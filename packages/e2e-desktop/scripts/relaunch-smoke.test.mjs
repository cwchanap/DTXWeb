import { expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let returnStalePreferences = false;
let persistedPreferences;
const starts = [];
const terminations = [];

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
	}
}));

const { runRelaunchSmoke } = await import('./relaunch-smoke.ts');

const diagnosticsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'logs');

const createBinary = () => {
	const root = mkdtempSync(join(tmpdir(), 'dtx-relaunch-test-'));
	const binary = join(root, 'dtx-desktop');
	writeFileSync(binary, 'test binary');
	return { root, binary };
};

const resetScenario = () => {
	returnStalePreferences = false;
	persistedPreferences = undefined;
	starts.length = 0;
	terminations.length = 0;
};

test('proves preferences survive a second native session using one data directory', async () => {
	resetScenario();
	const { root, binary } = createBinary();
	let logDir;
	try {
		await runRelaunchSmoke({ appBinaryPath: binary });

		expect(starts).toHaveLength(2);
		expect(starts[1].input.dataDir).toBe(starts[0].input.dataDir);
		logDir = starts[0].input.logDir;
		expect(logDir.startsWith(`${diagnosticsRoot}${sep}`)).toBeTrue();
		expect(existsSync(logDir)).toBeTrue();
		expect(terminations).toEqual([
			{ browser: starts[0].session, code: 86 },
			{ browser: starts[1].session, code: 0 }
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
		if (logDir) rmSync(logDir, { recursive: true, force: true });
	}
});

test('fails when the relaunched native session returns stale preferences', async () => {
	resetScenario();
	const { root, binary } = createBinary();
	returnStalePreferences = true;
	let logDir;
	try {
		await expect(runRelaunchSmoke({ appBinaryPath: binary })).rejects.toThrow(
			'Preferences sentinel did not survive native relaunch'
		);
		logDir = starts[0].input.logDir;
		expect(existsSync(logDir)).toBeTrue();
	} finally {
		returnStalePreferences = false;
		rmSync(root, { recursive: true, force: true });
		if (logDir) rmSync(logDir, { recursive: true, force: true });
	}
});
