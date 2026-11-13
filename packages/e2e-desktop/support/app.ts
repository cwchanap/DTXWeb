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

export type IpcDiagnosticWindow = {
	ipc?: { postMessage: (data: unknown) => unknown };
	__wdio_ipc_diag_installed?: boolean;
	__wdio_ipc_diag__?: string[];
};

export type IpcDiagnosticInstallOutcome =
	'installed' | 'already-installed' | 'window-ipc-unavailable' | 'wrap-rejected';

/**
 * HPA-316 Windows diagnostic: the Rust IPC parser rejects postMessage-path
 * messages whose `callback`/`error` field is `null`
 * (`JSON error: invalid type: null, expected u32`), so those invokes never run.
 * This wrapper records the rejected message bodies for the spec to dump into
 * the runner log, identifying exactly which commands are being dropped.
 *
 * Passed DIRECTLY to browser.execute: WDIO serializes the function source, so
 * it must stay self-contained (no module-level references) and zero-arg; the
 * page's global window is the injection point (tests stub globalThis.window).
 */
export const installIpcDiagnostics = (): IpcDiagnosticInstallOutcome => {
	const targetWindow = window as unknown as IpcDiagnosticWindow;
	if (targetWindow.__wdio_ipc_diag_installed) return 'already-installed';
	const target = targetWindow.ipc;
	if (!target || typeof target.postMessage !== 'function') return 'window-ipc-unavailable';
	const original = target.postMessage;
	try {
		target.postMessage = (data: unknown): unknown => {
			try {
				const text = typeof data === 'string' ? data : JSON.stringify(data);
				if (
					typeof text === 'string' &&
					(/"callback"\s*:\s*null/.test(text) || /"error"\s*:\s*null/.test(text))
				) {
					const captured =
						targetWindow.__wdio_ipc_diag__ ?? (targetWindow.__wdio_ipc_diag__ = []);
					if (captured.length < 20) captured.push(text.slice(0, 600));
				}
			} catch {
				// Diagnostics must never break IPC delivery.
			}
			return original.call(target, data);
		};
	} catch {
		return 'wrap-rejected';
	}
	targetWindow.__wdio_ipc_diag_installed = true;
	return 'installed';
};

/**
 * Companion to installIpcDiagnostics: returns the captured null-callback IPC
 * message bodies. Passed DIRECTLY to browser.execute (self-contained source).
 */
export const collectIpcDiagnostics = (): string[] =>
	(window as unknown as { __wdio_ipc_diag__?: string[] }).__wdio_ipc_diag__ ?? [];
