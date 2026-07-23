import { browser, $ } from '@wdio/globals';

export const resetApp = async (workspacePath?: string): Promise<void> => {
	await browser.execute((path) => {
		localStorage.clear();
		if (path) {
			localStorage.setItem('workspace_path', JSON.stringify(path));
		}
		window.location.hash = '';
	}, workspacePath);
	await browser.refresh();
	await $('#app').waitForDisplayed();
};

export const openWorkspace = async (workspacePath: string): Promise<void> => {
	await resetApp(workspacePath);
	await $('input[placeholder="Search songs and folders..."]').waitForDisplayed();
};
