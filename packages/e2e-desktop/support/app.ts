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
 * This wrapper records WHICH command and field were rejected — command name
 * and null field only; IPC payloads, credentials, and any other message
 * content are never stored. Unparseable input is recorded as `unparseable`.
 *
 * Passed DIRECTLY to browser.execute: WDIO serializes the function source, so
 * it must stay self-contained (no module-level references) and zero-arg; the
 * page's global window is the injection point (tests stub globalThis.window).
 */
export const installIpcDiagnostics = (): IpcDiagnosticInstallOutcome => {
	// Summarizes a rejected message as `cmd=<name> null=<field(s)>`; null when
	// the regex hit was a nested false positive; `unparseable` without any
	// message content when JSON parsing fails.
	const describeRejectedMessage = (text: string): string | null => {
		try {
			const parsed = JSON.parse(text) as {
				cmd?: unknown;
				callback?: unknown;
				error?: unknown;
			};
			const nullFields = [
				parsed.callback === null ? 'callback' : null,
				parsed.error === null ? 'error' : null
			].filter(Boolean);
			if (nullFields.length === 0) return null;
			const cmd = typeof parsed.cmd === 'string' ? parsed.cmd : 'unknown';
			return `cmd=${cmd} null=${nullFields.join('+')}`;
		} catch {
			return 'unparseable';
		}
	};
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
					const summary = describeRejectedMessage(text);
					if (summary) {
						const captured =
							targetWindow.__wdio_ipc_diag__ ?? (targetWindow.__wdio_ipc_diag__ = []);
						if (captured.length < 20) captured.push(summary);
					}
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
 * Companion to installIpcDiagnostics: returns the captured rejection summaries
 * (command name + null field only). Passed DIRECTLY to browser.execute
 * (self-contained source).
 */
export const collectIpcDiagnostics = (): string[] =>
	(window as unknown as { __wdio_ipc_diag__?: string[] }).__wdio_ipc_diag__ ?? [];
