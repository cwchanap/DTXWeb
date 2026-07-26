import { expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { startStandaloneTauriSession, terminateStandaloneTauriSession } =
	await import('./standalone-session.ts');

class FakeChild extends EventEmitter {
	exitCode = null;
	pid = 41_001;
	signalCode = null;
	killSignals = [];
	exitOnSignal = new Set();

	kill(signal) {
		this.killSignals.push(signal);
		if (this.exitOnSignal.has(signal)) this.exit(0, signal);
		return true;
	}

	exit(code = 0, signal = null) {
		this.exitCode = code;
		this.signalCode = signal;
		this.emit('exit', code, signal);
	}
}

const leasePathFor = (port) => join(tmpdir(), 'dtx-e2e-embedded-port-leases', `${port}.lease`);

const makeClock = () => ({
	now: () => Date.now(),
	setTimeout: (callback) => {
		queueMicrotask(callback);
		return 0;
	},
	clearTimeout: () => undefined
});

const makeReservePort = (...ports) =>
	mock(async () => ({ port: ports.shift(), release: async () => undefined }));

const makeBrowser = () => ({ deleteSession: mock(async () => undefined) });

const makeDependencies = ({
	child = new FakeChild(),
	port = 46_001,
	observedNonce = 'launch-nonce-123',
	remoteError,
	onExit = () => child.exit()
} = {}) => {
	const spawn = mock(() => child);
	const remote = mock(async () => {
		if (remoteError) throw remoteError;
		return makeBrowser();
	});
	const evaluate = mock(async (_port, script) => {
		if (script.includes('read_e2e_session_nonce')) return observedNonce;
		if (script.includes('plugin:process|exit')) {
			onExit();
			return undefined;
		}
		throw new Error(`Unexpected direct-eval script: ${script}`);
	});
	return {
		child,
		spawn,
		remote,
		evaluate,
		clock: makeClock(),
		nonce: () => 'launch-nonce-123',
		reservePort: makeReservePort(port)
	};
};

const input = {
	appBinaryPath: '/tmp/dtx-desktop',
	dataDir: '/tmp/dtx-e2e-data',
	logDir: '/tmp/dtx-e2e-logs'
};

const cleanupLease = (port) => rmSync(leasePathFor(port), { recursive: true, force: true });

test('spawns exactly one owned app and connects remote directly with the embedded protocol', async () => {
	const dependencies = makeDependencies({ port: 46_001 });
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		expect(dependencies.spawn).toHaveBeenCalledTimes(1);
		expect(dependencies.spawn).toHaveBeenCalledWith(
			'/tmp/dtx-desktop',
			[],
			expect.objectContaining({
				shell: false,
				env: expect.objectContaining({
					DTX_E2E_DATA_DIR: '/tmp/dtx-e2e-data',
					DTX_E2E_SESSION_NONCE: 'launch-nonce-123',
					TAURI_WEBDRIVER_PORT: '46001',
					WDIO_EMBEDDED_SERVER: 'true'
				})
			})
		);
		expect(dependencies.remote).toHaveBeenCalledWith(
			expect.objectContaining({
				hostname: '127.0.0.1',
				port: 46_001,
				connectionRetryCount: 0
			})
		);
		await terminateStandaloneTauriSession(browser);
	} finally {
		cleanupLease(46_001);
	}
});

test('cleans the owned child and WebDriver session when the nonce proves another app answered', async () => {
	const dependencies = makeDependencies({ port: 46_002, observedNonce: 'other-app-nonce' });
	try {
		await expect(startStandaloneTauriSession(input, dependencies)).rejects.toThrow(
			'nonce mismatch'
		);
		expect(dependencies.child.exitCode).toBe(0);
		expect(dependencies.remote).toHaveBeenCalledTimes(1);
	} finally {
		cleanupLease(46_002);
	}
});

test('cleans startup failure without launching a replacement app', async () => {
	const child = new FakeChild();
	child.exitOnSignal.add('SIGTERM');
	const dependencies = makeDependencies({
		child,
		port: 46_003,
		remoteError: new Error('driver connection failed')
	});
	try {
		await expect(startStandaloneTauriSession(input, dependencies)).rejects.toThrow(
			'driver connection failed'
		);
		expect(dependencies.spawn).toHaveBeenCalledTimes(1);
		expect(child.killSignals).toEqual(['SIGTERM']);
	} finally {
		cleanupLease(46_003);
	}
});

test('escalates from controlled exit through TERM to KILL and waits for exit', async () => {
	const child = new FakeChild();
	child.exitOnSignal.add('SIGKILL');
	const dependencies = makeDependencies({ child, port: 46_004, onExit: () => undefined });
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		await terminateStandaloneTauriSession(browser, 86);
		expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
		expect(child.exitCode).toBe(0);
	} finally {
		cleanupLease(46_004);
	}
});

test('does not release the lease before the child exits and propagates WebDriver cleanup failures', async () => {
	const child = new FakeChild();
	let leaseExistedAtExit = false;
	const port = 46_005;
	const dependencies = makeDependencies({
		child,
		port,
		onExit: () => {
			leaseExistedAtExit = existsSync(leasePathFor(port));
			child.exit();
		}
	});
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		browser.deleteSession.mockImplementationOnce(async () => {
			throw new Error('delete session failed');
		});
		await expect(terminateStandaloneTauriSession(browser)).rejects.toThrow(
			'delete session failed'
		);
		expect(leaseExistedAtExit).toBe(true);
		expect(existsSync(leasePathFor(port))).toBe(true);
	} finally {
		cleanupLease(port);
	}
});

test('atomically reclaims a stale lease for one concurrent starter only', async () => {
	const port = 46_006;
	const path = leasePathFor(port);
	mkdirSync(path, { recursive: true });
	writeFileSync(
		join(path, 'owner.json'),
		JSON.stringify({ pid: 999_999, nonce: 'stale-owner', createdAt: 0 })
	);
	const first = makeDependencies({ port });
	const second = makeDependencies({ port });
	second.reservePort = makeReservePort(port, port, port);
	try {
		const results = await Promise.allSettled([
			startStandaloneTauriSession(input, first),
			startStandaloneTauriSession(input, second)
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(first.spawn.mock.calls.length + second.spawn.mock.calls.length).toBe(1);
		const winner = results.find((result) => result.status === 'fulfilled');
		await terminateStandaloneTauriSession(winner.value);
	} finally {
		cleanupLease(port);
	}
});

test('restores a foreign replacement instead of deleting it during release', async () => {
	const port = 46_007;
	const dependencies = makeDependencies({ port });
	const path = leasePathFor(port);
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		writeFileSync(
			join(path, 'owner.json'),
			JSON.stringify({ pid: process.pid, nonce: 'foreign-owner', createdAt: Date.now() })
		);
		await expect(terminateStandaloneTauriSession(browser)).rejects.toThrow('another harness');
		expect(existsSync(path)).toBe(true);
	} finally {
		cleanupLease(port);
	}
});
