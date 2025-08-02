import { writable } from 'svelte/store';

// Store for mapping simFileId to songFolderPath
interface EditorMappingState {
	simFileIdToFolderPath: Record<string, string>;
}

const initialState: EditorMappingState = {
	simFileIdToFolderPath: {}
};

function createEditorMappingStore() {
	const { subscribe, set, update } = writable<EditorMappingState>(initialState);

	return {
		subscribe,

		// Add or update a mapping
		setMapping: (simFileId: string, folderPath: string) => {
			update((state) => ({
				...state,
				simFileIdToFolderPath: {
					...state.simFileIdToFolderPath,
					[simFileId]: folderPath
				}
			}));
		},

		// Get folder path for a simFileId
		getFolderPath: (simFileId: string): string | undefined => {
			let folderPath: string | undefined;
			update((state) => {
				folderPath = state.simFileIdToFolderPath[simFileId];
				return state;
			});
			return folderPath;
		},

		// Remove a mapping
		removeMapping: (simFileId: string) => {
			update((state) => {
				const newMappings = { ...state.simFileIdToFolderPath };
				delete newMappings[simFileId];
				return {
					...state,
					simFileIdToFolderPath: newMappings
				};
			});
		},

		// Clear all mappings
		clearMappings: () => {
			set(initialState);
		}
	};
}

export const editorMappingStore = createEditorMappingStore();
