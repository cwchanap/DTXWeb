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

export type IpcDiagnosticsWindow = {
	ipc?: unknown;
	fetch?: typeof fetch;
	__TAURI_INTERNALS__?: { callbacks?: { size?: number } };
	__wdio_ipc_diag_installed?: boolean;
	__wdio_ipc_diag_fetch__?: string[];
	__wdio_ipc_diag_callbacks_base__?: number;
	__wdio_ipc_diag_ipc_present__?: boolean;
	__wdio_ipc_diag_ipc_pm_writable__?: boolean | null;
};

export type IpcDiagnosticsReport = {
	ipc: { present: boolean; postMessageWritable: boolean | null };
	fetchTransport: string[];
	callbacks: { atInstall: number; now: number | null };
};

export type IpcDiagnosticInstallOutcome =
	'installed' | 'already-installed' | 'tauri-internals-unavailable' | 'fetch-unavailable';

/**
 * HPA-316 Windows diagnostic: the Drive refresh result never reached the
 * store, and wry 0.57.0 defines `window.ipc` with
 * `Object.defineProperty(window, 'ipc', { value: Object.freeze({ postMessage: … }) })`
 * (webview2/mod.rs:952, wkwebview/mod.rs:642) — the frozen postMessage sender
 * cannot be wrapped, so the old capture silently recorded nothing on BOTH
 * platforms. This installer only uses seams verified writable against those
 * sources:
 * - `window.fetch` (standard, writable): Tauri's custom-protocol path sends
 *   every command through fetch with the command name in the URL; each send
 *   is summarized as `fetch cmd=<name> status=<n>` or `… failed` — command
 *   name and status only, never headers, bodies, or query strings. A `failed`
 *   entry marks the moment Tauri falls back to the postMessage transport.
 * - `__TAURI_INTERNALS__.callbacks` (live, readable Map): every invoke
 *   registers two once-callbacks that delete themselves on completion, so
 *   entries that persist past idle time are dropped invokes (their messages
 *   were rejected by the Rust IPC parser and the promise never settled).
 * The frozen `window.ipc` descriptor is reported as-is.
 *
 * Passed DIRECTLY to browser.execute: WDIO serializes the function source, so
 * it must stay self-contained (no module-level references) and zero-arg; the
 * page's global window is the injection point (tests stub globalThis.window).
 */
export const installIpcDiagnostics = (): IpcDiagnosticInstallOutcome => {
	const targetWindow = window as unknown as IpcDiagnosticsWindow;
	if (targetWindow.__wdio_ipc_diag_installed) return 'already-installed';
	const callbacks = targetWindow.__TAURI_INTERNALS__?.callbacks;
	if (!callbacks || typeof callbacks.size !== 'number') return 'tauri-internals-unavailable';
	if (typeof targetWindow.fetch !== 'function') return 'fetch-unavailable';

	const ipcDescriptor = Object.getOwnPropertyDescriptor(targetWindow, 'ipc');
	const ipcValue = ipcDescriptor?.value as { postMessage?: unknown } | undefined;
	const postMessageDescriptor = ipcValue
		? Object.getOwnPropertyDescriptor(ipcValue, 'postMessage')
		: undefined;

	const originalFetch = targetWindow.fetch;
	const summaries: string[] = targetWindow.__wdio_ipc_diag_fetch__ ?? [];
	const record = (summary: string): void => {
		if (summaries.length < 20) summaries.push(summary);
	};
	const ipcCommandFrom = (input: unknown): string | null => {
		const href =
			typeof input === 'string'
				? input
				: input && typeof input === 'object'
					? typeof (input as { url?: unknown }).url === 'string'
						? (input as { url: string }).url
						: typeof (input as { href?: unknown }).href === 'string'
							? (input as { href: string }).href
							: null
					: null;
		if (href === null) return null;
		try {
			const parsed = new URL(href, window.location?.href);
			if (parsed.protocol !== 'ipc:' && parsed.hostname !== 'ipc.localhost') return null;
			return decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'unknown';
		} catch {
			return null;
		}
	};
	targetWindow.fetch = ((...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
		try {
			const cmd = ipcCommandFrom(args[0]);
			if (cmd === null) return originalFetch.apply(targetWindow, args);
			return originalFetch.apply(targetWindow, args).then(
				(response) => {
					record(`fetch cmd=${cmd} status=${response.status}`);
					return response;
				},
				(error) => {
					record(`fetch cmd=${cmd} failed`);
					throw error;
				}
			);
		} catch {
			// Diagnostics must never break delivery; forward anything unexpected.
			return originalFetch.apply(targetWindow, args);
		}
	}) as typeof fetch;

	targetWindow.__wdio_ipc_diag_fetch__ = summaries;
	targetWindow.__wdio_ipc_diag_callbacks_base__ = callbacks.size;
	targetWindow.__wdio_ipc_diag_ipc_present__ = Boolean(ipcDescriptor);
	targetWindow.__wdio_ipc_diag_ipc_pm_writable__ = postMessageDescriptor
		? postMessageDescriptor.writable === true
		: ipcValue && typeof ipcValue.postMessage === 'function'
			? true
			: null;
	targetWindow.__wdio_ipc_diag_installed = true;
	return 'installed';
};

/**
 * Companion to installIpcDiagnostics: returns the sanitized diagnostics
 * report (transport descriptor facts, capped fetch-path summaries, and the
 * callbacks-map growth that exposes dropped invokes). Passed DIRECTLY to
 * browser.execute (self-contained source). Null before installation.
 */
export const collectIpcDiagnostics = (): IpcDiagnosticsReport | null => {
	const targetWindow = window as unknown as IpcDiagnosticsWindow;
	if (!targetWindow.__wdio_ipc_diag_installed) return null;
	return {
		ipc: {
			present: targetWindow.__wdio_ipc_diag_ipc_present__ === true,
			postMessageWritable: targetWindow.__wdio_ipc_diag_ipc_pm_writable__ ?? null
		},
		fetchTransport: [...(targetWindow.__wdio_ipc_diag_fetch__ ?? [])],
		callbacks: {
			atInstall: targetWindow.__wdio_ipc_diag_callbacks_base__ ?? -1,
			now: targetWindow.__TAURI_INTERNALS__?.callbacks?.size ?? null
		}
	};
};

/**
 * Dumps the IPC diagnostics to the CI log, reducing any dump failure to a
 * fixed marker: raw exception text can carry WebDriver/session or transport
 * details, and the report itself is already content-free.
 */
export const dumpIpcDiagnosticsSafely = async (
	dump: () => Promise<IpcDiagnosticsReport | null>
): Promise<void> => {
	try {
		const report = await dump();
		console.info(`[gdrive-diag] ipc diagnostics: ${JSON.stringify(report)}`);
	} catch {
		console.info('[gdrive-diag] ipc diagnostics dump failed');
	}
};
