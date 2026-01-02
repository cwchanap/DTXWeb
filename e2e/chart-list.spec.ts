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

	test('should select chart when clicked', async ({ page }) => {
		await page.waitForSelector('text=Song One');

		const chartItem = page.locator('[data-testid="chart-item"]').first();
		await chartItem.click();

		// Verify chart is selected (could check for selected styling or state)
		await expect(chartItem).toHaveAttribute('data-selected', 'true');
	});
});
