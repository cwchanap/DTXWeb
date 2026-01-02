import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('DTX to MIDI Converter Tool', () => {
	// Test fixture paths
	const testDtxPath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

	test.describe('Navigation and Initial State', () => {
		test('should navigate from tools page to DTX to MIDI converter', async ({ page }) => {
			await page.goto(PAGES.TOOLS);

			// Verify tools page loads
			await expect(page.getByRole('heading', { name: 'Available Tools' })).toBeVisible();

			// Verify DTX to MIDI converter tool is available
			await expect(
				page.getByRole('heading', { name: 'DTX to MIDI Converter' })
			).toBeVisible();
			await expect(
				page.getByText(
					'Convert DTX drum chart files to MIDI format for use with digital audio'
				)
			).toBeVisible();

			// Click on DTX to MIDI converter tool
			await page.getByRole('button', { name: 'Open Tool' }).first().click();

			// Verify navigation to converter page
			await expect(page).toHaveURL(PAGES.DTX_CONVERTER);
			await expect(
				page.getByRole('heading', { name: 'DTX to MIDI Converter', level: 1 })
			).toBeVisible();
		});
	});

	test.describe('Download Functionality', () => {
		test('should download MIDI file successfully', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload and convert file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();
			await page.getByRole('button', { name: 'Convert to MIDI' }).click();
			await expect(page.getByRole('heading', { name: 'Conversion Complete!' })).toBeVisible();

			// Test download
			const downloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download MIDI File' }).click();
			const download = await downloadPromise;

			// Verify download
			expect(download.suggestedFilename()).toBe('test-sample.mid');

			// Verify success message
			await expect(page.getByText('MIDI file downloaded successfully!')).toBeVisible();
		});
	});
});
