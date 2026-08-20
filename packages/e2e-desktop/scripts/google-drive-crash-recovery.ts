import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { E2eDriveControl, E2eDriveSnapshot } from '../support/generated/native-types';
import {
	startStandaloneTauriSession,
	terminateStandaloneTauriSession,
	waitForStandaloneTauriSessionExit
} from '../support/standalone-session';
import {
	createWorkspaceFixture,
	fixtureSongTitle,
	type WorkspaceFixture
} from '../support/workspace-fixture';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executableName = process.platform === 'win32' ? 'dtx-desktop.exe' : 'dtx-desktop';
const defaultAppBinaryPath =
	process.env.DTX_DESKTOP_BINARY ??
	resolve(packageRoot, '../dtx-desktop/src-tauri/target-e2e/debug', executableName);
const defaultDiagnosticsRoot = join(packageRoot, 'logs');
const e2eUserId = 'dtx-e2e-user';
const simfileId = '311001';
const expectedDriveFileId = 'e2e-drive-file-0001';
const expectedDownloadUrl = `https://drive.google.test/download/${expectedDriveFileId}`;

type CrashRecoveryInput = {
	appBinaryPath?: string;
	diagnosticsRoot?: string;
};

type ReloadReadinessProbe = {
	documentToken: string | null;
	readyState: DocumentReadyState;
	workspacePresent: boolean;
	workspaceVisible: boolean;
};

type ReloadWaitOptions = {
	timeoutMs?: number;
	intervalMs?: number;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
};

type TimedOperationOutcome<T> =
	{ kind: 'value'; value: T } | { kind: 'error'; error: unknown } | { kind: 'deadline' };

type NativeProbeState = 'not-attempted' | 'failed' | 'timed-out';

const crashControl: E2eDriveControl = {
	reset: true,
	owner: {
		simfileId,
		cloudTitle: fixtureSongTitle,
		googleDriveFileId: null,
		downloadUrl: null
	},
	existingFileFailure: 'none',
	publicPermission: true,
	terminateBeforeMetadataPatch: true
};

const seedNativeState = (dataDir: string, fixture: WorkspaceFixture): void => {
	const appData = join(dataDir, 'dtxweb');
	mkdirSync(appData, { recursive: true });
	writeFileSync(
		join(appData, 'workspace.json'),
		JSON.stringify({ workspaceRoot: fixture.workspaceRoot })
	);
	writeFileSync(
		join(appData, 'google-drive-settings.json'),
		JSON.stringify({
			googleDriveFoldersByUser: {
				[e2eUserId]: { id: 'e2e-public-folder', name: 'E2E Public Folder' }
			}
		})
	);
};

const readSnapshot = async (session: WebdriverIO.Browser): Promise<E2eDriveSnapshot> =>
	await session.tauri.execute<E2eDriveSnapshot, []>(
		({ core }) => core.invoke('snapshot_google_drive_e2e') as unknown as E2eDriveSnapshot
	);

const reloadProbe = (): ReloadReadinessProbe => {
	const e2eWindow = window as typeof window & {
		__dtxE2eReloadDocumentToken?: string;
	};
	const search = document.querySelector('input[placeholder="Search songs and folders..."]');
	const style = search ? getComputedStyle(search) : null;
	const rect = search?.getBoundingClientRect();

	return {
		documentToken: e2eWindow.__dtxE2eReloadDocumentToken ?? null,
		readyState: document.readyState,
		workspacePresent: search !== null,
		workspaceVisible:
			style !== null &&
			rect !== undefined &&
			style.display !== 'none' &&
			style.visibility !== 'hidden' &&
			Number.parseFloat(style.opacity) > 0 &&
			rect.width > 0 &&
			rect.height > 0
	};
};

const isRetryableReloadProbeError = (error: unknown): boolean =>
	/Tauri core\.invoke is unavailable|A JavaScript exception occurred|Script execution timed out|browsing context|navigation|page load|document.*unload|no such window|stale element reference|disconnected/i.test(
		error instanceof Error ? error.message : String(error)
	);

