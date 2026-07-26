import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
	type WriteStream
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { remote } from 'webdriverio';

type StandaloneTauriSessionInput = {
	appBinaryPath: string;
	dataDir: string;
	drumeryUserId: string;
	logDir: string;
};

type PortReservation = {
	port: number;
	release: () => Promise<void>;
};

type OwnershipRecord = {
	createdAt: number;
	nonce: string;
	pid: number;
};

type PortLease = {
	nonce: string;
	path: string;
	record: OwnershipRecord;
};

type ChildLike = Pick<
	ChildProcess,
	'exitCode' | 'kill' | 'once' | 'pid' | 'removeListener' | 'signalCode'
>;

type Clock = {
	clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void;
	now: () => number;
	setTimeout: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
};

type Remote = (options: Record<string, unknown>) => Promise<WebdriverIO.Browser>;
type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
type StatusFetch = (
	url: string,
	init?: { signal?: AbortSignal }
) => Promise<{
	json: () => Promise<unknown>;
	ok: boolean;
}>;

export type StandaloneSessionDependencies = {
	clock?: Clock;
	evaluate?: (port: number, script: string, args: unknown[]) => Promise<unknown>;
	fetch?: StatusFetch;
	nonce?: () => string;
	platform?: NodeJS.Platform;
	rename?: typeof renameSync;
	remote?: Remote;
	reservePort?: () => Promise<PortReservation>;
	spawn?: Spawn;
};

type OwnedSession = {
	browser: WebdriverIO.Browser;
	child: ChildLike;
	closeLogs: () => Promise<void>;
	exitPromise: Promise<boolean>;
	lease: PortLease;
	port: number;
	clock: Clock;
	evaluate: (port: number, script: string, args: unknown[]) => Promise<unknown>;
	ownershipVerified: boolean;
};

const EMBEDDED_PORT_ATTEMPTS = 3;
const MAX_LEASE_AGE_MS = 15 * 60 * 1000;
const CHILD_EXIT_TIMEOUT_MS = 5_000;
const READINESS_POLL_MS = 100;
const READINESS_TIMEOUT_MS = 60_000;
const TAURI_INVOKE_UNAVAILABLE_ERROR = 'Tauri core.invoke is unavailable';
const leaseDirectory = join(tmpdir(), 'dtx-e2e-embedded-port-leases');
const ownerFileName = 'owner.json';
const activeSessions = new WeakMap<WebdriverIO.Browser, OwnedSession>();

const defaultClock: Clock = {
	now: () => Date.now(),
	setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
	clearTimeout: (timeout) => clearTimeout(timeout)
};

const createNonce = (): string => randomBytes(32).toString('hex');

const reserveEmbeddedPort = async (): Promise<PortReservation> =>
	await new Promise<PortReservation>((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close(() =>
					reject(new Error('Could not reserve an embedded WebDriver port'))
				);
				return;
			}
			resolve({
				port: address.port,
				release: async (): Promise<void> =>
					await new Promise<void>((resolveRelease, rejectRelease) => {
						server.close((error) => (error ? rejectRelease(error) : resolveRelease()));
					})
			});
		});
	});

const isPidAlive = (pid: number): boolean => {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
	}
};

const readOwnershipRecord = (directory: string): OwnershipRecord | null => {
	try {
		const value = JSON.parse(
			readFileSync(join(directory, ownerFileName), 'utf8')
		) as Partial<OwnershipRecord>;
		if (
			!Number.isFinite(value.createdAt) ||
			typeof value.nonce !== 'string' ||
			value.nonce.length === 0 ||
			!Number.isInteger(value.pid)
		) {
			return null;
		}
		return value as OwnershipRecord;
	} catch {
		return null;
	}
};

const sameOwnership = (left: OwnershipRecord | null, right: OwnershipRecord | null): boolean =>
	left !== null &&
	right !== null &&
	left.pid === right.pid &&
	left.nonce === right.nonce &&
	left.createdAt === right.createdAt;

