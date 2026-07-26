import { createServer } from 'node:net';

import { cleanupWdioSession, createTauriCapabilities, startWdioSession } from '@wdio/tauri-service';

type StandaloneTauriSessionInput = {
	appBinaryPath: string;
	dataDir: string;
	logDir: string;
};

const EMBEDDED_PORT_ATTEMPTS = 3;

const allocateEmbeddedPort = async (): Promise<number> =>
	await new Promise<number>((resolve, reject) => {
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
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(address.port);
			});
		});
	});

const isEmbeddedPortCollision = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : String(error);
	return /EADDRINUSE|address already in use|port.*in use/i.test(message);
};

const isExpectedDisconnect = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : String(error);
	return /ECONNREFUSED|connection refused|socket hang up|invalid session id|disconnected/i.test(
		message
	);
};

export const startStandaloneTauriSession = async ({
	appBinaryPath,
	dataDir,
	logDir
}: StandaloneTauriSessionInput): Promise<WebdriverIO.Browser> => {
	for (let attempt = 0; attempt < EMBEDDED_PORT_ATTEMPTS; attempt += 1) {
		const embeddedPort = await allocateEmbeddedPort();
		const capabilities = createTauriCapabilities(appBinaryPath, {
			driverProvider: 'embedded',
			startTimeout: 60_000
		});
		capabilities['wdio:tauriServiceOptions'] = {
			...capabilities['wdio:tauriServiceOptions'],
			captureBackendLogs: true,
			captureFrontendLogs: true,
			embeddedPort,
			logDir
		};

		try {
			return await startWdioSession(capabilities, {
				env: { DTX_E2E_DATA_DIR: dataDir }
			});
		} catch (error) {
			if (!isEmbeddedPortCollision(error) || attempt === EMBEDDED_PORT_ATTEMPTS - 1) {
				throw error;
			}
			// The service does not accept port 0, so reserving then releasing an
			// ephemeral localhost port has an unavoidable bind-close race. Retry a
			// fresh reservation when another process wins that race.
		}
	}

	throw new Error('Could not start standalone Tauri session');
};

export const terminateStandaloneTauriSession = async (
	browser: WebdriverIO.Browser,
	code?: number
): Promise<void> => {
	try {
		await browser.tauri.execute<void, [number | undefined]>(
			({ core }, exitCode) =>
				core.invoke('plugin:process|exit', { code: exitCode }) as Promise<void>,
			code
		);
	} catch (error) {
		if (!isExpectedDisconnect(error)) {
			throw error;
		}
	} finally {
		await cleanupWdioSession(browser).catch(() => undefined);
	}
};
