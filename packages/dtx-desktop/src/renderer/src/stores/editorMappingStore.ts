import { writable, get } from 'svelte/store';

// Store for mapping simFileId to song metadata
interface SongMetadata {
	folderPath: string;
	songName: string;
}

interface EditorMappingState {
	simFileIdToFolderPath: Record<string, string>; // Keep for backward compatibility
	simFileIdToMetadata: Record<string, SongMetadata>;
}

const STORAGE_KEY = 'editor_mapping_cache';

// Load initial state from localStorage
function loadInitialState(): EditorMappingState {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored) {
			return JSON.parse(stored);
		}
	} catch (error) {
		console.warn('Failed to load editor mapping from localStorage:', error);
	}
	return { simFileIdToFolderPath: {}, simFileIdToMetadata: {} };
}

// Save state to localStorage
function saveState(state: EditorMappingState): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch (error) {
		console.warn('Failed to save editor mapping to localStorage:', error);
	}
}

const initialState = loadInitialState();

function createEditorMappingStore() {
	const store = writable<EditorMappingState>(initialState);
	const { subscribe, set, update } = store;

	return {
		subscribe,

		// Add or update a mapping (backward compatibility)
		setMapping: (simFileId: string, folderPath: string) => {
			update((state) => {
				const newState = {
					...state,
					simFileIdToFolderPath: {
						...state.simFileIdToFolderPath,
						[simFileId]: folderPath
					}
				};
				saveState(newState);
				return newState;
			});
		},

		// Add or update a mapping with metadata
		setMappingWithMetadata: (simFileId: string, folderPath: string, songName: string) => {
			update((state) => {
				const newState = {
					...state,
					simFileIdToFolderPath: {
						...state.simFileIdToFolderPath,
						[simFileId]: folderPath
					},
					simFileIdToMetadata: {
						...state.simFileIdToMetadata,
						[simFileId]: { folderPath, songName }
					}
				};
				saveState(newState);
				return newState;
			});
		},

		// Get folder path for a simFileId
		getFolderPath: (simFileId: string): string | undefined => {
			const state = get(store);
			// Try new metadata store first, then fall back to old store
			return (
				state.simFileIdToMetadata[simFileId]?.folderPath ||
				state.simFileIdToFolderPath[simFileId]
			);
		},

		// Get song metadata for a simFileId
		getSongMetadata: (simFileId: string): SongMetadata | undefined => {
			const state = get(store);
			return state.simFileIdToMetadata[simFileId];
		},

		// Remove a mapping
		removeMapping: (simFileId: string) => {
			update((state) => {
				const newMappings = { ...state.simFileIdToFolderPath };
				const newMetadata = { ...state.simFileIdToMetadata };
				delete newMappings[simFileId];
				delete newMetadata[simFileId];
				const newState = {
					...state,
					simFileIdToFolderPath: newMappings,
					simFileIdToMetadata: newMetadata
				};
				saveState(newState);
				return newState;
			});
		},

		// Clear all mappings
		clearMappings: () => {
			const clearedState = { simFileIdToFolderPath: {}, simFileIdToMetadata: {} };
			set(clearedState);
			saveState(clearedState);
		}
	};
}

export const editorMappingStore = createEditorMappingStore();
