import { expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const createBinary = () => {
	const root = mkdtempSync(join(tmpdir(), 'dtx-relaunch-test-'));
	const binary = join(root, 'dtx-desktop');
	writeFileSync(binary, 'test binary');
	return { root, binary };
};

test('proves preferences survive a second native session using one data directory', async () => {
	const { root, binary } = createBinary();
	try {
		await runRelaunchSmoke({ appBinaryPath: binary });

		expect(starts).toHaveLength(2);
		expect(starts[1].input.dataDir).toBe(starts[0].input.dataDir);
		expect(terminations).toEqual([
			{ browser: starts[0].session, code: 86 },
			{ browser: starts[1].session, code: 0 }
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('fails when the relaunched native session returns stale preferences', async () => {
	const { root, binary } = createBinary();
	returnStalePreferences = true;
	try {
		await expect(runRelaunchSmoke({ appBinaryPath: binary })).rejects.toThrow(
			'Preferences sentinel did not survive native relaunch'
		);
	} finally {
		returnStalePreferences = false;
		rmSync(root, { recursive: true, force: true });
	}
});