const runBeforeDeadline = async <T>(
	operation: () => Promise<T>,
	remainingMs: number
): Promise<TimedOperationOutcome<T>> => {
	let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
	const outcome = await Promise.race([
		operation()
			.then((value) => ({ kind: 'value' as const, value }))
			.catch((error: unknown) => ({ kind: 'error' as const, error })),
		new Promise<{ kind: 'deadline' }>((resolve) => {
			deadlineTimer = setTimeout(() => resolve({ kind: 'deadline' }), remainingMs);
		})
	]);
	if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
	return outcome;
};

const reloadProbeSummary = (
	probe: ReloadReadinessProbe | undefined,
	previousDocumentToken: string,
	nativeProbeState: NativeProbeState
): string => {
	if (!probe) {
		return `probe=unavailable, native=${nativeProbeState}`;
	}
	const documentState = probe.documentToken === previousDocumentToken ? 'old' : 'replaced';
	const workspaceState = !probe.workspacePresent
		? 'missing'
		: probe.workspaceVisible
			? 'visible'
			: 'hidden';
	return [
		`document=${documentState}`,
		`readyState=${probe.readyState}`,
		`workspace=${workspaceState}`,
		`native=${nativeProbeState}`
	].join(', ');
};

export const waitForReloadedWorkspace = async (
	session: WebdriverIO.Browser,
	previousDocumentToken: string,
	{
		timeoutMs = 20_000,
		intervalMs = 100,
		now = Date.now,
		sleep = async (milliseconds) =>
			await new Promise((resolve) => setTimeout(resolve, milliseconds))
	}: ReloadWaitOptions = {}
): Promise<ReloadReadinessProbe> => {
	const deadline = now() + timeoutMs;
	let latest: ReloadReadinessProbe | undefined;
	let lastTransientError: string | undefined;
	let lastNativeError: string | undefined;
	let nativeProbeState: NativeProbeState = 'not-attempted';

	while (now() < deadline) {
		const outcome = await runBeforeDeadline(
			async () => await session.tauri.execute<ReloadReadinessProbe, []>(reloadProbe),
			Math.max(1, deadline - now())
		);

		if (outcome.kind === 'deadline') break;
		if (outcome.kind === 'error') {
			if (!isRetryableReloadProbeError(outcome.error)) {
				throw new Error(
					`Crash-recovery reload probe failed: ${
						outcome.error instanceof Error
							? outcome.error.message
							: String(outcome.error)
					}`,
					{ cause: outcome.error }
				);
			}
			lastTransientError =
				outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
		} else {
			latest = outcome.value;
			const documentReplaced = latest.documentToken !== previousDocumentToken;
			const documentReady =
				latest.readyState === 'interactive' || latest.readyState === 'complete';
			if (
				documentReplaced &&
				documentReady &&
				latest.workspacePresent &&
				latest.workspaceVisible
			) {
				const nativeOutcome = await runBeforeDeadline(
					async () => await readSnapshot(session),
					Math.max(1, deadline - now())
				);
				if (nativeOutcome.kind === 'deadline') {
					nativeProbeState = 'timed-out';
					break;
				}
				if (nativeOutcome.kind === 'value') return latest;
				nativeProbeState = 'failed';
				lastNativeError =
					nativeOutcome.error instanceof Error
						? nativeOutcome.error.message
						: String(nativeOutcome.error);
			}
		}

		const delayMs = Math.min(intervalMs, Math.max(0, deadline - now()));
		if (delayMs > 0) await sleep(delayMs);
	}

	const transientDiagnostic = lastTransientError
		? `, lastTransientError=${lastTransientError}`
		: '';
	throw new Error(
		`Timed out after ${timeoutMs}ms waiting for the crash-recovery document reload: ${reloadProbeSummary(
			latest,
			previousDocumentToken,
			nativeProbeState
		)}${transientDiagnostic}${lastNativeError ? `, lastNativeError=${lastNativeError}` : ''}`
	);
};

