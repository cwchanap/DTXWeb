import { expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const randomBytes = mock(() => ({ toString: () => 'launch-nonce-123' }));
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
const cleanupResponses = [];
let observedNonce = 'launch-nonce-123';
const createBrowser = () => ({
	tauri: {
		execute: async (callback, ...args) =>
			await callback(
				{
					core: {
						invoke: async (command) => {
							if (command === 'read_e2e_session_nonce') return observedNonce;
							throw new Error('socket hang up');
						}
					}
				},
				...args
			)
	}
});
const startWdioSession = mock(async (...args) => {
	const response = startResponses.shift() ?? createBrowser();
	if (response instanceof Error) throw response;
	return response;
});
const cleanupWdioSession = mock(async () => {
	const response = cleanupResponses.shift();
	if (response instanceof Error) throw response;
});

mock.module('node:crypto', () => ({ randomBytes }));
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
	const browser = await startStandaloneTauriSession({
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
			env: {
				DTX_E2E_DATA_DIR: '/tmp/dtx-e2e-data',
				DTX_E2E_SESSION_NONCE: 'launch-nonce-123'
			}
		})
	);
	expect(portReservations.at(-1)).toEqual({ port: 0, hostname: '127.0.0.1' });
	expect(startWdioSession.mock.calls.slice(startCallCount)[0][0]).not.toEqual(
		expect.objectContaining({
			'wdio:tauriServiceOptions': expect.objectContaining({ embeddedPort: 4445 })
		})
	);
	await terminateStandaloneTauriSession(browser);
});

test('uses distinct allocated ports for separate standalone launches', async () => {
	availablePorts.push(46_051, 46_052);
	const startCallCount = startWdioSession.mock.calls.length;
	const input = {
		appBinaryPath: '/tmp/dtx-desktop',
		dataDir: '/tmp/dtx-e2e-data',
		logDir: '/tmp/dtx-e2e-logs'
	};

	const firstBrowser = await startStandaloneTauriSession(input);
	const secondBrowser = await startStandaloneTauriSession(input);

	const launchedCapabilities = startWdioSession.mock.calls
		.slice(startCallCount)
		.map(([capabilities]) => capabilities['wdio:tauriServiceOptions']);
	expect(launchedCapabilities.map(({ embeddedPort }) => embeddedPort)).toEqual([46_051, 46_052]);
	expect(launchedCapabilities.map(({ embeddedPort }) => embeddedPort)).not.toContain(4445);
	await terminateStandaloneTauriSession(firstBrowser);
	await terminateStandaloneTauriSession(secondBrowser);
});

test('fails a real embedded-driver readiness timeout without launching a second app', async () => {
	availablePorts.push(46_101);
	startResponses.push(
		new Error('Embedded WebDriver did not become ready on port 46101 within 60000ms')
	);
	const startCallCount = startWdioSession.mock.calls.length;

	await expect(
		startStandaloneTauriSession({
			appBinaryPath: '/tmp/dtx-desktop',
			dataDir: '/tmp/dtx-e2e-data',
			logDir: '/tmp/dtx-e2e-logs'
		})
	).rejects.toThrow('did not become ready on port');

	const launchedCapabilities = startWdioSession.mock.calls
		.slice(startCallCount)
		.map(([capabilities]) => capabilities['wdio:tauriServiceOptions']);
	expect(launchedCapabilities.map(({ embeddedPort }) => embeddedPort)).toEqual([46_101]);
	availablePorts.push(46_101);
	const reusedPortBrowser = await startStandaloneTauriSession({
		appBinaryPath: '/tmp/dtx-desktop',
		dataDir: '/tmp/dtx-e2e-data',
		logDir: '/tmp/dtx-e2e-logs'
	});
	expect(startWdioSession.mock.calls.at(-1)[0]['wdio:tauriServiceOptions'].embeddedPort).toBe(
		46_101
	);
	await terminateStandaloneTauriSession(reusedPortBrowser);
});

