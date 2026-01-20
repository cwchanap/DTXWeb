import { test, expect, type Page } from '@playwright/test';
import { PAGES } from './constants';

const waitForXaDecoder = async (page: Page) => {
	await page.waitForFunction(
		() =>
			(window as { __xaDecoderReady?: boolean; __xaDecoderError?: string })
				.__xaDecoderReady === true ||
			(window as { __xaDecoderReady?: boolean; __xaDecoderError?: string }).__xaDecoderError,
		{ timeout: 30000 }
	);

	const error = await page.evaluate(
		() => (window as { __xaDecoderError?: string }).__xaDecoderError
	);
	expect(error).toBeFalsy();

	const ready = await page.evaluate(
		() => (window as { __xaDecoderReady?: boolean }).__xaDecoderReady
	);
	expect(ready).toBe(true);
};

test.describe('Editor page', () => {
	test.describe('Basic Editor Loading', () => {
		test('loads editor page with empty chart', async ({ page }) => {
			await page.goto(PAGES.EDITOR);

			// Wait for page to load
			await page.waitForLoadState('networkidle');
			await page.waitForSelector('html[data-e2e-hydrated="true"]');
			await waitForXaDecoder(page);

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
			await waitForXaDecoder(page);

			// Check for main editor components
			await expect(page.getByTestId('editor-root')).toBeVisible({ timeout: 15000 });
			await expect(page.getByText('File')).toBeVisible({ timeout: 10000 });
			await expect(page.getByRole('button', { name: 'Editor Tabs' })).toBeVisible({
				timeout: 10000
			});
		});
	});
});
