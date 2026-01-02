import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('MIDI to DTX Converter Tool', () => {
	// Test fixture paths (using the same fixtures as MIDI preview)
	const testMidiPath = path.join(__dirname, 'fixtures', 'test-sample.mid');

	test.describe('Navigation and Initial State', () => {
		test('should navigate from tools page to MIDI to DTX converter', async ({ page }) => {
			await page.goto(PAGES.TOOLS);

			// Verify tools page loads
			await expect(page.getByRole('heading', { name: 'Available Tools' })).toBeVisible();

			// Verify MIDI to DTX Converter tool is available
			await expect(
				page.getByRole('heading', { name: 'MIDI to DTX Converter' })
			).toBeVisible();
			await expect(
				page.getByText('Convert MIDI files to DTX drum chart format for rhythm game use')
			).toBeVisible();

			// Click on MIDI to DTX Converter tool (second tool in the list)
			await page.getByRole('button', { name: 'Open Tool' }).nth(1).click();

			// Verify navigation to MIDI to DTX converter page
			await expect(page).toHaveURL(PAGES.MIDI_TO_DTX_CONVERTER);
			await expect(
				page.getByRole('heading', { name: 'MIDI to DTX Converter', level: 1 })
			).toBeVisible();
		});
	});

	test.describe('File Upload Functionality', () => {
		test('should upload a valid MIDI file', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Verify file is uploaded and UI updates
			await expect(page.getByRole('heading', { name: 'File Ready', level: 3 })).toBeVisible();
			await expect(page.getByText('test-sample.mid')).toBeVisible();
			await expect(page.getByText(/\d+\.\d+ KB/)).toBeVisible();

			// Verify file action buttons appear
			await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose Different File' })).toBeVisible();

			// Verify DTX metadata section appears
			await expect(page.getByRole('heading', { name: 'DTX File Settings' })).toBeVisible();
			await expect(page.getByLabelText('Title')).toBeVisible();
			await expect(page.getByLabelText('Artist')).toBeVisible();
			await expect(page.getByLabelText('Difficulty Level')).toBeVisible();
			await expect(page.getByLabelText('BPM')).toBeVisible();
			await expect(page.getByLabelText('Comment')).toBeVisible();

			// Verify MIDI note mapping section appears
			await expect(
				page.getByRole('heading', { name: 'MIDI Note to DTX Lane Mapping' })
			).toBeVisible();
		});
	});

	test.describe('Conversion Process', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload test MIDI file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Wait for the convert button to appear
			await expect(page.getByRole('button', { name: 'Convert to DTX' })).toBeVisible();
		});

		test('should allow downloading converted DTX file', async ({ page }) => {
			// Convert the file
			await page.getByRole('button', { name: 'Convert to DTX' }).click();
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible({
				timeout: 10000
			});

			// Set up download event listener
			const downloadPromise = page.waitForEvent('download');

			// Click download button
			await page.getByRole('button', { name: 'Download DTX File' }).click();

			// Wait for download to start
			const download = await downloadPromise;

			// Verify download filename
			expect(download.suggestedFilename()).toBe('test-sample.dtx');

			// Verify success notification
			await expect(page.getByText('DTX file downloaded successfully!')).toBeVisible({
				timeout: 5000
			});
		});
	});
});