const isLeaseStale = (record: OwnershipRecord | null, now: number): boolean =>
	record === null ||
	Math.abs(now - record.createdAt) > MAX_LEASE_AGE_MS ||
	!isPidAlive(record.pid);

const errorCode = (error: unknown): string | null =>
	error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;

const isPublicationContention = (
	error: unknown,
	path: string,
	platform: NodeJS.Platform
): boolean => {
	const code = errorCode(error);
	if (code === 'EEXIST' || code === 'ENOTEMPTY') return true;
	return (
		platform === 'win32' &&
		(code === 'EACCES' || code === 'EPERM') &&
		existsSync(path) &&
		readOwnershipRecord(path) !== null
	);
};

const removeDirectory = (path: string): void => {
	rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
};

const privateDirectory = (root: string, name: string, nonce: string, phase: string): string =>
	join(root, `.${name}.${phase}.${nonce}`);

const createPrivateOwnershipDirectory = (
	root: string,
	name: string,
	record: OwnershipRecord
): string => {
	const path = privateDirectory(root, name, record.nonce, 'pending');
	mkdirSync(path, { mode: 0o700 });
	writeFileSync(join(path, ownerFileName), JSON.stringify(record), { mode: 0o600 });
	return path;
};

const moveToQuarantine = (
	path: string,
	expected: OwnershipRecord | null,
	nonce: string
): 'missing' | 'mismatch' | 'moved' => {
	const quarantine = privateDirectory(join(path, '..'), basename(path), nonce, 'quarantine');
	try {
		renameSync(path, quarantine);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing';
		throw error;
	}

	const moved = readOwnershipRecord(quarantine);
	if (expected === null ? moved !== null : !sameOwnership(moved, expected)) {
		try {
			renameSync(quarantine, path);
		} catch (restoreError) {
			throw new AggregateError(
				[restoreError],
				`Lease ownership changed while quarantining ${basename(path)}`
			);
		}
		return 'mismatch';
	}
	removeDirectory(quarantine);
	return 'moved';
};

const acquirePortLease = (
	port: number,
	nonce: string,
	clock: Clock,
	rename: typeof renameSync,
	platform: NodeJS.Platform
): PortLease | null => {
	mkdirSync(leaseDirectory, { recursive: true, mode: 0o700 });
	const path = join(leaseDirectory, `${port}.lease`);
	const name = basename(path);
	const record = { pid: process.pid, nonce, createdAt: clock.now() };

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const pending = createPrivateOwnershipDirectory(leaseDirectory, name, record);
		try {
			rename(pending, path);
			return { nonce, path, record };
		} catch (error) {
			removeDirectory(pending);
			if (!isPublicationContention(error, path, platform)) {
				throw error;
			}
		}

		const observed = readOwnershipRecord(path);
		if (!isLeaseStale(observed, clock.now())) return null;
		const reclaimed = moveToQuarantine(path, observed, `${nonce}-reclaim-${attempt}`);
		if (reclaimed !== 'moved') return null;
	}
	return null;
};

const releasePortLease = (lease: PortLease): void => {
	const released = moveToQuarantine(lease.path, lease.record, `${lease.nonce}-release`);
	if (released === 'mismatch') {
		throw new Error(
			`Refusing to release a port lease now owned by another harness: ${lease.path}`
		);
	}
};

const makeDirectEvalScript = (
	script: string,
	args: unknown[]
): string => `var __cb = arguments[arguments.length - 1];
(async () => {
  try {
    const __wdio_args = ${JSON.stringify(args)};
    const __wdio_core = window.__wdio_original_core__ || window.__TAURI__?.core;
    if (!__wdio_core || typeof __wdio_core.invoke !== 'function') {
      throw new Error(${JSON.stringify(TAURI_INVOKE_UNAVAILABLE_ERROR)});
    }
    const __tauri = { core: { invoke: __wdio_core.invoke.bind(__wdio_core) } };
    const __result = await (${script})(__tauri, ...__wdio_args);
    __cb({ ok: true, value: __result === undefined ? null : __result, undef: __result === undefined });
  } catch (error) {
    __cb({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
})();`;

