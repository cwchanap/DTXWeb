import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import { waitForUiDisplayed } from '../support/app';
import {
	configureGoogleDriveE2e,
	snapshotGoogleDriveE2e,
	type E2eDriveControl,
	type E2eDriveSnapshot
} from '../support/native';
import {
	fixtureSongTitle,
	getPreseededWorkspaceFixture,
	type WorkspaceFixture
} from '../support/workspace-fixture';

const e2eUserId = 'dtx-e2e-user';
const simfileId = '311001';
const firstDriveFileId = 'e2e-drive-file-0001';
const driveUrl = (fileId: string): string => `https://drive.google.test/download/${fileId}`;

const owner = ({
	cloudTitle = fixtureSongTitle,
	downloadUrl = null,
	googleDriveFileId = null
}: {
	cloudTitle?: string;
	downloadUrl?: string | null;
	googleDriveFileId?: string | null;
} = {}): E2eDriveControl['owner'] => ({
	simfileId,
	cloudTitle,
	googleDriveFileId,
	downloadUrl
});

const control = ({
	existingFileFailure = 'none',
	ownerSeed = owner(),
	publicPermission = true,
	reset = true,
	terminateBeforeMetadataPatch = false
}: {
	existingFileFailure?: E2eDriveControl['existingFileFailure'];
	ownerSeed?: E2eDriveControl['owner'];
	publicPermission?: boolean | null;
	reset?: boolean;
	terminateBeforeMetadataPatch?: boolean | null;
} = {}): E2eDriveControl => ({
	reset,
	owner: ownerSeed,
	existingFileFailure,
	publicPermission,
	terminateBeforeMetadataPatch
});

const linkedSimfile = ({
	downloadUrl = null,
	googleDriveFileId = null,
	rendererTitle = fixtureSongTitle
}: {
	downloadUrl?: string | null;
	googleDriveFileId?: string | null;
	rendererTitle?: string;
} = {}): {
	id: number;
	title: string;
	artist: string;
	bpm: number;
	displayId: number;
	userId: null;
	googleDriveFileId: string | null;
	isPublished: boolean;
	downloadUrl: string | null;
	previewUrl: null;
	videoPreviewUrl: null;
	publishDate: string;
	createdAt: string;
	updatedAt: string;
	dtxFiles: never[];
} => ({
	id: Number(simfileId),
	title: rendererTitle,
	artist: 'Integration Test',
	bpm: 120,
	displayId: Number(simfileId),
	userId: null,
	googleDriveFileId,
	isPublished: false,
	downloadUrl,
	previewUrl: null,
	videoPreviewUrl: null,
	publishDate: '2026-07-25',
	createdAt: '2026-07-25T00:00:00.000Z',
	updatedAt: '2026-07-25T00:00:00.000Z',
	dtxFiles: []
});

const openAuthenticatedLinkedSong = async ({
	fixture,
	downloadUrl = null,
	googleDriveFileId = null,
	rendererTitle = fixtureSongTitle
}: {
	fixture: WorkspaceFixture;
	downloadUrl?: string | null;
	googleDriveFileId?: string | null;
	rendererTitle?: string;
}): Promise<void> => {
	await browser.execute(
		({ cloudSong, songPath, userId }) => {
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
						linkedSimFileId: String(cloudSong.id),
						linkedAt: '2026-07-25T00:00:00.000Z',
						cloudSongData: cloudSong
					}
				})
			);
			window.location.hash = '';
		},
		{
			cloudSong: linkedSimfile({ downloadUrl, googleDriveFileId, rendererTitle }),
			songPath: fixture.songFolder,
			userId: e2eUserId
		}
	);
	await browser.refresh();
	await waitForUiDisplayed('input[placeholder="Search songs and folders..."]', {
		timeoutMsg: 'Expected the authenticated E2E workspace to restore'
	});
	await $(`//button[.//span[normalize-space()="${fixtureSongTitle}"]]`).click();
	await waitForUiDisplayed('h2', { text: 'Song Details' });
	const upload = await $(
		`button[aria-label="${googleDriveFileId ? 'Re-upload ZIP to Drive' : 'Upload ZIP to Drive'}"]`
	);
	await upload.waitForEnabled({
		timeout: 15_000,
		timeoutMsg: 'Expected seeded Google Drive connection to enable upload'
	});
};

