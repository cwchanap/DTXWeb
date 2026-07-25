import { browser, expect, $ } from '@wdio/globals';

import { resetApp } from '../support/app';
import { getWorkspaceRoot } from '../support/native';
import { SENTINEL_PREFERENCES } from '../support/sentinel-preferences';
import { getPreseededWorkspaceFixture } from '../support/workspace-fixture';

type Preferences = {
	detailPaneWidth: number;
	detailPaneVisible: boolean;
	scoreLinks: Record<string, string>;
};

describe('Drumery desktop', (): void => {
	beforeEach(async (): Promise<void> => {
		await resetApp();
	});

	it('launches the native shell and invokes a Rust command', async (): Promise<void> => {
		const app = await $('#app');
		await app.waitForDisplayed();

		const preferences = await browser.tauri.execute<Preferences, []>(
			({ core }) => core.invoke('read_preferences') as unknown as Preferences
		);

		// A single object assertion prints the complete received preferences when
		// isolation regresses, making CI failures immediately diagnostic.
		expect(preferences).toEqual(SENTINEL_PREFERENCES);
		expect(await getWorkspaceRoot()).toBe(getPreseededWorkspaceFixture().workspaceRoot);
	});
});
