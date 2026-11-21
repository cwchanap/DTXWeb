import { test, expect } from '@playwright/test';
import { PAGES } from './constants';
import { parseMidi, type ParsedMidi } from '@dtx/common';
import { readFileSync } from 'node:fs';

// A chart exercising the converter's semantics end-to-end: simultaneous
// cross-lane hits, a decimal 3/4 bar, a mid-bar #BPMxx change, and a return
// to 4/4. Bar starts (480 PPQ): m0 = 0, m1 = 1920 (0.75 -> 1440 ticks),
// m2 = 3360.
const dtxChart = [
	'#TITLE:E2E Converter Chart',
	'#ARTIST:E2E',
	'#BPM:120',
	'#BPMAA:180',
	'#DLEVEL:5',
	'#00011: 01000000', // hihat m0 p0 — simultaneous
	'#00012: 01000000', // snare m0 p0 — simultaneous
	'#00013: 01000000', // bass  m0 p0 — simultaneous
	'#00102: 0.75', // m1 is 3/4
	'#00108: 0000AA00', // tempo 180 at m1 p0.5 (mid-bar) -> tick 2640
	'#00111: 00000001', // hihat m1 p0.75 (late-bar) -> tick 3000
	'#00202: 1', // m2 back to 4/4
	'#00212: 01010101' // snare m2 p0/.25/.5/.75 -> 3360/3840/4320/4800
].join('\r\n');

const dtxUpload = {
	name: 'e2e-converter.dtx',
	mimeType: 'text/plain',
	buffer: Buffer.from(dtxChart, 'utf-8')
};

const downloadBytes = async (download: {
	path: () => Promise<string | null>;
}): Promise<Uint8Array> => {
	const downloadPath = await download.path();
	expect(downloadPath).toBeTruthy();
	return new Uint8Array(readFileSync(downloadPath!));
};

const noteOnsets = (parsed: ParsedMidi): [number, number][] =>
	parsed.tracks[0].notes.map((n) => [n.startTime, n.note]);

test.describe('DTX to MIDI Converter Tool', () => {
	test.describe('Navigation and Initial State', () => {
		test('should navigate from tools page to DTX to MIDI converter', async ({ page }) => {
			await page.goto(PAGES.TOOLS);
			await page.waitForSelector('html[data-e2e-hydrated="true"]');

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
			await page.goto(PAGES.DTX_CONVERTER);
			await page.waitForLoadState('networkidle');
			await page.waitForSelector('html[data-e2e-hydrated="true"]');
			await expect(
				page.getByRole('heading', { name: 'DTX to MIDI Converter', level: 1 })
			).toBeVisible();
			await expect(page).toHaveURL(PAGES.DTX_CONVERTER);
			await expect(
				page.getByRole('heading', { name: 'DTX to MIDI Converter', level: 1 })
			).toBeVisible();
		});
	});

	test.describe('Download Functionality', () => {
		test.beforeEach(async ({ page }) => {
			await page.goto(PAGES.DTX_CONVERTER);
			await page.waitForLoadState('networkidle');
			await page.waitForSelector('html[data-e2e-hydrated="true"]');
			await page.setInputFiles('input[type="file"]', dtxUpload);
			await expect(page.getByRole('heading', { name: 'File Ready' })).toBeVisible({
				timeout: 10000
			});
		});

		test('shows staff instrument names for the playable lanes, never Unknown', async ({
			page
		}) => {
			for (const name of ['Bass', 'Snare', 'Closed Hi-Hat', 'Left Crash', 'Pedal Hi-Hat']) {
				await expect(page.getByText(name, { exact: true })).toBeVisible();
			}
			await expect(page.getByText('Unknown', { exact: true })).toHaveCount(0);

			// Editable lane rows cover the playable 11-1C lanes only — never
			// the legacy 01-0C aliases or control lanes.
			await expect(page.locator('#lane-13')).toBeVisible();
			await expect(page.locator('#lane-1C')).toBeVisible();
			await expect(page.locator('#lane-01')).toHaveCount(0);
			await expect(page.locator('#lane-08')).toHaveCount(0);
		});

		test('downloads MIDI bytes the shared parser reparses with chart semantics', async ({
			page
		}) => {
			await page.getByRole('button', { name: 'Convert to MIDI' }).click();
			await expect(page.getByRole('heading', { name: 'Conversion Complete!' })).toBeVisible();

			const downloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download MIDI File' }).click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toBe('e2e-converter.mid');
			await expect(page.getByText('MIDI file downloaded successfully!')).toBeVisible();

			const parsed = parseMidi(await downloadBytes(download));

			expect(parsed.format).toBe(0);
			expect(parsed.trackCount).toBe(1);
			expect(parsed.ticksPerQuarter).toBe(480);

			// Base 120 BPM plus the mid-bar 180 change at tick 2640.
			expect(parsed.tempoEvents).toEqual([
				{ tick: 0, microsecondsPerQuarter: 500000 },
				{ tick: 2640, microsecondsPerQuarter: 333333 }
			]);

			// 4/4 -> 3/4 -> 4/4 meter changes at cumulative bar ticks.
			expect(parsed.meterEvents).toEqual([
				{ tick: 0, numerator: 4, denominator: 4 },
				{ tick: 1920, numerator: 3, denominator: 4 },
				{ tick: 3360, numerator: 4, denominator: 4 }
			]);

			// Simultaneous hits at tick 0 on canonical GM notes (42/38/36), the
			// late-bar 3/4 hihat, and four snare hits across the 4/4 bar.
			expect(noteOnsets(parsed)).toEqual([
				[0, 42],
				[0, 38],
				[0, 36],
				[3000, 42],
				[3360, 38],
				[3840, 38],
				[4320, 38],
				[4800, 38]
			]);
			expect(parsed.tracks[0].notes.every((n) => n.channel === 9)).toBe(true);
		});

		test('applies a lane-to-GM override made before download', async ({ page }) => {
			await page.getByRole('button', { name: 'Convert to MIDI' }).click();
			await expect(page.getByRole('heading', { name: 'Conversion Complete!' })).toBeVisible();

			// Remap the Bass lane (13) from GM 36 to GM 41 before downloading.
			await page.locator('#lane-13').fill('41');

			const downloadPromise = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Download MIDI File' }).click();
			const download = await downloadPromise;
			const parsed = parseMidi(await downloadBytes(download));

			expect(noteOnsets(parsed).map(([, note]) => note)).toContain(41);
			expect(noteOnsets(parsed).map(([, note]) => note)).not.toContain(36);
		});
	});
});
