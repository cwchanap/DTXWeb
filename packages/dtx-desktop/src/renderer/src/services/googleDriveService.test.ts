import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockHost = vi.hoisted(() => ({
	uploadSongZipToGoogleDrive: vi.fn(),
	cancelGoogleDriveUpload: vi.fn(),
	onGoogleDriveUploadProgress: vi.fn()
}));

vi.mock('./desktopHost', () => ({ desktopHost: mockHost }));

import { googleDriveService } from './googleDriveService';
import { get } from 'svelte/store';
import { googleDriveStore } from '../stores/googleDriveStore';

describe('googleDriveService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('crypto', {
			randomUUID: vi.fn(() => 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8')
		});
		googleDriveStore.reset();
		mockHost.onGoogleDriveUploadProgress.mockResolvedValue(vi.fn());
		mockHost.uploadSongZipToGoogleDrive.mockResolvedValue({ success: true });
	});

	afterEach(() => vi.unstubAllGlobals());

	it('creates an operation before subscribing and uploads only a normalized relative song path', async () => {
		const outcome = await googleDriveService.uploadSongZip({
			simfileId: 'simfile-42',
			workspacePath: '/Users/test/DTX',
			songPath: '/Users/test/DTX/songs/alpha'
		});

		expect(outcome).toEqual({
			simfileSave: { success: true },
			driveUpload: { status: 'success' }
		});
		expect(mockHost.onGoogleDriveUploadProgress).toHaveBeenCalledWith(expect.any(Function));
		expect(mockHost.uploadSongZipToGoogleDrive).toHaveBeenCalledWith({
			operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
			simfileId: 'simfile-42',
			songRelativePath: 'songs/alpha'
		});
		expect(mockHost.onGoogleDriveUploadProgress.mock.invocationCallOrder[0]).toBeLessThan(
			mockHost.uploadSongZipToGoogleDrive.mock.invocationCallOrder[0]
		);
	});

	it('rejects a song path outside the native-hydrated workspace without invoking native upload', async () => {
		await expect(
			googleDriveService.uploadSongZip({
				simfileId: 'simfile-42',
				workspacePath: '/Users/test/DTX',
				songPath: '/Users/test/Elsewhere/song'
			})
		).resolves.toEqual({
			simfileSave: { success: true },
			driveUpload: { status: 'failed', errorCode: 'INVALID_RESPONSE' }
		});
		expect(mockHost.uploadSongZipToGoogleDrive).not.toHaveBeenCalled();
	});

	it('stores only matching progress and cleans the operation listener after the native transaction', async () => {
		const unlisten = vi.fn();
		let progressListener: (progress: {
			operationId: string;
			simfileId: string;
			stage: 'uploading';
			percentage: number;
		}) => void = () => {};
		mockHost.onGoogleDriveUploadProgress.mockImplementation(
			async (listener: typeof progressListener) => {
				progressListener = listener;
				return unlisten;
			}
		);
		mockHost.uploadSongZipToGoogleDrive.mockImplementation(async () => {
			progressListener({
				operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
				simfileId: 'simfile-42',
				stage: 'uploading',
				percentage: 42
			});
			return { success: true };
		});

		await googleDriveService.uploadSongZip({
			simfileId: 'simfile-42',
			workspacePath: '/Users/test/DTX',
			songPath: '/Users/test/DTX/songs/alpha'
		});

		expect(get(googleDriveStore).operation).toMatchObject({
			operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
			simfileId: 'simfile-42',
			stage: 'uploading',
			percentage: 42
		});
		expect(unlisten).toHaveBeenCalledOnce();
	});

	it('cleans the operation listener when the native transaction rejects', async () => {
		const unlisten = vi.fn();
		mockHost.onGoogleDriveUploadProgress.mockResolvedValue(unlisten);
		mockHost.uploadSongZipToGoogleDrive.mockRejectedValue(new Error('native failed'));

		await expect(
			googleDriveService.uploadSongZip({
				simfileId: 'simfile-42',
				workspacePath: '/Users/test/DTX',
				songPath: '/Users/test/DTX/songs/alpha'
			})
		).resolves.toEqual({
			simfileSave: { success: true },
			driveUpload: { status: 'failed', errorCode: 'UNKNOWN' }
		});
		expect(unlisten).toHaveBeenCalledOnce();
	});
});
