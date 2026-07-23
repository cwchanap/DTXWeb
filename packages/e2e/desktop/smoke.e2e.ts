import { browser, expect, $ } from '@wdio/globals';

type Preferences = {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
	scoreLinks: Record<string, string>;
};

describe('Drumery desktop', () => {
	it('launches the native shell and invokes a Rust command', async () => {
		await expect(browser).toHaveTitle('Drumery');

		const app = await $('#app');
		await app.waitForDisplayed();

		const preferences = await browser.tauri.execute<Preferences>(({ core }) =>
			core.invoke('read_preferences')
		);

		expect(preferences.detailPaneWidth).toBeGreaterThanOrEqual(320);
		expect(preferences.detailPaneWidth).toBeLessThanOrEqual(640);
		expect(typeof preferences.detailPaneVisible).toBe('boolean');
		expect(preferences.scoreLinks).toBeDefined();
	});
});
