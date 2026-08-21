import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
import { CHART_B_ID, CHART_B_TITLE } from './test-config';

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

	test('opens a published uploaded chart in the public notation preview', async ({ page }) => {
		// The card title links to /preview/[id] for previewable charts, and the
		// card's [⋮] menu also carries an explicit entry (labeled "Open in Music
		// Tab"). The entry appears only for a published chart with an uploaded
		// file (ChartList.helpers.ts isPreviewable) — seeded CHART_B_ID is both.
		const card = page.locator('.music-card').filter({ hasText: CHART_B_TITLE }).first();
		await card.getByRole('button', { name: 'Actions' }).click();

		const previewEntry = page.getByRole('menuitem', { name: 'Open in Music Tab' });
		await expect(previewEntry).toHaveAttribute('href', `/preview/${CHART_B_ID}`);
		await previewEntry.click();
		await expect(page).toHaveURL(PAGES.PREVIEW(CHART_B_ID));
	});

	test('links the card title to the public notation preview', async ({ page }) => {
		const titleLink = page.getByRole('link', { name: CHART_B_TITLE });
		await expect(titleLink).toHaveAttribute('href', `/preview/${CHART_B_ID}`);
	});
});
