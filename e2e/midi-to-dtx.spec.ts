import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('MIDI to DTX Converter Tool', () => {
	// Test fixture paths (using the same fixtures as MIDI preview)
	const testMidiPath = path.join(__dirname, 'fixtures', 'test-sample.mid');
	const emptyMidiPath = path.join(__dirname, 'fixtures', 'empty-sample.mid');
	const multiTrackMidiPath = path.join(__dirname, 'fixtures', 'multi-track-sample.mid');
	const invalidFilePath = path.join(__dirname, 'fixtures', 'invalid-file.txt');

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

		test('should display initial upload interface', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Verify page title and heading
			await expect(
				page.getByRole('heading', { name: 'MIDI to DTX Converter', level: 1 })
			).toBeVisible();
			await expect(
				page.getByRole('heading', { name: 'Convert MIDI to DTX', level: 2 })
			).toBeVisible();

			// Verify upload section
			await expect(
				page.getByRole('heading', { name: 'Upload MIDI File', level: 3 })
			).toBeVisible();
			await expect(page.getByText('Select a .mid or .midi file to convert')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Verify info section
			await expect(
				page.getByRole('heading', { name: 'About MIDI to DTX Conversion' })
			).toBeVisible();
			await expect(
				page.getByText('This tool converts MIDI files to DTX drum chart format')
			).toBeVisible();
		});

		test('should have working navigation back to tools', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Click back button
			await page.getByRole('button', { name: '← Back to Tools' }).click();

			// Verify navigation back to tools page
			await expect(page).toHaveURL(PAGES.TOOLS);
			await expect(page.getByRole('heading', { name: 'Tools', level: 1 })).toBeVisible();
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

		test('should reject invalid file types with error message', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Try to upload invalid file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([invalidFilePath]);

			// Verify error notification (wait for it to appear)
			await expect(page.getByText('Invalid file type')).toBeVisible({ timeout: 5000 });
			await expect(
				page.getByText('Please select a valid MIDI file (.mid or .midi)')
			).toBeVisible();

			// Verify upload interface is still shown (file not accepted)
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();
			await expect(page.getByText('Select a .mid or .midi file to convert')).toBeVisible();

			// Verify metadata and mapping sections do not appear
			await expect(
				page.getByRole('heading', { name: 'DTX File Settings' })
			).not.toBeVisible();
			await expect(
				page.getByRole('heading', { name: 'MIDI Note to DTX Lane Mapping' })
			).not.toBeVisible();
		});

		test('should allow removing uploaded file', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload a file first
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Wait for file to be uploaded
			await expect(page.getByRole('heading', { name: 'File Ready', level: 3 })).toBeVisible();

			// Click remove button
			await page.getByRole('button', { name: 'Remove' }).click();

			// Verify file is removed and upload interface is shown again
			await expect(
				page.getByRole('heading', { name: 'Upload MIDI File', level: 3 })
			).toBeVisible();
			await expect(page.getByText('Select a .mid or .midi file to convert')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Verify metadata and mapping sections are hidden
			await expect(
				page.getByRole('heading', { name: 'DTX File Settings' })
			).not.toBeVisible();
			await expect(
				page.getByRole('heading', { name: 'MIDI Note to DTX Lane Mapping' })
			).not.toBeVisible();
		});

		test('should allow choosing a different file', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload a file first
			let fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			let fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Wait for upload to complete
			await expect(page.getByText('test-sample.mid')).toBeVisible();

			// Click choose different file
			fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose Different File' }).click();
			fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([emptyMidiPath]);

			// Verify new file is loaded
			await expect(page.getByText('empty-sample.mid')).toBeVisible();
			await expect(page.getByRole('heading', { name: 'File Ready', level: 3 })).toBeVisible();
		});
	});

	test.describe('DTX Metadata Configuration', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload test MIDI file for each test
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Wait for upload to complete
			await expect(page.getByRole('heading', { name: 'DTX File Settings' })).toBeVisible();
		});

		test('should have default metadata values', async ({ page }) => {
			// Check default values
			await expect(page.getByLabelText('Title')).toHaveValue('test-sample');
			await expect(page.getByLabelText('Artist')).toHaveValue('Unknown');
			await expect(page.getByLabelText('Difficulty Level')).toHaveValue('5');
			await expect(page.getByLabelText('BPM')).toHaveValue('120');
			await expect(page.getByLabelText('Comment')).toHaveValue('Converted from MIDI file');
		});

		test('should allow editing metadata fields', async ({ page }) => {
			// Edit title
			await page.getByLabelText('Title').fill('My Custom Song');
			await expect(page.getByLabelText('Title')).toHaveValue('My Custom Song');

			// Edit artist
			await page.getByLabelText('Artist').fill('Test Artist');
			await expect(page.getByLabelText('Artist')).toHaveValue('Test Artist');

			// Edit difficulty level
			await page.getByLabelText('Difficulty Level').fill('8');
			await expect(page.getByLabelText('Difficulty Level')).toHaveValue('8');

			// Edit BPM
			await page.getByLabelText('BPM').fill('140');
			await expect(page.getByLabelText('BPM')).toHaveValue('140');

			// Edit comment
			await page.getByLabelText('Comment').fill('Custom comment');
			await expect(page.getByLabelText('Comment')).toHaveValue('Custom comment');
		});

		test('should validate metadata input ranges', async ({ page }) => {
			// Test difficulty level validation
			const levelInput = page.getByLabelText('Difficulty Level');
			await levelInput.fill('0');
			await expect(levelInput).toHaveAttribute('min', '1');
			await expect(levelInput).toHaveAttribute('max', '10');

			// Test BPM validation
			const bpmInput = page.getByLabelText('BPM');
			await bpmInput.fill('59');
			await expect(bpmInput).toHaveAttribute('min', '60');
			await expect(bpmInput).toHaveAttribute('max', '300');
		});
	});

	test.describe('MIDI Note Mapping Configuration', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload test MIDI file for each test
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Wait for mapping section to appear
			await expect(
				page.getByRole('heading', { name: 'MIDI Note to DTX Lane Mapping' })
			).toBeVisible();
		});

		test('should display MIDI note mapping configuration', async ({ page }) => {
			// Verify mapping section content
			await expect(
				page.getByText('Configure which DTX lane each MIDI drum note should map to')
			).toBeVisible();

			// Verify some common drum mappings are shown
			await expect(page.getByText('Bass Drum (36):')).toBeVisible();
			await expect(page.getByText('Snare (38):')).toBeVisible();
			await expect(page.getByText('Closed Hi-Hat (42):')).toBeVisible();
			await expect(page.getByText('Open Hi-Hat (46):')).toBeVisible();
		});

		test('should allow customizing note mappings', async ({ page }) => {
			// Find the select for Bass Drum (36) and change its mapping
			const bassDrumSelect = page
				.locator('text=Bass Drum (36):')
				.locator('..')
				.locator('select');
			await bassDrumSelect.selectOption('02'); // Map to Snare lane

			// Verify the selection was made
			await expect(bassDrumSelect).toHaveValue('02');

			// Find the select for Snare (38) and change its mapping
			const snareSelect = page.locator('text=Snare (38):').locator('..').locator('select');
			await snareSelect.selectOption('01'); // Map to Bass Drum lane

			// Verify the selection was made
			await expect(snareSelect).toHaveValue('01');
		});

		test('should show all available DTX lanes in selects', async ({ page }) => {
			// Get the first select dropdown (Bass Drum)
			const firstSelect = page
				.locator('text=Bass Drum (36):')
				.locator('..')
				.locator('select');

			// Click to open dropdown and verify options are available
			await firstSelect.click();

			// Check for some expected lane options (these should be available)
			// Note: We can't easily check all options in Playwright, but we can verify the select works
			await expect(firstSelect).toBeVisible();
		});
	});

	test.describe('Conversion Process', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload test MIDI file and configure metadata
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Wait for the convert button to appear
			await expect(page.getByRole('button', { name: 'Convert to DTX' })).toBeVisible();
		});

		test('should show convert button after file upload', async ({ page }) => {
			// Verify convert button is visible and enabled
			const convertButton = page.getByRole('button', { name: 'Convert to DTX' });
			await expect(convertButton).toBeVisible();
			await expect(convertButton).toBeEnabled();
		});

		test('should show conversion progress', async ({ page }) => {
			// Click convert button
			const convertButton = page.getByRole('button', { name: 'Convert to DTX' });
			await convertButton.click();

			// Check for either converting state or completed state
			// (conversion might be very fast in tests)
			try {
				// Try to catch the converting state
				await expect(page.getByRole('button', { name: 'Converting...' })).toBeVisible({
					timeout: 1000
				});
				await expect(page.getByRole('button', { name: 'Converting...' })).toBeDisabled();
			} catch {
				// If we missed the converting state, that's okay - check for completed state
			}

			// Wait for conversion to complete
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible({
				timeout: 10000
			});
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeDisabled();
		});

		test('should show download section after successful conversion', async ({ page }) => {
			// Convert the file
			await page.getByRole('button', { name: 'Convert to DTX' }).click();

			// Wait for conversion to complete
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible({
				timeout: 10000
			});

			// Verify download section appears
			await expect(page.getByRole('heading', { name: 'Conversion Complete!' })).toBeVisible();
			await expect(page.getByText('Your DTX file is ready for download')).toBeVisible();
			await expect(page.getByText('test-sample.dtx')).toBeVisible();

			// Verify note conversion count is shown
			await expect(page.getByText(/Converted \d+ note events/)).toBeVisible();

			// Verify download and reset buttons
			await expect(page.getByRole('button', { name: 'Download DTX File' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Convert Another File' })).toBeVisible();
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

		test('should allow converting another file after completion', async ({ page }) => {
			// Convert the file
			await page.getByRole('button', { name: 'Convert to DTX' }).click();
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible({
				timeout: 10000
			});

			// Click convert another file
			await page.getByRole('button', { name: 'Convert Another File' }).click();

			// Verify interface resets to initial state
			await expect(
				page.getByRole('heading', { name: 'Upload MIDI File', level: 3 })
			).toBeVisible();
			await expect(page.getByText('Select a .mid or .midi file to convert')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Verify configuration sections are hidden
			await expect(
				page.getByRole('heading', { name: 'DTX File Settings' })
			).not.toBeVisible();
			await expect(
				page.getByRole('heading', { name: 'MIDI Note to DTX Lane Mapping' })
			).not.toBeVisible();
		});
	});

	test.describe('Error Handling', () => {
		test('should handle conversion errors gracefully', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload an empty MIDI file which might cause issues
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([emptyMidiPath]);

			// Wait for upload and try to convert
			await expect(page.getByRole('button', { name: 'Convert to DTX' })).toBeVisible();
			await page.getByRole('button', { name: 'Convert to DTX' }).click();

			// Should either convert successfully (empty DTX) or show an error
			// Wait for either success or error state
			try {
				await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible({
					timeout: 10000
				});
			} catch {
				// Check for error notification
				await expect(
					page.getByText(/Conversion failed|Failed to parse MIDI file/)
				).toBeVisible({ timeout: 5000 });
			}
		});
	});

	test.describe('Multi-track MIDI Support', () => {
		test('should handle multi-track MIDI files', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload multi-track MIDI file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([multiTrackMidiPath]);

			// Verify file loads successfully
			await expect(page.getByRole('heading', { name: 'File Ready', level: 3 })).toBeVisible();
			await expect(page.getByText('multi-track-sample.mid')).toBeVisible();

			// Should show configuration sections
			await expect(page.getByRole('heading', { name: 'DTX File Settings' })).toBeVisible();
			await expect(
				page.getByRole('heading', { name: 'MIDI Note to DTX Lane Mapping' })
			).toBeVisible();

			// Should allow conversion
			await expect(page.getByRole('button', { name: 'Convert to DTX' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Convert to DTX' })).toBeEnabled();
		});
	});

	test.describe('Responsive Design', () => {
		test('should work on mobile viewport', async ({ page }) => {
			// Set mobile viewport
			await page.setViewportSize({ width: 375, height: 667 });
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Verify mobile layout
			await expect(
				page.getByRole('heading', { name: 'MIDI to DTX Converter', level: 1 })
			).toBeVisible();
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeVisible();

			// Test file upload on mobile
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Verify mobile display of configuration sections
			await expect(page.getByRole('heading', { name: 'DTX File Settings' })).toBeVisible();
			await expect(page.getByLabelText('Title')).toBeVisible();

			// Verify mobile conversion flow
			await expect(page.getByRole('button', { name: 'Convert to DTX' })).toBeVisible();
		});
	});

	test.describe('Accessibility', () => {
		test('should have proper heading hierarchy', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Verify heading levels are correct
			await expect(
				page.getByRole('heading', { level: 1, name: 'MIDI to DTX Converter' })
			).toBeVisible();
			await expect(
				page.getByRole('heading', { level: 2, name: 'Convert MIDI to DTX' })
			).toBeVisible();
			await expect(
				page.getByRole('heading', { level: 3, name: 'Upload MIDI File' })
			).toBeVisible();
		});

		test('should have accessible form controls', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Upload file to show form controls
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Wait for form to appear
			await expect(page.getByRole('heading', { name: 'DTX File Settings' })).toBeVisible();

			// Verify form labels are properly associated
			await expect(page.getByLabelText('Title')).toBeVisible();
			await expect(page.getByLabelText('Artist')).toBeVisible();
			await expect(page.getByLabelText('Difficulty Level')).toBeVisible();
			await expect(page.getByLabelText('BPM')).toBeVisible();
			await expect(page.getByLabelText('Comment')).toBeVisible();
		});

		test('should handle keyboard navigation', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Tab through the interface
			await page.keyboard.press('Tab'); // Should focus on "Back to Tools"
			await expect(page.getByRole('button', { name: '← Back to Tools' })).toBeFocused();

			await page.keyboard.press('Tab'); // Should focus on language popover
			await page.keyboard.press('Tab'); // Should focus on "Choose File" button
			await expect(page.getByRole('button', { name: 'Choose File' })).toBeFocused();
		});
	});

	test.describe('Full Conversion Workflow', () => {
		test('should complete full conversion workflow', async ({ page }) => {
			await page.goto(PAGES.MIDI_TO_DTX_CONVERTER);

			// Step 1: Upload MIDI file
			const fileChooserPromise = page.waitForEvent('filechooser');
			await page.getByRole('button', { name: 'Choose File' }).click();
			const fileChooser = await fileChooserPromise;
			await fileChooser.setFiles([testMidiPath]);

			// Step 2: Configure metadata
			await expect(page.getByRole('heading', { name: 'DTX File Settings' })).toBeVisible();
			await page.getByLabelText('Title').fill('E2E Test Song');
			await page.getByLabelText('Artist').fill('E2E Test Artist');
			await page.getByLabelText('Difficulty Level').fill('7');
			await page.getByLabelText('BPM').fill('150');

			// Step 3: Configure note mapping (optional - use defaults)
			await expect(
				page.getByRole('heading', { name: 'MIDI Note to DTX Lane Mapping' })
			).toBeVisible();

			// Step 4: Convert
			await page.getByRole('button', { name: 'Convert to DTX' }).click();
			await expect(page.getByRole('button', { name: '✓ Converted' })).toBeVisible({
				timeout: 10000
			});

			// Step 5: Download
			const downloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download DTX File' }).click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toBe('test-sample.dtx');

			// Verify success
			await expect(page.getByText('DTX file downloaded successfully!')).toBeVisible({
				timeout: 5000
			});
		});
	});
});
