import { expect, $ } from '@wdio/globals';

import { resetApp, waitForUiDisplayed } from '../support/app';

describe('Desktop shell navigation', () => {
	beforeEach(async () => {
		await resetApp();
	});

	it('navigates among offline sections from the navigation rail', async () => {
		await $('button[aria-label="Settings"]').click();
		await expect($('h2=Settings')).toBeDisplayed();
		await expect($('button[aria-label="Settings"]')).toHaveAttribute('aria-current', 'page');

		await $('button[aria-label="Templates"]').click();
		await expect($('h2=Song Templates')).toBeDisplayed();
		await expect($('button[aria-label="Templates"]')).toHaveAttribute('aria-current', 'page');

		await $('button[aria-label="Library"]').click();
		await waitForUiDisplayed('h2', {
			text: 'Library',
			timeoutMsg: 'Expected Library to become ready after navigation'
		});
		await expect($('button[aria-label="Library"]')).toHaveAttribute('aria-current', 'page');
	});

	it('runs navigation commands from the command palette', async () => {
		await $('button[aria-label="Open command palette"]').click();

		const search = await $('input[aria-label="Command palette search"]');
		await search.waitForDisplayed();
		await search.setValue('settings');
		await $('[role="option"][aria-label="Open Settings"]').click();

		await expect($('h2=Settings')).toBeDisplayed();
		await expect($('button[aria-label="Settings"]')).toHaveAttribute('aria-current', 'page');
	});
});
