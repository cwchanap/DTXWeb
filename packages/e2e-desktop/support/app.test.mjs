import { expect, test } from 'bun:test';
import { _setGlobal } from '@wdio/globals';

const { readDriveRefreshDiagnostics, logDriveRefreshDiagnosticsSafely } = await import('./app.ts');

// The helpers run as serialized page callbacks via browser.execute; the fake
// browser invokes the real page function in-process against a stubbed window.
const useFakeBrowser = (execute) => {
	_setGlobal('browser', { execute });
};

const withPageWindow = (targetWindow, run) => {
	const previousWindow = globalThis.window;
	globalThis.window = targetWindow;
	try {
		run();
	} finally {
		if (previousWindow === undefined) delete globalThis.window;
		else globalThis.window = previousWindow;
	}
};

const captureConsoleInfo = async (run) => {
	const lines = [];
	const originalInfo = console.info;
	console.info = (...args) => {
		lines.push(args.map((argument) => String(argument)).join(' '));
	};
	try {
		await run();
	} finally {
		console.info = originalInfo;
	}
	return lines;
};

test('readDriveRefreshDiagnostics returns the snapshot exposed by the renderer diagnostic', async () => {
	useFakeBrowser(async (pageFunction) => {
		let result;
		withPageWindow(
			{
				__dtxDriveRefreshDiag: () => ({
					observed: true,
					pending: false,
					resolved: true,
					rejected: false,
					withConnection: true,
					connected: true,
					storeConnected: true,
					storeHasError: false,
					calls: 1,
					startedAtMs: 1,
					settledAtMs: 2
				})
			},
			() => {
				result = pageFunction();
			}
		);
		return result;
	});

	expect(await readDriveRefreshDiagnostics()).toMatchObject({
		observed: true,
		resolved: true,
		connected: true,
		storeConnected: true
	});
});

test('readDriveRefreshDiagnostics returns null when the diagnostic global is absent', async () => {
	useFakeBrowser(async (pageFunction) => {
		let result;
		withPageWindow({}, () => {
			result = pageFunction();
		});
		return result;
	});

	expect(await readDriveRefreshDiagnostics()).toBeNull();
});

test('readDriveRefreshDiagnostics returns null for a non-function global', async () => {
	useFakeBrowser(async (pageFunction) => {
		let result;
		withPageWindow({ __dtxDriveRefreshDiag: 42 }, () => {
			result = pageFunction();
		});
		return result;
	});

	expect(await readDriveRefreshDiagnostics()).toBeNull();
});

test('logDriveRefreshDiagnosticsSafely logs the sanitized snapshot', async () => {
	useFakeBrowser(async (pageFunction) => {
		let result;
		withPageWindow(
			{
				__dtxDriveRefreshDiag: () => ({
					observed: true,
					pending: true,
					resolved: false,
					rejected: false,
					withConnection: false,
					connected: false,
					storeConnected: false,
					storeHasError: false,
					calls: 1,
					startedAtMs: 1,
					settledAtMs: null
				})
			},
			() => {
				result = pageFunction();
			}
		);
		return result;
	});

	const lines = await captureConsoleInfo(() => logDriveRefreshDiagnosticsSafely('final'));

	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain('[gdrive-diag] refresh final:');
	expect(lines[0]).toContain('"pending":true');
});

test('logDriveRefreshDiagnosticsSafely logs a fixed marker without exception content on failure', async () => {
	useFakeBrowser(async () => {
		throw new Error('WebDriver session SESS-SECRET-TOKEN aborted for secret@example.com');
	});

	const lines = await captureConsoleInfo(() => logDriveRefreshDiagnosticsSafely('final'));

	expect(lines).toHaveLength(1);
	expect(lines[0]).toBe('[gdrive-diag] refresh final: read failed');
	expect(lines.join(' ')).not.toContain('SESS-SECRET-TOKEN');
	expect(lines.join(' ')).not.toContain('secret@example.com');
});
