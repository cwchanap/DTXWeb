import { writable } from 'svelte/store';
import type {
	GoogleDriveConnectionState,
	GoogleDriveDisconnectResult,
	GoogleDriveUploadProgress
} from '../services/desktopHost';

export type GoogleDriveOperation = GoogleDriveUploadProgress;

export type GoogleDriveStoreState = {
	connection: GoogleDriveConnectionState | null;
	revocationUnconfirmed: boolean;
	operations: Record<string, GoogleDriveOperation>;
	error: string | null;
};

const initialState = (): GoogleDriveStoreState => ({
	connection: null,
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

export const createGoogleDriveStore = () => {
	const { subscribe, set, update } = writable<GoogleDriveStoreState>(initialState());
	let generation = 0;
	const isCurrent = (candidate: number) => candidate === generation;

	return {
		subscribe,
		captureGeneration: (): number => generation,
		setConnection: (connection: GoogleDriveConnectionState) =>
			update((state) => ({
				...state,
				connection,
				revocationUnconfirmed: false,
				error: null
			})),
		setConnectionIfCurrent: (candidate: number, connection: GoogleDriveConnectionState) => {
			if (!isCurrent(candidate)) return;
			update((state) => ({
				...state,
				connection,
				revocationUnconfirmed: false,
				error: null
			}));
		},
		setDisconnectIfCurrent: (candidate: number, result: GoogleDriveDisconnectResult) => {
			if (!isCurrent(candidate)) return;
			update((state) => ({
				...state,
				connection: result.connection,
				revocationUnconfirmed: result.revocationUnconfirmed,
				error: null
			}));
		},
		setErrorIfCurrent: (candidate: number, error: string | null) => {
			if (!isCurrent(candidate)) return;
			update((state) => ({ ...state, error }));
		},
		beginOperation: (operationId: string, simfileId: string) =>
			update((state) => ({
				...state,
				operations: {
					...state.operations,
					[operationId]: { operationId, simfileId, stage: 'waiting-for-upload-slot' }
				},
				error: null
			})),
		applyProgress: (progress: GoogleDriveUploadProgress) =>
			update((state) => {
				const operation = state.operations[progress.operationId];
				if (
					!operation ||
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
