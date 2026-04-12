import { test, expect } from '@playwright/test';

const mockChart = {
	id: 7777,
	title: 'E2E Nav Chart',
	artist: 'E2E Artist',
	bpm: 140,
	is_published: true,
	display_id: 'E2E01',
	dtx_files: [],
	publish_date: '2024-01-01',
	download_url: null,
	video_preview_url: null
};

test.describe('Chart list item navigation', () => {
	test.beforeEach(async ({ page }) => {
		await page.route('**/api/chart*', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ data: [mockChart], count: 1 })
			});
		});

		await page.goto('/blog');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
	});

	test('clicking a chart card navigates to the chart editor', async ({ page }) => {
		const card = page.getByRole('link', { name: /open e2e nav chart in chart editor/i });
		await expect(card).toBeVisible();

		await Promise.all([page.waitForURL(/\/editor\/7777/), card.click()]);
	});

	test('clicking a chart row in table view navigates to the chart editor', async ({ page }) => {
		await page.getByRole('button', { name: 'Table view' }).click();

		const row = page.getByRole('link', { name: /open e2e nav chart in chart editor/i });
		await expect(row).toBeVisible();

		await Promise.all([page.waitForURL(/\/editor\/7777/), row.click()]);
	});
});

test.describe('Landing page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
	});

	test('shows the hero content', async ({ page }) => {
		await expect(page.getByRole('heading', { name: 'Feel the Beat' })).toBeVisible();
		await expect(
			page.getByText(
				'Experience the ultimate rhythm gaming platform for DTX drum simulation files.'
			)
		).toBeVisible();
	});

	test('navigates to core sections from hero actions', async ({ page }) => {
		await page.getByRole('button', { name: /Explore Charts/i }).click();
		await expect(page).toHaveURL(/\/blog$/);

		await page.goto('/');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		await page.getByRole('button', { name: /Chart Editor/i }).click();
		await expect(page).toHaveURL(/\/editor$/);

		await page.goto('/');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
		await page.getByRole('button', { name: /DTX Tools/i }).click();
		await expect(page).toHaveURL(/\/tool$/);
	});
});
