import { browser, $ } from '@wdio/globals';

export const resetApp = async (): Promise<void> => {
	await browser.execute(() => {
		localStorage.clear();
		window.location.hash = '';
	});
	await browser.refresh();
	await $('#app').waitForDisplayed();
};

export const openWorkspace = async (): Promise<void> => {
	await resetApp();
	await $('input[placeholder="Search songs and folders..."]').waitForDisplayed();
};
