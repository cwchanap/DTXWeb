import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Options } from '@wdio/types';

import { SENTINEL_PREFERENCES } from './support/sentinel-preferences';
import { allocateWdioDataDirectory, cleanupWdioDataDirectory } from './support/wdio-data-dir';
import { getOrCreatePreseededWorkspaceFixture } from './support/workspace-fixture';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const executableName = process.platform === 'win32' ? 'dtx-desktop.exe' : 'dtx-desktop';
const e2eDrumeryUserId = 'dtx-e2e-user';
// e2e builds use a dedicated cargo target dir (`target-e2e`, set via
// CARGO_TARGET_DIR in the `e2e:build` script) so they don't clobber or
// invalidate `tauri dev` artifacts in `target/debug`.
const appBinaryPath =
	process.env.DTX_DESKTOP_BINARY ??
	resolve(packageRoot, '../dtx-desktop/src-tauri/target-e2e/debug', executableName);

// Isolate native preferences without redirecting HOME or platform data dirs.
// `DTX_E2E_DATA_DIR` is consumed directly by the Rust preferences layer (gated
// on the `e2e` Cargo feature — see `resolve_dirs()` in preferences.rs), so it
// works on all platforms while leaving WebKit/Mesa caches in their normal
// locations instead of inside the temporary preferences directory.
const dataDirectory = allocateWdioDataDirectory();
const isolatedDataDir = dataDirectory.path;
process.env.DTX_E2E_DATA_DIR = isolatedDataDir;
process.env.DTX_E2E_DRUMERY_USER_ID = e2eDrumeryUserId;
const fixture = getOrCreatePreseededWorkspaceFixture({ parentPath: isolatedDataDir });

// Seed distinctive, valid preferences so the launch spec proves that the
// WDIO service forwards DTX_E2E_DATA_DIR and Rust reads the isolated path.
// Empty scoreLinks avoids introducing an invalid unscoped production key.
mkdirSync(join(isolatedDataDir, 'dtxweb'), { recursive: true });
writeFileSync(
	join(isolatedDataDir, 'dtxweb', 'preferences.json'),
	JSON.stringify(SENTINEL_PREFERENCES)
);
writeFileSync(
	join(isolatedDataDir, 'dtxweb', 'workspace.json'),
	JSON.stringify({ workspaceRoot: fixture.workspaceRoot })
);
writeFileSync(
	join(isolatedDataDir, 'dtxweb', 'google-drive-settings.json'),
	JSON.stringify({
		googleDriveFoldersByUser: {
			[e2eDrumeryUserId]: {
				id: 'e2e-public-folder',
				name: 'E2E Public Folder'
			}
		}
	})
);

const isolatedAppEnv: Record<string, string> = {
	DTX_E2E_DATA_DIR: isolatedDataDir,
	DTX_E2E_DRUMERY_USER_ID: e2eDrumeryUserId
};

export const config: Options.Testrunner = {
	runner: 'local',
	specs: ['./specs/**/*.e2e.ts'],
	maxInstances: 1,
	services: [
		[
			'@wdio/tauri-service',
			{
				appBinaryPath,
				driverProvider: 'embedded',
				embeddedPort: 4445,
				captureBackendLogs: true,
				captureFrontendLogs: true,
				startTimeout: 60_000,
				// Injected into the spawned Tauri app's environment (merged with
				// process.env by the tauri-service). See isolatedAppEnv above.
				env: isolatedAppEnv
			}
		]
	],
	// @ts-expect-error -- `capabilities` is a standard wdio config field but
	// @wdio/types@9.29.1 omits it from the Testrunner interface.
	capabilities: [
		{
			browserName: 'tauri',
			'tauri:options': {
				application: appBinaryPath
			}
		}
	],
	logLevel: 'warn',
	reporters: ['spec'],
	// Explicit log output directory. The tauri-service uses this (falling back
	// to cwd/logs) for captured backend/frontend logs; the desktop-e2e-test
	// workflow uploads this path as an artifact on failure.
	outputDir: resolve(packageRoot, 'logs'),
	waitforTimeout: 15_000,
	connectionRetryTimeout: 90_000,
	connectionRetryCount: 2,
	framework: 'mocha',
	mochaOpts: {
		ui: 'bdd',
		timeout: 60_000
	},
	// Cleanup is best-effort: a browser/runtime process may still briefly hold
	// or recreate files while shutting down. Optional temp cleanup must never
	// turn an otherwise successful E2E run into a failure.
	onComplete: (): void => {
		cleanupWdioDataDirectory(dataDirectory);
	}
};
