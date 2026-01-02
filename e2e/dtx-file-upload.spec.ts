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
});
