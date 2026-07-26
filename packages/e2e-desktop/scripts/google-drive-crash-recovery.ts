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

const waitForWorkspaceReady = async (session: WebdriverIO.Browser): Promise<void> => {
	await session.waitUntil(
		async () =>
			await session.execute(() => {
				const search = document.querySelector(
					'input[placeholder="Search songs and folders..."]'
				);
				if (!search) return false;

				const style = getComputedStyle(search);
				const rect = search.getBoundingClientRect();
				return (
					style.display !== 'none' &&
					style.visibility !== 'hidden' &&
					Number.parseFloat(style.opacity) > 0 &&
					rect.width > 0 &&
					rect.height > 0
				);
			}),
		{
			timeout: 20_000,
			timeoutMsg: 'Expected crash-recovery workspace to restore'
		}
	);
};

const seedRendererState = async (
	session: WebdriverIO.Browser,
	fixture: WorkspaceFixture
): Promise<void> => {
	await session.execute(
		({ songPath, userId }) => {
			localStorage.clear();
			localStorage.setItem('auth_access_token', 'renderer-e2e-access-token');
			localStorage.setItem('auth_refresh_token', 'renderer-e2e-refresh-token');
			localStorage.setItem(
				'auth_user_data',
				JSON.stringify({
					id: userId,
					email: 'desktop-e2e@drumery.invalid',
					user_metadata: { name: 'Desktop E2E' }
				})
			);
			localStorage.setItem(
				'dtx_linkage_cache',
				JSON.stringify({
					[songPath]: {
						linkedSimFileId: '311001',
						linkedAt: '2026-07-25T00:00:00.000Z',
						cloudSongData: {
							id: 311001,
							title: 'Critical Workspace Song',
							artist: 'Integration Test',
							bpm: 120,
							is_published: false,
							publish_date: '2026-07-25',
							display_id: 311001,
							download_url: null,
							google_drive_file_id: null,
							preview_url: null,
							video_preview_url: null,
							dtx_files: []
						}
					}
				})
			);
			window.location.hash = '';
		},
		{ songPath: fixture.songFolder, userId: e2eUserId }
	);
	await session.refresh();
	// The embedded WebDriver reports refresh completion before WebKit has
	// finished replacing the document. Avoid issuing executeScript into that
	// transition; the first command can otherwise block until its script timeout.
	await new Promise((resolve) => setTimeout(resolve, 100));
	await waitForWorkspaceReady(session);
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

const readSnapshot = async (session: WebdriverIO.Browser): Promise<E2eDriveSnapshot> =>
	await session.tauri.execute<E2eDriveSnapshot, []>(
		({ core }) => core.invoke('snapshot_google_drive_e2e') as unknown as E2eDriveSnapshot
	);

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
		latest = await readSnapshot(session);
		if (
			latest.owner.googleDriveFileId === expectedDriveFileId &&
			latest.owner.downloadUrl === expectedDownloadUrl
		) {
			return latest;
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
