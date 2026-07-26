import { expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
	startStandaloneTauriSession,
	terminateStandaloneTauriSession,
	waitForStandaloneTauriSessionExit
} = await import('./standalone-session.ts');

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

const makeClock = (step = 100) => {
	let now = 0;
	return {
		now: () => now,
		setTimeout: (callback, milliseconds) => {
			queueMicrotask(() => {
				now += Math.max(step, milliseconds);
				callback();
			});
			return 0;
		},
		clearTimeout: () => undefined
	};
};

const makeReservePort = (...ports) =>
	mock(async () => ({ port: ports.shift(), release: async () => undefined }));

const makeBrowser = () => ({ deleteSession: mock(async () => undefined) });

const makeDependencies = ({
	child = new FakeChild(),
	port = 46_001,
	observedNonce = 'launch-nonce-123',
	exitError,
	remoteError,
	onExit = () => child.exit(),
	statusResponses = [{ ok: true, value: { ready: true } }]
} = {}) => {
	const spawn = mock(() => child);
	const browsers = [];
	const remote = mock(async () => {
		if (remoteError) throw remoteError;
		const browser = makeBrowser();
		browsers.push(browser);
		return browser;
	});
	const evaluate = mock(async (_port, script, args) => {
		if (script.includes('read_e2e_session_nonce')) return observedNonce;
		if (script.includes('plugin:process|exit')) {
			onExit(args[0]);
			if (exitError) throw exitError;
			return undefined;
		}
		throw new Error(`Unexpected direct-eval script: ${script}`);
	});
	const fetch = mock(async () => {
		const response = statusResponses.shift() ?? { ok: true, value: { ready: true } };
		if (response instanceof Error) throw response;
		return { ok: response.ok, json: async () => ({ value: response.value }) };
	});
	return {
		child,
		browsers,
		spawn,
		remote,
		evaluate,
		fetch,
		clock: makeClock(),
		nonce: () => 'launch-nonce-123',
		reservePort: makeReservePort(port)
	};
};

const input = {
	appBinaryPath: '/tmp/dtx-desktop',
	dataDir: '/tmp/dtx-e2e-data',
	drumeryUserId: 'fixed-e2e-user',
	logDir: '/tmp/dtx-e2e-logs'
};

const cleanupLease = (port) => rmSync(leasePathFor(port), { recursive: true, force: true });

test('spawns exactly one owned app and connects remote directly with the embedded protocol', async () => {
	const exitCodes = [];
	let child;
	const dependencies = makeDependencies({
		port: 46_001,
		onExit: (code) => {
			exitCodes.push(code);
			child.exit();
		}
	});
	child = dependencies.child;
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
					DTX_E2E_DRUMERY_USER_ID: 'fixed-e2e-user',
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
		await terminateStandaloneTauriSession(browser, 86);
		expect(exitCodes).toEqual([86]);
	} finally {
		cleanupLease(46_001);
	}
});

test('observes the exact owned native process exit code before cleanup', async () => {
	const connectionRefused = Object.assign(new Error('connection refused'), {
		code: 'ECONNREFUSED'
	});
	const dependencies = makeDependencies({
		port: 46_017,
		exitError: connectionRefused,
		onExit: () => undefined
	});
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		dependencies.child.exit(86);
		await expect(waitForStandaloneTauriSessionExit(browser, 86)).resolves.toBeUndefined();
		await terminateStandaloneTauriSession(browser, 86);
	} finally {
		cleanupLease(46_017);
	}
});

