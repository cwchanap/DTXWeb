import {
	desktopHost,
	type GoogleDriveConnectionState,
	type GoogleDriveUploadInput,
	type GoogleDriveUploadProgress,
	type GoogleDriveUploadResult
} from './desktopHost';
import { get } from 'svelte/store';
import { googleDriveStore } from '../stores/googleDriveStore';

export type SongSaveOutcome = {
	simfileSave: { success: boolean; error?: string };
	driveUpload: {
		status: 'success' | 'failed' | 'skipped';
		fileId?: string;
		downloadUrl?: string;
		errorCode?: string;
		error?: string;
	};
};

export type GoogleDriveUploadRequest = {
	simfileId: string;
	workspacePath: string;
	songPath: string;
	forceCreateReplacement?: boolean;
};

export type SimfileSaveResult = {
	success: boolean;
	simfileId?: string;
	error?: string;
};

export type SaveAndUploadRequest = {
	save: () => Promise<SimfileSaveResult>;
	workspacePath: string;
	songPath: string;
	driveConnected?: boolean;
};

const normalizeRelativeSongPath = (workspacePath: string, songPath: string): string | null => {
	const normalize = (value: string): string =>
		value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
	const workspace = normalize(workspacePath);
	const song = normalize(songPath);
	if (!workspace || !song || !song.startsWith(`${workspace}/`)) return null;

	const relative = song.slice(workspace.length + 1);
	const parts = relative.split('/');
	if (parts.length === 0 || parts.some((part) => !part || part === '.' || part === '..'))
		return null;
	return parts.join('/');
};

const outcomeFromNativeResult = (result: GoogleDriveUploadResult): SongSaveOutcome => ({
	simfileSave: { success: true },
	driveUpload: result.success
		? {
				status: 'success',
				fileId: result.fileId,
				downloadUrl: result.downloadUrl
			}
		: {
				status: 'failed',
				errorCode: result.errorCode,
				error: result.error
			}
});

const invalidPathOutcome = (): SongSaveOutcome => ({
	simfileSave: { success: true },
	driveUpload: { status: 'failed', errorCode: 'INVALID_RESPONSE' }
});

const uploadSongZip = async (
	request: GoogleDriveUploadRequest,
	onProgress?: (progress: GoogleDriveUploadProgress) => void
): Promise<SongSaveOutcome> => {
	const songRelativePath = normalizeRelativeSongPath(request.workspacePath, request.songPath);
	if (!songRelativePath) return invalidPathOutcome();

	const operationId = crypto.randomUUID();
	googleDriveStore.beginOperation(operationId, request.simfileId);
	let unlisten: (() => void) | undefined;
	try {
		unlisten = await desktopHost.onGoogleDriveUploadProgress((progress) => {
			if (progress.operationId === operationId && progress.simfileId === request.simfileId) {
				googleDriveStore.applyProgress(progress);
				onProgress?.(progress);
			}
		});

		const input: GoogleDriveUploadInput = {
			operationId,
			simfileId: request.simfileId,
			songRelativePath,
			...(request.forceCreateReplacement === undefined
				? {}
				: { forceCreateReplacement: request.forceCreateReplacement })
		};
		const result = await desktopHost.uploadSongZipToGoogleDrive(input);
		if (!result.success) {
			googleDriveStore.setUploadError(
				operationId,
				request.simfileId,
				result.errorCode ?? 'UNKNOWN'
			);
		}
		return outcomeFromNativeResult(result);
	} catch {
		googleDriveStore.setUploadError(operationId, request.simfileId, 'UNKNOWN');
		return {
			simfileSave: { success: true },
			driveUpload: { status: 'failed', errorCode: 'UNKNOWN' }
		};
	} finally {
		unlisten?.();
	}
};

const saveAndUpload = async (request: SaveAndUploadRequest): Promise<SongSaveOutcome> => {
	let saveResult: SimfileSaveResult;
	try {
		saveResult = await request.save();
	} catch (error) {
		return {
			simfileSave: {
				success: false,
				error: error instanceof Error ? error.message : 'Failed to save song'
			},
			driveUpload: { status: 'skipped' }
		};
	}

	if (!saveResult.success) {
		return {
			simfileSave: { success: false, error: saveResult.error },
			driveUpload: { status: 'skipped' }
		};
	}

	if (!(request.driveConnected ?? get(googleDriveStore).connection?.connected)) {
		return {
			simfileSave: { success: true },
			driveUpload: { status: 'skipped' }
		};
	}

	if (!saveResult.simfileId) {
		return {
			simfileSave: { success: true },
			driveUpload: { status: 'failed', errorCode: 'INVALID_RESPONSE' }
		};
	}

	return await uploadSongZip({
		simfileId: saveResult.simfileId,
		workspacePath: request.workspacePath,
		songPath: request.songPath
	});
};

export const googleDriveService = {
	refreshConnection: async (): Promise<GoogleDriveConnectionState | null> => {
		const generation = googleDriveStore.captureGeneration();
		try {
			const connection = await desktopHost.getGoogleDriveConnectionState();
			googleDriveStore.setConnectionIfCurrent(generation, connection, 'refresh');
			return connection;
		} catch {
			googleDriveStore.setErrorIfCurrent(generation, 'UNKNOWN');
			return null;
		}
	},
	connectAndChooseFolder: async (): Promise<GoogleDriveConnectionState | null> => {
		const generation = googleDriveStore.captureGeneration();
		try {
			const connection = await desktopHost.connectGoogleDriveAndChooseFolder();
			googleDriveStore.setConnectionIfCurrent(generation, connection, 'connect');
			return connection;
		} catch {
			googleDriveStore.setErrorIfCurrent(generation, 'UNKNOWN');
			return null;
		}
	},
	changeFolder: async (): Promise<GoogleDriveConnectionState | null> => {
		const generation = googleDriveStore.captureGeneration();
		try {
			const connection = await desktopHost.changeGoogleDriveFolder();
			googleDriveStore.setConnectionIfCurrent(generation, connection, 'change-folder');
			return connection;
		} catch {
			googleDriveStore.setErrorIfCurrent(generation, 'UNKNOWN');
			return null;
		}
	},
	recheckSharing: async (): Promise<GoogleDriveConnectionState | null> => {
		const generation = googleDriveStore.captureGeneration();
		try {
			const connection = await desktopHost.recheckGoogleDriveSharing();
			googleDriveStore.setConnectionIfCurrent(generation, connection, 'recheck-sharing');
			return connection;
		} catch {
			googleDriveStore.setErrorIfCurrent(generation, 'UNKNOWN');
			return null;
		}
	},
	disconnect: async (): Promise<void> => {
		const generation = googleDriveStore.captureGeneration();
		try {
			const result = await desktopHost.disconnectGoogleDrive();
			googleDriveStore.setDisconnectIfCurrent(generation, result);
		} catch {
			googleDriveStore.setErrorIfCurrent(generation, 'UNKNOWN');
		}
	},
	saveAndUpload,
	uploadSongZip,
	cancelUpload: (operationId: string): Promise<boolean> =>
		desktopHost.cancelGoogleDriveUpload(operationId)
};

export { normalizeRelativeSongPath };
