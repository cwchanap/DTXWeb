import { writable } from 'svelte/store';

interface WorkspaceState {
	path: string | null;
	folders: string[];
	isLoading: boolean;
	error: string | null;
}

const initialState: WorkspaceState = {
	path: null,
	folders: [],
	isLoading: false,
	error: null
};

function createWorkspaceStore() {
	// Try to restore workspace path from localStorage
	const storedPath = localStorage.getItem('workspace_path');
	const initialPath = storedPath ? JSON.parse(storedPath) : null;

	const initializedState = {
		...initialState,
		path: initialPath
	};

	const { subscribe, set, update } = writable<WorkspaceState>(initializedState);

	return {
		subscribe,
		setPath: (path: string) => {
			// Store in localStorage
			localStorage.setItem('workspace_path', JSON.stringify(path));
			// Update store
			update((state) => ({ ...state, path, error: null }));
		},
		setFolders: (folders: string[]) => update((state) => ({ ...state, folders, error: null })),
		setLoading: (isLoading: boolean) => update((state) => ({ ...state, isLoading })),
		setError: (error: string) => update((state) => ({ ...state, error })),
		clearWorkspace: () => {
			localStorage.removeItem('workspace_path');
			update((state) => ({ ...state, path: null, folders: [], error: null }));
		},
		reset: () => set(initialState)
	};
}

export const workspaceStore = createWorkspaceStore();
