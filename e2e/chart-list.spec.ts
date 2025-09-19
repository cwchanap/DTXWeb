import { test, expect } from '@playwright/test';

test.describe('ChartList E2E Tests', () => {
	test.beforeEach(async ({ page }) => {
		// Navigate to the app
		await page.goto('/');
		// Wait for the chart list to load
		await page.waitForSelector('[data-testid="chart-list"]', { timeout: 10000 });
	});

	test('should render chart list with simfiles', async ({ page }) => {
		// Wait for charts to load
		await page.waitForSelector('text=Song One', { timeout: 5000 });

		await expect(page.locator('text=Song One')).toBeVisible();
		await expect(page.locator('text=Song Two')).toBeVisible();
		await expect(page.locator('text=Artist One')).toBeVisible();
		await expect(page.locator('text=Artist Two')).toBeVisible();
		await expect(page.locator('text=120 BPM')).toBeVisible();
		await expect(page.locator('text=140 BPM')).toBeVisible();
	});

	test('should display empty state when no simfiles exist', async ({ page }) => {
		// Mock empty response or navigate to empty workspace
		await page.route('**/api/simfiles', (route) => {
			route.fulfill({ json: [] });
		});

		await page.reload();
		await expect(page.locator('text=no charts found')).toBeVisible();
	});

	test('should select chart when clicked', async ({ page }) => {
		await page.waitForSelector('text=Song One');

		const chartItem = page.locator('[data-testid="chart-item"]').first();
		await chartItem.click();

		// Verify chart is selected (could check for selected styling or state)
		await expect(chartItem).toHaveAttribute('data-selected', 'true');
	});

	test('should filter charts by search term', async ({ page }) => {
		await page.waitForSelector('text=Song One');
		await page.waitForSelector('text=Song Two');

		const searchInput = page.locator('input[placeholder*="search"]');
		await searchInput.fill('Song One');

		await expect(page.locator('text=Song One')).toBeVisible();
		await expect(page.locator('text=Song Two')).toBeHidden();
	});

	test('should sort charts by different criteria', async ({ page }) => {
		await page.waitForSelector('text=Song One');

		const sortDropdown = page.locator('[data-testid="sort-dropdown"]');
		await sortDropdown.selectOption('bpm');

		// Verify sorting order
		const chartItems = page.locator('[data-testid="chart-item"]');
		await expect(chartItems.first()).toContainText('Song One'); // 120 BPM first
		await expect(chartItems.nth(1)).toContainText('Song Two'); // 140 BPM second

		// Sort by BPM descending
		await sortDropdown.selectOption('bpm-desc');
		await expect(chartItems.first()).toContainText('Song Two'); // 140 BPM first
		await expect(chartItems.nth(1)).toContainText('Song One'); // 120 BPM second
	});

	test('should delete chart with confirmation', async ({ page }) => {
		await page.waitForSelector('text=Song One');

		const deleteButton = page.locator('[data-testid="delete-chart-simfile-1"]');
		await deleteButton.click();

		// Should show confirmation dialog
		await expect(page.locator('text=confirm delete')).toBeVisible();

		const confirmButton = page.locator('button:has-text("confirm")');
		await confirmButton.click();

		// Verify chart is removed
		await expect(page.locator('text=Song One')).toBeHidden();
	});

	test('should cancel chart deletion', async ({ page }) => {
		await page.waitForSelector('text=Song One');

		const deleteButton = page.locator('button:has-text("delete")');
		await deleteButton.click();

		const cancelButton = page.locator('button:has-text("cancel")');
		await cancelButton.click();

		// Confirmation dialog should be hidden
		await expect(page.locator('text=confirm delete')).toBeHidden();
		// Chart should still be visible
		await expect(page.locator('text=Song One')).toBeVisible();
	});

	test('should display temporary charts alongside saved ones', async ({ page }) => {
		// Mock temp charts response
		await page.route('**/api/temp-charts', (route) => {
			route.fulfill({
				json: [
					{
						id: 'temp-1',
						title: 'Temporary Song',
						artist: 'Temp Artist',
						isTemporary: true
					}
				]
			});
		});

		await page.reload();
		await expect(page.locator('text=Temporary Song')).toBeVisible();
		await expect(page.locator('text=Song One')).toBeVisible();

		// Temporary charts should be visually distinct
		const tempChart = page.locator('[data-temporary="true"]');
		await expect(tempChart).toBeVisible();
	});

	test('should support keyboard navigation', async ({ page }) => {
		await page.waitForSelector('text=Song One');

		const firstChart = page.locator('[data-testid="chart-item"]').first();
		await firstChart.focus();

		// Press Enter to select
		await page.keyboard.press('Enter');

		// Verify selection
		await expect(firstChart).toHaveAttribute('data-selected', 'true');
	});

	test('should handle large numbers of charts efficiently', async ({ page }) => {
		// Mock many charts
		const manyCharts = Array.from({ length: 1000 }, (_, i) => ({
			id: `simfile-${i}`,
			title: `Song ${i}`,
			artist: `Artist ${i}`,
			bpm: 120 + i
		}));

		await page.route('**/api/simfiles', (route) => {
			route.fulfill({ json: manyCharts });
		});

		await page.reload();

		// Should implement virtualization or pagination
		const visibleCharts = page.locator('[data-testid="chart-item"]');
		const count = await visibleCharts.count();
		expect(count).toBeLessThanOrEqual(50); // Should not render all 1000
	});

	test('should recover from network errors', async ({ page }) => {
		// Mock network error
		await page.route('**/api/simfiles', (route) => {
			route.abort('failed');
		});

		await page.reload();
		await expect(page.locator('text=error loading charts')).toBeVisible();

		// Mock successful retry
		await page.route('**/api/simfiles', (route) => {
			route.fulfill({
				json: [
					{
						id: 'simfile-1',
						title: 'Song One',
						artist: 'Artist One',
						bpm: 120
					}
				]
			});
		});

		const retryButton = page.locator('button:has-text("retry")');
		await retryButton.click();

		await expect(page.locator('text=Song One')).toBeVisible();
	});

	test('should have proper accessibility labels', async ({ page }) => {
		await page.waitForSelector('[aria-label*="chart list"]');

		const chartList = page.locator('[aria-label*="chart list"]');
		await expect(chartList).toBeVisible();

		const chartItems = page.locator('[aria-label*="chart:"]');
		const count = await chartItems.count();
		expect(count).toBeGreaterThan(0);
	});

	test('should announce selection changes to screen readers', async ({ page }) => {
		const announcement = page.locator('[role="status"][aria-label*="selected chart"]');
		await expect(announcement).toBeVisible();
	});
});