const directEvaluate = async (port: number, script: string, args: unknown[]): Promise<unknown> => {
	const response = await fetch(`http://127.0.0.1:${port}/wdio/eval`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ script: makeDirectEvalScript(script, args), timeout_ms: 30_000 }),
		signal: AbortSignal.timeout(35_000)
	});
	const payload = (await response.json().catch(() => null)) as {
		error?: string;
		undef?: boolean;
		value?: unknown;
	} | null;
	if (!response.ok)
		throw new Error(payload?.error ?? `Direct eval HTTP error: ${response.status}`);
	if (payload === null) throw new Error('Direct eval returned invalid JSON');
	if (payload.error) throw new Error(payload.error);
	return payload.undef === true ? undefined : payload.value;
};

const addTauriExecute = (
	browser: WebdriverIO.Browser,
	port: number,
	evaluate: (port: number, script: string, args: unknown[]) => Promise<unknown>
): void => {
	const ownedBrowser = browser as unknown as {
		tauri: {
			execute: <Result>(
				script: (...args: never[]) => unknown,
				...args: unknown[]
			) => Promise<Result>;
		};
	};
	ownedBrowser.tauri = {
		execute: async <Result>(
			script: (...args: never[]) => unknown,
			...args: unknown[]
		): Promise<Result> => (await evaluate(port, script.toString(), args)) as Result
	};
};

const createExitPromise = (child: ChildLike): Promise<boolean> =>
	new Promise<boolean>((resolve) => {
		child.once('exit', () => resolve(true));
		child.once('error', () => resolve(false));
	});

const captureProcessLogs = (child: ChildProcess, logDir: string): (() => Promise<void>) => {
	mkdirSync(logDir, { recursive: true });
	const streams: WriteStream[] = [];
	for (const [source, name] of [
		[child.stdout, 'native-stdout.log'],
		[child.stderr, 'native-stderr.log']
	] as const) {
		if (!source) continue;
		const destination = createWriteStream(join(logDir, name), { flags: 'a' });
		source.pipe(destination);
		streams.push(destination);
	}
	return async (): Promise<void> => {
		await Promise.all(
			streams.map(
				async (stream) =>
					await new Promise<void>((resolve, reject) => {
						stream.once('error', reject);
						stream.end(resolve);
					})
			)
		);
	};
};

const waitForChildExit = async (
	child: ChildLike,
	exitPromise: Promise<boolean>,
	clock: Clock,
	timeoutMilliseconds = CHILD_EXIT_TIMEOUT_MS
): Promise<boolean> => {
	if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
		return true;
	return await new Promise<boolean>((resolve) => {
		let finished = false;
		const complete = (exited: boolean): void => {
			if (finished) return;
			finished = true;
			clock.clearTimeout(timeout);
			resolve(exited);
		};
		const timeout = clock.setTimeout(() => complete(false), timeoutMilliseconds);
		void exitPromise.then((exited) => {
			if (exited) complete(true);
		});
	});
};

const waitForTimer = async (clock: Clock, milliseconds: number): Promise<void> =>
	await new Promise<void>((resolve) => {
		clock.setTimeout(resolve, milliseconds);
	});

