import { test, expect } from '@playwright/test';
import { PAGES } from './constants';

test.describe('Editor page', () => {
	test.describe('Basic Editor Loading', () => {
		test('loads editor page with empty chart', async ({ page }) => {
			await page.goto(PAGES.EDITOR);

			// Wait for page to load
			await page.waitForLoadState('networkidle');

			// Check for main editor components
			await expect(page.locator('canvas')).toBeVisible(); // Phaser game canvas
			await expect(page.getByText('File')).toBeVisible(); // Navigation menu
		});

		test('loads editor page with specific simfile', async ({ page }) => {
			await page.goto(PAGES.EDITOR_WITH_SIMFILE('318'));

			// Wait for page to load
			await page.waitForLoadState('networkidle');

			// Check for main editor components
			await expect(page.locator('canvas')).toBeVisible();
			await expect(page.getByText('File')).toBeVisible();

			// Switch to Sound tab
			await page.getByRole('button', { name: 'Sound' }).click();

			// Check for sound chips from simfile 318
			await expect(page.getByText('bass.xa').first()).toBeVisible();
			await expect(page.getByText('snare.ogg').first()).toBeVisible();

			// Should show difficulty modal or other simfile-specific elements
			// Note: This may require specific assertions based on the simfile data
		});
	});
});
