import { workspaceStore, type TreeNode, type WorkspaceState } from '../stores/workspaceStore';
import { simFileStore, type SimFileState } from '../stores/simFileStore';
import { linkingService } from './linkingService';
import { linkageCacheService } from './linkageCacheService';
import type { WorkspaceBookmark } from '../stores/bookmarkStore';
import { desktopHost } from './desktopHost';

let switchInProgress = false;
let workspaceTransitionGeneration = 0;

const beginWorkspaceTransition = (): number => {
	workspaceTransitionGeneration += 1;
	return workspaceTransitionGeneration;
};

const getWorkspaceSnapshot = (): Pick<WorkspaceState, 'path' | 'currentSubWorkspace'> => {
	let snapshot: Pick<WorkspaceState, 'path' | 'currentSubWorkspace'> = {
		path: null,
		currentSubWorkspace: null
	};
	const unsubscribe = workspaceStore.subscribe((state) => {
		snapshot = {
			path: state.path,
			currentSubWorkspace: state.currentSubWorkspace
		};
	});
	unsubscribe();
	return snapshot;
};

const isWorkspaceSnapshotCurrent = (
	snapshot: Pick<WorkspaceState, 'path' | 'currentSubWorkspace'>
): boolean => {
	const current = getWorkspaceSnapshot();
	return (
		current.path === snapshot.path &&
		current.currentSubWorkspace === snapshot.currentSubWorkspace
	);
};

