import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PAGES } from './constants';
import { CHART_B_ID } from './test-config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The DTX chart fixture put into local Miniflare R2 by prepare-stack.ts.
// The API resolves `fileUrl` against its `PUBLIC_SIMFILE_BUCKET_URL`, which in
// the e2e stack defaults to the production chart.hapadona.com host (Miniflare
// R2 is not served over HTTP). Rather than rewire the API's public base URL
// for every e2e run, we intercept that one external fetch and fulfill it from
// the local fixture — the surfaces under test (real VexFlow SVG + a live
// browser AudioContext) are exercised end-to-end; only the chart-file HTTP
// transport is stubbed, which is exactly what page.route is for.
//
// Uses its own dedicated fixture (not the shared test-sample.dtx) so it can
// carry real playable notes plus a channel-08 tempo change without touching
// the converter/upload fixture other specs depend on.
const dtxFixture = path.join(__dirname, 'fixtures', 'preview-tempo.dtx');
// DTXFile.parseFromText (packages/common/src/lib/chart/dtx.ts) splits raw
// text on a literal '\r\n', matching real DTXMania files. Git's CRLF
// normalization on commit would silently degrade a checked-in CRLF fixture
// back to LF-only on every other clone/CI, which breaks note + tempo parsing
// invisibly (the page falls back to a single default measure instead of
// erroring). Keep the checked-in fixture as plain, git-safe text and
// normalize its line endings to CRLF here, at fulfill time, so parsing is
// exercised for real regardless of the checkout's line endings.
const dtxFixtureContent = readFileSync(dtxFixture, 'utf-8').replace(/\r?\n/g, '\r\n');

// End-to-end coverage for the /preview/[id] route's two surfaces that the
// unit tests cannot exercise with real implementations:
//   1. Real VexFlow SVG rendering inside NotationView (unit tests stub it).
//   2. A live browser AudioContext driving the lookahead scheduler + transport
//      clock (unit tests inject a FakeContext).
//
// Uses the seeded published chart CHART_B_ID (1002). The fixture has no #WAV
// chips, so audio load completes instantly with no samples and playback is
// silent — but the AudioContext is still created and the scheduler + transport
// clock run, which is the live surface under test.
test.describe('Preview page', () => {
	test.beforeEach(async ({ page }) => {
		// Fulfill the chart DTX file fetch from the local fixture so the page
		// can parse + render it without reaching the production R2 CDN.
		await page.route('https://chart.hapadona.com/**', (route) => {
			const url = route.request().url();
			if (url.endsWith('.dtx')) {
				return route.fulfill({ body: dtxFixtureContent, status: 200 });
			}
			return route.continue();
		});
		await page.goto(PAGES.PREVIEW(CHART_B_ID));
		await page.waitForSelector('html[data-e2e-hydrated="true"]');
	});

	test('renders real VexFlow SVG notation for the seeded chart', async ({ page }) => {
		// Wait for the page to leave the loading state and mount NotationView.
		const container = page.getByTestId('notation-container');
		await expect(container).toBeVisible({ timeout: 15000 });

		// VexFlow's SVG renderer populates the container with an <svg> whose
		// staves carry the `vf-stave` class. Asserting on the class (not just
		// `svg`) confirms this is VexFlow output, not an unrelated SVG.
		const svg = container.locator('svg').first();
		await expect(svg).toBeVisible();
		await expect(container.locator('.vf-stave').first()).toBeVisible();
	});

	test('engages a live AudioContext and advances the transport clock on play', async ({
		page
	}) => {
		// Wait for the chart to render + audio "load" (no samples -> resolves
		// immediately) so the transport button enables.
		const playButton = page.getByRole('button', { name: 'Play' });
		await expect(playButton).toBeEnabled({ timeout: 15000 });

		// The transport shows "m:ss / m:ss". Capture the chart's total duration
		// from the right-hand side so the assertion does not depend on the
		// fixture's exact measure count.
		const transportTime = page.getByTestId('transport-time');
		const initialText = (await transportTime.textContent()) ?? '';
		const durationPart = initialText.split(' / ')[1] ?? '';
		// Sanity: the duration is present and non-zero (not "0:00").
		expect(durationPart).toMatch(/^\d+:\d{2}$/);
		expect(durationPart).not.toBe('0:00');

		// Play -> the live AudioContext is created/resumed and the lookahead
		// scheduler starts driving currentTime. The button flips to Pause.
		await playButton.click();
		await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

		// The transport clock must advance past 0:00, proving the live
		// AudioContext clock (not a wall-clock fallback) is feeding currentTime.
		await expect
			.poll(
				async () => {
					const text = await transportTime.textContent();
					// Format is "m:ss / m:ss"; grab the leading (current) time.
					return text?.split(' / ')[0] ?? '';
				},
				{ timeout: 8000, intervals: [250] }
			)
			.not.toBe('0:00');

		// Pause -> the button flips back to Play and the clock stops advancing.
		await page.getByRole('button', { name: 'Pause' }).click();
		await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
	});

	test('renders the starting tempo and a channel-08 tempo change', async ({ page }) => {
		// Wait for the page to leave the loading state and mount NotationView.
		const container = page.getByTestId('notation-container');
		await expect(container).toBeVisible({ timeout: 15000 });

		// NotationView draws BPM marks via VexFlow's StaveTempo (packages/dtx-web/
		// src/lib/components/preview/NotationView.svelte), which is only stubbed
		// in unit tests. StaveTempo's real SVG renderer (vexflow/src/stavetempo.ts)
		// emits a single <text> node per mark whose textContent ends " = <bpm>" —
		// there is no separate glyph-only element to key off, so matching that
		// substring on the notation container's own <text> nodes (never a global
		// getByText, which is brittle against VexFlow's non-DOM-friendly glyph
		// spans) is the real, non-pixel-based proof that VexFlow rendered both
		// the base #BPM:120 tempo and the measure-2 channel-08 change to 180
		// defined by #BPMAA:180 / #00208: AA in fixtures/preview-tempo.dtx.
		const svgText = container.locator('svg text');
		await expect(svgText.filter({ hasText: '= 120' })).toHaveCount(1);
		await expect(svgText.filter({ hasText: '= 180' })).toHaveCount(1);
	});
});