const clickDriveUpload = async (hasExistingFile: boolean): Promise<void> => {
	const upload = await $(
		`button[aria-label="${hasExistingFile ? 'Re-upload ZIP to Drive' : 'Upload ZIP to Drive'}"]`
	);
	await upload.waitForEnabled();
	await upload.click();
};

const terminalUploadStages = new Set(['upload-complete', 'upload-failed-save-succeeded']);

const waitForSnapshot = async (
	predicate: (snapshot: E2eDriveSnapshot) => boolean,
	timeoutMsg: string
): Promise<E2eDriveSnapshot> => {
	let latest: E2eDriveSnapshot | undefined;
	await browser.waitUntil(
		async () => {
			latest = await snapshotGoogleDriveE2e();
			const terminalStage = latest.progress.at(-1)?.stage;
			return (
				predicate(latest) &&
				terminalStage !== undefined &&
				terminalUploadStages.has(terminalStage)
			);
		},
		{ timeout: 20_000, interval: 100, timeoutMsg }
	);
	if (!latest) throw new Error(timeoutMsg);
	return latest;
};

const expectedZipEntries = (
	fixture: WorkspaceFixture
): { name: string; size: number; sha256: string }[] =>
	readdirSync(fixture.songFolder)
		.map((name) => {
			const contents = readFileSync(join(fixture.songFolder, name));
			return {
				name,
				size: contents.byteLength,
				sha256: createHash('sha256').update(contents).digest('hex')
			};
		})
		.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