const seedRendererState = async (
	session: WebdriverIO.Browser,
	fixture: WorkspaceFixture
): Promise<void> => {
	const previousDocumentToken = `drive-crash-${randomUUID()}`;
	const installedDocumentToken = await session.execute(
		({ documentToken, simfileId, songPath, userId }) => {
			const e2eWindow = window as typeof window & {
				__dtxE2eReloadDocumentToken?: string;
			};
			e2eWindow.__dtxE2eReloadDocumentToken = documentToken;
			localStorage.clear();
			localStorage.setItem(
				'auth_session',
				JSON.stringify({
					sessionToken: 'renderer-e2e-session-token',
					user: {
						id: userId,
						name: 'Desktop E2E',
						email: 'desktop-e2e@drumery.invalid',
						emailVerified: true,
						image: null,
						createdAt: '',
						updatedAt: ''
					}
				})
			);
			localStorage.setItem(
				'dtx_linkage_cache_v2',
				JSON.stringify({
					[songPath]: {
						linkedSimFileId: simfileId,
						linkedAt: '2026-07-25T00:00:00.000Z',
						cloudSongData: {
							id: Number(simfileId),
							title: 'Critical Workspace Song',
							artist: 'Integration Test',
							bpm: 120,
							displayId: Number(simfileId),
							userId: null,
							googleDriveFileId: null,
							isPublished: false,
							downloadUrl: null,
							previewUrl: null,
							videoPreviewUrl: null,
							publishDate: '2026-07-25',
							createdAt: '2026-07-25T00:00:00.000Z',
							updatedAt: '2026-07-25T00:00:00.000Z',
							dtxFiles: []
						}
					}
				})
			);
			window.location.hash = '';
			return e2eWindow.__dtxE2eReloadDocumentToken;
		},
		{
			documentToken: previousDocumentToken,
			simfileId,
			songPath: fixture.songFolder,
			userId: e2eUserId
		}
	);
	if (installedDocumentToken !== previousDocumentToken) {
		throw new Error('Failed to install the crash-recovery pre-refresh document token');
	}
	await session.refresh();
	await waitForReloadedWorkspace(session, previousDocumentToken);
};

const clickUploadButton = async (session: WebdriverIO.Browser): Promise<void> => {
	await session.$(`//button[.//span[normalize-space()="${fixtureSongTitle}"]]`).click();
	const upload = await session.$('button[aria-label="Upload ZIP to Drive"]');
	await upload.waitForEnabled({
		timeout: 20_000,
		timeoutMsg: 'Expected seeded Drive connection before crash injection'
	});
	await upload.click();
};

const configureCrash = async (session: WebdriverIO.Browser): Promise<void> => {
	await session.tauri.execute<void, [E2eDriveControl]>(
		({ core }, control) =>
			core.invoke('configure_google_drive_e2e', { control }) as Promise<void>,
		crashControl
	);
};

const isExpectedDisconnect = (error: unknown): boolean =>
	/ECONNREFUSED|ECONNRESET|connection refused|socket hang up|invalid session id|disconnected/i.test(
		error instanceof Error ? error.message : String(error)
	);

export const assertRecoveredDriveSnapshot = (snapshot: E2eDriveSnapshot): void => {
	if (snapshot.objects.length !== 1) {
		throw new Error(
			`Expected exactly one persisted Drive object after restart, received ${snapshot.objects.length}`
		);
	}
	if (snapshot.objects[0].fileId !== expectedDriveFileId) {
		throw new Error(`Restart recovered unexpected Drive ID ${snapshot.objects[0].fileId}`);
	}
	if (
		snapshot.owner.googleDriveFileId !== expectedDriveFileId ||
		snapshot.owner.downloadUrl !== expectedDownloadUrl
	) {
		throw new Error('Restart did not bind the pre-generated Drive ID and URL');
	}
	if (snapshot.createCount !== 0 || snapshot.lifetimeCreateCount !== 1) {
		throw new Error(
			`Restart created a duplicate Drive object (run=${snapshot.createCount}, lifetime=${snapshot.lifetimeCreateCount})`
		);
	}
};

