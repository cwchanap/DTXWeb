import { writable } from 'svelte/store';
import type { SimfileWithDtx } from '@dtx/common';

interface SimFileState {
	userSimFiles: SimfileWithDtx[];
	publishedSimFiles: SimfileWithDtx[];
	isLoading: boolean;
	error: string | null;
	lastUpdated: Date | null;
	fromCache: boolean;
}

const initialState: SimFileState = {
	userSimFiles: [],
	publishedSimFiles: [],
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
		setUserSimFiles: (userSimFiles: SimfileWithDtx[], fromCache: boolean = false) => {
			update((state) => ({
				...state,
				userSimFiles,
				isLoading: false,
				error: null,
				lastUpdated: new Date(),
				fromCache
			}));
		},

		// Set published simFiles
		setPublishedSimFiles: (publishedSimFiles: SimfileWithDtx[], fromCache: boolean = false) => {
			update((state) => ({
				...state,
				publishedSimFiles,
				isLoading: false,
				error: null,
				lastUpdated: new Date(),
				fromCache
			}));
		},

		// Add a new simFile to user simFiles
		addUserSimFile: (simFile: SimfileWithDtx) => {
			update((state) => ({
				...state,
				userSimFiles: [simFile, ...state.userSimFiles],
				lastUpdated: new Date()
			}));
		},

		// Update an existing simFile
		updateUserSimFile: (updatedSimFile: SimfileWithDtx) => {
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
		filterUserSimFiles: (filterFn: (simFile: SimfileWithDtx) => boolean) => {
			let filteredSimFiles: SimfileWithDtx[] = [];
			update((state) => {
				filteredSimFiles = state.userSimFiles.filter(filterFn);
				return state; // Don't modify the store, just return filtered data
			});
			return filteredSimFiles;
		},

		// Get simFile by ID
		getSimFileById: (id: number): SimfileWithDtx | undefined => {
			let simFile: SimfileWithDtx | undefined;
			update((state) => {
				simFile =
					state.userSimFiles.find((sf) => sf.id === id) ||
					state.publishedSimFiles.find((sf) => sf.id === id);
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
