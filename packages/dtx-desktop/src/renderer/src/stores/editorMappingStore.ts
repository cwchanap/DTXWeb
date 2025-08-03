import { writable, get } from 'svelte/store';

// Store for mapping simFileId to songFolderPath
interface EditorMappingState {
	simFileIdToFolderPath: Record<string, string>;
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
	return { simFileIdToFolderPath: {} };
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

		// Add or update a mapping
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

		// Get folder path for a simFileId
		getFolderPath: (simFileId: string): string | undefined => {
			const state = get(store);
			return state.simFileIdToFolderPath[simFileId];
		},

		// Remove a mapping
		removeMapping: (simFileId: string) => {
			update((state) => {
				const newMappings = { ...state.simFileIdToFolderPath };
				delete newMappings[simFileId];
				const newState = {
					...state,
					simFileIdToFolderPath: newMappings
				};
				saveState(newState);
				return newState;
			});
		},

		// Clear all mappings
		clearMappings: () => {
			const clearedState = { simFileIdToFolderPath: {} };
			set(clearedState);
			saveState(clearedState);
		}
	};
}

export const editorMappingStore = createEditorMappingStore();
