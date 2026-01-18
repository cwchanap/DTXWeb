import { test, expect } from '@playwright/test';
import { PAGES } from './constants';

test.describe('Editor page', () => {
	test.describe('Basic Editor Loading', () => {
		test('loads editor page with empty chart', async ({ page }) => {
			await page.goto(PAGES.EDITOR);

			// Wait for page to load
			await page.waitForLoadState('networkidle');

			// Check for main editor components
			await expect(page.locator('#game-container')).toBeVisible();
			await expect(page.getByText('File')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Editor Tabs' })).toBeVisible();
		});

		test('loads editor page with specific simfile', async ({ page }) => {
			await page.goto(PAGES.EDITOR_WITH_SIMFILE('318'));

			// Wait for page to load
			await page.waitForLoadState('networkidle');

			// Check for main editor components
			await expect(page.locator('#game-container')).toBeVisible();
			await expect(page.getByText('File')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Editor Tabs' })).toBeVisible();
		});
	});
});
