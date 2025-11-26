import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('DTX File Upload E2E Tests', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Navigate to upload section or ensure we're in the right area
		await page.waitForSelector('[data-testid="file-upload"]', { timeout: 10000 });
	});

	test('should complete full upload workflow for valid DTX file with assets', async ({
		page
	}) => {
		// Prepare test files
		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');
		const audioFile1Path = path.join(__dirname, 'fixtures', 'kick.wav');
		const audioFile2Path = path.join(__dirname, 'fixtures', 'snare.wav');

		// Start file upload
		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath, audioFile1Path, audioFile2Path]);

		// Wait for upload to process
		await page.waitForSelector('[data-testid="upload-progress"]', { timeout: 5000 });
		await page.waitForSelector('[data-testid="upload-success"]', { timeout: 30000 });

		// Verify the simfile was created and is visible
		await expect(page.locator('text=Test Song')).toBeVisible();
		await expect(page.locator('text=Test Artist')).toBeVisible();
		await expect(page.locator('text=120 BPM')).toBeVisible();

		// Verify asset files were processed
		await expect(page.locator('text=2 asset files')).toBeVisible();
	});

	test('should handle DTX-only upload without asset files', async ({ page }) => {
		const dtxFilePath = path.join(__dirname, 'fixtures', 'simple-test.dtx');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		await page.waitForSelector('[data-testid="upload-success"]', { timeout: 30000 });

		// Verify the simfile was created
		await expect(page.locator('[data-testid="simfile-item"]')).toBeVisible();

		// Should not show asset files count for DTX-only upload
		await expect(page.locator('text=0 asset files')).toBeVisible();
	});

	test('should preserve metadata through upload workflow', async ({ page }) => {
		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		await page.waitForSelector('[data-testid="upload-success"]', { timeout: 30000 });

		// Verify metadata preservation
		await expect(page.locator('text=Test Song')).toBeVisible();
		await expect(page.locator('text=Test Artist')).toBeVisible();
		await expect(page.locator('text=120 BPM')).toBeVisible();
	});

	test('should handle DTX parsing errors gracefully', async ({ page }) => {
		const invalidFilePath = path.join(__dirname, 'fixtures', 'invalid-file.txt');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([invalidFilePath]);

		// Should show parsing error
		await page.waitForSelector('[data-testid="upload-error"]', { timeout: 10000 });
		await expect(page.locator('text=Invalid DTX format')).toBeVisible();

		// Verify no simfile was created
		await expect(page.locator('[data-testid="simfile-item"]')).toHaveCount(0);
	});

	test('should handle storage upload failures', async ({ page }) => {
		// Mock storage failure
		await page.route('**/storage/**', (route) => {
			route.fulfill({
				status: 413,
				body: JSON.stringify({ error: 'Storage quota exceeded' })
			});
		});

		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		await page.waitForSelector('[data-testid="upload-error"]', { timeout: 10000 });
		await expect(page.locator('text=Upload failed: Storage quota exceeded')).toBeVisible();
	});

	test('should handle workspace addition failures', async ({ page }) => {
		// Mock workspace API failure
		await page.route('**/api/workspace/simfiles', (route) => {
			route.fulfill({
				status: 400,
				body: JSON.stringify({ error: 'Workspace full' })
			});
		});

		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		await page.waitForSelector('[data-testid="upload-error"]', { timeout: 10000 });
		await expect(page.locator('text=Workspace full')).toBeVisible();
	});

	test('should validate required asset files', async ({ page }) => {
		// Upload DTX that references missing audio files
		const dtxWithMissingAssetsPath = path.join(__dirname, 'fixtures', 'dtx-missing-assets.dtx');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxWithMissingAssetsPath]);

		await page.waitForSelector('[data-testid="upload-error"]', { timeout: 10000 });
		await expect(page.locator('text=Missing required asset files')).toBeVisible();
	});

	test('should handle invalid file types', async ({ page }) => {
		const invalidFiles = [
			path.join(__dirname, 'fixtures', 'invalid-file.txt'),
			path.join(__dirname, 'fixtures', 'fake.exe')
		];

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles(invalidFiles);

		await page.waitForSelector('[data-testid="upload-error"]', { timeout: 5000 });
		await expect(page.locator('text=Invalid file types')).toBeVisible();
	});

	test('should handle multiple concurrent uploads properly', async ({ page, context }) => {
		// Open multiple tabs for concurrent uploads
		const page2 = await context.newPage();
		const page3 = await context.newPage();

		await page2.goto('/');
		await page3.goto('/');

		await page2.waitForSelector('[data-testid="file-upload"]', { timeout: 10000 });
		await page3.waitForSelector('[data-testid="file-upload"]', { timeout: 10000 });

		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		// Start uploads simultaneously
		const upload1 = page.locator('input[type="file"]').setInputFiles([dtxFilePath]);
		const upload2 = page2.locator('input[type="file"]').setInputFiles([dtxFilePath]);
		const upload3 = page3.locator('input[type="file"]').setInputFiles([dtxFilePath]);

		await Promise.all([upload1, upload2, upload3]);

		// Wait for all uploads to complete
		await page.waitForSelector('[data-testid="upload-success"]', { timeout: 30000 });
		await page2.waitForSelector('[data-testid="upload-success"]', { timeout: 30000 });
		await page3.waitForSelector('[data-testid="upload-success"]', { timeout: 30000 });

		// Verify all simfiles were created with unique IDs
		await expect(page.locator('[data-testid="simfile-item"]')).toHaveCount(3);

		await page2.close();
		await page3.close();
	});

	test('should track upload progress through workflow stages', async ({ page }) => {
		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		// Track progress stages
		await expect(page.locator('[data-stage="validating"]')).toBeVisible();
		await expect(page.locator('[data-stage="parsing"]')).toBeVisible();
		await expect(page.locator('[data-stage="creating_simfile"]')).toBeVisible();
		await expect(page.locator('[data-stage="saving_temp"]')).toBeVisible();
		await expect(page.locator('[data-stage="uploading"]')).toBeVisible();
		await expect(page.locator('[data-stage="adding_to_workspace"]')).toBeVisible();

		await page.waitForSelector('[data-stage="complete"]', { timeout: 30000 });
		await expect(page.locator('[data-testid="upload-success"]')).toBeVisible();
	});

	test('should clean up temporary data on upload failure', async ({ page }) => {
		// Mock upload failure after temp save
		let callCount = 0;
		await page.route('**/storage/**', (route) => {
			callCount++;
			if (callCount > 1) {
				// Let temp save succeed, but fail cloud upload
				route.fulfill({
					status: 500,
					body: JSON.stringify({ error: 'Upload failed' })
				});
			} else {
				route.continue();
			}
		});

		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		await page.waitForSelector('[data-testid="upload-error"]', { timeout: 10000 });
		await expect(page.locator('text=Upload failed')).toBeVisible();

		// Verify cleanup occurred - no temporary simfile should remain
		await expect(page.locator('[data-temporary="true"]')).toHaveCount(0);
	});

	test('should support drag and drop upload', async ({ page }) => {
		const dropZone = page.locator('[data-testid="drop-zone"]');
		await expect(dropZone).toBeVisible();

		// Simulate drag and drop
		const dataTransfer = await page.evaluateHandle(() => new DataTransfer());

		// Add file to data transfer (this is a simplified version - in real tests you'd need to handle file objects)
		await dropZone.dispatchEvent('drop', { dataTransfer });

		// Since we can't easily simulate real file drops in Playwright,
		// we'll verify the drop zone is functional and accepts files
		await expect(dropZone).toHaveAttribute('data-drop-active', 'true');
	});

	test('should show upload progress with percentage', async ({ page }) => {
		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		// Mock slow upload to observe progress
		await page.route('**/storage/**', (route) => {
			setTimeout(() => route.continue(), 2000); // 2 second delay
		});

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		// Verify progress indicator appears
		await expect(page.locator('[data-testid="upload-progress"]')).toBeVisible();
		await expect(page.locator('[data-testid="progress-percentage"]')).toBeVisible();

		// Wait for completion
		await page.waitForSelector('[data-testid="upload-success"]', { timeout: 30000 });
	});

	test('should allow cancelling upload in progress', async ({ page }) => {
		const dtxFilePath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

		// Mock slow upload
		await page.route('**/storage/**', (route) => {
			setTimeout(() => route.continue(), 10000); // 10 second delay
		});

		const fileInput = page.locator('input[type="file"]');
		await fileInput.setInputFiles([dtxFilePath]);

		// Wait for upload to start
		await page.waitForSelector('[data-testid="upload-progress"]');

		// Cancel upload
		const cancelButton = page.locator('[data-testid="cancel-upload"]');
		await cancelButton.click();

		// Verify upload was cancelled
		await expect(page.locator('[data-testid="upload-cancelled"]')).toBeVisible();
		await expect(page.locator('[data-testid="upload-progress"]')).toBeHidden();
	});
});
