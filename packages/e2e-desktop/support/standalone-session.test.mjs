import { expect, mock, test } from 'bun:test';

const createTauriCapabilities = mock((appBinaryPath, options) => ({
	'tauri:options': { application: appBinaryPath },
	'wdio:tauriServiceOptions': options
}));
const startWdioSession = mock(async () => ({ id: 'first-session' }));
const cleanupWdioSession = mock(async () => undefined);

mock.module('@wdio/tauri-service', () => ({
	createTauriCapabilities,
	startWdioSession,
	cleanupWdioSession
}));

const { startStandaloneTauriSession, terminateStandaloneTauriSession } =
	await import('./standalone-session.ts');

test('forwards the isolated data directory to the native standalone session', async () => {
	await startStandaloneTauriSession({
		appBinaryPath: '/tmp/dtx-desktop',
		dataDir: '/tmp/dtx-e2e-data',
		logDir: '/tmp/dtx-e2e-logs'
	});

	expect(createTauriCapabilities).toHaveBeenCalledWith('/tmp/dtx-desktop', {
		driverProvider: 'embedded',
		startTimeout: 60_000
	});
	expect(startWdioSession).toHaveBeenCalledWith(
		expect.objectContaining({
			'wdio:tauriServiceOptions': expect.objectContaining({
				captureBackendLogs: true,
				captureFrontendLogs: true,
				logDir: '/tmp/dtx-e2e-logs'
			})
		}),
		expect.objectContaining({
			env: { DTX_E2E_DATA_DIR: '/tmp/dtx-e2e-data' }
		})
	);
});

test('cleans the native session after the expected process-exit disconnect', async () => {
	const invoke = mock(async () => undefined);
	const browser = {
		tauri: {
			execute: async (callback, code) => {
				await callback({ core: { invoke } }, code);
				throw new Error('socket hang up');
			}
		}
	};

	await expect(terminateStandaloneTauriSession(browser, 86)).resolves.toBeUndefined();
	expect(invoke).toHaveBeenCalledWith('plugin:process|exit', { code: 86 });
	expect(cleanupWdioSession).toHaveBeenCalledWith(browser);
});

test('keeps unexpected exit failures visible after cleanup', async () => {
	const browser = {
		tauri: {
			execute: async () => {
				throw new Error('process command denied');
			}
		}
	};

	await expect(terminateStandaloneTauriSession(browser)).rejects.toThrow(
		'process command denied'
	);
	expect(cleanupWdioSession).toHaveBeenCalledWith(browser);
});
