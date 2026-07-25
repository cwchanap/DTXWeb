import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Options } from '@wdio/types';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const executableName = process.platform === 'win32' ? 'dtx-desktop.exe' : 'dtx-desktop';
// e2e builds use a dedicated cargo target dir (`target-e2e`, set via
// CARGO_TARGET_DIR in the `e2e:build` script) so they don't clobber or
// invalidate `tauri dev` artifacts in `target/debug`.
const appBinaryPath =
	process.env.DTX_DESKTOP_BINARY ??
	resolve(packageRoot, '../dtx-desktop/src-tauri/target-e2e/debug', executableName);

// Isolate the Tauri app's native data from the developer's real preferences.
// The e2e identifier (`com.hapadona.drumery.e2e` in tauri.e2e.conf.json) only
// scopes Tauri/WebView-owned data — the native preferences code in
// preferences.rs calls `dirs::data_dir()` directly, which resolves to the
// global per-user data dir, not an identifier-scoped one. Without these env
// vars, `bun run e2e:desktop` reads (and could overwrite) the developer's real
// `dtxweb/preferences.json` and legacy `~/.dtxweb/preferences.json`.
//
// `dirs` v6 respects env vars on Linux (`$XDG_DATA_HOME`, `$HOME`) and macOS
// (`$HOME`), so the isolation is effective on both platforms where E2E runs
// (Linux in CI, macOS locally). On Windows, `dirs` v6 uses
// `SHGetKnownFolderPath` which ignores env vars — the vars are set anyway
// (harmless) but Windows E2E isolation would require a Rust-side config flag.
const isolatedDataDir = mkdtempSync(join(tmpdir(), 'dtx-e2e-data-'));
const isolatedAppEnv: Record<string, string> = {
	// Linux: dirs::data_dir() → $XDG_DATA_HOME || $HOME/.local/share
	XDG_DATA_HOME: isolatedDataDir,
	// macOS: dirs::data_dir() → $HOME/Library/Application Support
	// Linux legacy fallback: dirs::home_dir() → $HOME → ~/.dtxweb/...
	HOME: isolatedDataDir,
	// Windows: dirs::data_dir() → SHGetKnownFolderPath (ignores env in dirs v6,
	// but set for forward-compat / other consumers).
	APPDATA: isolatedDataDir,
	USERPROFILE: isolatedDataDir
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
	}
};