export const workspaceService = {
	/**
	 * Opens a folder selection dialog and sets the selected path as the workspace
	 */
	selectWorkspace: async (): Promise<void> => {
		const transition = beginWorkspaceTransition();
		try {
			workspaceStore.setLoading(true);

			// This dialog establishes the native managed workspace root.
			console.log('Invoking select-workspace-folder dialog');
			const result = await desktopHost.selectWorkspaceFolder();
			console.log('Dialog result:', result);
			if (!workspaceService.isTransitionCurrent(transition)) return;

			if (result.canceled) {
				console.log('Dialog was canceled');
				return;
			}

			const selectedPath = result.filePaths[0];
			console.log('Selected path:', selectedPath);
			workspaceStore.reset();
			workspaceStore.setPath(selectedPath);

			// Load sub-workspaces and tree structure in the selected directory
			await workspaceService.loadSubWorkspaces();
			await workspaceService.loadTreeStructure();
		} catch (error) {
			console.error('Failed to select workspace:', error);
			if (workspaceService.isTransitionCurrent(transition)) {
				workspaceStore.setError('Failed to select workspace directory');
			}
		} finally {
			if (workspaceService.isTransitionCurrent(transition)) {
				workspaceStore.setLoading(false);
			}
		}
	},

	/**
	 * Re-selects a saved workspace bookmark through the native trust-establishing dialog.
	 * A bookmark is only a convenience label; its stored path is never trusted directly.
	 */
	switchToBookmark: async (
		bookmark: WorkspaceBookmark
	): Promise<
		{ ok: true } | { ok: false; error: string; path: string } | { ok: false; error: string }
	> => {
		// The bookmark remains part of the UI contract, but its stored path is never trusted.
		void bookmark;
		// Guard against concurrent switches
		if (switchInProgress) {
			return { ok: false, error: 'A workspace switch is already in progress' };
		}
		switchInProgress = true;
		const transition = beginWorkspaceTransition();

		try {
			try {
				const selection = await desktopHost.selectWorkspaceFolder();
				if (!workspaceService.isTransitionCurrent(transition)) {
					return { ok: false, error: 'Workspace selection was superseded' };
				}
				if (selection.canceled || !selection.filePaths[0]) {
					return { ok: false, error: 'Workspace selection was canceled' };
				}

				const selectedPath = selection.filePaths[0];
				workspaceStore.reset();
				workspaceStore.setPath(selectedPath);
				await workspaceService.loadSubWorkspaces();
				await workspaceService.loadTreeStructure();
			} catch {
				return {
					ok: false,
					error: 'Failed to select workspace directory'
				};
			}

			// Check if any loader set an error during loading
			let loadError: string | null = null;
			const unsubscribe = workspaceStore.subscribe((s) => {
				loadError = s.error;
			});
			unsubscribe();

			if (loadError) {
				return { ok: false, error: loadError };
			}

			return { ok: true };
		} finally {
			switchInProgress = false;
		}
	},

	/**
	 * Loads the list of sub-workspaces (folders with DTXFiles. prefix) in the current workspace
	 */
	loadSubWorkspaces: async (): Promise<void> => {
		const snapshot = getWorkspaceSnapshot();
		try {
			if (!snapshot.path) {
				if (isWorkspaceSnapshotCurrent(snapshot)) {
					workspaceStore.setSubWorkspaces([]);
				}
				return;
			}

			const folders = await desktopHost.listDirectories(snapshot.path);
			if (!isWorkspaceSnapshotCurrent(snapshot)) return;

			// Filter only sub-workspaces (folders with DTXFiles. prefix)
			const subWorkspaces = folders.filter((folder: string) =>
				folder.startsWith('DTXFiles.')
			);
			workspaceStore.setSubWorkspaces(subWorkspaces);
		} catch (error) {
			console.error('Failed to load sub-workspaces:', error);
			if (isWorkspaceSnapshotCurrent(snapshot)) {
				workspaceStore.setError('Failed to load sub-workspaces');
			}
		}
	},

	/**
	 * Loads the tree structure for the current workspace or sub-workspace
	 * Shows all folders in workspace, or contents of selected sub-workspace
	 */
	loadTreeStructure: async (): Promise<void> => {
		const snapshot = getWorkspaceSnapshot();
		try {
			if (!snapshot.path) {
				if (isWorkspaceSnapshotCurrent(snapshot)) {
					workspaceStore.setTreeStructure([]);
				}
				return;
			}

			if (snapshot.currentSubWorkspace) {
				// If a sub-workspace is selected, show its contents
				const treeData = await desktopHost.loadTreeStructure<TreeNode[]>(
					snapshot.path,
					snapshot.currentSubWorkspace
				);
				if (!isWorkspaceSnapshotCurrent(snapshot)) return;
				workspaceStore.setTreeStructure(treeData);

				// Trigger auto-linking after tree structure is loaded
				workspaceService.triggerAutoLinking();
			} else {
				// If no sub-workspace is selected, show all folders in the workspace
				const treeData = await desktopHost.loadTreeStructure<TreeNode[]>(snapshot.path);
				if (!isWorkspaceSnapshotCurrent(snapshot)) return;
				workspaceStore.setTreeStructure(treeData);

				// Trigger auto-linking after tree structure is loaded
				workspaceService.triggerAutoLinking();
			}
		} catch (error) {
			console.error('Failed to load tree structure:', error);
			if (isWorkspaceSnapshotCurrent(snapshot)) {
				workspaceStore.setError('Failed to load tree structure');
			}
		}
	},

	/**
	 * Triggers automatic linking between remote simFiles and local folders
	 */
	triggerAutoLinking: (): void => {
		// Get current simFile state
		let currentSimFileState: SimFileState | null = null;
		const unsubscribeSimFile = simFileStore.subscribe((state) => {
			currentSimFileState = state;
		});
		unsubscribeSimFile();

		// Get current workspace state
		let currentWorkspaceState: WorkspaceState | null = null;
		const unsubscribeWorkspace = workspaceStore.subscribe((state) => {
			currentWorkspaceState = state;
		});
		unsubscribeWorkspace();

		// Only proceed if we have both remote simFiles and local tree structure
		if (
			currentSimFileState?.userSimFiles?.length > 0 &&
			currentWorkspaceState?.treeStructure?.length > 0
		) {
			console.log('Triggering automatic linking from workspace service...');
			linkingService.autoLinkSimFilesToFolders(
				currentSimFileState.userSimFiles,
				currentWorkspaceState.treeStructure
			);
		} else {
			console.log('Skipping auto-linking from workspace service: insufficient data', {
				remoteSimFiles: currentSimFileState?.userSimFiles?.length || 0,
				localFolders: currentWorkspaceState?.treeStructure?.length || 0
			});
		}
	},

	/**
	 * Triggers automatic linking for a specific set of newly loaded nodes
	 * @param newNodes Array of newly loaded TreeNodes
	 */
	triggerAutoLinkingForNewNodes: (newNodes: TreeNode[]): void => {
		// Get current simFile state
		let currentSimFileState: SimFileState | null = null;
		const unsubscribeSimFile = simFileStore.subscribe((state) => {
			currentSimFileState = state;
		});
		unsubscribeSimFile();

		// Only proceed if we have remote simFiles and new nodes
		if (currentSimFileState?.userSimFiles?.length > 0 && newNodes?.length > 0) {
			console.log('Triggering automatic linking for newly loaded nodes...');
			linkingService.linkSimFilesToNewNodes(currentSimFileState.userSimFiles, newNodes);
		} else {
			console.log('Skipping auto-linking for new nodes: insufficient data', {
				remoteSimFiles: currentSimFileState?.userSimFiles?.length || 0,
				newNodes: newNodes?.length || 0
			});
		}
	},

	/**
	 * Expands a tree node and loads its children
	 */
	expandTreeNode: async (nodePath: string): Promise<void> => {
		try {
			// Get current node state to check if children are already loaded
			let currentNode: TreeNode | null = null;
			const unsubscribe = workspaceStore.subscribe((state) => {
				const findNode = (nodes: TreeNode[], path: string): TreeNode | null => {
					for (const node of nodes) {
						if (node.path === path) return node;
						const found = findNode(node.children, path);
						if (found) return found;
					}
					return null;
				};
				currentNode = findNode(state.treeStructure, nodePath);
			});
			unsubscribe();

			if (!currentNode) return;

			// If children are already loaded, just expand
			if (currentNode.children.length > 0) {
				workspaceStore.updateTreeNode(nodePath, { isExpanded: true });
				return;
			}

			// Set loading state for the node
			workspaceStore.updateTreeNode(nodePath, { isLoading: true });

			const children = await desktopHost.loadTreeStructure<TreeNode[]>(nodePath);

			// Apply cached linkage to newly loaded children
			const enrichedChildren = children.map((child: TreeNode) => {
				const cachedLinkage = linkageCacheService.getLinkage(child.path);
				if (cachedLinkage) {
					return {
						...child,
						linkedSimFileId: String(cachedLinkage.linkedSimFileId),
						linkedSimFile: cachedLinkage.cloudSongData
					};
				}
				return child;
			});

			// Update the node with enriched children and expanded state
			workspaceStore.updateTreeNode(nodePath, {
				isExpanded: true,
				isLoading: false,
				children: enrichedChildren,
				hasChildren: enrichedChildren.length > 0
			});

			// Trigger auto-linking for newly loaded children (more efficient than full tree scan)
			workspaceService.triggerAutoLinkingForNewNodes(enrichedChildren);
		} catch (error) {
			console.error('Failed to expand tree node:', error);
			workspaceStore.updateTreeNode(nodePath, { isLoading: false });
		}
	},

	/**
	 * Collapses a tree node
	 */
	collapseTreeNode: (nodePath: string): void => {
		workspaceStore.updateTreeNode(nodePath, { isExpanded: false });
	},

	/**
	 * Sets the current sub-workspace
	 */
	setCurrentSubWorkspace: async (subWorkspace: string | null): Promise<void> => {
		beginWorkspaceTransition();
		workspaceStore.setCurrentSubWorkspace(subWorkspace);
		await workspaceService.loadTreeStructure();
		// Note: loadTreeStructure already triggers auto-linking, so no need to call it again here
	},

	/**
	 * Clears the current workspace selection
	 */
	clearWorkspace: async (): Promise<void> => {
		const transition = beginWorkspaceTransition();
		try {
			await desktopHost.clearWorkspaceRoot();
			if (workspaceService.isTransitionCurrent(transition)) {
				workspaceStore.clearWorkspace();
			}
		} catch (error) {
			console.error('Failed to clear workspace:', error);
			if (workspaceService.isTransitionCurrent(transition)) {
				workspaceStore.setError('Failed to clear workspace directory');
			}
		}
	},

	/**
	 * Selects a song and shows song details
	 */
	selectSong: (song: TreeNode): void => {
		workspaceStore.selectSong(song);
	},

	/**
	 * Closes song details and returns to workspace view
	 */
	closeSongDetails: (): void => {
		workspaceStore.closeSongDetails();
	},

	getTransitionGeneration: (): number => workspaceTransitionGeneration,

	isTransitionCurrent: (transition: number): boolean =>
		transition === workspaceTransitionGeneration
};
