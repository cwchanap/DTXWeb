import { writable } from 'svelte/store';

export interface TreeNode {
	name: string;
	path: string;
	isExpanded: boolean;
	isLoading: boolean;
	children: TreeNode[];
	hasChildren: boolean;
	containsDtxFiles?: boolean; // New property to identify folders with .dtx files
}

interface WorkspaceState {
	path: string | null;
	currentSubWorkspace: string | null;
	subWorkspaces: string[];
	treeStructure: TreeNode[];
	isLoading: boolean;
	error: string | null;
	selectedSong: TreeNode | null;
	showSongDetails: boolean;
}

const initialState: WorkspaceState = {
	path: null,
	currentSubWorkspace: null,
	subWorkspaces: [],
	treeStructure: [],
	isLoading: false,
	error: null,
	selectedSong: null,
	showSongDetails: false
};

// Helper function to update tree nodes recursively
function updateTreeNodeRecursive(
	nodes: TreeNode[],
	targetPath: string,
	updates: Partial<TreeNode>
): TreeNode[] {
	return nodes.map((node) => {
		if (node.path === targetPath) {
			return { ...node, ...updates };
		}
		if (node.children.length > 0) {
			return {
				...node,
				children: updateTreeNodeRecursive(node.children, targetPath, updates)
			};
		}
		return node;
	});
}

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
		setCurrentSubWorkspace: (subWorkspace: string | null) => {
			update((state) => ({ ...state, currentSubWorkspace: subWorkspace }));
		},
		setSubWorkspaces: (subWorkspaces: string[]) =>
			update((state) => ({ ...state, subWorkspaces, error: null })),
		setTreeStructure: (treeStructure: TreeNode[]) =>
			update((state) => ({ ...state, treeStructure, error: null })),
		updateTreeNode: (nodePath: string, updates: Partial<TreeNode>) => {
			update((state) => ({
				...state,
				treeStructure: updateTreeNodeRecursive(state.treeStructure, nodePath, updates)
			}));
		},
		setLoading: (isLoading: boolean) => update((state) => ({ ...state, isLoading })),
		setError: (error: string) => update((state) => ({ ...state, error })),
		clearWorkspace: () => {
			localStorage.removeItem('workspace_path');
			update((state) => ({
				...state,
				path: null,
				currentSubWorkspace: null,
				subWorkspaces: [],
				treeStructure: [],
				error: null,
				selectedSong: null,
				showSongDetails: false
			}));
		},
		selectSong: (song: TreeNode) => {
			update((state) => ({
				...state,
				selectedSong: song,
				showSongDetails: true
			}));
		},
		closeSongDetails: () => {
			update((state) => ({
				...state,
				selectedSong: null,
				showSongDetails: false
			}));
		},
		reset: () => set(initialState)
	};
}

export const workspaceStore = createWorkspaceStore();