const waitForEmbeddedReadiness = async (
	port: number,
	child: ChildLike,
	exitPromise: Promise<boolean>,
	clock: Clock,
	fetchStatus: StatusFetch
): Promise<void> => {
	const deadline = clock.now() + READINESS_TIMEOUT_MS;
	const earlyExitError = new Error(
		'Standalone Tauri app exited before the embedded WebDriver server became ready'
	);
	const earlyExit = exitPromise.then(async (exited) => {
		if (exited) throw earlyExitError;
		return await new Promise<never>(() => undefined);
	});
	while (clock.now() <= deadline) {
		if (child.exitCode !== null || child.signalCode !== null) throw earlyExitError;
		try {
			const response = await Promise.race([
				fetchStatus(`http://127.0.0.1:${port}/status`, {
					signal: AbortSignal.timeout(Math.max(1, deadline - clock.now()))
				}),
				earlyExit
			]);
			const payload = (await response.json()) as { value?: { ready?: unknown } };
			if (response.ok && payload.value?.ready === true) return;
		} catch (error) {
			if (error === earlyExitError) throw error;
			// A pre-ready embedded server commonly rejects the first connection.
		}
		if (clock.now() >= deadline) break;
		await Promise.race([
			waitForTimer(clock, Math.min(READINESS_POLL_MS, deadline - clock.now())),
			earlyExit
		]);
	}
	throw new Error(`Embedded WebDriver server did not become ready on port ${port}`);
};

const waitForTauriInvokeReadiness = async (
	readSessionNonce: () => Promise<string>,
	child: ChildLike,
	exitPromise: Promise<boolean>,
	clock: Clock
): Promise<string> => {
	const deadline = clock.now() + READINESS_TIMEOUT_MS;
	const readinessTimeoutError = new Error('Tauri invoke bridge did not become ready');
	const earlyExitError = new Error(
		'Standalone Tauri app exited before the invoke bridge became ready'
	);
	const earlyExit = exitPromise.then(async (exited) => {
		if (exited) throw earlyExitError;
		return await new Promise<never>(() => undefined);
	});
	while (clock.now() <= deadline) {
		if (child.exitCode !== null || child.signalCode !== null) throw earlyExitError;
		const nonceResult = readSessionNonce();
		let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
		const deadlineReached = (async (): Promise<never> => {
			// Give an already-settled invoke result priority over the synthetic
			// deadline clock used by unit tests while still bounding a pending probe.
			await Promise.resolve();
			return await new Promise<never>((_, reject) => {
				deadlineTimer = clock.setTimeout(
					() => reject(readinessTimeoutError),
					Math.max(0, deadline - clock.now())
				);
			});
		})();
		try {
			return await Promise.race([nonceResult, earlyExit, deadlineReached]);
		} catch (error) {
			if (error === earlyExitError) throw error;
			if (error === readinessTimeoutError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			if (message !== TAURI_INVOKE_UNAVAILABLE_ERROR) throw error;
		} finally {
			if (deadlineTimer !== undefined) clock.clearTimeout(deadlineTimer);
		}
		if (clock.now() >= deadline) break;
		await Promise.race([
			waitForTimer(clock, Math.min(READINESS_POLL_MS, deadline - clock.now())),
			earlyExit
		]);
	}
	throw readinessTimeoutError;
};

const isExpectedDriverDisconnect = (error: unknown): boolean => {
	const code = errorCode(error);
	if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ConnectionRefused')
		return true;
	const message = error instanceof Error ? error.message : String(error);
	return /ECONNREFUSED|ECONNRESET|connection refused|socket hang up|invalid session id|disconnected/i.test(
		message
	);
};

const collect = async (errors: unknown[], action: () => Promise<void> | void): Promise<void> => {
	try {
		await action();
	} catch (error) {
		errors.push(error);
	}
};

const closeOwnedSession = async (
	session: OwnedSession,
	code: number | undefined,
	requestNativeExit: boolean
): Promise<void> => {
	const errors: unknown[] = [];
	let exitRequestFailed = false;
	let exitRequestError: unknown;
	let sessionClosedBeforeChildShutdown = false;
	if (!requestNativeExit) {
		try {
			await session.browser.deleteSession();
		} catch {
			// A browser that has not proved ownership is best-effort cleanup only.
		}
		sessionClosedBeforeChildShutdown = true;
	}
	if (requestNativeExit && session.ownershipVerified) {
		const exitCode = code ?? 0;
		try {
			await session.browser.tauri.execute<void, [number]>(
				({ core }, ownedExitCode) =>
					core.invoke('plugin:process|exit', { code: ownedExitCode }) as Promise<void>,
				exitCode
			);
		} catch (error) {
			exitRequestFailed = true;
			exitRequestError = error;
		}
	}

	let childExited = await waitForChildExit(session.child, session.exitPromise, session.clock);
	if (!childExited) {
		await collect(errors, () => {
			if (!session.child.kill('SIGTERM'))
				throw new Error('Failed to send SIGTERM to standalone Tauri app');
		});
		childExited = await waitForChildExit(session.child, session.exitPromise, session.clock);
		if (!childExited) {
			await collect(errors, () => {
				if (!session.child.kill('SIGKILL'))
					throw new Error('Failed to send SIGKILL to standalone Tauri app');
			});
			childExited = await waitForChildExit(session.child, session.exitPromise, session.clock);
			if (!childExited) {
				errors.push(new Error('Standalone Tauri app did not exit after SIGKILL'));
			}
		}
	}

	if (exitRequestFailed && (!childExited || !isExpectedDriverDisconnect(exitRequestError))) {
		errors.unshift(exitRequestError);
	}

	if (!sessionClosedBeforeChildShutdown) {
		try {
			await session.browser.deleteSession();
		} catch (error) {
			const childExited =
				session.child.exitCode !== null || session.child.signalCode !== null;
			if (!childExited || !isExpectedDriverDisconnect(error)) errors.push(error);
		}
	}
	await collect(errors, session.closeLogs);

	if (errors.length === 0) {
		await collect(errors, () => releasePortLease(session.lease));
	}
	activeSessions.delete(session.browser);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1)
		throw new AggregateError(errors, 'Standalone Tauri session cleanup failed');
};