const waitForReconciliation = async (session: WebdriverIO.Browser): Promise<E2eDriveSnapshot> => {
	const deadline = Date.now() + 20_000;
	let latest: E2eDriveSnapshot | undefined;
	while (Date.now() < deadline) {
		const outcome = await runBeforeDeadline(
			async () => await readSnapshot(session),
			Math.max(1, deadline - Date.now())
		);
		if (outcome.kind === 'deadline') break;
		if (outcome.kind === 'error') {
			if (!isRetryableReloadProbeError(outcome.error)) {
				throw new Error(
					`Crash-recovery reconciliation snapshot failed: ${
						outcome.error instanceof Error
							? outcome.error.message
							: String(outcome.error)
					}`,
					{ cause: outcome.error }
				);
			}
		} else {
			latest = outcome.value;
			if (
				latest.owner.googleDriveFileId === expectedDriveFileId &&
				latest.owner.downloadUrl === expectedDownloadUrl
			) {
				return latest;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`Current-user reconciliation did not complete after restart: ${JSON.stringify(latest)}`
	);
};

export const runGoogleDriveCrashRecovery = async ({
	appBinaryPath = defaultAppBinaryPath,
	diagnosticsRoot = defaultDiagnosticsRoot
}: CrashRecoveryInput = {}): Promise<void> => {
	if (!existsSync(appBinaryPath)) {
		throw new Error(`Desktop E2E binary not found at ${appBinaryPath}. Run e2e:build first.`);
	}

	const dataDir = mkdtempSync(join(tmpdir(), 'dtx-e2e-drive-crash-'));
	const fixture = createWorkspaceFixture({ parentPath: dataDir });
	seedNativeState(dataDir, fixture);
	mkdirSync(diagnosticsRoot, { recursive: true });
	const logDir = mkdtempSync(join(diagnosticsRoot, 'drive-crash-'));
	let firstSession: WebdriverIO.Browser | undefined;
	let secondSession: WebdriverIO.Browser | undefined;
	let proofComplete = false;
	let primaryError: unknown;

	try {
		firstSession = await startStandaloneTauriSession({
			appBinaryPath,
			dataDir,
			drumeryUserId: e2eUserId,
			logDir: join(logDir, 'first-launch')
		});
		await configureCrash(firstSession);
		await seedRendererState(firstSession, fixture);
		try {
			await clickUploadButton(firstSession);
		} catch (error) {
			if (!isExpectedDisconnect(error)) throw error;
		}
		await waitForStandaloneTauriSessionExit(firstSession, 86);
		const crashed = firstSession;
		firstSession = undefined;
		await terminateStandaloneTauriSession(crashed, 86);

		secondSession = await startStandaloneTauriSession({
			appBinaryPath,
			dataDir,
			drumeryUserId: e2eUserId,
			logDir: join(logDir, 'second-launch')
		});
		await seedRendererState(secondSession, fixture);
		const recovered = await waitForReconciliation(secondSession);
		assertRecoveredDriveSnapshot(recovered);

		const relaunched = secondSession;
		secondSession = undefined;
		await terminateStandaloneTauriSession(relaunched, 0);
		proofComplete = true;
	} catch (error) {
		primaryError = error;
	} finally {
		const cleanupErrors: unknown[] = [];
		for (const session of [secondSession, firstSession]) {
			if (!session) continue;
			try {
				await terminateStandaloneTauriSession(session, 1);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		try {
			rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		} catch {
			// A local abandoned E2E temp directory is harmless; CI runners are ephemeral.
		}
		if (proofComplete && primaryError === undefined) {
			try {
				rmSync(logDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch {
				// Success diagnostics are safe to retain if the platform still holds a log file.
			}
		}
		if (cleanupErrors.length > 0) {
			primaryError = new AggregateError(
				primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors],
				'Google Drive crash-recovery cleanup failed'
			);
		}
	}

	if (primaryError !== undefined) throw primaryError;
	console.log('Desktop Google Drive post-create crash recovery passed.');
};

const invokedAsScript =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
	await runGoogleDriveCrashRecovery();
}
