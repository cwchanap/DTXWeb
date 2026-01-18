import { test, expect } from '@playwright/test';
import { PAGES } from './constants';

test.describe('Editor page', () => {
	test.describe('Basic Editor Loading', () => {
		test('loads editor page with empty chart', async ({ page }) => {
			await page.goto(PAGES.EDITOR);

			// Wait for page to load
			await page.waitForLoadState('networkidle');
			await page.waitForSelector('html[data-e2e-hydrated="true"]');

			// Check for main editor components
			await expect(page.getByTestId('editor-root')).toBeVisible({ timeout: 15000 });
			await expect(page.getByText('File')).toBeVisible({ timeout: 10000 });
			await expect(page.getByRole('button', { name: 'Editor Tabs' })).toBeVisible({
				timeout: 10000
			});
		});

		test('loads editor page with specific simfile', async ({ page }) => {
			await page.goto(PAGES.EDITOR_WITH_SIMFILE('318'));

			// Wait for page to load
			await page.waitForLoadState('networkidle');
			await page.waitForSelector('html[data-e2e-hydrated="true"]');

			// Check for main editor components
			await expect(page.getByTestId('editor-root')).toBeVisible({ timeout: 15000 });
			await expect(page.getByText('File')).toBeVisible({ timeout: 10000 });
			await expect(page.getByRole('button', { name: 'Editor Tabs' })).toBeVisible({
				timeout: 10000
			});
		});
	});
});