test('cleans the provider and rejects when the remote session reports another app nonce', async () => {
	availablePorts.push(46_125);
	observedNonce = 'unrelated-driver-nonce';
	const cleanupCallCount = cleanupWdioSession.mock.calls.length;

	try {
		await expect(
			startStandaloneTauriSession({
				appBinaryPath: '/tmp/dtx-desktop',
				dataDir: '/tmp/dtx-e2e-data',
				logDir: '/tmp/dtx-e2e-logs'
			})
		).rejects.toThrow('nonce mismatch');
		expect(cleanupWdioSession.mock.calls.slice(cleanupCallCount)).toHaveLength(1);
	} finally {
		observedNonce = 'launch-nonce-123';
	}
});

test('holds an exclusive lease until standalone cleanup releases it', async () => {
	availablePorts.push(46_151, 46_151, 46_152, 46_151);
	const startCallCount = startWdioSession.mock.calls.length;
	const input = {
		appBinaryPath: '/tmp/dtx-desktop',
		dataDir: '/tmp/dtx-e2e-data',
		logDir: '/tmp/dtx-e2e-logs'
	};

	const firstBrowser = await startStandaloneTauriSession(input);
	const contendedBrowser = await startStandaloneTauriSession(input);
	const launchedCapabilities = startWdioSession.mock.calls
		.slice(startCallCount)
		.map(([capabilities]) => capabilities['wdio:tauriServiceOptions']);
	expect(launchedCapabilities.map(({ embeddedPort }) => embeddedPort)).toEqual([46_151, 46_152]);

	await terminateStandaloneTauriSession(firstBrowser);
	const releasedLeaseBrowser = await startStandaloneTauriSession(input);
	expect(startWdioSession.mock.calls.at(-1)[0]['wdio:tauriServiceOptions'].embeddedPort).toBe(
		46_151
	);

	await terminateStandaloneTauriSession(contendedBrowser);
	await terminateStandaloneTauriSession(releasedLeaseBrowser);
});

test('recovers a stale lease record before starting the only native app', async () => {
	const port = 46_160;
	const leasePath = join(tmpdir(), 'dtx-e2e-embedded-port-leases', `${port}.lock`);
	mkdirSync(join(tmpdir(), 'dtx-e2e-embedded-port-leases'), { recursive: true });
	writeFileSync(
		leasePath,
		JSON.stringify({
			pid: process.pid,
			nonce: 'future-corrupted-lease',
			createdAt: Date.now() + 60 * 60 * 1000
		})
	);
	availablePorts.push(port);

	try {
		const browser = await startStandaloneTauriSession({
			appBinaryPath: '/tmp/dtx-desktop',
			dataDir: '/tmp/dtx-e2e-data',
			logDir: '/tmp/dtx-e2e-logs'
		});
		expect(existsSync(leasePath)).toBe(true);
		await terminateStandaloneTauriSession(browser);
		expect(existsSync(leasePath)).toBe(false);
	} finally {
		rmSync(leasePath, { force: true });
	}
});

test('never releases a lease that a different harness nonce now owns', async () => {
	const port = 46_161;
	const leasePath = join(tmpdir(), 'dtx-e2e-embedded-port-leases', `${port}.lock`);
	availablePorts.push(port);

	try {
		const browser = await startStandaloneTauriSession({
			appBinaryPath: '/tmp/dtx-desktop',
			dataDir: '/tmp/dtx-e2e-data',
			logDir: '/tmp/dtx-e2e-logs'
		});
		writeFileSync(
			leasePath,
			JSON.stringify({ pid: process.pid, nonce: 'new-harness-owner', createdAt: Date.now() })
		);

		await terminateStandaloneTauriSession(browser);
		expect(existsSync(leasePath)).toBe(true);
	} finally {
		rmSync(leasePath, { force: true });
	}
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

test('keeps provider cleanup failures visible after terminating the native app', async () => {
	cleanupResponses.push(new Error('provider cleanup failed'));
	const browser = {
		tauri: {
			execute: async (callback, code) => {
				await callback({ core: { invoke: async () => undefined } }, code);
				throw new Error('socket hang up');
			}
		}
	};

	await expect(terminateStandaloneTauriSession(browser)).rejects.toThrow(
		'provider cleanup failed'
	);
});