test('cleans the owned child and WebDriver session when the nonce proves another app answered', async () => {
	const child = new FakeChild();
	child.exitOnSignal.add('SIGTERM');
	const dependencies = makeDependencies({
		child,
		port: 46_002,
		observedNonce: 'other-app-nonce'
	});
	try {
		await expect(startStandaloneTauriSession(input, dependencies)).rejects.toThrow(
			'nonce mismatch'
		);
		expect(dependencies.child.exitCode).toBe(0);
		expect(dependencies.remote).toHaveBeenCalledTimes(1);
		expect(
			dependencies.evaluate.mock.calls.some(([, script]) =>
				script.includes('plugin:process|exit')
			)
		).toBeFalse();
		expect(dependencies.browsers[0].deleteSession).toHaveBeenCalledTimes(1);
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

test('waits through an initial connection refusal until the embedded server reports ready', async () => {
	const dependencies = makeDependencies({
		port: 46_008,
		statusResponses: [new Error('ECONNREFUSED'), { ok: true, value: { ready: true } }]
	});
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		expect(dependencies.fetch).toHaveBeenCalledTimes(2);
		expect(dependencies.remote).toHaveBeenCalledTimes(1);
		await terminateStandaloneTauriSession(browser);
	} finally {
		cleanupLease(46_008);
	}
});

test('fails readiness without creating a WebDriver session and cleans the owned child', async () => {
	const child = new FakeChild();
	child.exitOnSignal.add('SIGTERM');
	const dependencies = makeDependencies({
		child,
		port: 46_009,
		statusResponses: [
			{ ok: true, value: { ready: false } },
			{ ok: true, value: { ready: false } }
		]
	});
	dependencies.clock = makeClock(60_000);
	try {
		await expect(startStandaloneTauriSession(input, dependencies)).rejects.toThrow(
			'did not become ready'
		);
		expect(dependencies.remote).not.toHaveBeenCalled();
		expect(child.killSignals).toEqual(['SIGTERM']);
	} finally {
		cleanupLease(46_009);
	}
});

test('fails immediately when the owned child exits before readiness', async () => {
	const child = new FakeChild();
	child.exit();
	const dependencies = makeDependencies({ child, port: 46_010 });
	try {
		await expect(startStandaloneTauriSession(input, dependencies)).rejects.toThrow(
			'exited before'
		);
		expect(dependencies.remote).not.toHaveBeenCalled();
	} finally {
		cleanupLease(46_010);
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

test('accepts the expected driver disconnect only after the owned child has exited', async () => {
	const dependencies = makeDependencies({ port: 46_011 });
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		browser.deleteSession.mockImplementationOnce(async () => {
			throw new Error('socket hang up');
		});
		await expect(terminateStandaloneTauriSession(browser)).resolves.toBeUndefined();
		expect(existsSync(leasePathFor(46_011))).toBeFalse();
	} finally {
		cleanupLease(46_011);
	}
});

test('accepts WebdriverIO ConnectionRefused cleanup after the owned child has exited', async () => {
	const port = 46_017;
	const dependencies = makeDependencies({ port });
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		browser.deleteSession.mockImplementationOnce(async () => {
			throw Object.assign(
				new Error('WebDriverError: Request failed with error code ConnectionRefused'),
				{ code: 'ConnectionRefused' }
			);
		});
		await expect(terminateStandaloneTauriSession(browser)).resolves.toBeUndefined();
		expect(existsSync(leasePathFor(port))).toBeFalse();
	} finally {
		cleanupLease(port);
	}
});

test('accepts a controlled-exit disconnect after the owned child has exited', async () => {
	const port = 46_014;
	const dependencies = makeDependencies({
		port,
		exitError: new Error('socket hang up')
	});
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		let leaseExistedDuringCleanup = false;
		browser.deleteSession.mockImplementationOnce(async () => {
			leaseExistedDuringCleanup = existsSync(leasePathFor(port));
		});
		await expect(terminateStandaloneTauriSession(browser, 86)).resolves.toBeUndefined();
		expect(leaseExistedDuringCleanup).toBeTrue();
		expect(dependencies.browsers[0].deleteSession).toHaveBeenCalledTimes(1);
		expect(existsSync(leasePathFor(port))).toBeFalse();
	} finally {
		cleanupLease(port);
	}
});

test('preserves an unexpected controlled-exit error after the owned child has exited', async () => {
	const port = 46_015;
	const dependencies = makeDependencies({
		port,
		exitError: new Error('native exit request rejected')
	});
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		await expect(terminateStandaloneTauriSession(browser, 86)).rejects.toThrow(
			'native exit request rejected'
		);
		expect(dependencies.browsers[0].deleteSession).toHaveBeenCalledTimes(1);
		expect(existsSync(leasePathFor(port))).toBeTrue();
	} finally {
		cleanupLease(port);
	}
});

test('preserves a controlled-exit disconnect when the owned child does not exit', async () => {
	const port = 46_016;
	const child = new FakeChild();
	const dependencies = makeDependencies({
		child,
		port,
		exitError: new Error('socket hang up'),
		onExit: () => undefined
	});
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		let cleanupError;
		try {
			await terminateStandaloneTauriSession(browser, 86);
		} catch (error) {
			cleanupError = error;
		}
		expect(cleanupError).toBeInstanceOf(AggregateError);
		expect(cleanupError.errors.map((error) => error.message)).toEqual([
			'socket hang up',
			'Standalone Tauri app did not exit after SIGKILL'
		]);
		expect(child.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
		expect(dependencies.browsers[0].deleteSession).toHaveBeenCalledTimes(1);
		expect(existsSync(leasePathFor(port))).toBeTrue();
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

test('treats Windows access-denied publication as contention only when a valid owner exists', async () => {
	const firstPort = 46_012;
	const secondPort = 46_013;
	let injected = false;
	const dependencies = makeDependencies({ port: firstPort });
	dependencies.reservePort = makeReservePort(firstPort, secondPort);
	dependencies.platform = 'win32';
	dependencies.rename = (from, to) => {
		if (!injected && to === leasePathFor(firstPort)) {
			injected = true;
			mkdirSync(to, { recursive: true });
			writeFileSync(
				join(to, 'owner.json'),
				JSON.stringify({ pid: process.pid, nonce: 'existing-owner', createdAt: 0 })
			);
			throw Object.assign(new Error('access denied'), { code: 'EACCES' });
		}
		renameSync(from, to);
	};
	try {
		const browser = await startStandaloneTauriSession(input, dependencies);
		expect(dependencies.spawn).toHaveBeenCalledTimes(1);
		expect(dependencies.remote.mock.calls[0][0].port).toBe(secondPort);
		await terminateStandaloneTauriSession(browser);
	} finally {
		cleanupLease(firstPort);
		cleanupLease(secondPort);
	}
});
