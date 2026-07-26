import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockHost = vi.hoisted(() => ({
	uploadSongZipToGoogleDrive: vi.fn(),
	cancelGoogleDriveUpload: vi.fn(),
	onGoogleDriveUploadProgress: vi.fn(),
	getGoogleDriveConnectionState: vi.fn(),
	connectGoogleDriveAndChooseFolder: vi.fn(),
	changeGoogleDriveFolder: vi.fn(),
	recheckGoogleDriveSharing: vi.fn(),
	disconnectGoogleDrive: vi.fn()
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

		expect(get(googleDriveStore).operations).toMatchObject({
			'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8': {
				operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
				simfileId: 'simfile-42',
				stage: 'uploading',
				percentage: 42
			}
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

	it.each([
		['refreshConnection', 'getGoogleDriveConnectionState'],
		['connectAndChooseFolder', 'connectGoogleDriveAndChooseFolder'],
		['changeFolder', 'changeGoogleDriveFolder'],
		['recheckSharing', 'recheckGoogleDriveSharing']
	] as const)(
		'does not apply a late %s connection result after reset',
		async (serviceMethod, hostMethod) => {
			let resolve!: (connection: { connected: boolean }) => void;
			mockHost[hostMethod].mockReturnValue(
				new Promise((promiseResolve) => {
					resolve = promiseResolve;
				})
			);

			const pending = googleDriveService[serviceMethod]();
			googleDriveStore.reset();
			resolve({ connected: true });
			await pending;

			expect(get(googleDriveStore).connection).toBeNull();
		}
	);

	it('does not apply a late disconnect result after reset', async () => {
		let resolve!: (result: {
			connection: { connected: boolean };
			revocationUnconfirmed: boolean;
		}) => void;
		mockHost.disconnectGoogleDrive.mockReturnValue(
			new Promise((promiseResolve) => {
				resolve = promiseResolve;
			})
		);

		const pending = googleDriveService.disconnect();
		googleDriveStore.reset();
		resolve({ connection: { connected: false }, revocationUnconfirmed: true });
		await pending;

		expect(get(googleDriveStore).revocationUnconfirmed).toBe(false);
	});

	it('keeps ordinary refresh results unverified but records a successful sharing recheck as verified', async () => {
		const connection = { connected: true, folder: { id: 'folder-id', name: 'Exports' } };
		mockHost.getGoogleDriveConnectionState.mockResolvedValue(connection);
		mockHost.recheckGoogleDriveSharing.mockResolvedValue(connection);

		await googleDriveService.refreshConnection();
		expect(get(googleDriveStore).publicDownloadVerified).toBe(false);

		await googleDriveService.recheckSharing();
		expect(get(googleDriveStore).publicDownloadVerified).toBe(true);
	});

	it('does not attempt Drive when the primary save fails', async () => {
		googleDriveStore.setConnection({
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' }
		});

		await expect(
			googleDriveService.saveAndUpload({
				save: async () => ({ success: false, error: 'Database error' }),
				workspacePath: '/Users/test/DTX',
				songPath: '/Users/test/DTX/songs/alpha'
			})
		).resolves.toEqual({
			simfileSave: { success: false, error: 'Database error' },
			driveUpload: { status: 'skipped' }
		});
		expect(mockHost.uploadSongZipToGoogleDrive).not.toHaveBeenCalled();
	});

	it('keeps a successful save and skips Drive when it is disconnected', async () => {
		const save = vi.fn(async () => ({ success: true, simfileId: 'created-73' }));

		await expect(
			googleDriveService.saveAndUpload({
				save,
				workspacePath: '/Users/test/DTX',
				songPath: '/Users/test/DTX/songs/alpha'
			})
		).resolves.toEqual({
			simfileSave: { success: true },
			driveUpload: { status: 'skipped' }
		});
		expect(save).toHaveBeenCalledOnce();
		expect(mockHost.uploadSongZipToGoogleDrive).not.toHaveBeenCalled();
	});

	it('uploads only after save and uses the ID returned by a successful create', async () => {
		const order: string[] = [];
		googleDriveStore.setConnection({
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' }
		});
		mockHost.uploadSongZipToGoogleDrive.mockImplementation(async (input) => {
			order.push(`drive:${input.simfileId}`);
			return {
				success: true,
				fileId: 'drive-new',
				downloadUrl: 'https://drive.google.com/uc?id=drive-new'
			};
		});

		const outcome = await googleDriveService.saveAndUpload({
			save: async () => {
				order.push('save');
				return { success: true, simfileId: 'created-73' };
			},
			workspacePath: '/Users/test/DTX',
			songPath: '/Users/test/DTX/songs/alpha'
		});

		expect(order).toEqual(['save', 'drive:created-73']);
		expect(outcome).toEqual({
			simfileSave: { success: true },
			driveUpload: {
				status: 'success',
				fileId: 'drive-new',
				downloadUrl: 'https://drive.google.com/uc?id=drive-new'
			}
		});
		expect(mockHost.uploadSongZipToGoogleDrive).toHaveBeenCalledWith({
			operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
			simfileId: 'created-73',
			songRelativePath: 'songs/alpha'
		});
	});

	it('preserves primary success when Drive fails and sends no renderer title authority', async () => {
		googleDriveStore.setConnection({
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' }
		});
		mockHost.uploadSongZipToGoogleDrive.mockResolvedValue({
			success: false,
			errorCode: 'NETWORK'
		});

		const outcome = await googleDriveService.saveAndUpload({
			save: async () => ({ success: true, simfileId: 'existing-42' }),
			workspacePath: '/Users/test/DTX',
			songPath: '/Users/test/DTX/songs/unsaved-renderer-title'
		});

		expect(outcome).toEqual({
			simfileSave: { success: true },
			driveUpload: { status: 'failed', errorCode: 'NETWORK' }
		});
		expect(mockHost.uploadSongZipToGoogleDrive).toHaveBeenCalledWith({
			operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
			simfileId: 'existing-42',
			songRelativePath: 'songs/unsaved-renderer-title'
		});
	});

	it('explicit replacement differs from a normal upload only by forceCreateReplacement', async () => {
		await googleDriveService.uploadSongZip({
			simfileId: 'simfile-42',
			workspacePath: '/Users/test/DTX',
			songPath: '/Users/test/DTX/songs/alpha',
			forceCreateReplacement: true
		});

		expect(mockHost.uploadSongZipToGoogleDrive).toHaveBeenCalledWith({
			operationId: 'f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8',
			simfileId: 'simfile-42',
			songRelativePath: 'songs/alpha',
			forceCreateReplacement: true
		});
	});

	it('releases save orchestration after native cancellation is accepted without rolling back save', async () => {
		googleDriveStore.setConnection({
			connected: true,
			folder: { id: 'folder-id', name: 'Exports' }
		});
		let resolveUpload!: (result: { success: boolean; errorCode: string }) => void;
		mockHost.uploadSongZipToGoogleDrive.mockReturnValue(
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
		);
		mockHost.cancelGoogleDriveUpload.mockImplementation(async () => {
			resolveUpload({ success: false, errorCode: 'CANCELED' });
			return true;
		});

		const pending = googleDriveService.saveAndUpload({
			save: async () => ({ success: true, simfileId: 'existing-42' }),
			workspacePath: '/Users/test/DTX',
			songPath: '/Users/test/DTX/songs/alpha'
		});
		await vi.waitFor(() => expect(mockHost.uploadSongZipToGoogleDrive).toHaveBeenCalledOnce());

		await googleDriveService.cancelUpload('f5ca4b7c-c7bb-4f01-a9f4-e42b6b3043a8');

		await expect(pending).resolves.toEqual({
			simfileSave: { success: true },
			driveUpload: { status: 'failed', errorCode: 'CANCELED' }
		});
	});
});
