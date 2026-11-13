import { browser, $ } from '@wdio/globals';

export const waitForUiDisplayed = async (
	selector: string,
	{
		text,
		timeoutMsg = `Expected "${selector}" to be displayed`
	}: { text?: string; timeoutMsg?: string } = {}
): Promise<void> => {
	await browser.waitUntil(
		async () =>
			await browser.execute(
				({ selector: requestedSelector, text: expectedText }) => {
					const matches = Array.from(document.querySelectorAll(requestedSelector));
					const element = expectedText
						? matches.find(
								(candidate) => candidate.textContent?.trim() === expectedText
							)
						: matches[0];
					if (!element) return false;

					const style = getComputedStyle(element);
					const rect = element.getBoundingClientRect();
					return (
						style.display !== 'none' &&
						style.visibility !== 'hidden' &&
						Number.parseFloat(style.opacity) > 0 &&
						rect.width > 0 &&
						rect.height > 0
					);
				},
				{ selector, text }
			),
		{ timeoutMsg }
	);
};

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
	await waitForUiDisplayed('input[placeholder="Search songs and folders..."]', {
		timeoutMsg: 'Expected the restored workspace library to become ready'
	});
};