const cleanupStartupFailure = async (
	child: ChildLike,
	exitPromise: Promise<boolean>,
	lease: PortLease,
	clock: Clock,
	closeLogs: () => Promise<void>,
	primaryError: unknown
): Promise<never> => {
	const errors: unknown[] = [primaryError];
	if (!(await waitForChildExit(child, exitPromise, clock))) {
		await collect(errors, () => {
			if (!child.kill('SIGTERM'))
				throw new Error('Failed to send SIGTERM after standalone startup failure');
		});
		if (!(await waitForChildExit(child, exitPromise, clock))) {
			await collect(errors, () => {
				if (!child.kill('SIGKILL'))
					throw new Error('Failed to send SIGKILL after standalone startup failure');
			});
			if (!(await waitForChildExit(child, exitPromise, clock))) {
				errors.push(new Error('Standalone Tauri app remained alive after startup cleanup'));
			}
		}
	}
	if (errors.length === 1) {
		await collect(errors, closeLogs);
	}
	if (errors.length === 1) {
		try {
			releasePortLease(lease);
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length === 1) throw errors[0];
	throw new AggregateError(errors, 'Standalone Tauri startup failed and cleanup was incomplete');
};

export const startStandaloneTauriSession = async (
	{ appBinaryPath, dataDir, drumeryUserId, logDir }: StandaloneTauriSessionInput,
	dependencies: StandaloneSessionDependencies = {}
): Promise<WebdriverIO.Browser> => {
	const clock = dependencies.clock ?? defaultClock;
	const nonce = dependencies.nonce ?? createNonce;
	const reservePort = dependencies.reservePort ?? reserveEmbeddedPort;
	const spawnProcess = dependencies.spawn ?? (spawn as Spawn);
	const createRemote = dependencies.remote ?? (remote as unknown as Remote);
	const evaluate = dependencies.evaluate ?? directEvaluate;
	const fetchStatus = dependencies.fetch ?? (fetch as StatusFetch);
	const rename = dependencies.rename ?? renameSync;
	const platform = dependencies.platform ?? process.platform;
	const sessionNonce = nonce();
	let reservation: PortReservation | undefined;
	let lease: PortLease | null = null;

	for (let attempt = 0; attempt < EMBEDDED_PORT_ATTEMPTS && lease === null; attempt += 1) {
		reservation = await reservePort();
		lease = acquirePortLease(reservation.port, sessionNonce, clock, rename, platform);
		if (lease === null) await reservation.release();
	}
	if (!reservation || !lease)
		throw new Error('Could not acquire an embedded WebDriver port lease');

	try {
		await reservation.release();
	} catch (error) {
		releasePortLease(lease);
		throw error;
	}

	let child: ChildProcess;
	try {
		child = spawnProcess(appBinaryPath, [], {
			env: {
				...process.env,
				DTX_E2E_DATA_DIR: dataDir,
				DTX_E2E_DRUMERY_USER_ID: drumeryUserId,
				DTX_E2E_SESSION_NONCE: sessionNonce,
				TAURI_WEBDRIVER_PORT: String(reservation.port),
				WDIO_EMBEDDED_SERVER: 'true',
				DTX_E2E_LOG_DIR: logDir
			},
			shell: false,
			stdio: ['ignore', 'pipe', 'pipe']
		});
	} catch (error) {
		releasePortLease(lease);
		throw error;
	}
	const exitPromise = createExitPromise(child);
	const closeLogs = captureProcessLogs(child, logDir);

	let browser: WebdriverIO.Browser | undefined;
	let ownershipVerified = false;
	try {
		await waitForEmbeddedReadiness(reservation.port, child, exitPromise, clock, fetchStatus);
		browser = await createRemote({
			hostname: '127.0.0.1',
			port: reservation.port,
			capabilities: { 'tauri:options': { application: appBinaryPath } },
			connectionRetryCount: 0,
			connectionRetryTimeout: 60_000
		});
		addTauriExecute(browser, reservation.port, evaluate);
		const observedNonce = await waitForTauriInvokeReadiness(
			async () =>
				await browser!.tauri.execute<string, []>(
					({ core }) => core.invoke('read_e2e_session_nonce') as unknown as string
				),
			child,
			exitPromise,
			clock
		);
		if (observedNonce !== sessionNonce)
			throw new Error('Standalone Tauri session nonce mismatch');
		ownershipVerified = true;
		activeSessions.set(browser, {
			browser,
			child,
			closeLogs,
			exitPromise,
			lease,
			port: reservation.port,
			clock,
			evaluate,
			ownershipVerified
		});
		return browser;
	} catch (error) {
		if (browser) {
			addTauriExecute(browser, reservation.port, evaluate);
			const failedSession: OwnedSession = {
				browser,
				child,
				closeLogs,
				exitPromise,
				lease,
				port: reservation.port,
				clock,
				evaluate,
				ownershipVerified
			};
			try {
				await closeOwnedSession(failedSession, 1, ownershipVerified);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Standalone Tauri startup verification failed'
				);
			}
			throw error;
		}
		return await cleanupStartupFailure(child, exitPromise, lease, clock, closeLogs, error);
	}
};

export const terminateStandaloneTauriSession = async (
	browser: WebdriverIO.Browser,
	code?: number
): Promise<void> => {
	const session = activeSessions.get(browser);
	if (!session) throw new Error('Standalone Tauri session is not owned by this harness');
	await closeOwnedSession(session, code, true);
};

export const waitForStandaloneTauriSessionExit = async (
	browser: WebdriverIO.Browser,
	expectedCode: number,
	timeoutMilliseconds = 20_000
): Promise<void> => {
	const session = activeSessions.get(browser);
	if (!session) throw new Error('Standalone Tauri session is not owned by this harness');
	if (
		!(await waitForChildExit(
			session.child,
			session.exitPromise,
			session.clock,
			timeoutMilliseconds
		))
	) {
		throw new Error('Standalone Tauri app did not exit at the expected crash boundary');
	}
	if (session.child.exitCode !== expectedCode) {
		throw new Error(
			`Standalone Tauri app exited with ${session.child.exitCode ?? session.child.signalCode}, expected ${expectedCode}`
		);
	}
};
