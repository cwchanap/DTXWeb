import { workspaceStore, type TreeNode, type WorkspaceState } from '../stores/workspaceStore';
import { simFileStore, type SimFileState } from '../stores/simFileStore';
import { linkingService } from './linkingService';
import { linkageCacheService } from './linkageCacheService';
import type { WorkspaceBookmark } from '../stores/bookmarkStore';

export const workspaceService = {
	/**
	 * Opens a folder selection dialog and sets the selected path as the workspace
	 */
	selectWorkspace: async (): Promise<void> => {
		try {
			workspaceStore.setLoading(true);

			// Use Electron's ipcRenderer to open folder selection dialog
			console.log('Invoking select-folder dialog');
			const result = await window.electron.ipcRenderer.invoke('select-folder');
			console.log('Dialog result:', result);

			if (result.canceled) {
				console.log('Dialog was canceled');
				return;
			}

			const selectedPath = result.filePaths[0];
			console.log('Selected path:', selectedPath);
			workspaceStore.setPath(selectedPath);

			// Load sub-workspaces and tree structure in the selected directory
			await workspaceService.loadSubWorkspaces();
			await workspaceService.loadTreeStructure();
		} catch (error) {
			console.error('Failed to select workspace:', error);
			workspaceStore.setError('Failed to select workspace directory');
		} finally {
			workspaceStore.setLoading(false);
		}
	},

	/**
	 * Switches to a saved workspace bookmark: resets workspace state, sets the new path,
	 * and reloads sub-workspaces and tree.
	 */
	switchToBookmark: async (
		bookmark: WorkspaceBookmark
	): Promise<{ ok: true } | { ok: false; error: string; path: string }> => {
		// Validate the bookmark path still exists before resetting workspace state
		const pathExists = await window.electron.ipcRenderer.invoke('path-exists', bookmark.path);
		if (!pathExists) {
			return {
				ok: false,
				error: `Workspace path no longer exists: ${bookmark.path}. It may have been moved or deleted.`,
				path: bookmark.path
			};
		}

		workspaceStore.reset();
		workspaceStore.setPath(bookmark.path);
		await workspaceService.loadSubWorkspaces();
		await workspaceService.loadTreeStructure();
		return { ok: true };
	},

	/**
	 * Loads the list of sub-workspaces (folders with DTXFiles. prefix) in the current workspace
	 */
	loadSubWorkspaces: async (): Promise<void> => {
		try {
			// Get the current path from the store
			let currentPath: string | null = null;
			const unsubscribe = workspaceStore.subscribe((state) => {
				currentPath = state.path;
			});
			unsubscribe();

			if (!currentPath) {
				workspaceStore.setSubWorkspaces([]);
				return;
			}

			// Use Electron's ipcRenderer to get folders in the workspace
			const folders = await window.electron.ipcRenderer.invoke(
				'list-directories',
				currentPath
			);

			// Filter only sub-workspaces (folders with DTXFiles. prefix)
			const subWorkspaces = folders.filter((folder: string) =>
				folder.startsWith('DTXFiles.')
			);
			workspaceStore.setSubWorkspaces(subWorkspaces);
		} catch (error) {
			console.error('Failed to load sub-workspaces:', error);
			workspaceStore.setError('Failed to load sub-workspaces');
		}
	},

	/**
	 * Loads the tree structure for the current workspace or sub-workspace
	 * Shows all folders in workspace, or contents of selected sub-workspace
	 */
	loadTreeStructure: async (): Promise<void> => {
		try {
			// Get the current path from the store
			let currentPath: string | null = null;
			let currentSubWorkspace: string | null = null;
			const unsubscribe = workspaceStore.subscribe((state) => {
				currentPath = state.path;
				currentSubWorkspace = state.currentSubWorkspace;
			});
			unsubscribe();

			if (!currentPath) {
				workspaceStore.setTreeStructure([]);
				return;
			}

			if (currentSubWorkspace) {
				// If a sub-workspace is selected, show its contents
				const treeData = await window.electron.ipcRenderer.invoke(
					'load-tree-structure',
					currentPath,
					currentSubWorkspace
				);
				workspaceStore.setTreeStructure(treeData);

				// Trigger auto-linking after tree structure is loaded
				workspaceService.triggerAutoLinking();
			} else {
				// If no sub-workspace is selected, show all folders in the workspace
				const treeData = await window.electron.ipcRenderer.invoke(
					'load-tree-structure',
					currentPath
				);
				workspaceStore.setTreeStructure(treeData);

				// Trigger auto-linking after tree structure is loaded
				workspaceService.triggerAutoLinking();
			}
		} catch (error) {
			console.error('Failed to load tree structure:', error);
			workspaceStore.setError('Failed to load tree structure');
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

			const children = await window.electron.ipcRenderer.invoke(
				'load-tree-structure',
				nodePath
			);

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
		workspaceStore.setCurrentSubWorkspace(subWorkspace);
		await workspaceService.loadTreeStructure();
		// Note: loadTreeStructure already triggers auto-linking, so no need to call it again here
	},

	/**
	 * Clears the current workspace selection
	 */
	clearWorkspace: (): void => {
		workspaceStore.clearWorkspace();
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
	}
};
