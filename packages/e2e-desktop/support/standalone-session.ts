import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
const MAX_LEASE_AGE_MS = 15 * 60 * 1000;

type PortReservation = {
	port: number;
	release: () => Promise<void>;
};

type PortLease = {
	fileDescriptor: number;
	nonce: string;
	path: string;
};

type LeaseRecord = {
	createdAt: number;
	nonce: string;
	pid: number;
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

const isPidAlive = (pid: number): boolean => {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
	}
};

const readLeaseRecord = (path: string): LeaseRecord | null => {
	try {
		const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LeaseRecord>;
		if (
			!Number.isFinite(value.createdAt) ||
			typeof value.nonce !== 'string' ||
			value.nonce.length === 0 ||
			!Number.isInteger(value.pid)
		) {
			return null;
		}
		return value as LeaseRecord;
	} catch {
		return null;
	}
};

const isLeaseStale = (record: LeaseRecord | null): boolean =>
	record === null ||
	Math.abs(Date.now() - record.createdAt) > MAX_LEASE_AGE_MS ||
	!isPidAlive(record.pid);

const acquirePortLease = (port: number, nonce: string): PortLease | null => {
	mkdirSync(leaseDirectory, { recursive: true });
	const path = join(leaseDirectory, `${port}.lock`);
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const fileDescriptor = openSync(path, 'wx', 0o600);
			writeFileSync(
				fileDescriptor,
				JSON.stringify({ pid: process.pid, nonce, createdAt: Date.now() })
			);
			return { fileDescriptor, nonce, path };
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
				throw error;
			}
			if (!isLeaseStale(readLeaseRecord(path))) return null;
			try {
				unlinkSync(path);
			} catch {
				return null;
			}
		}
	}
	return null;
};

const releasePortLease = (lease: PortLease): void => {
	try {
		closeSync(lease.fileDescriptor);
	} finally {
		try {
			if (readLeaseRecord(lease.path)?.nonce === lease.nonce) {
				unlinkSync(lease.path);
			}
		} catch {
			// A cleanup race cannot leave the session's file descriptor open.
		}
	}
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
	const sessionNonce = randomBytes(32).toString('hex');
	for (let attempt = 0; attempt < EMBEDDED_PORT_ATTEMPTS; attempt += 1) {
		const reservation = await reserveEmbeddedPort();
		let lease: PortLease | null;
		try {
			lease = acquirePortLease(reservation.port, sessionNonce);
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

		let browser: WebdriverIO.Browser | undefined;
		try {
			browser = await startWdioSession(capabilities, {
				env: {
					DTX_E2E_DATA_DIR: dataDir,
					DTX_E2E_SESSION_NONCE: sessionNonce
				}
			});
			const observedNonce = await browser.tauri.execute<string, []>(
				({ core }) => core.invoke('read_e2e_session_nonce') as unknown as string
			);
			if (observedNonce !== sessionNonce) {
				throw new Error('Standalone Tauri session nonce mismatch');
			}
			activePortLeases.set(browser, lease);
			return browser;
		} catch (error) {
			if (browser) {
				try {
					await cleanupWdioSession(browser);
				} finally {
					releasePortLease(lease);
				}
			} else {
				// @wdio/tauri-service tears down its child/driver before rejecting a
				// failed standalone startup. Do not launch a second app in this process.
				releasePortLease(lease);
			}
			throw error;
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
		try {
			await cleanupWdioSession(browser);
		} finally {
			const lease = activePortLeases.get(browser);
			if (lease) {
				activePortLeases.delete(browser);
				releasePortLease(lease);
			}
		}
	}
};
