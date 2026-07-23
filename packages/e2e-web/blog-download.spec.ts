import { test, expect } from '@playwright/test';
import { CHART_B_TITLE } from './test-config';

// anonymous — explicitly no stored auth.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('anonymous blog browse + single download (dual-path)', () => {
	test('published chart appears and downloads', async ({ page }) => {
		// The same-origin REST download endpoint (OFF leg) rate-limits by client IP via
		// getClientIp (cf-connecting-ip / x-forwarded-for). `vite dev` does not inject one,
		// so the handler would 400 ("Unable to determine client IP"). Supply x-forwarded-for
		// ONLY for same-origin (:5173) requests — it is a request header, not auth, so the
		// journey stays anonymous. It must NOT be added to cross-origin dtx-api (:8787)
		// requests in the ON leg: that would force a CORS preflight whose response does not
		// allow x-forwarded-for, blocking the call. (The ON-leg worker, run via `wrangler dev`,
		// supplies cf-connecting-ip itself, so no header is needed there.)
		await page.route('http://localhost:5173/**', async (route) => {
			await route.continue({
				headers: { ...route.request().headers(), 'x-forwarded-for': '127.0.0.1' }
			});
		});

		// listSimfiles(PUBLISHED)
		await page.goto('/blog');
		await page.waitForSelector('html[data-e2e-hydrated="true"]');

		// Scope to chart B's card (the filter-bar .music-card lacks the title).
		const card = page.locator('.music-card', { hasText: CHART_B_TITLE });
		await expect(card).toBeVisible();

		// downloadSimfile — click the per-card Download button (aria-label resolves to
		// "Download" via chart_actions.download), capture the browser download.
		const downloadPromise = page.waitForEvent('download');
		await card.getByRole('button', { name: /download/i }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.zip$/);
	});
});
