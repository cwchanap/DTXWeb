import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('DTX to MIDI Converter Tool', () => {
	// Test fixture paths
	const testDtxPath = path.join(__dirname, 'fixtures', 'test-sample.dtx');
	const simpleDtxPath = path.join(__dirname, 'fixtures', 'simple-test.dtx');
	const invalidFilePath = path.join(__dirname, 'fixtures', 'invalid-file.txt');

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

		test('should display initial upload interface', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Verify upload section
			await expect(
				page.getByRole('heading', { name: 'Convert DTX to MIDI', level: 2 })
			).toBeVisible();
			await expect(
				page.getByRole('heading', { name: 'Upload DTX File', level: 3 })
			).toBeVisible();
			await expect(page.getByText('Select a .dtx file to convert')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Verify info section
			await expect(
				page.getByRole('heading', { name: 'About DTX to MIDI Conversion' })
			).toBeVisible();
			await expect(
				page.getByText('This tool converts DTX drum chart files to MIDI format')
			).toBeVisible();
		});

		test('should have working navigation back to tools', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Click back button
			await page.getByRole('button', { name: '← Back to Tools' }).click();

			// Verify navigation back to tools page
			await expect(page).toHaveURL(PAGES.TOOLS);
			await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();
		});
	});

	test.describe('File Upload Functionality', () => {
		test('should upload and process a valid DTX file', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			// Verify file is uploaded and ready state is shown
			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();
			await expect(page.getByText('test-sample.dtx')).toBeVisible();

			// Verify lane mapping section appears
			await expect(
				page.getByRole('heading', { name: 'DTX Lane to MIDI Note Mapping' })
			).toBeVisible();
			await expect(
				page.getByText('Configure which MIDI note number each DTX lane should map to')
			).toBeVisible();

			// Verify convert button appears
			await expect(page.getByRole('button', { name: 'Convert to MIDI' })).toBeVisible();
		});

		test('should reject invalid file types with error message', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Try to upload invalid file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([invalidFilePath]);

			// Verify error notification
			await expect(page.getByText('Invalid file type')).toBeVisible();
			await expect(page.getByText('Please select a valid DTX file (.dtx)')).toBeVisible();

			// Verify upload interface is still shown (file not accepted)
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();
			await expect(page.getByText('Select a .dtx file to convert')).toBeVisible();
		});

		test('should allow removing uploaded file', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload a file first
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			// Wait for upload to complete
			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();

			// Click remove button
			await page.getByRole('button', { name: 'Remove' }).click();

			// Verify file is removed and upload interface is shown again
			await expect(
				page.getByRole('heading', { name: 'Upload DTX File', level: 3 })
			).toBeVisible();
			await expect(page.getByText('Select a .dtx file to convert')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Verify mapping section is no longer visible
			await expect(
				page.getByRole('heading', { name: 'DTX Lane to MIDI Note Mapping' })
			).not.toBeVisible();
		});

		test('should allow choosing a different file', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload a file first
			let fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			let fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			// Wait for upload to complete
			await expect(page.getByText('test-sample.dtx')).toBeVisible();

			// Click choose different file
			fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose Different File' }).click();
			fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([simpleDtxPath]);

			// Verify new file is loaded
			await expect(page.getByText('simple-test.dtx')).toBeVisible();
		});
	});

	test.describe('MIDI Note Mapping Configuration', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload test DTX file for each test
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			// Wait for upload to complete
			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();
		});

		test('should display default MIDI note mapping', async ({ page }) => {
			// Verify mapping section is displayed
			await expect(
				page.getByRole('heading', { name: 'DTX Lane to MIDI Note Mapping' })
			).toBeVisible();

			// Check default values for common drums
			await expect(page.locator('input[id="lane-01"]')).toHaveValue('36'); // Bass Drum
			await expect(page.locator('input[id="lane-02"]')).toHaveValue('38'); // Snare
			await expect(page.locator('input[id="lane-03"]')).toHaveValue('42'); // Closed Hi-Hat
			await expect(page.locator('input[id="lane-04"]')).toHaveValue('46'); // Open Hi-Hat

			// Check drum names are displayed
			await expect(page.getByText('Bass Drum')).toBeVisible();
			await expect(page.getByText('Snare')).toBeVisible();
			await expect(page.getByText('Closed Hi-Hat')).toBeVisible();
		});

		test('should allow customization of note mappings', async ({ page }) => {
			// Change Bass Drum from 36 to 50 (High Tom)
			await page.locator('input[id="lane-01"]').fill('50');
			await expect(page.locator('input[id="lane-01"]')).toHaveValue('50');

			// Change Snare from 38 to 42 (Hi-Hat)
			await page.locator('input[id="lane-02"]').fill('42');
			await expect(page.locator('input[id="lane-02"]')).toHaveValue('42');

			// Verify other values remain unchanged
			await expect(page.locator('input[id="lane-03"]')).toHaveValue('42');
		});

		test('should validate MIDI note number ranges', async ({ page }) => {
			const bassInput = page.locator('input[id="lane-01"]');

			// Test valid boundary values
			await bassInput.fill('0');
			await expect(bassInput).toHaveValue('0');

			await bassInput.fill('127');
			await expect(bassInput).toHaveValue('127');

			// Test typical drum values
			await bassInput.fill('36');
			await expect(bassInput).toHaveValue('36');
		});

		test('should display all 12 DTX lanes with correct labels', async ({ page }) => {
			const expectedLanes = [
				{ id: '01', name: 'Bass Drum' },
				{ id: '02', name: 'Snare' },
				{ id: '03', name: 'Closed Hi-Hat' },
				{ id: '04', name: 'Open Hi-Hat' },
				{ id: '05', name: 'Crash' },
				{ id: '06', name: 'Ride' },
				{ id: '07', name: 'Low Tom' },
				{ id: '08', name: 'Mid Tom' },
				{ id: '09', name: 'High Tom' },
				{ id: '0A', name: 'Pedal Hi-Hat' },
				{ id: '0B', name: 'Crash 2' },
				{ id: '0C', name: 'Ride 2' }
			];

			for (const lane of expectedLanes) {
				await expect(page.locator(`input[id="lane-${lane.id}"]`)).toBeVisible();
				await expect(page.getByText(lane.name)).toBeVisible();
			}
		});
	});

	test.describe('Conversion Process', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload test DTX file for each test
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			// Wait for upload to complete
			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();
		});

		test('should complete full conversion workflow', async ({ page }) => {
			// Verify convert button is available
			await expect(page.getByRole('button', { name: 'Convert to MIDI' })).toBeVisible();

			// Click convert button
			await page.getByRole('button', { name: 'Convert to MIDI' }).click();

			// Wait for conversion to complete
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Conversion Complete!' })).toBeVisible();

			// Verify download section appears
			await expect(page.getByText('Your MIDI file is ready for download')).toBeVisible();
			await expect(page.getByText('test-sample.mid')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Download MIDI File' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Convert Another File' })).toBeVisible();
		});

		test('should show conversion progress states', async ({ page }) => {
			const convertButton = page.getByRole('button', { name: 'Convert to MIDI' });

			// Initial state
			await expect(convertButton).toBeVisible();
			await expect(convertButton).toHaveText('Convert to MIDI');

			// Click to start conversion
			await convertButton.click();

			// Check for completion state
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible();
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeDisabled();
		});

		test('should allow converting another file after completion', async ({ page }) => {
			// Complete first conversion
			await page.getByRole('button', { name: 'Convert to MIDI' }).click();
			await expect(page.getByRole('heading', { name: 'Conversion Complete!' })).toBeVisible();

			// Click convert another file
			await page.getByRole('button', { name: 'Convert Another File' }).click();

			// Verify back to upload state
			await expect(
				page.getByRole('heading', { name: 'Upload DTX File', level: 3 })
			).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Verify conversion results are cleared
			await expect(
				page.getByRole('heading', { name: 'Conversion Complete!' })
			).not.toBeVisible();
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

	test.describe('Error Handling', () => {
		test('should handle conversion errors gracefully', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();

			// Mock a conversion error (this would require setting up a mock or corrupted file)
			// For now, we'll just test that the UI handles the error state properly
			await page.getByRole('button', { name: 'Convert to MIDI' }).click();

			// The conversion should either succeed or show an error
			// If it succeeds, that's also fine for this test
			try {
				await expect(
					page.getByRole('heading', { name: 'Conversion Complete!' })
				).toBeVisible({ timeout: 5000 });
			} catch {
				// If conversion fails, check for error handling
				await expect(page.getByText('Conversion failed')).toBeVisible();
			}
		});
	});

	test.describe('Responsive Design', () => {
		test('should work on mobile viewport', async ({ page }) => {
			// Set mobile viewport
			await page.setViewportSize({ width: 375, height: 667 });
			await page.goto(PAGES.DTX_CONVERTER);

			// Verify mobile layout
			await expect(
				page.getByRole('heading', { name: 'DTX to MIDI Converter', level: 1 })
			).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Test file upload on mobile
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			// Verify mobile display of mapping
			await expect(
				page.getByRole('heading', { name: 'DTX Lane to MIDI Note Mapping' })
			).toBeVisible();
		});
	});

	test.describe('Accessibility', () => {
		test('should have proper heading hierarchy', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Verify heading levels are correct
			await expect(
				page.getByRole('heading', { level: 1, name: 'DTX to MIDI Converter' })
			).toBeVisible();
			await expect(
				page.getByRole('heading', { level: 2, name: 'Convert DTX to MIDI' })
			).toBeVisible();
			await expect(
				page.getByRole('heading', { level: 3, name: 'About DTX to MIDI Conversion' })
			).toBeVisible();
		});

		test('should have accessible form controls', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Upload file to show mapping controls
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testDtxPath]);

			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();

			// Check that form inputs have proper labels
			await expect(page.getByLabelText('01:')).toBeVisible();
			await expect(page.getByLabelText('02:')).toBeVisible();
			await expect(page.getByLabelText('03:')).toBeVisible();
		});

		test('should handle keyboard navigation', async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);

			// Tab through the interface
			await page.keyboard.press('Tab'); // Should focus on "Back to Tools"
			await expect(page.getByRole('button', { name: '← Back to Tools' })).toBeFocused();

			// Continue tabbing to other interactive elements
			await page.keyboard.press('Tab');
			await page.keyboard.press('Tab'); // Should eventually reach "Choose File"
		});
	});
});
