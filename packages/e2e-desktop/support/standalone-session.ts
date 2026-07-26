import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupWdioSession, createTauriCapabilities, startWdioSession } from '@wdio/tauri-service';

type StandaloneTauriSessionInput = {
	appBinaryPath: string;
	dataDir: string;
	logDir: string;
};

const EMBEDDED_PORT_ATTEMPTS = 3;

type PortReservation = {
	port: number;
	release: () => Promise<void>;
};

type PortLease = {
	fileDescriptor: number;
	path: string;
};

const activePortLeases = new WeakMap<WebdriverIO.Browser, PortLease>();
const leaseDirectory = join(tmpdir(), 'dtx-e2e-embedded-port-leases');

const reserveEmbeddedPort = async (): Promise<PortReservation> =>
	await new Promise<PortReservation>((resolve, reject) => {
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
			resolve({
				port: address.port,
				release: async (): Promise<void> =>
					await new Promise<void>((resolveRelease, rejectRelease) => {
						server.close((error) => {
							if (error) {
								rejectRelease(error);
								return;
							}
							resolveRelease();
						});
					})
			});
		});
	});

const acquirePortLease = (port: number): PortLease | null => {
	mkdirSync(leaseDirectory, { recursive: true });
	const path = join(leaseDirectory, `${port}.lock`);
	try {
		return { fileDescriptor: openSync(path, 'wx', 0o600), path };
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
			return null;
		}
		throw error;
	}
};

const releasePortLease = (lease: PortLease): void => {
	try {
		closeSync(lease.fileDescriptor);
	} finally {
		try {
			unlinkSync(lease.path);
		} catch {
			// A cleanup race cannot leave the session's file descriptor open.
		}
	}
};

const isEmbeddedPortCollision = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : String(error);
	return /EADDRINUSE|address already in use|port may already be in use|did not become ready on port/i.test(
		message
	);
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
		const reservation = await reserveEmbeddedPort();
		let lease: PortLease | null;
		try {
			lease = acquirePortLease(reservation.port);
		} catch (error) {
			await reservation.release().catch(() => undefined);
			throw error;
		}
		try {
			await reservation.release();
		} catch (error) {
			if (lease) releasePortLease(lease);
			throw error;
		}
		if (!lease) continue;

		const capabilities = createTauriCapabilities(appBinaryPath, {
			driverProvider: 'embedded',
			startTimeout: 60_000
		});
		capabilities['wdio:tauriServiceOptions'] = {
			...capabilities['wdio:tauriServiceOptions'],
			captureBackendLogs: true,
			captureFrontendLogs: true,
			embeddedPort: reservation.port,
			logDir
		};

		try {
			const browser = await startWdioSession(capabilities, {
				env: { DTX_E2E_DATA_DIR: dataDir }
			});
			activePortLeases.set(browser, lease);
			return browser;
		} catch (error) {
			releasePortLease(lease);
			if (!isEmbeddedPortCollision(error) || attempt === EMBEDDED_PORT_ATTEMPTS - 1) {
				throw error;
			}
			// The service does not accept port 0, so reserving then releasing a
			// localhost port has an unavoidable external-process bind-close race.
			// The lease prevents another harness from reusing it; retry a fresh port
			// when the embedded service reports a collision or readiness timeout.
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
		const lease = activePortLeases.get(browser);
		if (lease) {
			activePortLeases.delete(browser);
			releasePortLease(lease);
		}
	}
};
