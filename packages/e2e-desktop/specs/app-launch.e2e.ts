import { browser, expect, $ } from '@wdio/globals';

import { resetApp } from '../support/app';
import { SENTINEL_PREFERENCES } from '../wdio.conf';

type Preferences = {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
	scoreLinks: Record<string, string>;
};

describe('Drumery desktop', () => {
	beforeEach(async () => {
		await resetApp();
	});

	it('launches the native shell and invokes a Rust command', async () => {
		const app = await $('#app');
		await app.waitForDisplayed();

		const preferences = await browser.tauri.execute<Preferences, []>(
			({ core }) => core.invoke('read_preferences') as unknown as Preferences
		);

		// Assert the exact sentinel values seeded in wdio.conf.ts. This proves
		// the WDIO tauri-service forwards DTX_E2E_DATA_DIR to the spawned app
		// and the Rust resolve_dirs() branch (preferences.rs, `e2e` feature)
		// reads from the isolated data dir — not the developer's real
		// preferences. If either regressed, read_preferences would return
		// defaults (clean CI) or real user data (local) instead of these
		// distinctive values.
		expect(preferences.detailPaneWidth).toBe(SENTINEL_PREFERENCES.detailPaneWidth);
		expect(preferences.detailPaneVisible).toBe(SENTINEL_PREFERENCES.detailPaneVisible);
		expect(preferences.scoreLinks).toEqual(SENTINEL_PREFERENCES.scoreLinks);
	});
});
