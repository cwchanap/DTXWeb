import { expect, mock, test } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';

let returnStalePreferences = false;
let persistedPreferences;
const starts = [];
const terminations = [];
const terminationErrors = [];

const newSession = () => ({
	tauri: {
		execute: async (callback, ...args) =>
			await callback(
				{
					core: {
						invoke: async (command, input) => {
							if (command === 'write_preferences') {
								persistedPreferences = input.prefs;
								return undefined;
							}
							if (command === 'read_preferences') {
								return returnStalePreferences
									? {
											detailPaneWidth: 420,
											detailPaneVisible: true,
											scoreLinks: {}
										}
									: persistedPreferences;
							}
							throw new Error(`Unexpected command: ${command}`);
						}
					}
				},
				...args
			)
	}
});

mock.module('../support/standalone-session.ts', () => ({
	startStandaloneTauriSession: async (input) => {
		const session = newSession();
		starts.push({ input, session });
		return session;
	},
	terminateStandaloneTauriSession: async (browser, code) => {
		terminations.push({ browser, code });
		const error = terminationErrors.shift();
		if (error) throw error;
	}
}));

const { __acquireRelaunchPruneLockForTests, __releaseRelaunchPruneLockForTests, runRelaunchSmoke } =
	await import('./relaunch-smoke.ts');

const createBinary = () => {
	const root = mkdtempSync(join(tmpdir(), 'dtx-relaunch-test-'));
	const binary = join(root, 'dtx-desktop');
	writeFileSync(binary, 'test binary');
	return { root, binary };
};

const createDiagnosticsRoot = (parentPath) => {
	const diagnosticsRoot = join(parentPath, 'logs');
	mkdirSync(diagnosticsRoot);
	return diagnosticsRoot;
};

const resetScenario = () => {
	returnStalePreferences = false;
	persistedPreferences = undefined;
	starts.length = 0;
	terminations.length = 0;
	terminationErrors.length = 0;
};

