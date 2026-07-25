import { writable } from 'svelte/store';
import type { SimfileWithDtx } from '@dtx/common';
import { linkageCacheService } from '../services/linkageCacheService';

export type ShellSection = 'library' | 'cloud' | 'templates' | 'settings' | 'scores';

export interface TreeNode {
	name: string;
	path: string;
	isExpanded: boolean;
	isLoading: boolean;
	children: TreeNode[];
	hasChildren: boolean;
	containsDtxFiles?: boolean; // New property to identify folders with .dtx files
	songTitle?: string | null; // Song title from SET.def file
	linkedSimFileId?: string | null; // ID of linked remote simFile
	linkedSimFile?: SimfileWithDtx | null; // Full linked remote simFile data
}

export interface WorkspaceState {
	path: string | null;
	currentSubWorkspace: string | null;
	subWorkspaces: string[];
	treeStructure: TreeNode[];
	isLoading: boolean;
	error: string | null;
	selectedSong: TreeNode | null;
	selectedCloudSimFile: SimfileWithDtx | null;
	showCloudSongDetails: boolean;
	showNewSong: boolean;
	activeSection: ShellSection;
}

const initialState: WorkspaceState = {
	path: null,
	currentSubWorkspace: null,
	subWorkspaces: [],
	treeStructure: [],
	isLoading: false,
	error: null,
	selectedSong: null,
	selectedCloudSimFile: null,
	showCloudSongDetails: false,
	showNewSong: false,
	activeSection: 'library'
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
	const { subscribe, set, update } = writable<WorkspaceState>(initialState);

	return {
		subscribe,
		setPath: (path: string) => {
			update((state) => ({ ...state, path, error: null }));
		},
		hydratePath: (path: string | null) => {
			update((state) => ({ ...state, path, error: null }));
		},
		setCurrentSubWorkspace: (subWorkspace: string | null) => {
			update((state) => ({ ...state, currentSubWorkspace: subWorkspace }));
		},
		setSubWorkspaces: (subWorkspaces: string[]) =>
			update((state) => ({ ...state, subWorkspaces, error: null })),
		setTreeStructure: (treeStructure: TreeNode[]) => {
			// Recursive function to apply cached linkage to all nodes
			const applyCachedLinkageRecursive = (nodes: TreeNode[]): TreeNode[] => {
				return nodes.map((node) => {
					const cachedLinkage = linkageCacheService.getLinkage(node.path);

					let enrichedNode = { ...node };

					if (cachedLinkage) {
						enrichedNode = {
							...enrichedNode,
							linkedSimFileId: String(cachedLinkage.linkedSimFileId), // Ensure it's a string
							linkedSimFile: cachedLinkage.cloudSongData
						};
					}

					// Recursively apply to children
					if (node.children.length > 0) {
						enrichedNode.children = applyCachedLinkageRecursive(node.children);
					}

					return enrichedNode;
				});
			};

			// Load cached linkage data and apply to tree nodes recursively
			const enrichedTreeStructure = applyCachedLinkageRecursive(treeStructure);

			update((state) => {
				return { ...state, treeStructure: enrichedTreeStructure, error: null };
			});
		},
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
			// Also clear linkage cache when workspace is cleared
			linkageCacheService.clearCache();
			update((state) => ({
				...state,
				path: null,
				currentSubWorkspace: null,
				subWorkspaces: [],
				treeStructure: [],
				error: null,
				selectedSong: null,
				selectedCloudSimFile: null,
				showCloudSongDetails: false,
				showNewSong: false
			}));
		},
		selectSong: (song: TreeNode) => {
			update((state) => ({
				...state,
				selectedSong: song,
				showNewSong: false,
				// Local and cloud selections are mutually exclusive.
				selectedCloudSimFile: null,
				showCloudSongDetails: false
			}));
		},
		selectCloudSimFile: (simFile: SimfileWithDtx) => {
			update((state) => ({
				...state,
				selectedCloudSimFile: simFile,
				showCloudSongDetails: true,
				// Local and cloud selections are mutually exclusive.
				selectedSong: null,
				showNewSong: false
			}));
		},
		closeCloudSongDetails: () => {
			update((state) => ({
				...state,
				selectedCloudSimFile: null,
				showCloudSongDetails: false
			}));
		},
		closeSongDetails: () => {
			update((state) => ({
				...state,
				selectedSong: null
			}));
		},
		showNewSongForm: () => {
			update((state) => ({
				...state,
				showNewSong: true,
				// AppShell renders Settings/Templates before it checks showNewSong,
				// so the flag alone does nothing there. NewSong creates a local
				// workspace folder, so it always belongs in the library section;
				// switch to it to guarantee the form is actually shown.
				activeSection: 'library',
				selectedSong: null,
				selectedCloudSimFile: null,
				showCloudSongDetails: false
			}));
		},
		closeNewSongForm: () => {
			update((state) => ({
				...state,
				showNewSong: false
			}));
		},
		linkSimFileToFolder: (folderPath: string, simFile: SimfileWithDtx) => {
			// Save to localStorage cache
			linkageCacheService.saveLinkage(folderPath, simFile.id, simFile);

			update((state) => ({
				...state,
				treeStructure: updateTreeNodeRecursive(state.treeStructure, folderPath, {
					linkedSimFileId: String(simFile.id), // Ensure it's a string
					linkedSimFile: simFile
				})
			}));
		},
		unlinkSimFileFromFolder: (folderPath: string) => {
			// Remove from localStorage cache
			linkageCacheService.removeLinkage(folderPath);

			update((state) => ({
				...state,
				treeStructure: updateTreeNodeRecursive(state.treeStructure, folderPath, {
					linkedSimFileId: null,
					linkedSimFile: null
				})
			}));
		},
		setActiveSection: (section: ShellSection) =>
			update((state) => {
				// Re-clicking the already-active section is a no-op: it must not
				// discard an open selection (otherwise the detail pane snaps shut).
				// Transient state only resets on an actual section change.
				if (section === state.activeSection) return state;
				return {
					...state,
					activeSection: section,
					selectedSong: null,
					selectedCloudSimFile: null,
					showCloudSongDetails: false,
					showNewSong: false
				};
			}),
		reset: () => set(initialState)
	};
}

export const workspaceStore = createWorkspaceStore();
