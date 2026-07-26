import { writable } from 'svelte/store';
import type {
	GoogleDriveConnectionState,
	GoogleDriveUploadProgress
} from '../services/desktopHost';

export type GoogleDriveOperation = GoogleDriveUploadProgress;

export type GoogleDriveStoreState = {
	connection: GoogleDriveConnectionState | null;
	operation: GoogleDriveOperation | null;
	error: string | null;
};

const initialState = (): GoogleDriveStoreState => ({
	connection: null,
	operation: null,
	error: null
});

const terminalStages = new Set<GoogleDriveUploadProgress['stage']>([
	'upload-complete',
	'upload-failed-save-succeeded'
]);

export const createGoogleDriveStore = () => {
	const { subscribe, set, update } = writable<GoogleDriveStoreState>(initialState());

	return {
		subscribe,
		setConnection: (connection: GoogleDriveConnectionState) =>
			update((state) => ({ ...state, connection, error: null })),
		beginOperation: (operationId: string, simfileId: string) =>
			update((state) => ({
				...state,
				operation: { operationId, simfileId, stage: 'waiting-for-upload-slot' },
				error: null
			})),
		applyProgress: (progress: GoogleDriveUploadProgress) =>
			update((state) => {
				if (
					!state.operation ||
					state.operation.operationId !== progress.operationId ||
					state.operation.simfileId !== progress.simfileId ||
					terminalStages.has(state.operation.stage)
				) {
					return state;
				}

				return {
					...state,
					operation: progress,
					error: progress.errorCode ?? null
				};
			}),
		setError: (error: string | null) => update((state) => ({ ...state, error })),
		setUploadError: (operationId: string, simfileId: string, error: string) =>
			update((state) => {
				if (
					state.operation?.operationId !== operationId ||
					state.operation.simfileId !== simfileId
				) {
					return state;
				}
				return { ...state, error };
			}),
		reset: () => set(initialState())
	};
};

export const googleDriveStore = createGoogleDriveStore();