test('proves preferences survive a second native session using one data directory', async () => {
	resetScenario();
	const { root, binary } = createBinary();
	const diagnosticsRoot = createDiagnosticsRoot(root);
	let logDir;
	try {
		await runRelaunchSmoke({ appBinaryPath: binary, diagnosticsRoot });

		expect(starts).toHaveLength(2);
		expect(starts[1].input.dataDir).toBe(starts[0].input.dataDir);
		logDir = starts[0].input.logDir;
		expect(logDir.startsWith(`${diagnosticsRoot}${sep}`)).toBeTrue();
		expect(existsSync(logDir)).toBeFalse();
		expect(terminations).toEqual([
			{ browser: starts[0].session, code: 86 },
			{ browser: starts[1].session, code: 0 }
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('fails when the relaunched native session returns stale preferences', async () => {
	resetScenario();
	const { root, binary } = createBinary();
	const diagnosticsRoot = createDiagnosticsRoot(root);
	returnStalePreferences = true;
	let logDir;
	try {
		await expect(runRelaunchSmoke({ appBinaryPath: binary, diagnosticsRoot })).rejects.toThrow(
			'Preferences sentinel did not survive native relaunch'
		);
		logDir = starts[0].input.logDir;
		expect(existsSync(logDir)).toBeTrue();
	} finally {
		returnStalePreferences = false;
		rmSync(root, { recursive: true, force: true });
	}
});

test('prunes stale and excess retained relaunch diagnostics before a failed run', async () => {
	resetScenario();
	const { root, binary } = createBinary();
	const diagnosticsRoot = createDiagnosticsRoot(root);
	const staleLogDir = join(diagnosticsRoot, 'relaunch-stale');
	mkdirSync(staleLogDir);
	utimesSync(staleLogDir, new Date('2020-01-01'), new Date('2020-01-01'));
	for (let index = 0; index < 12; index += 1) {
		mkdirSync(join(diagnosticsRoot, `relaunch-recent-${index}`));
	}
	returnStalePreferences = true;
	try {
		await expect(runRelaunchSmoke({ appBinaryPath: binary, diagnosticsRoot })).rejects.toThrow(
			'Preferences sentinel did not survive native relaunch'
		);

		const retainedRelaunchLogs = readdirSync(diagnosticsRoot).filter((name) =>
			name.startsWith('relaunch-')
		);
		expect(existsSync(staleLogDir)).toBeFalse();
		expect(retainedRelaunchLogs.length).toBeLessThanOrEqual(10);
		expect(retainedRelaunchLogs).toContain(basename(starts[0].input.logDir));
	} finally {
		returnStalePreferences = false;
		rmSync(root, { recursive: true, force: true });
	}
});

test('preserves an old active relaunch directory while pruning completed diagnostics', async () => {
	resetScenario();
	const { root, binary } = createBinary();
	const diagnosticsRoot = createDiagnosticsRoot(root);
	const activeLogDir = join(diagnosticsRoot, 'relaunch-active');
	mkdirSync(activeLogDir);
	writeFileSync(
		join(activeLogDir, 'active.json'),
		JSON.stringify({ pid: process.pid, nonce: 'active-run', createdAt: Date.now() })
	);
	utimesSync(activeLogDir, new Date('2020-01-01'), new Date('2020-01-01'));
	returnStalePreferences = true;
	try {
		await expect(runRelaunchSmoke({ appBinaryPath: binary, diagnosticsRoot })).rejects.toThrow(
			'Preferences sentinel did not survive native relaunch'
		);

		expect(existsSync(activeLogDir)).toBeTrue();
	} finally {
		returnStalePreferences = false;
		rmSync(root, { recursive: true, force: true });
	}
});

test('retains diagnostics when final native cleanup fails', async () => {
	resetScenario();
	const { root, binary } = createBinary();
	const diagnosticsRoot = createDiagnosticsRoot(root);
	terminationErrors.push(undefined, new Error('second session cleanup failed'));
	try {
		await expect(runRelaunchSmoke({ appBinaryPath: binary, diagnosticsRoot })).rejects.toThrow(
			'second session cleanup failed'
		);

		expect(existsSync(starts[1].input.logDir)).toBeTrue();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('atomically reclaims one stale prune lock while a concurrent acquirer observes the new owner', () => {
	const root = mkdtempSync(join(tmpdir(), 'dtx-relaunch-lock-test-'));
	const diagnosticsRoot = createDiagnosticsRoot(root);
	const lockPath = join(diagnosticsRoot, 'relaunch-prune.lock');
	mkdirSync(lockPath);
	writeFileSync(
		join(lockPath, 'owner.json'),
		JSON.stringify({ pid: 999_999, nonce: 'stale-pruner', createdAt: 0 })
	);
	try {
		const first = __acquireRelaunchPruneLockForTests(diagnosticsRoot);
		const second = __acquireRelaunchPruneLockForTests(diagnosticsRoot);
		expect(first).not.toBeNull();
		expect(second).toBeNull();
		__releaseRelaunchPruneLockForTests(first);
		expect(existsSync(lockPath)).toBeFalse();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('restores a foreign prune-lock replacement instead of deleting it', () => {
	const root = mkdtempSync(join(tmpdir(), 'dtx-relaunch-lock-test-'));
	const diagnosticsRoot = createDiagnosticsRoot(root);
	const lockPath = join(diagnosticsRoot, 'relaunch-prune.lock');
	try {
		const lock = __acquireRelaunchPruneLockForTests(diagnosticsRoot);
		writeFileSync(
			join(lockPath, 'owner.json'),
			JSON.stringify({ pid: process.pid, nonce: 'foreign-pruner', createdAt: Date.now() })
		);
		expect(() => __releaseRelaunchPruneLockForTests(lock)).toThrow('another process');
		expect(existsSync(lockPath)).toBeTrue();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
