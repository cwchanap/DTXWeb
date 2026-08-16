import { writable } from 'svelte/store';
import type { SimfileModel } from '@dtx/common';

export interface SimFileState {
	userSimFiles: SimfileModel[];
	isLoading: boolean;
	error: string | null;
	lastUpdated: Date | null;
	fromCache: boolean;
}

const initialState: SimFileState = {
	userSimFiles: [],
	isLoading: false,
	error: null,
	lastUpdated: null,
	fromCache: false
};

function createSimFileStore() {
	const { subscribe, set, update } = writable<SimFileState>(initialState);

	return {
		subscribe,

		// Set loading state
		setLoading: (isLoading: boolean) => {
			update((state) => ({ ...state, isLoading, error: null }));
		},

		// Set error state
		setError: (error: string) => {
			update((state) => ({ ...state, error, isLoading: false }));
		},

		// Clear error
		clearError: () => {
			update((state) => ({ ...state, error: null }));
		},

		// Set user simFiles
		setUserSimFiles: (userSimFiles: SimfileModel[], fromCache: boolean = false) => {
			update((state) => ({
				...state,
				userSimFiles,
				isLoading: false,
				error: null,
				lastUpdated: new Date(),
				fromCache
			}));
		},

		// Add a new simFile to user simFiles
		addUserSimFile: (simFile: SimfileModel) => {
			update((state) => ({
				...state,
				userSimFiles: [simFile, ...state.userSimFiles],
				lastUpdated: new Date()
			}));
		},

		// Update an existing simFile
		updateUserSimFile: (updatedSimFile: SimfileModel) => {
			update((state) => ({
				...state,
				userSimFiles: state.userSimFiles.map((simFile) =>
					simFile.id === updatedSimFile.id ? updatedSimFile : simFile
				),
				lastUpdated: new Date()
			}));
		},

		// Remove a simFile from user simFiles
		removeUserSimFile: (simFileId: number) => {
			update((state) => ({
				...state,
				userSimFiles: state.userSimFiles.filter((simFile) => simFile.id !== simFileId),
				lastUpdated: new Date()
			}));
		},

		// Filter user simFiles by criteria
		filterUserSimFiles: (filterFn: (simFile: SimfileModel) => boolean) => {
			let filteredSimFiles: SimfileModel[] = [];
			update((state) => {
				filteredSimFiles = state.userSimFiles.filter(filterFn);
				return state; // Don't modify the store, just return filtered data
			});
			return filteredSimFiles;
		},

		// Get simFile by ID
		getSimFileById: (id: number): SimfileModel | undefined => {
			let simFile: SimfileModel | undefined;
			update((state) => {
				simFile = state.userSimFiles.find((sf: SimfileModel) => sf.id === id);
				return state; // Don't modify the store
			});
			return simFile;
		},

		// Reset store to initial state
		reset: () => {
			set(initialState);
		},

		// Get current state (useful for one-time reads)
		getCurrentState: (): SimFileState => {
			let currentState: SimFileState = initialState;
			update((state) => {
				currentState = state;
				return state;
			});
			return currentState;
		}
	};
}

export const simFileStore = createSimFileStore();
