import { dirname, resolve } from 'node:path';
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
				startTimeout: 60_000
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
	waitforTimeout: 15_000,
	connectionRetryTimeout: 90_000,
	connectionRetryCount: 2,
	framework: 'mocha',
	mochaOpts: {
		ui: 'bdd',
		timeout: 60_000
	}
};
