import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Options } from '@wdio/types';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const executableName = process.platform === 'win32' ? 'dtx-desktop.exe' : 'dtx-desktop';
const appBinaryPath =
	process.env.DTX_DESKTOP_BINARY ??
	resolve(packageRoot, '../dtx-desktop/src-tauri/target/debug', executableName);

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
