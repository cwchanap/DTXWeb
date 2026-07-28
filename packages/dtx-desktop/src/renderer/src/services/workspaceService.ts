import { workspaceStore, type TreeNode, type WorkspaceState } from '../stores/workspaceStore';
import { simFileStore, type SimFileState } from '../stores/simFileStore';
import { linkingService } from './linkingService';
import { linkageCacheService } from './linkageCacheService';
import type { WorkspaceBookmark } from '../stores/bookmarkStore';
import { desktopHost } from './desktopHost';
import { get } from 'svelte/store';

let switchOwner: number | null = null;
let nextSwitchOwner = 0;
let workspaceTransitionGeneration = 0;
let operationLifecycle = 0;
let trustTransitionQueue: Promise<void> = Promise.resolve();
let loadingOwner: number | null = null;
let subWorkspaceRequest = 0;
let treeRequest = 0;
let nextExpansionRequest = 0n;
const expandRequests = new Map<string, bigint>();

const invalidateExpansionRequests = (): void => {
	const pendingNodes = [...expandRequests.keys()];
	expandRequests.clear();
	for (const nodePath of pendingNodes) {
		workspaceStore.updateTreeNode(nodePath, { isLoading: false });
	}
};

const beginWorkspaceTransition = (): number => {
	workspaceTransitionGeneration += 1;
	subWorkspaceRequest += 1;
	treeRequest += 1;
	invalidateExpansionRequests();
	return workspaceTransitionGeneration;
};

const beginLoading = (generation: number): void => {
	if (generation !== workspaceTransitionGeneration) return;
	loadingOwner = generation;
	workspaceStore.setLoading(true);
};

const restoreLoading = (generation: number): void => {
	if (loadingOwner === generation && generation === workspaceTransitionGeneration) {
		workspaceStore.setLoading(true);
	}
};

const finishLoading = (generation: number): void => {
	if (loadingOwner !== generation) return;
	loadingOwner = null;
	if (generation === workspaceTransitionGeneration) {
		workspaceStore.setLoading(false);
	}
};

const queueTransition = <T>(
	operation: (generation: number) => Promise<T>,
	onDiscarded: () => T,
	startLoading: boolean
): Promise<T> => {
	const lifecycle = operationLifecycle;
	const run = (): T | Promise<T> => {
		if (lifecycle !== operationLifecycle) return onDiscarded();
		const generation = beginWorkspaceTransition();
		if (startLoading) beginLoading(generation);
		return operation(generation);
	};
	const queued = trustTransitionQueue.then(run, run);
	trustTransitionQueue = queued.then(
		() => undefined,
		() => undefined
	);
	return queued;
};

const queueTrustTransition = <T>(
	operation: (generation: number) => Promise<T>,
	onDiscarded: () => T
): Promise<T> => queueTransition(operation, onDiscarded, true);

const queueViewTransition = <T>(
	operation: (generation: number) => Promise<T>,
	onDiscarded: () => T
): Promise<T> => queueTransition(operation, onDiscarded, false);

