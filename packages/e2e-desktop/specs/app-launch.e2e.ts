import { browser, expect, $ } from '@wdio/globals';

import { resetApp } from '../support/app';

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

		expect(preferences.detailPaneWidth).toBeGreaterThanOrEqual(320);
		expect(preferences.detailPaneWidth).toBeLessThanOrEqual(640);
		expect(typeof preferences.detailPaneVisible).toBe('boolean');
		expect(preferences.scoreLinks).toBeDefined();
	});
});
