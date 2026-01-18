import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('DTX to MIDI upload workflow', () => {
	const testDtxPath = path.join(__dirname, 'fixtures', 'test-sample.dtx');

	test.beforeEach(async ({ page }) => {
		await page.goto(PAGES.DTX_CONVERTER);
	});

	test('uploads a DTX file and shows ready state', async ({ page }) => {
		await page.setInputFiles('input[type="file"]', testDtxPath);

		await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible();
		await expect(page.getByText('test-sample.dtx')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Convert to MIDI' })).toBeVisible();
	});

	test('converts and downloads a MIDI file', async ({ page }) => {
		await page.setInputFiles('input[type="file"]', testDtxPath);

		await page.getByRole('button', { name: 'Convert to MIDI' }).click();
		await expect(page.getByRole('heading', { name: 'Conversion Complete!' })).toBeVisible();

		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Download MIDI File' }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe('test-sample.mid');
	});
});
