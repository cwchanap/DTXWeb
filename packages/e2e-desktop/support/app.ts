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

export type DriveRefreshDiagnostics = {
	observed: boolean;
	pending: boolean;
	resolved: boolean;
	rejected: boolean;
	withConnection: boolean;
	connected: boolean;
	storeConnected: boolean;
	storeHasError: boolean;
	calls: number;
	startedAtMs: number | null;
	settledAtMs: number | null;
};

/**
 * HPA-316 Windows diagnostic: reads the snapshot recorded by the renderer-side
 * diagnostic (driveRefreshDiagnostics.ts, installed in the e2e build before
 * mount). The renderer wraps googleDriveService.refreshConnection, so the
 * ORIGINAL boot refresh is attributed directly: pending / resolved / rejected
 * plus whether the result reached the store. Only booleans, counts, and
 * timestamps cross the boundary. Null in builds without the diagnostic.
 */
export const readDriveRefreshDiagnostics = async (): Promise<DriveRefreshDiagnostics | null> =>
	await browser.execute(() => {
		const read = (window as unknown as { __dtxDriveRefreshDiag?: () => unknown })
			.__dtxDriveRefreshDiag;
		return typeof read === 'function' ? (read() as DriveRefreshDiagnostics) : null;
	});

/**
 * Companion to readDriveRefreshDiagnostics: logs the snapshot (or a fixed
 * marker on failure — raw exception text can carry session details). The
 * snapshot itself is already content-free.
 */
export const logDriveRefreshDiagnosticsSafely = async (label: string): Promise<void> => {
	try {
		const snapshot = await readDriveRefreshDiagnostics();
		console.info(`[gdrive-diag] refresh ${label}: ${JSON.stringify(snapshot)}`);
	} catch {
		console.info(`[gdrive-diag] refresh ${label}: read failed`);
	}
};
