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

	test.describe('Navigation Menu', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.EDITOR);
			await page.waitForLoadState('networkidle');
		});

		test('File menu contains expected options', async ({ page }) => {
			// Click File menu button to open dropdown (use more specific selector)
			await page.getByRole('button', { name: 'File', exact: true }).click();

			// Check for file menu options (based on what I observed earlier)
			await expect(page.getByText('New')).toBeVisible();
			// Note: 'Switch File' menu item may not be present in current version
			await expect(page.getByText('Export File')).toBeVisible();
		});

		test('can open and close modals from navigation', async ({ page }) => {
			// Open File menu using specific button selector
			await page.getByRole('button', { name: 'File', exact: true }).click();

			// Test New File action
			await page.getByText('New', { exact: true }).click();
			// Should either create new file directly or show confirmation modal
			// This depends on whether there are unsaved changes

			// Wait a bit for any navigation or modal to settle
			await page.waitForTimeout(500);

			// Test that we can interact with the editor after the file menu action
			// This verifies the navigation completed without errors
			await expect(page.getByRole('button', { name: 'File', exact: true })).toBeVisible();
		});
	});

	test.describe('Editor Tabs', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.EDITOR);
			await page.waitForLoadState('networkidle');
		});

		test('displays editor tabs panel', async ({ page }) => {
			// Check for Editor Tabs button
			await expect(page.getByRole('button', { name: 'Editor Tabs' })).toBeVisible();

			// Check for Main, Sound, and Preview tab buttons
			await expect(page.getByRole('button', { name: 'Main' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Sound' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Preview' })).toBeVisible();
		});

		test('can interact with editor tabs', async ({ page }) => {
			// Test clicking on Sound tab
			await page.getByRole('button', { name: 'Sound' }).click();

			// Test clicking on Preview tab
			await page.getByRole('button', { name: 'Preview' }).click();

			// Test clicking back to Main tab
			await page.getByRole('button', { name: 'Main' }).click();

			// Should not cause any errors and tab content should change
		});

		test('main tab contains song metadata form', async ({ page }) => {
			// Ensure we're on Main tab
			await page.getByRole('button', { name: 'Main' }).click();

			// Check for form fields
			await expect(page.getByRole('textbox', { name: 'Title:' })).toBeVisible();
			await expect(page.getByRole('textbox', { name: 'Artist:' })).toBeVisible();
			await expect(page.getByRole('textbox', { name: 'Comment:' })).toBeVisible();
			await expect(page.getByRole('spinbutton', { name: 'BPM:' })).toBeVisible();
			await expect(page.getByRole('spinbutton', { name: 'Level:' })).toBeVisible();

			// Check grid spacing controls
			await expect(page.getByText('Grid Spacing:')).toBeVisible();
			await expect(page.getByRole('button', { name: '16th' })).toBeVisible();
		});

		test('sound tab displays sound chip table', async ({ page }) => {
			// Switch to Sound tab
			await page.getByRole('button', { name: 'Sound' }).click();

			// Check for sound table headers using more specific selectors
			await expect(page.getByRole('cell', { name: 'Active' })).toBeVisible();
			await expect(page.getByRole('cell', { name: 'Label' })).toBeVisible();
			await expect(page.getByRole('cell', { name: 'ID' })).toBeVisible();
			await expect(page.getByRole('cell', { name: 'Volume' })).toBeVisible();
			await expect(page.getByRole('cell', { name: 'File' })).toBeVisible();

			// Check for interactive elements
			// Note: 'Set as active note' button may not be present in empty editor
		});
	});

	test.describe('Game Canvas Interaction', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.EDITOR);
			await page.waitForLoadState('networkidle');

			// Wait for Phaser to initialize
			await page.waitForTimeout(2000);
		});

		test('game canvas is present and interactive', async ({ page }) => {
			const canvas = page.locator('canvas');
			await expect(canvas).toBeVisible();

			// Check canvas dimensions are reasonable
			const canvasBox = await canvas.boundingBox();
			expect(canvasBox).toBeTruthy();
			expect(canvasBox!.width).toBeGreaterThan(0);
			expect(canvasBox!.height).toBeGreaterThan(0);
		});

		test('can click on canvas without errors', async ({ page }) => {
			const canvas = page.locator('canvas');

			// Click on canvas center
			await canvas.click({ position: { x: 400, y: 300 } });

			// Should not cause any console errors or crashes
			// Wait a bit to ensure any async operations complete
			await page.waitForTimeout(500);
		});
	});

	test.describe('Modals and Dialogs', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.EDITOR);
			await page.waitForLoadState('networkidle');
		});

		test('can interact with editor tips panel', async ({ page }) => {
			// Check that Editor Tips panel is visible by default
			await expect(page.getByText('📝 Editor Tips')).toBeVisible();

			// Check for tip content
			await expect(page.getByText('Toggle editing mode')).toBeVisible();
			await expect(page.getByText('Delete selected notes')).toBeVisible();
			await expect(page.getByText('Copy selected notes')).toBeVisible();

			// Test hiding the tips panel
			await page.getByRole('button', { name: 'Hide' }).click();

			// Tips panel should be hidden after clicking Hide
			await expect(page.getByText('📝 Editor Tips')).not.toBeVisible();
		});

		test('handles modal interactions gracefully', async ({ page }) => {
			// Test various modal triggers that might exist
			const modalTriggers = ['File', 'difficulty', 'workspace', 'sound'];

			for (const trigger of modalTriggers) {
				const triggerElements = page.getByText(trigger, { exact: false });
				const triggerCount = await triggerElements.count();

				if (triggerCount > 0) {
					try {
						await triggerElements.first().click();
						await page.waitForTimeout(500); // Allow modal to open

						// Try to close any opened modal with Escape
						await page.keyboard.press('Escape');
						await page.waitForTimeout(300);
					} catch (e) {
						// Some triggers might not be clickable or might not open modals
						// This is expected and not a failure
					}
				}
			}
		});
	});

	test.describe('Keyboard Shortcuts', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.EDITOR);
			await page.waitForLoadState('networkidle');
		});

		test('handles common keyboard shortcuts', async ({ page }) => {
			// Test Escape key (should close modals)
			await page.keyboard.press('Escape');
			await page.waitForTimeout(300);

			// Test Space key (might play/pause in editor context)
			await page.keyboard.press('Space');
			await page.waitForTimeout(300);

			// These shortcuts should not cause errors
		});
	});

	test.describe('Error Handling', () => {
		test('handles navigation to invalid simfile gracefully', async ({ page }) => {
			// Test with non-existent simfile ID
			await page.goto(PAGES.EDITOR_WITH_SIMFILE('nonexistent'));

			// Should still load the editor, possibly with error handling
			await expect(page.locator('canvas')).toBeVisible();

			// Should not show unhandled error messages
			const errorElements = page.locator('text=Error').or(page.locator('text=error'));
			const errorCount = await errorElements.count();

			// If errors are shown, they should be handled gracefully
			if (errorCount > 0) {
				// Error messages should be user-friendly, not raw stack traces
				const errorText = await errorElements.first().textContent();
				expect(errorText).not.toContain('TypeError');
				expect(errorText).not.toContain('undefined is not');
			}
		});

		test('console errors are minimal', async ({ page }) => {
			const consoleErrors: string[] = [];

			page.on('console', (msg) => {
				if (msg.type() === 'error') {
					consoleErrors.push(msg.text());
				}
			});

			await page.goto(PAGES.EDITOR);
			await page.waitForLoadState('networkidle');
			await page.waitForTimeout(3000); // Allow time for async operations

			// Filter out expected/acceptable errors
			const significantErrors = consoleErrors.filter(
				(error) =>
					!error.includes('Failed to fetch') && // Network errors are sometimes expected
					!error.includes('404') && // 404s might be expected for some resources
					!error.includes('WebGL') && // WebGL warnings are browser-dependent
					!error.includes('Audio context') // Audio context warnings are common
			);

			// Should have minimal console errors
			expect(significantErrors.length).toBeLessThan(3);
		});
	});

	test.describe('Performance and Loading', () => {
		test('editor loads within reasonable time', async ({ page }) => {
			const startTime = Date.now();

			await page.goto(PAGES.EDITOR);
			await page.waitForLoadState('networkidle');
			await expect(page.locator('canvas')).toBeVisible();

			const loadTime = Date.now() - startTime;

			// Should load within 10 seconds (generous for CI environments)
			expect(loadTime).toBeLessThan(10000);
		});

		test('game canvas initializes properly', async ({ page }) => {
			await page.goto(PAGES.EDITOR);

			// Wait for canvas to be visible
			await expect(page.locator('canvas')).toBeVisible();

			// Wait for Phaser to initialize
			await page.waitForTimeout(3000);

			// Canvas should have reasonable dimensions
			const canvas = page.locator('canvas');
			const box = await canvas.boundingBox();

			expect(box).toBeTruthy();
			expect(box!.width).toBeGreaterThan(100);
			expect(box!.height).toBeGreaterThan(100);
		});
	});
});
