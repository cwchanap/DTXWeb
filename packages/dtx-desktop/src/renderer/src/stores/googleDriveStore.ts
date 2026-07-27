import { writable } from 'svelte/store';
import type {
	GoogleDriveConnectionState,
	GoogleDriveDisconnectResult,
	GoogleDriveUploadProgress
} from '../services/desktopHost';

export type GoogleDriveOperation = GoogleDriveUploadProgress;
export type GoogleDriveConnectionSource =
	'refresh' | 'connect' | 'change-folder' | 'recheck-sharing';

export type GoogleDriveStoreState = {
	connection: GoogleDriveConnectionState | null;
	publicDownloadVerified: boolean;
	revocationUnconfirmed: boolean;
	operations: Record<string, GoogleDriveOperation>;
	error: string | null;
};

const initialState = (): GoogleDriveStoreState => ({
	connection: null,
	publicDownloadVerified: false,
	revocationUnconfirmed: false,
	operations: {},
	error: null
});

const stageRank: Record<GoogleDriveUploadProgress['stage'], number> = {
	'waiting-for-upload-slot': 0,
	'preparing-zip': 1,
	'connecting-to-google-drive': 2,
	uploading: 3,
	finalizing: 4,
	'synchronizing-download-metadata': 5,
	'upload-complete': 6,
	'upload-failed-save-succeeded': 6
};

const terminalStages = new Set<GoogleDriveUploadProgress['stage']>([
	'upload-complete',
	'upload-failed-save-succeeded'
]);

export const getActiveGoogleDriveOperationForSimfile = (
	state: GoogleDriveStoreState,
	simfileId: string | null | undefined
): GoogleDriveOperation | undefined => {
	if (!simfileId) return undefined;
	return Object.values(state.operations).find(
		(operation) => operation.simfileId === simfileId && !terminalStages.has(operation.stage)
	);
};

export const createGoogleDriveStore = () => {
	const { subscribe, set, update } = writable<GoogleDriveStoreState>(initialState());
	let generation = 0;
	const isCurrent = (candidate: number) => candidate === generation;
	const applyConnection = (
		state: GoogleDriveStoreState,
		connection: GoogleDriveConnectionState,
		source: GoogleDriveConnectionSource
	): GoogleDriveStoreState => ({
		...state,
		connection,
		// The native summary alone is deliberately not proof of public access.
		// Only an explicit connect, folder-change, or sharing recheck result is
		// treated as a fresh validation, and that renderer-only fact is never
		// persisted across reset/restart.
		publicDownloadVerified:
			connection.connected &&
			source !== 'refresh' &&
			!connection.requiresPublicSharing &&
			!connection.sharingCheckUnavailable,
		// A normal cache/refresh read has no authority to dismiss a warning that
		// OAuth revocation was not confirmed. A fresh successful connect does.
		revocationUnconfirmed:
			source === 'connect' && connection.connected ? false : state.revocationUnconfirmed,
		error: null
	});

	return {
		subscribe,
		captureGeneration: (): number => generation,
		setConnection: (
			connection: GoogleDriveConnectionState,
			source: GoogleDriveConnectionSource = 'refresh'
		) => update((state) => applyConnection(state, connection, source)),
		setConnectionIfCurrent: (
			candidate: number,
			connection: GoogleDriveConnectionState,
			source: GoogleDriveConnectionSource = 'refresh'
		) => {
			if (!isCurrent(candidate)) return;
			update((state) => applyConnection(state, connection, source));
		},
		setDisconnectIfCurrent: (candidate: number, result: GoogleDriveDisconnectResult) => {
			if (!isCurrent(candidate)) return;
			update((state) => ({
				...state,
				connection: result.connection,
				publicDownloadVerified: false,
				revocationUnconfirmed: result.revocationUnconfirmed,
				error: null
			}));
		},
		setErrorIfCurrent: (candidate: number, error: string | null) => {
			if (!isCurrent(candidate)) return;
			update((state) => ({ ...state, error }));
		},
		beginOperation: (operationId: string, simfileId: string) =>
			update((state) => {
				// Remove terminal operations for the same simfile so completed
				// entries do not accumulate across repeated uploads in a session.
				const cleanedOperations = Object.fromEntries(
					Object.entries(state.operations).filter(
						([, op]) => op.simfileId !== simfileId || !terminalStages.has(op.stage)
					)
				);
				return {
					...state,
					operations: {
						...cleanedOperations,
						[operationId]: { operationId, simfileId, stage: 'waiting-for-upload-slot' }
					},
					error: null
				};
			}),
		applyProgress: (progress: GoogleDriveUploadProgress) =>
			update((state) => {
				const operation = state.operations[progress.operationId];
				if (
					!operation ||
					!(progress.stage in stageRank) ||
					operation.simfileId !== progress.simfileId ||
					terminalStages.has(operation.stage) ||
					stageRank[progress.stage] < stageRank[operation.stage]
				) {
					return state;
				}

				return {
					...state,
					operations: { ...state.operations, [progress.operationId]: progress }
				};
			}),
		setUploadError: (operationId: string, simfileId: string, errorCode: string) =>
			update((state) => {
				const operation = state.operations[operationId];
				if (!operation || operation.simfileId !== simfileId) return state;
				return {
					...state,
					operations: {
						...state.operations,
						[operationId]: { ...operation, errorCode }
					}
				};
			}),
		reset: () => {
			generation += 1;
			set(initialState());
		}
	};
};

export const googleDriveStore = createGoogleDriveStore();
