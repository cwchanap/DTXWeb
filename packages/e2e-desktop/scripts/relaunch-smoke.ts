import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
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

const RELAUNCH_SENTINEL = {
	detailPaneWidth: 613,
	detailPaneVisible: false,
	scoreLinks: { 'desktop-relaunch-smoke': 'native-process-restarted' }
} as const satisfies PreferencesShape;

type RelaunchSmokeInput = {
	appBinaryPath?: string;
	diagnosticsRoot?: string;
};

const pruneRelaunchDiagnostics = (diagnosticsRoot: string): void => {
	const cutoff = Date.now() - MAX_RELAUNCH_LOG_AGE_MS;
	const entries = readdirSync(diagnosticsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name.startsWith('relaunch-'))
		.map((entry) => {
			const path = join(diagnosticsRoot, entry.name);
			return { path, modifiedAt: statSync(path).mtimeMs };
		})
		.sort((left, right) => right.modifiedAt - left.modifiedAt);
	let retainedCount = 0;

	for (const entry of entries) {
		if (entry.modifiedAt < cutoff || retainedCount >= MAX_RETAINED_RELAUNCH_LOGS - 1) {
			rmSync(entry.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			continue;
		}
		retainedCount += 1;
	}
};

const cleanSession = async (browser: WebdriverIO.Browser, code: number): Promise<void> => {
	try {
		await terminateStandaloneTauriSession(browser, code);
	} catch (error) {
		console.warn(`Failed to clean up standalone Tauri session: ${String(error)}`);
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
	let firstSession: WebdriverIO.Browser | undefined;
	let secondSession: WebdriverIO.Browser | undefined;
	let passed = false;

	try {
		firstSession = await startStandaloneTauriSession({ appBinaryPath, dataDir, logDir });
		await firstSession.tauri.execute<void, [PreferencesShape]>(
			({ core }, prefs) => core.invoke('write_preferences', { prefs }) as Promise<void>,
			RELAUNCH_SENTINEL
		);
		await terminateStandaloneTauriSession(firstSession, 86);
		firstSession = undefined;

		secondSession = await startStandaloneTauriSession({ appBinaryPath, dataDir, logDir });
		const persistedPreferences = await secondSession.tauri.execute<PreferencesShape, []>(
			({ core }) => core.invoke('read_preferences') as unknown as PreferencesShape
		);
		if (!isDeepStrictEqual(persistedPreferences, RELAUNCH_SENTINEL)) {
			throw new Error('Preferences sentinel did not survive native relaunch');
		}

		passed = true;
		console.log('Desktop native terminate/relaunch persistence smoke passed.');
	} finally {
		if (secondSession) {
			await cleanSession(secondSession, 0);
		}
		if (firstSession) {
			await cleanSession(firstSession, 0);
		}
		try {
			rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		} catch {
			// CI runners are ephemeral; a local abandoned temp directory is harmless.
		}
		if (passed) {
			try {
				rmSync(logDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch {
				// Retained success diagnostics are harmless if another process holds them briefly.
			}
		}
	}
};

const invokedAsScript =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
	await runRelaunchSmoke();
}