const getWorkspaceSnapshot = (): Pick<WorkspaceState, 'path' | 'currentSubWorkspace'> => {
	const state = get(workspaceStore);
	return {
		path: state.path,
		currentSubWorkspace: state.currentSubWorkspace
	};
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

const queueAuthoritativeWorkspaceReconciliation = (): void => {
	void queueTrustTransition(
		async (transition) => {
			try {
				const authoritativeRoot = await desktopHost.getWorkspaceRoot();
				if (!workspaceService.isTransitionCurrent(transition)) return;

				workspaceStore.reset();
				restoreLoading(transition);
				if (!authoritativeRoot) {
					workspaceStore.clearWorkspace();
					return;
				}

				workspaceStore.setPath(authoritativeRoot);
				await workspaceService.loadSubWorkspaces();
				if (!workspaceService.isTransitionCurrent(transition)) return;
				await workspaceService.loadTreeStructure();
			} catch (error) {
				console.error('Failed to reconcile authoritative workspace:', error);
				if (workspaceService.isTransitionCurrent(transition)) {
					workspaceStore.setError('Failed to load workspace directory');
				}
			} finally {
				finishLoading(transition);
			}
		},
		() => undefined
	);
};

export const workspaceService = {
	/**
	 * Opens a folder selection dialog and sets the selected path as the workspace
	 */
	selectWorkspace: (): Promise<void> =>
		queueTrustTransition(
			async (transition) => {
				let nativeMutationCommitted = false;
				try {
					// This dialog establishes the native managed workspace root.
					const result = await desktopHost.selectWorkspaceFolder();
					nativeMutationCommitted = !result.canceled && Boolean(result.filePaths[0]);
					if (!workspaceService.isTransitionCurrent(transition)) return;

					if (result.canceled) {
						return;
					}

					const selectedPath = result.filePaths[0];
					workspaceStore.reset();
					restoreLoading(transition);
					workspaceStore.setPath(selectedPath);

					// Load sub-workspaces and tree structure in the selected directory
					await workspaceService.loadSubWorkspaces();
					if (!workspaceService.isTransitionCurrent(transition)) return;
					await workspaceService.loadTreeStructure();
				} catch (error) {
					console.error('Failed to select workspace:', error);
					if (workspaceService.isTransitionCurrent(transition)) {
						workspaceStore.setError('Failed to select workspace directory');
					}
				} finally {
					if (
						nativeMutationCommitted &&
						!workspaceService.isTransitionCurrent(transition)
					) {
						queueAuthoritativeWorkspaceReconciliation();
					}
					finishLoading(transition);
				}
			},
			() => undefined
		),

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
		if (switchOwner !== null) {
			return { ok: false, error: 'A workspace switch is already in progress' };
		}
		const owner = ++nextSwitchOwner;
		switchOwner = owner;
		const releaseSwitch = () => {
			if (switchOwner !== owner) return;
			switchOwner = null;
		};
		return queueTrustTransition(
			async (transition) => {
				let nativeMutationCommitted = false;
				try {
					try {
						const selection = await desktopHost.selectWorkspaceFolder();
						nativeMutationCommitted =
							!selection.canceled && Boolean(selection.filePaths[0]);
						if (!workspaceService.isTransitionCurrent(transition)) {
							return { ok: false, error: 'Workspace selection was superseded' };
						}
						if (selection.canceled || !selection.filePaths[0]) {
							return { ok: false, error: 'Workspace selection was canceled' };
						}

						const selectedPath = selection.filePaths[0];
						workspaceStore.reset();
						restoreLoading(transition);
						workspaceStore.setPath(selectedPath);
						await workspaceService.loadSubWorkspaces();
						if (!workspaceService.isTransitionCurrent(transition)) {
							return { ok: false, error: 'Workspace selection was superseded' };
						}
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
					if (
						nativeMutationCommitted &&
						!workspaceService.isTransitionCurrent(transition)
					) {
						queueAuthoritativeWorkspaceReconciliation();
					}
					finishLoading(transition);
					releaseSwitch();
				}
			},
			() => {
				releaseSwitch();
				return { ok: false, error: 'Workspace selection was superseded' };
			}
		);
	},

	/**
	 * Loads the list of sub-workspaces (folders with DTXFiles. prefix) in the current workspace
	 */
	loadSubWorkspaces: async (): Promise<void> => {
		const transition = workspaceTransitionGeneration;
		const request = ++subWorkspaceRequest;
		const snapshot = getWorkspaceSnapshot();
		try {
			if (!snapshot.path) {
				if (
					workspaceService.isTransitionCurrent(transition) &&
					request === subWorkspaceRequest &&
					isWorkspaceSnapshotCurrent(snapshot)
				) {
					workspaceStore.setSubWorkspaces([]);
				}
				return;
			}

			const folders = await desktopHost.listDirectories(snapshot.path);
			if (
				!workspaceService.isTransitionCurrent(transition) ||
				request !== subWorkspaceRequest ||
				!isWorkspaceSnapshotCurrent(snapshot)
			)
				return;

			// Filter only sub-workspaces (folders with DTXFiles. prefix)
			const subWorkspaces = folders.filter((folder: string) =>
				folder.startsWith('DTXFiles.')
			);
			workspaceStore.setSubWorkspaces(subWorkspaces);
		} catch (error) {
			console.error('Failed to load sub-workspaces:', error);
			if (
				workspaceService.isTransitionCurrent(transition) &&
				request === subWorkspaceRequest &&
				isWorkspaceSnapshotCurrent(snapshot)
			) {
				workspaceStore.setError('Failed to load sub-workspaces');
			}
		}
	},

	/**
	 * Loads the tree structure for the current workspace or sub-workspace
	 * Shows all folders in workspace, or contents of selected sub-workspace
	 */
	loadTreeStructure: async (isCallerCurrent: () => boolean = () => true): Promise<void> => {
		const transition = workspaceTransitionGeneration;
		const request = ++treeRequest;
		invalidateExpansionRequests();
		const snapshot = getWorkspaceSnapshot();
		const canCommit = () =>
			isCallerCurrent() &&
			workspaceService.isTransitionCurrent(transition) &&
			request === treeRequest &&
			isWorkspaceSnapshotCurrent(snapshot);
		try {
			if (!snapshot.path) {
				if (canCommit()) {
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
				if (!canCommit()) return;
				workspaceStore.setTreeStructure(treeData);

				// Trigger auto-linking after tree structure is loaded
				workspaceService.triggerAutoLinking();
			} else {
				// If no sub-workspace is selected, show all folders in the workspace
				const treeData = await desktopHost.loadTreeStructure<TreeNode[]>(snapshot.path);
				if (!canCommit()) return;
				workspaceStore.setTreeStructure(treeData);

				// Trigger auto-linking after tree structure is loaded
				workspaceService.triggerAutoLinking();
			}
		} catch (error) {
			console.error('Failed to load tree structure:', error);
			if (canCommit()) {
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
		const transition = workspaceTransitionGeneration;
		const request = ++nextExpansionRequest;
		const snapshot = getWorkspaceSnapshot();
		expandRequests.set(nodePath, request);
		const canCommit = () =>
			workspaceService.isTransitionCurrent(transition) &&
			expandRequests.get(nodePath) === request &&
			isWorkspaceSnapshotCurrent(snapshot);
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

			if (!currentNode || !canCommit()) return;

			// If children are already loaded, just expand
			if (currentNode.children.length > 0) {
				workspaceStore.updateTreeNode(nodePath, { isExpanded: true });
				if (expandRequests.get(nodePath) === request) {
					expandRequests.delete(nodePath);
				}
				return;
			}

			// Set loading state for the node
			workspaceStore.updateTreeNode(nodePath, { isLoading: true });

			const children = await desktopHost.loadTreeStructure<TreeNode[]>(nodePath);
			if (!canCommit()) return;

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

			if (expandRequests.get(nodePath) === request) {
				expandRequests.delete(nodePath);
			}

			// Trigger auto-linking for newly loaded children (more efficient than full tree scan)
			workspaceService.triggerAutoLinkingForNewNodes(enrichedChildren);
		} catch (error) {
			console.error('Failed to expand tree node:', error);
			if (canCommit()) {
				workspaceStore.updateTreeNode(nodePath, { isLoading: false });
			}
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
		await queueViewTransition(
			async () => {
				workspaceStore.setCurrentSubWorkspace(subWorkspace);
				await workspaceService.loadTreeStructure();
				// Note: loadTreeStructure already triggers auto-linking, so no need to call it again here
			},
			() => undefined
		);
	},

	/**
	 * Clears the current workspace selection
	 */
	clearWorkspace: (): Promise<void> =>
		queueTrustTransition(
			async (transition) => {
				let nativeMutationCommitted = false;
				try {
					await desktopHost.clearWorkspaceRoot();
					nativeMutationCommitted = true;
					if (workspaceService.isTransitionCurrent(transition)) {
						workspaceStore.clearWorkspace();
					}
				} catch (error) {
					console.error('Failed to clear workspace:', error);
					if (workspaceService.isTransitionCurrent(transition)) {
						workspaceStore.setError('Failed to clear workspace directory');
					}
				} finally {
					if (
						nativeMutationCommitted &&
						!workspaceService.isTransitionCurrent(transition)
					) {
						queueAuthoritativeWorkspaceReconciliation();
					}
					finishLoading(transition);
				}
			},
			() => undefined
		),

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
		transition === workspaceTransitionGeneration,

	disposeOperations: (): void => {
		operationLifecycle += 1;
		beginWorkspaceTransition();
		loadingOwner = null;
		switchOwner = null;
		workspaceStore.setLoading(false);
	}
};
