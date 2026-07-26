import { expect, mock, test } from 'bun:test';

const availablePorts = [];
const portReservations = [];
const createServer = mock(() => ({
	once: () => undefined,
	listen: (port, hostname, onListening) => {
		portReservations.push({ port, hostname });
		onListening();
	},
	address: () => ({ port: availablePorts.shift() }),
	close: (callback) => callback()
}));
const createTauriCapabilities = mock((appBinaryPath, options) => ({
	'tauri:options': { application: appBinaryPath },
	'wdio:tauriServiceOptions': options
}));
const startResponses = [];
const startWdioSession = mock(async (...args) => {
	const response = startResponses.shift() ?? { id: `session-${args.length}` };
	if (response instanceof Error) throw response;
	return response;
});
const cleanupWdioSession = mock(async () => undefined);

mock.module('node:net', () => ({ createServer }));
mock.module('@wdio/tauri-service', () => ({
	createTauriCapabilities,
	startWdioSession,
	cleanupWdioSession
}));

const { startStandaloneTauriSession, terminateStandaloneTauriSession } =
	await import('./standalone-session.ts');

test('forwards the isolated data directory and allocated port to the native standalone session', async () => {
	availablePorts.push(46_001);
	const startCallCount = startWdioSession.mock.calls.length;
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
				embeddedPort: 46_001,
				logDir: '/tmp/dtx-e2e-logs'
			})
		}),
		expect.objectContaining({
			env: { DTX_E2E_DATA_DIR: '/tmp/dtx-e2e-data' }
		})
	);
	expect(portReservations.at(-1)).toEqual({ port: 0, hostname: '127.0.0.1' });
	expect(startWdioSession.mock.calls.slice(startCallCount)[0][0]).not.toEqual(
		expect.objectContaining({
			'wdio:tauriServiceOptions': expect.objectContaining({ embeddedPort: 4445 })
		})
	);
});

test('uses distinct allocated ports for separate standalone launches', async () => {
	availablePorts.push(46_051, 46_052);
	const startCallCount = startWdioSession.mock.calls.length;
	const input = {
		appBinaryPath: '/tmp/dtx-desktop',
		dataDir: '/tmp/dtx-e2e-data',
		logDir: '/tmp/dtx-e2e-logs'
	};

	await startStandaloneTauriSession(input);
	await startStandaloneTauriSession(input);

	const launchedCapabilities = startWdioSession.mock.calls
		.slice(startCallCount)
		.map(([capabilities]) => capabilities['wdio:tauriServiceOptions']);
	expect(launchedCapabilities.map(({ embeddedPort }) => embeddedPort)).toEqual([46_051, 46_052]);
	expect(launchedCapabilities.map(({ embeddedPort }) => embeddedPort)).not.toContain(4445);
});

test('retries a raced embedded-port collision with a different allocated port', async () => {
	availablePorts.push(46_101, 46_102);
	startResponses.push(new Error('EADDRINUSE'), { id: 'retried-session' });
	const startCallCount = startWdioSession.mock.calls.length;

	await startStandaloneTauriSession({
		appBinaryPath: '/tmp/dtx-desktop',
		dataDir: '/tmp/dtx-e2e-data',
		logDir: '/tmp/dtx-e2e-logs'
	});

	const launchedCapabilities = startWdioSession.mock.calls
		.slice(startCallCount)
		.map(([capabilities]) => capabilities['wdio:tauriServiceOptions']);
	expect(launchedCapabilities.map(({ embeddedPort }) => embeddedPort)).toEqual([46_101, 46_102]);
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