describe('Desktop Google Drive ZIP upload', () => {
	let fixture: WorkspaceFixture;

	before(() => {
		fixture = getPreseededWorkspaceFixture();
	});

	it('uploads the fixture ZIP with ordered progress and preserves identity on re-upload', async () => {
		await configureGoogleDriveE2e(control());
		await openAuthenticatedLinkedSong({ fixture });

		await clickDriveUpload(false);
		const first = await waitForSnapshot(
			(snapshot) => snapshot.metadataMutations.length === 1,
			'Expected the first Drive upload to synchronize metadata'
		);

		expect(first.objects).toHaveLength(1);
		expect(first.objects[0]).toEqual({
			fileId: firstDriveFileId,
			name: `${fixtureSongTitle}.zip`,
			webContentLink: driveUrl(firstDriveFileId),
			zipEntries: expectedZipEntries(fixture),
			creationCount: 1
		});
		expect(first.owner.googleDriveFileId).toBe(firstDriveFileId);
		expect(first.owner.downloadUrl).toBe(driveUrl(firstDriveFileId));
		await waitForUiDisplayed('a', { text: 'Open Google Drive download' });
		expect(
			await $('//a[normalize-space()="Open Google Drive download"]').getAttribute('href')
		).toBe(driveUrl(firstDriveFileId));
		expect(new Set(first.progress.map((progress) => progress.operationId)).size).toBe(1);
		expect(first.progress.every((progress) => progress.simfileId === simfileId)).toBe(true);
		expect(first.progress.map((progress) => progress.stage)).toEqual([
			'waiting-for-upload-slot',
			'preparing-zip',
			'connecting-to-google-drive',
			'finalizing',
			'synchronizing-download-metadata',
			'upload-complete'
		]);
		expect(first.metadataMutations).toEqual([
			{
				mutation: 'updateDriveFile',
				simfileId,
				driveFileId: firstDriveFileId,
				downloadUrl: driveUrl(firstDriveFileId)
			}
		]);

		await clickDriveUpload(true);
		const updated = await waitForSnapshot(
			(snapshot) => snapshot.updateCount === 1 && snapshot.metadataMutations.length === 2,
			'Expected re-upload to update the same Drive object'
		);
		expect(updated.objects).toHaveLength(1);
		expect(updated.objects[0].fileId).toBe(firstDriveFileId);
		expect(updated.objects[0].creationCount).toBe(1);
		expect(updated.createCount).toBe(1);
		expect(updated.generateCount).toBe(1);
		expect(
			updated.metadataMutations.every((mutation) => mutation.mutation === 'updateDriveFile')
		).toBe(true);
		expect(updated.calls.filter((call) => call.operation === 'updateDriveFile')).toHaveLength(
			2
		);
	});

	it('preserves missing-file metadata until explicit replacement and uses the cloud title', async () => {
		const missingFileId = 'missing-existing-file';
		const priorUrl = driveUrl(missingFileId);
		const cloudTitle = 'Authoritative Cloud Title';
		await configureGoogleDriveE2e(
			control({
				existingFileFailure: 'not-found',
				ownerSeed: owner({
					cloudTitle,
					googleDriveFileId: missingFileId,
					downloadUrl: priorUrl
				})
			})
		);
		await openAuthenticatedLinkedSong({
			fixture,
			googleDriveFileId: missingFileId,
			downloadUrl: priorUrl,
			rendererTitle: 'Unsaved Renderer Title'
		});

		await clickDriveUpload(true);
		const failed = await waitForSnapshot(
			(snapshot) =>
				snapshot.progress.some(
					(progress) =>
						progress.stage === 'upload-failed-save-succeeded' &&
						progress.errorCode === 'FILE_NOT_FOUND'
				),
			'Expected permanent existing-file failure'
		);
		expect(failed.owner.googleDriveFileId).toBe(missingFileId);
		expect(failed.owner.downloadUrl).toBe(priorUrl);
		expect(failed.objects).toHaveLength(0);
		expect(failed.createCount).toBe(0);
		expect(failed.metadataMutations).toHaveLength(0);

		await waitForUiDisplayed('button', { text: 'Create a replacement upload' });
		await $('//button[normalize-space()="Create a replacement upload"]').click();
		const replaced = await waitForSnapshot(
			(snapshot) => snapshot.metadataMutations.length === 1,
			'Expected explicit replacement to synchronize one new identity'
		);
		expect(replaced.objects).toHaveLength(1);
		expect(replaced.objects[0].fileId).toBe(firstDriveFileId);
		expect(replaced.objects[0].name).toBe(`${cloudTitle}.zip`);
		expect(replaced.objects[0].name).not.toContain('Unsaved Renderer Title');
		expect(replaced.createCount).toBe(1);
		expect(replaced.generateCount).toBe(1);
		expect(replaced.owner.googleDriveFileId).toBe(firstDriveFileId);
	});

	it('rejects private sharing, accepts anyone sharing, and detects later removal', async () => {
		await configureGoogleDriveE2e(control({ publicPermission: false }));
		await openAuthenticatedLinkedSong({ fixture });

		await clickDriveUpload(false);
		const rejected = await waitForSnapshot(
			(snapshot) =>
				snapshot.deleteCount === 1 &&
				snapshot.progress.some(
					(progress) =>
						progress.stage === 'upload-failed-save-succeeded' &&
						progress.errorCode === 'DOWNLOAD_NOT_PUBLIC'
				),
			'Expected a private Drive object to be rejected and compensated'
		);
		expect(rejected.objects).toHaveLength(0);
		expect(rejected.owner.googleDriveFileId).toBeNull();
		expect(rejected.metadataMutations).toHaveLength(0);

		await configureGoogleDriveE2e(
			control({
				reset: false,
				ownerSeed: null,
				publicPermission: true,
				terminateBeforeMetadataPatch: null
			})
		);
		await waitForUiDisplayed('button', { text: 'Re-check sharing' });
		await $('//button[normalize-space()="Re-check sharing"]').click();
		await clickDriveUpload(false);
		const accepted = await waitForSnapshot(
			(snapshot) => snapshot.metadataMutations.length === 1,
			'Expected anyone sharing to allow a retry'
		);
		expect(accepted.objects).toHaveLength(1);
		expect(accepted.objects[0].fileId).toBe('e2e-drive-file-0002');
		expect(accepted.createCount).toBe(2);
		expect(accepted.deleteCount).toBe(1);

		await configureGoogleDriveE2e(
			control({
				reset: false,
				ownerSeed: null,
				publicPermission: false,
				terminateBeforeMetadataPatch: null
			})
		);
		await $('button[aria-label="Settings"]').click();
		await waitForUiDisplayed('h2', { text: 'Settings' });
		await $('//button[normalize-space()="Re-check sharing"]').click();
		await waitForUiDisplayed('p', {
			text: 'The selected folder must allow public download links.'
		});
		expect((await snapshotGoogleDriveE2e()).publicPermission).toBe(false);
	});
});
