import {
	closeSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { type PreferencesShape } from '../support/sentinel-preferences';
import {
	startStandaloneTauriSession,
	terminateStandaloneTauriSession
} from '../support/standalone-session';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executableName = process.platform === 'win32' ? 'dtx-desktop.exe' : 'dtx-desktop';
const defaultAppBinaryPath =
	process.env.DTX_DESKTOP_BINARY ??
	resolve(packageRoot, '../dtx-desktop/src-tauri/target-e2e/debug', executableName);
const defaultDiagnosticsRoot = join(packageRoot, 'logs');
const MAX_RETAINED_RELAUNCH_LOGS = 10;
const MAX_RELAUNCH_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_RUN_MAX_AGE_MS = 30 * 60 * 1000;
const PRUNE_LOCK_MAX_AGE_MS = 5 * 60 * 1000;
const ACTIVE_RUN_MARKER = 'active.json';
const PRUNE_LOCK_FILE = 'relaunch-prune.lock';

const RELAUNCH_SENTINEL = {
	detailPaneWidth: 613,
	detailPaneVisible: false,
	scoreLinks: { 'desktop-relaunch-smoke': 'native-process-restarted' }
} as const satisfies PreferencesShape;

type RelaunchSmokeInput = {
	appBinaryPath?: string;
	diagnosticsRoot?: string;
};

type RunLease = {
	createdAt: number;
	nonce: string;
	pid: number;
};

type PruneLock = {
	fileDescriptor: number;
	nonce: string;
	path: string;
};

const isPidAlive = (pid: number): boolean => {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
	}
};

const readRunLease = (path: string): RunLease | null => {
	try {
		const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunLease>;
		if (
			!Number.isFinite(value.createdAt) ||
			typeof value.nonce !== 'string' ||
			value.nonce.length === 0 ||
			!Number.isInteger(value.pid)
		) {
			return null;
		}
		return value as RunLease;
	} catch {
		return null;
	}
};

const isRunLeaseActive = (lease: RunLease | null, maxAgeMs: number): boolean =>
	lease !== null && Math.abs(Date.now() - lease.createdAt) <= maxAgeMs && isPidAlive(lease.pid);

const writeRunLease = (path: string, nonce: string): void => {
	writeFileSync(path, JSON.stringify({ pid: process.pid, nonce, createdAt: Date.now() }));
};

const removeOwnedLease = (path: string, nonce: string): void => {
	try {
		if (readRunLease(path)?.nonce === nonce) unlinkSync(path);
	} catch {
		// A concurrent cleanup can only make this run less eligible for pruning.
	}
};

const acquirePruneLock = (diagnosticsRoot: string): PruneLock | null => {
	const path = join(diagnosticsRoot, PRUNE_LOCK_FILE);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const nonce = randomBytes(16).toString('hex');
		try {
			const fileDescriptor = openSync(path, 'wx', 0o600);
			writeRunLease(path, nonce);
			return { fileDescriptor, nonce, path };
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
				return null;
			}
			if (isRunLeaseActive(readRunLease(path), PRUNE_LOCK_MAX_AGE_MS)) return null;
			try {
				unlinkSync(path);
			} catch {
				return null;
			}
		}
	}
	return null;
};

const releasePruneLock = (lock: PruneLock): void => {
	try {
		closeSync(lock.fileDescriptor);
	} finally {
		removeOwnedLease(lock.path, lock.nonce);
	}
};

