import { test, expect } from '@playwright/test';
import { PAGES } from './constants';

test.describe('Blog page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(PAGES.BLOG);
	});

	test('loads with expected header', async ({ page }) => {
		await expect(
			page.getByRole('heading', { level: 1, name: "Welcome to Hapadona's DTX Blog" })
		).toBeVisible();
	});

	test('shows Latest News section', async ({ page }) => {
		await expect(page.getByRole('heading', { level: 2, name: 'Latest News' })).toBeVisible();
		// Content may change as news gets added; at minimum the section renders.
		await expect(page.getByText('No news yet.')).toBeVisible();
	});

	test('shows Latest Simfiles with search and pagination controls', async ({ page }) => {
		await expect(
			page.getByRole('heading', { level: 2, name: 'Latest Simfiles' })
		).toBeVisible();

		// Search input by placeholder
		await expect(page.getByPlaceholder('search by song name or artist')).toBeVisible();

		// Items per page selector exists with expected options
		await expect(page.getByText('Items:')).toBeVisible();
		const combo = page.getByRole('combobox');
		await expect(combo).toBeVisible();
		const options = combo.locator('option');
		await expect(options).toHaveCount(4);
		await expect(options.nth(0)).toHaveText('6');
		await expect(options.nth(1)).toHaveText('12');
		await expect(options.nth(2)).toHaveText('24');
		await expect(options.nth(3)).toHaveText('48');
	});

	test('has view toggle and language controls', async ({ page }) => {
		await expect(page.getByText('View:')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Card view' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible();

		// Language switcher button present
		await expect(page.getByRole('button', { name: 'Language' })).toBeVisible();
	});
});