const pruneRelaunchDiagnostics = (diagnosticsRoot: string): void => {
	const lock = acquirePruneLock(diagnosticsRoot);
	if (!lock) return;
	const cutoff = Date.now() - MAX_RELAUNCH_LOG_AGE_MS;
	try {
		const entries = readdirSync(diagnosticsRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name.startsWith('relaunch-'))
			.flatMap((entry) => {
				const path = join(diagnosticsRoot, entry.name);
				try {
					return [{ path, modifiedAt: statSync(path).mtimeMs }];
				} catch {
					return [];
				}
			})
			.sort((left, right) => right.modifiedAt - left.modifiedAt);
		let retainedCount = 0;

		for (const entry of entries) {
			const activeMarker = join(entry.path, ACTIVE_RUN_MARKER);
			if (isRunLeaseActive(readRunLease(activeMarker), ACTIVE_RUN_MAX_AGE_MS)) continue;
			if (entry.modifiedAt >= cutoff && retainedCount < MAX_RETAINED_RELAUNCH_LOGS - 1) {
				retainedCount += 1;
				continue;
			}
			try {
				rmSync(entry.path, {
					recursive: true,
					force: true,
					maxRetries: 5,
					retryDelay: 200
				});
			} catch {
				// A disappearing or locked completed run is retried by a future invocation.
			}
		}
	} finally {
		releasePruneLock(lock);
	}
};

export const runRelaunchSmoke = async ({
	appBinaryPath = defaultAppBinaryPath,
	diagnosticsRoot = defaultDiagnosticsRoot
}: RelaunchSmokeInput = {}): Promise<void> => {
	if (!existsSync(appBinaryPath)) {
		throw new Error(`Desktop E2E binary not found at ${appBinaryPath}. Run e2e:build first.`);
	}

	const dataDir = mkdtempSync(join(tmpdir(), 'dtx-e2e-relaunch-'));
	mkdirSync(diagnosticsRoot, { recursive: true });
	pruneRelaunchDiagnostics(diagnosticsRoot);
	const logDir = mkdtempSync(join(diagnosticsRoot, 'relaunch-'));
	const activeMarker = join(logDir, ACTIVE_RUN_MARKER);
	const activeNonce = randomBytes(16).toString('hex');
	writeRunLease(activeMarker, activeNonce);
	let firstSession: WebdriverIO.Browser | undefined;
	let secondSession: WebdriverIO.Browser | undefined;
	let proofComplete = false;
	let primaryError: unknown;

	try {
		firstSession = await startStandaloneTauriSession({ appBinaryPath, dataDir, logDir });
		await firstSession.tauri.execute<void, [PreferencesShape]>(
			({ core }, prefs) => core.invoke('write_preferences', { prefs }) as Promise<void>,
			RELAUNCH_SENTINEL
		);
		const first = firstSession;
		firstSession = undefined;
		await terminateStandaloneTauriSession(first, 86);

		secondSession = await startStandaloneTauriSession({ appBinaryPath, dataDir, logDir });
		const persistedPreferences = await secondSession.tauri.execute<PreferencesShape, []>(
			({ core }) => core.invoke('read_preferences') as unknown as PreferencesShape
		);
		if (!isDeepStrictEqual(persistedPreferences, RELAUNCH_SENTINEL)) {
			throw new Error('Preferences sentinel did not survive native relaunch');
		}

		const second = secondSession;
		secondSession = undefined;
		await terminateStandaloneTauriSession(second, 0);
		proofComplete = true;
	} catch (error) {
		primaryError = error;
	} finally {
		const cleanupErrors: unknown[] = [];
		for (const [session, code] of [
			[secondSession, 0],
			[firstSession, 0]
		] as const) {
			if (!session) continue;
			try {
				await terminateStandaloneTauriSession(session, code);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		removeOwnedLease(activeMarker, activeNonce);
		try {
			rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		} catch {
			// CI runners are ephemeral; a local abandoned temp directory is harmless.
		}
		if (cleanupErrors.length > 0) {
			primaryError = new AggregateError(
				primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors],
				'Desktop relaunch cleanup failed'
			);
		}
		if (proofComplete && primaryError === undefined) {
			try {
				rmSync(logDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch {
				// Retained success diagnostics are harmless if another process holds them briefly.
			}
		}
	}
	if (primaryError !== undefined) throw primaryError;
	console.log('Desktop native terminate/relaunch persistence smoke passed.');
};

const invokedAsScript =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
	await runRelaunchSmoke();
}
