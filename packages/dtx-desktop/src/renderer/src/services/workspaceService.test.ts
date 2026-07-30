import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workspaceService } from './workspaceService';
import { workspaceStore } from '../stores/workspaceStore';
import { simFileStore } from '../stores/simFileStore';
import { linkingService } from './linkingService';
import { linkageCacheService } from './linkageCacheService';
import { desktopHost } from './desktopHost';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		selectFolder: vi.fn(),
		selectWorkspaceFolder: vi.fn(),
		switchTrustedWorkspace: vi.fn(),
		getCurrentWorkspaceRootId: vi.fn(),
		clearWorkspaceRoot: vi.fn(),
		getWorkspaceRoot: vi.fn(),
		pathExists: vi.fn(),
		listDirectories: vi.fn(),
		loadTreeStructure: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve };
};

const createRejectableDeferred = <T>() => {
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((_resolve, promiseReject) => {
		reject = promiseReject;
	});

	return { promise, reject };
};

const flushPromises = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

// Mock the workspaceStore
vi.mock('../stores/workspaceStore', () => ({
	workspaceStore: {
		subscribe: vi.fn(),
		setLoading: vi.fn(),
		setPath: vi.fn(),
		setSubWorkspaces: vi.fn(),
		setTreeStructure: vi.fn(),
		setError: vi.fn(),
		updateTreeNode: vi.fn(),
		setCurrentSubWorkspace: vi.fn(),
		selectSong: vi.fn(),
		closeSongDetails: vi.fn(),
		clearWorkspace: vi.fn(),
		hydratePath: vi.fn(),
		hydrateRootId: vi.fn(),
		reset: vi.fn()
	}
}));

vi.mock('../stores/simFileStore', () => ({
	simFileStore: {
		subscribe: vi.fn()
	}
}));

vi.mock('./linkingService', () => ({
	linkingService: {
		autoLinkSimFilesToFolders: vi.fn(),
		linkSimFilesToNewNodes: vi.fn()
	}
}));

vi.mock('./linkageCacheService', () => ({
	linkageCacheService: {
		getLinkage: vi.fn()
	}
}));

describe('WorkspaceService', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		host.listDirectories.mockResolvedValue([]);
		host.getCurrentWorkspaceRootId.mockResolvedValue(null);
		// Mock tree structure with song title
		host.loadTreeStructure.mockResolvedValue([
			{
				name: 'TestSong',
				path: '/test/path/TestSong',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Test Song Title'
			},
			{
				name: 'AnotherSong',
				path: '/test/path/AnotherSong',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: null // No SET.def file
			}
		]);
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('loadTreeStructure', () => {
		it('should load tree structure with song titles parsed by SimFile class', async () => {
			// Mock the store subscription to return a test path
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({
					path: '/test/workspace',
					currentSubWorkspace: null,
					subWorkspaces: []
				});
				return vi.fn(); // unsubscribe function
			});

			await workspaceService.loadTreeStructure();

			// Verify that the host call was made
			expect(host.loadTreeStructure).toHaveBeenCalledWith('/test/workspace');

			// Verify that setTreeStructure was called with the mocked data
			expect(workspaceStore.setTreeStructure).toHaveBeenCalledWith([
				{
					name: 'TestSong',
					path: '/test/path/TestSong',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: 'Test Song Title'
				},
				{
					name: 'AnotherSong',
					path: '/test/path/AnotherSong',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: null
				}
			]);
		});

		it('should handle sub-workspace path correctly', async () => {
			// Mock the store subscription to return a sub-workspace
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({
					path: '/test/workspace',
					currentSubWorkspace: 'DTXFiles.TestSubWorkspace',
					subWorkspaces: ['DTXFiles.TestSubWorkspace']
				});
				return vi.fn(); // unsubscribe function
			});

			await workspaceService.loadTreeStructure();

			// Verify that the host call was made with the sub-workspace path
			expect(host.loadTreeStructure).toHaveBeenCalledWith(
				'/test/workspace',
				'DTXFiles.TestSubWorkspace'
			);
		});

		it('should set empty tree when no path is set', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: null, currentSubWorkspace: null });
				return vi.fn();
			});

			await workspaceService.loadTreeStructure();

			expect(workspaceStore.setTreeStructure).toHaveBeenCalledWith([]);
		});

		it('should handle errors gracefully', async () => {
			// Mock the store subscription to return a test path
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({
					path: '/test/workspace',
					currentSubWorkspace: null,
					subWorkspaces: []
				});
				return vi.fn(); // unsubscribe function
			});

			// Mock host to throw an error
			host.loadTreeStructure.mockRejectedValue(new Error('Test error'));

			await workspaceService.loadTreeStructure();

			// Verify that setError was called
			expect(workspaceStore.setError).toHaveBeenCalledWith('Failed to load tree structure');
		});

		it('does not apply an older sub-workspace tree after the current sub-workspace changes', async () => {
			const oldTree = createDeferred<any[]>();
			let state = {
				path: '/test/workspace',
				currentSubWorkspace: 'DTXFiles.Old',
				subWorkspaces: ['DTXFiles.Old', 'DTXFiles.New']
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback(state);
				return vi.fn();
			});
			host.loadTreeStructure.mockImplementation((_path, subWorkspace) => {
				if (subWorkspace === 'DTXFiles.Old') return oldTree.promise;
				return Promise.resolve([{ name: 'new', path: '/new', children: [] }]);
			});

			const oldRequest = workspaceService.loadTreeStructure();
			state = { ...state, currentSubWorkspace: 'DTXFiles.New' };
			await workspaceService.loadTreeStructure();
			oldTree.resolve([{ name: 'old', path: '/old', children: [] }]);
			await oldRequest;

			expect(workspaceStore.setTreeStructure).toHaveBeenCalledTimes(1);
			expect(workspaceStore.setTreeStructure).toHaveBeenCalledWith([
				{ name: 'new', path: '/new', children: [] }
			]);
		});

		it('disposes a pending tree request before its late response can mutate the store', async () => {
			const tree = createDeferred<any[]>();
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/test/workspace', currentSubWorkspace: null });
				return vi.fn();
			});
			host.loadTreeStructure.mockReturnValue(tree.promise);

			const request = workspaceService.loadTreeStructure();
			workspaceService.disposeOperations();
			tree.resolve([{ name: 'late', path: '/late', children: [] }]);
			await request;

			expect(workspaceStore.setTreeStructure).not.toHaveBeenCalled();
		});

		it('invalidates an in-flight expansion before applying a refreshed whole tree', async () => {
			const expansion = createDeferred<any[]>();
			const node = {
				path: '/workspace/song',
				children: [],
				isExpanded: false,
				isLoading: false
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/workspace', currentSubWorkspace: null, treeStructure: [node] });
				return vi.fn();
			});
			host.loadTreeStructure
				.mockReturnValueOnce(expansion.promise)
				.mockResolvedValueOnce([
					{ name: 'fresh', path: '/workspace/song', children: [], isExpanded: false }
				]);

			const expand = workspaceService.expandTreeNode('/workspace/song');
			await workspaceService.loadTreeStructure();
			expansion.resolve([{ name: 'stale', path: '/workspace/song/stale', children: [] }]);
			await expand;

			expect(workspaceStore.setTreeStructure).toHaveBeenCalledWith([
				{ name: 'fresh', path: '/workspace/song', children: [], isExpanded: false }
			]);
			const staleUpdates = (workspaceStore.updateTreeNode as any).mock.calls.filter(
				(call: any[]) => call[0] === '/workspace/song' && call[1].children
			);
			expect(staleUpdates).toHaveLength(0);
		});

		it('clears expansion loading when a whole-tree refresh fails', async () => {
			const expansion = createDeferred<any[]>();
			const node = {
				path: '/workspace/song',
				children: [],
				isExpanded: false,
				isLoading: false
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/workspace', currentSubWorkspace: null, treeStructure: [node] });
				return vi.fn();
			});
			host.loadTreeStructure
				.mockReturnValueOnce(expansion.promise)
				.mockRejectedValueOnce(new Error('refresh failed'));

			const expand = workspaceService.expandTreeNode('/workspace/song');
			await workspaceService.loadTreeStructure();
			expect(workspaceStore.updateTreeNode).toHaveBeenCalledWith('/workspace/song', {
				isLoading: false
			});

			expansion.resolve([{ name: 'stale', path: '/workspace/song/stale', children: [] }]);
			await expand;
			const staleUpdates = (workspaceStore.updateTreeNode as any).mock.calls.filter(
				(call: any[]) => call[0] === '/workspace/song' && call[1].children
			);
			expect(staleUpdates).toHaveLength(0);
			expect(workspaceStore.setError).toHaveBeenCalledWith('Failed to load tree structure');
		});

		it('does not reuse an expansion token after refresh for the same node path', async () => {
			const firstExpansion = createDeferred<any[]>();
			const secondExpansion = createDeferred<any[]>();
			const node = {
				path: '/workspace/song',
				children: [],
				isExpanded: false,
				isLoading: false
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/workspace', currentSubWorkspace: null, treeStructure: [node] });
				return vi.fn();
			});
			host.loadTreeStructure
				.mockReturnValueOnce(firstExpansion.promise)
				.mockResolvedValueOnce([
					{ name: 'fresh', path: '/workspace/song', children: [], isExpanded: false }
				])
				.mockReturnValueOnce(secondExpansion.promise);

			const first = workspaceService.expandTreeNode('/workspace/song');
			await workspaceService.loadTreeStructure();
			const second = workspaceService.expandTreeNode('/workspace/song');
			firstExpansion.resolve([
				{ name: 'stale', path: '/workspace/song/stale', children: [] }
			]);
			await first;

			const childUpdatesBeforeSecond = (
				workspaceStore.updateTreeNode as any
			).mock.calls.filter((call: any[]) => call[0] === '/workspace/song' && call[1].children);
			expect(childUpdatesBeforeSecond).toHaveLength(0);

			secondExpansion.resolve([
				{ name: 'current', path: '/workspace/song/current', children: [] }
			]);
			await second;
			const childUpdates = (workspaceStore.updateTreeNode as any).mock.calls.filter(
				(call: any[]) => call[0] === '/workspace/song' && call[1].children
			);
			expect(childUpdates).toHaveLength(1);
			expect(childUpdates[0][1].children).toEqual([
				{ name: 'current', path: '/workspace/song/current', children: [] }
			]);
		});
	});
	describe('selectWorkspace', () => {
		it('should select a workspace and update path and loading state when a path is chosen', async () => {
			host.selectWorkspaceFolder.mockResolvedValue({
				canceled: false,
				filePaths: ['/new/workspace']
			});
			host.loadTreeStructure.mockResolvedValue([]);
			host.listDirectories.mockResolvedValue([]);
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/new/workspace', currentSubWorkspace: null });
				return vi.fn();
			});

			await workspaceService.selectWorkspace();

			expect(workspaceStore.setLoading).toHaveBeenCalledWith(true);
			expect(workspaceStore.reset).toHaveBeenCalledOnce();
			expect(workspaceStore.setPath).toHaveBeenCalledWith('/new/workspace');
			expect(workspaceStore.reset.mock.invocationCallOrder[0]).toBeLessThan(
				workspaceStore.setPath.mock.invocationCallOrder[0]
			);
			expect(host.selectFolder).not.toHaveBeenCalled();
			expect(workspaceStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('should return early when dialog is canceled', async () => {
			host.selectWorkspaceFolder.mockResolvedValue({ canceled: true, filePaths: [] });

			await workspaceService.selectWorkspace();

			expect(workspaceStore.setPath).not.toHaveBeenCalled();
			expect(workspaceStore.reset).not.toHaveBeenCalled();
			expect(workspaceStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('keeps the newer workspace selection when an older dialog resolves later', async () => {
			const olderSelection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			const newerSelection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			host.selectWorkspaceFolder
				.mockReturnValueOnce(olderSelection.promise)
				.mockReturnValueOnce(newerSelection.promise);

			const olderRequest = workspaceService.selectWorkspace();
			const newerRequest = workspaceService.selectWorkspace();
			await flushPromises();
			olderSelection.resolve({ canceled: false, filePaths: ['/workspace/older'] });
			await vi.waitFor(() => {
				expect(host.selectWorkspaceFolder).toHaveBeenCalledTimes(2);
			});
			newerSelection.resolve({ canceled: false, filePaths: ['/workspace/newer'] });
			await Promise.all([olderRequest, newerRequest]);

			expect(workspaceStore.reset).toHaveBeenCalledTimes(2);
			expect(workspaceStore.setPath).toHaveBeenLastCalledWith('/workspace/newer');
		});

		it('serializes overlapping native selections so the final native and renderer roots agree', async () => {
			const firstSelection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			const secondSelection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			let nativeRoot: string | null = null;
			let rendererRoot: string | null = null;
			(workspaceStore.setPath as any).mockImplementation((path: string) => {
				rendererRoot = path;
			});
			host.getWorkspaceRoot.mockImplementation(async () => nativeRoot);
			host.selectWorkspaceFolder
				.mockImplementationOnce(async () => {
					const result = await firstSelection.promise;
					nativeRoot = result.filePaths[0] ?? null;
					return result;
				})
				.mockImplementationOnce(async () => {
					const result = await secondSelection.promise;
					nativeRoot = result.filePaths[0] ?? null;
					return result;
				});

			const first = workspaceService.selectWorkspace();
			const second = workspaceService.selectWorkspace();
			await vi.waitFor(() => {
				expect(host.selectWorkspaceFolder).toHaveBeenCalledTimes(1);
			});

			firstSelection.resolve({ canceled: false, filePaths: ['/workspace/first'] });
			await vi.waitFor(() => {
				expect(host.selectWorkspaceFolder).toHaveBeenCalledTimes(2);
			});
			secondSelection.resolve({ canceled: false, filePaths: ['/workspace/second'] });
			await Promise.all([first, second]);

			expect(await host.getWorkspaceRoot()).toBe('/workspace/second');
			expect(rendererRoot).toBe('/workspace/second');
		});

		it('serializes a clear behind a pending selection so it remains the final native state', async () => {
			const selection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			const clear = createDeferred<void>();
			let nativeRoot: string | null = null;
			let rendererRoot: string | null = '/workspace/existing';
			(workspaceStore.clearWorkspace as any).mockImplementation(() => {
				rendererRoot = null;
			});
			host.getWorkspaceRoot.mockImplementation(async () => nativeRoot);
			host.selectWorkspaceFolder.mockImplementation(async () => {
				const result = await selection.promise;
				nativeRoot = result.filePaths[0] ?? null;
				return result;
			});
			host.clearWorkspaceRoot.mockImplementation(async () => {
				await clear.promise;
				nativeRoot = null;
			});

			const select = workspaceService.selectWorkspace();
			const clearRequest = workspaceService.clearWorkspace();
			await flushPromises();
			expect(host.clearWorkspaceRoot).not.toHaveBeenCalled();

			selection.resolve({ canceled: false, filePaths: ['/workspace/selected'] });
			await vi.waitFor(() => {
				expect(host.clearWorkspaceRoot).toHaveBeenCalledOnce();
			});
			clear.resolve();
			await Promise.all([select, clearRequest]);

			expect(await host.getWorkspaceRoot()).toBeNull();
			expect(rendererRoot).toBeNull();
			expect(workspaceStore.setLoading.mock.calls.at(-1)).toEqual([false]);
		});

		it('should handle errors during folder selection', async () => {
			host.selectWorkspaceFolder.mockRejectedValue(new Error('IPC error'));

			await workspaceService.selectWorkspace();

			expect(workspaceStore.setError).toHaveBeenCalledWith(
				'Failed to select workspace directory'
			);
			expect(workspaceStore.setLoading).toHaveBeenCalledWith(false);
		});
	});

	describe('loadSubWorkspaces', () => {
		it('should load and filter sub-workspaces with DTXFiles. prefix', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/test/workspace' });
				return vi.fn();
			});
			host.listDirectories.mockResolvedValue([
				'DTXFiles.Songs',
				'OtherFolder',
				'DTXFiles.More'
			]);

			await workspaceService.loadSubWorkspaces();

			expect(workspaceStore.setSubWorkspaces).toHaveBeenCalledWith([
				'DTXFiles.Songs',
				'DTXFiles.More'
			]);
		});

		it('should set empty sub-workspaces when no path is set', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: null });
				return vi.fn();
			});

			await workspaceService.loadSubWorkspaces();

			expect(workspaceStore.setSubWorkspaces).toHaveBeenCalledWith([]);
			expect(host.listDirectories).not.toHaveBeenCalled();
		});

		it('should handle errors during sub-workspace loading', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/test/workspace' });
				return vi.fn();
			});
			host.listDirectories.mockRejectedValue(new Error('list error'));

			await workspaceService.loadSubWorkspaces();

			expect(workspaceStore.setError).toHaveBeenCalledWith('Failed to load sub-workspaces');
		});

		it('does not apply an older root response after the workspace changes', async () => {
			const oldFolders = createDeferred<string[]>();
			let state = { path: '/workspace/old' };
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback(state);
				return vi.fn();
			});
			host.listDirectories.mockImplementation((path) => {
				if (path === '/workspace/old') return oldFolders.promise;
				return Promise.resolve(['DTXFiles.New']);
			});

			const oldRequest = workspaceService.loadSubWorkspaces();
			state = { path: '/workspace/new' };
			await workspaceService.loadSubWorkspaces();
			oldFolders.resolve(['DTXFiles.Old']);
			await oldRequest;

			expect(workspaceStore.setSubWorkspaces).toHaveBeenCalledTimes(1);
			expect(workspaceStore.setSubWorkspaces).toHaveBeenCalledWith(['DTXFiles.New']);
		});

		it('rejects an older A response after an A-to-B-to-A transition', async () => {
			const oldA = createDeferred<string[]>();
			let state = { path: '/workspace/A', currentSubWorkspace: null };
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback(state);
				return vi.fn();
			});
			host.listDirectories.mockImplementation((path) => {
				if (path === '/workspace/A' && host.listDirectories.mock.calls.length === 1) {
					return oldA.promise;
				}
				return Promise.resolve([`DTXFiles.${path!.split('/').at(-1)}`]);
			});

			const staleA = workspaceService.loadSubWorkspaces();
			state = { path: '/workspace/B', currentSubWorkspace: null };
			await workspaceService.loadSubWorkspaces();
			state = { path: '/workspace/A', currentSubWorkspace: null };
			await workspaceService.loadSubWorkspaces();
			oldA.resolve(['DTXFiles.StaleA']);
			await staleA;

			expect(workspaceStore.setSubWorkspaces).toHaveBeenLastCalledWith(['DTXFiles.A']);
			expect(workspaceStore.setSubWorkspaces).not.toHaveBeenCalledWith(['DTXFiles.StaleA']);
		});

		it('discards a stale loader error after a newer request takes ownership', async () => {
			const oldFolders = createRejectableDeferred<string[]>();
			let state = { path: '/workspace/old', currentSubWorkspace: null };
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback(state);
				return vi.fn();
			});
			host.listDirectories.mockImplementation((path) => {
				if (path === '/workspace/old') return oldFolders.promise;
				return Promise.resolve(['DTXFiles.New']);
			});

			const oldRequest = workspaceService.loadSubWorkspaces();
			state = { path: '/workspace/new', currentSubWorkspace: null };
			await workspaceService.loadSubWorkspaces();
			oldFolders.reject(new Error('stale failure'));
			await oldRequest;

			expect(workspaceStore.setError).not.toHaveBeenCalled();
		});
	});

	describe('triggerAutoLinking', () => {
		it('should call autoLinkSimFilesToFolders when both simFiles and tree exist', () => {
			const mockSimFiles = [{ id: 1, title: 'Song' }] as any;
			const mockTree = [{ name: 'folder', path: '/a', children: [] }] as any;

			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: mockSimFiles });
				return vi.fn();
			});
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: mockTree });
				return vi.fn();
			});

			workspaceService.triggerAutoLinking();

			expect(linkingService.autoLinkSimFilesToFolders).toHaveBeenCalledWith(
				mockSimFiles,
				mockTree
			);
		});

		it('should skip auto-linking when no simFiles', () => {
			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: [] });
				return vi.fn();
			});
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [{ name: 'folder' }] });
				return vi.fn();
			});

			workspaceService.triggerAutoLinking();

			expect(linkingService.autoLinkSimFilesToFolders).not.toHaveBeenCalled();
		});

		it('should skip auto-linking when no tree structure', () => {
			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: [{ id: 1 }] });
				return vi.fn();
			});
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [] });
				return vi.fn();
			});

			workspaceService.triggerAutoLinking();

			expect(linkingService.autoLinkSimFilesToFolders).not.toHaveBeenCalled();
		});
	});

	describe('triggerAutoLinkingForNewNodes', () => {
		it('should call linkSimFilesToNewNodes when simFiles and nodes exist', () => {
			const mockSimFiles = [{ id: 1 }] as any;
			const mockNodes = [{ name: 'node', path: '/n', children: [] }] as any;

			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: mockSimFiles });
				return vi.fn();
			});

			workspaceService.triggerAutoLinkingForNewNodes(mockNodes);

			expect(linkingService.linkSimFilesToNewNodes).toHaveBeenCalledWith(
				mockSimFiles,
				mockNodes
			);
		});

		it('should skip when no simFiles', () => {
			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: [] });
				return vi.fn();
			});

			workspaceService.triggerAutoLinkingForNewNodes([{ name: 'n' } as any]);

			expect(linkingService.linkSimFilesToNewNodes).not.toHaveBeenCalled();
		});

		it('should skip when no new nodes', () => {
			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: [{ id: 1 }] });
				return vi.fn();
			});

			workspaceService.triggerAutoLinkingForNewNodes([]);

			expect(linkingService.linkSimFilesToNewNodes).not.toHaveBeenCalled();
		});
	});

	describe('expandTreeNode', () => {
		it('should just expand if node already has children', async () => {
			const existingNode = {
				path: '/test/node',
				children: [{ name: 'child', path: '/test/node/child', children: [] }],
				isExpanded: false,
				isLoading: false
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [existingNode] });
				return vi.fn();
			});

			await workspaceService.expandTreeNode('/test/node');

			expect(workspaceStore.updateTreeNode).toHaveBeenCalledWith('/test/node', {
				isExpanded: true
			});
			expect(host.loadTreeStructure).not.toHaveBeenCalled();
		});

		it('should load children when node has no children', async () => {
			const existingNode = {
				path: '/test/node',
				children: [],
				isExpanded: false,
				isLoading: false
			};
			const mockChildren = [{ name: 'child', path: '/test/node/child', children: [] }];
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [existingNode] });
				return vi.fn();
			});
			host.loadTreeStructure.mockResolvedValue(mockChildren);
			(linkageCacheService.getLinkage as any).mockReturnValue(null);
			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: [] });
				return vi.fn();
			});

			await workspaceService.expandTreeNode('/test/node');

			expect(workspaceStore.updateTreeNode).toHaveBeenCalledWith('/test/node', {
				isLoading: true
			});
			expect(workspaceStore.updateTreeNode).toHaveBeenCalledWith(
				'/test/node',
				expect.objectContaining({ isExpanded: true, isLoading: false })
			);
		});

		it('should apply cached linkage to children', async () => {
			const existingNode = { path: '/test/node', children: [], isExpanded: false };
			const mockChild = { name: 'child', path: '/test/node/child', children: [] };
			const mockLinkage = {
				linkedSimFileId: '42',
				cloudSongData: { id: 42, title: 'Cached Song' }
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [existingNode] });
				return vi.fn();
			});
			host.loadTreeStructure.mockResolvedValue([mockChild]);
			(linkageCacheService.getLinkage as any).mockReturnValue(mockLinkage);
			(simFileStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ userSimFiles: [] });
				return vi.fn();
			});

			await workspaceService.expandTreeNode('/test/node');

			expect(linkageCacheService.getLinkage).toHaveBeenCalledWith('/test/node/child');
			const updateCall = (workspaceStore.updateTreeNode as any).mock.calls.find(
				(call: any[]) => call[0] === '/test/node' && call[1].children !== undefined
			);
			expect(updateCall[1].children[0]).toMatchObject({
				linkedSimFileId: '42',
				linkedSimFile: mockLinkage.cloudSongData
			});
		});

		it('should return early when node is not found', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [] });
				return vi.fn();
			});

			await workspaceService.expandTreeNode('/nonexistent/node');

			expect(workspaceStore.updateTreeNode).not.toHaveBeenCalled();
		});

		it('should handle errors during node expansion', async () => {
			const existingNode = { path: '/test/node', children: [], isExpanded: false };
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [existingNode] });
				return vi.fn();
			});
			host.loadTreeStructure.mockRejectedValue(new Error('load error'));

			await workspaceService.expandTreeNode('/test/node');

			expect(workspaceStore.updateTreeNode).toHaveBeenCalledWith('/test/node', {
				isLoading: false
			});
		});

		it('only lets the latest duplicate expansion commit its result', async () => {
			const oldChildren = createDeferred<any[]>();
			const node = { path: '/test/node', children: [], isExpanded: false, isLoading: false };
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/workspace', currentSubWorkspace: null, treeStructure: [node] });
				return vi.fn();
			});
			host.loadTreeStructure
				.mockReturnValueOnce(oldChildren.promise)
				.mockResolvedValueOnce([{ name: 'new', path: '/test/node/new', children: [] }]);

			const first = workspaceService.expandTreeNode('/test/node');
			await workspaceService.expandTreeNode('/test/node');
			oldChildren.resolve([{ name: 'old', path: '/test/node/old', children: [] }]);
			await first;

			const childUpdates = (workspaceStore.updateTreeNode as any).mock.calls.filter(
				(call: any[]) => call[0] === '/test/node' && call[1].children
			);
			expect(childUpdates).toHaveLength(1);
			expect(childUpdates[0][1].children).toEqual([
				{ name: 'new', path: '/test/node/new', children: [] }
			]);
		});

		it('disposes a pending expansion without allowing a late result to mutate the tree', async () => {
			const children = createDeferred<any[]>();
			const node = { path: '/test/node', children: [], isExpanded: false, isLoading: false };
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/workspace', currentSubWorkspace: null, treeStructure: [node] });
				return vi.fn();
			});
			host.loadTreeStructure.mockReturnValue(children.promise);

			const request = workspaceService.expandTreeNode('/test/node');
			workspaceService.disposeOperations();
			children.resolve([{ name: 'late', path: '/test/node/late', children: [] }]);
			await request;

			const childUpdates = (workspaceStore.updateTreeNode as any).mock.calls.filter(
				(call: any[]) => call[0] === '/test/node' && call[1].children
			);
			expect(childUpdates).toHaveLength(0);
		});
	});

	describe('expandTreeNode - nested node lookup', () => {
		it('should find and expand a node nested inside a parent node', async () => {
			const nestedNode = {
				path: '/parent/child',
				children: [{ name: 'grandchild', path: '/parent/child/gc', children: [] }],
				isExpanded: false,
				isLoading: false
			};
			const parentNode = {
				path: '/parent',
				children: [nestedNode],
				isExpanded: true,
				isLoading: false
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ treeStructure: [parentNode] });
				return vi.fn();
			});

			await workspaceService.expandTreeNode('/parent/child');

			expect(workspaceStore.updateTreeNode).toHaveBeenCalledWith('/parent/child', {
				isExpanded: true
			});
		});
	});

	describe('selectSong', () => {
		it('should call workspaceStore.selectSong with the provided node', () => {
			const song = { name: 'test', path: '/test', children: [] } as any;
			workspaceService.selectSong(song);
			expect(workspaceStore.selectSong).toHaveBeenCalledWith(song);
		});
	});

	describe('collapseTreeNode', () => {
		it('should collapse a tree node', () => {
			workspaceService.collapseTreeNode('/test/node');

			expect(workspaceStore.updateTreeNode).toHaveBeenCalledWith('/test/node', {
				isExpanded: false
			});
		});
	});

	describe('setCurrentSubWorkspace', () => {
		it('should set sub-workspace', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/test/workspace', currentSubWorkspace: 'DTXFiles.Sub' });
				return vi.fn();
			});

			await workspaceService.setCurrentSubWorkspace('DTXFiles.Sub');

			expect(workspaceStore.setCurrentSubWorkspace).toHaveBeenCalledWith('DTXFiles.Sub');
		});

		it('should accept null to clear sub-workspace', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/test/workspace', currentSubWorkspace: null });
				return vi.fn();
			});

			await workspaceService.setCurrentSubWorkspace(null);

			expect(workspaceStore.setCurrentSubWorkspace).toHaveBeenCalledWith(null);
		});
	});

	describe('clearWorkspace', () => {
		it('clears native managed trust before clearing the renderer display state', async () => {
			host.clearWorkspaceRoot.mockResolvedValue(undefined);

			await workspaceService.clearWorkspace();

			expect(host.clearWorkspaceRoot).toHaveBeenCalledOnce();
			expect(workspaceStore.clearWorkspace).toHaveBeenCalled();
		});
	});

	describe('disposeOperations', () => {
		it('reconciles a remounted renderer after the disposed native selection settles', async () => {
			const selection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			let nativeRoot: string | null = '/workspace/a';
			let rendererState = {
				path: '/workspace/a' as string | null,
				currentSubWorkspace: null,
				subWorkspaces: [],
				treeStructure: []
			};
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback(rendererState);
				return vi.fn();
			});
			(workspaceStore.reset as any).mockImplementation(() => {
				rendererState = {
					...rendererState,
					path: null,
					currentSubWorkspace: null,
					subWorkspaces: [],
					treeStructure: []
				};
			});
			(workspaceStore.hydratePath as any).mockImplementation((path: string | null) => {
				rendererState = { ...rendererState, path };
			});
			(workspaceStore.setPath as any).mockImplementation((path: string) => {
				rendererState = { ...rendererState, path };
			});
			host.getWorkspaceRoot.mockImplementation(async () => nativeRoot);
			host.selectWorkspaceFolder.mockImplementation(async () => {
				const result = await selection.promise;
				nativeRoot = result.filePaths[0] ?? null;
				return result;
			});

			const disposedSelection = workspaceService.selectWorkspace();
			await vi.waitFor(() => {
				expect(host.selectWorkspaceFolder).toHaveBeenCalledOnce();
			});

			workspaceService.disposeOperations();
			workspaceStore.hydratePath('/workspace/a');
			selection.resolve({ canceled: false, filePaths: ['/workspace/b'] });
			await disposedSelection;

			await vi.waitFor(() => {
				expect(host.getWorkspaceRoot).toHaveBeenCalledOnce();
				expect(rendererState.path).toBe('/workspace/b');
			});
			expect(nativeRoot).toBe('/workspace/b');
			expect(workspaceStore.setLoading.mock.calls.at(-1)).toEqual([false]);
		});

		it('clears loading after a pending selection and lets a new selection run', async () => {
			const selection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			host.selectWorkspaceFolder
				.mockReturnValueOnce(selection.promise)
				.mockResolvedValueOnce({ canceled: true, filePaths: [] });

			const pending = workspaceService.selectWorkspace();
			await vi.waitFor(() => {
				expect(host.selectWorkspaceFolder).toHaveBeenCalledOnce();
			});
			workspaceService.disposeOperations();
			expect(workspaceStore.setLoading.mock.calls.at(-1)).toEqual([false]);

			selection.resolve({ canceled: true, filePaths: [] });
			await pending;
			await workspaceService.selectWorkspace();

			expect(host.selectWorkspaceFolder).toHaveBeenCalledTimes(2);
			expect(workspaceStore.setLoading.mock.calls.at(-1)).toEqual([false]);
		});

		it('releases a disposed bookmark switch so a new bookmark switch can run', async () => {
			const selection = createDeferred<{ outcome: 'ok'; path: string }>();
			host.switchTrustedWorkspace
				.mockReturnValueOnce(selection.promise)
				.mockRejectedValueOnce(new Error('not accessible'));

			const pending = workspaceService.switchToBookmark({
				id: 'old-id',
				path: '/old',
				name: 'Old'
			});
			await vi.waitFor(() => {
				expect(host.switchTrustedWorkspace).toHaveBeenCalledOnce();
			});
			workspaceService.disposeOperations();
			const replacement = workspaceService.switchToBookmark({
				id: 'new-id',
				path: '/new',
				name: 'New'
			});
			expect(workspaceStore.setLoading.mock.calls.at(-1)).toEqual([false]);

			// Resolving with a superseded transition keeps nativeMutationCommitted
			// false so the disposed switch doesn't trigger an authoritative
			// reconciliation that would race with the replacement's loading
			// lifecycle.
			selection.resolve({ outcome: 'ok', path: '/old-canonical' });
			await pending;
			const result = await replacement;

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('Could not switch');
			}
			expect(host.switchTrustedWorkspace).toHaveBeenCalledTimes(2);
			expect(workspaceStore.setLoading.mock.calls.at(-1)).toEqual([false]);
		});

		it('keeps a replacement bookmark switch owned when the disposed switch settles', async () => {
			const firstSelection = createDeferred<{ outcome: 'ok'; path: string }>();
			const secondSelection = createDeferred<{ outcome: 'ok'; path: string }>();
			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ path: '/second', currentSubWorkspace: null, subWorkspaces: [], error: null });
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.switchTrustedWorkspace
				.mockReturnValueOnce(firstSelection.promise)
				.mockReturnValueOnce(secondSelection.promise);

			const first = workspaceService.switchToBookmark({
				id: 'first-id',
				path: '/first',
				name: 'First'
			});
			await vi.waitFor(() => {
				expect(host.switchTrustedWorkspace).toHaveBeenCalledOnce();
			});
			workspaceService.disposeOperations();
			const replacement = workspaceService.switchToBookmark({
				id: 'second-id',
				path: '/second',
				name: 'Second'
			});

			firstSelection.resolve({ outcome: 'ok', path: '/first-canonical' });
			await first;
			await vi.waitFor(() => {
				expect(host.switchTrustedWorkspace).toHaveBeenCalledTimes(2);
			});
			const third = await workspaceService.switchToBookmark({
				id: 'third-id',
				path: '/third',
				name: 'Third'
			});
			expect(third).toEqual({
				ok: false,
				error: 'A workspace switch is already in progress'
			});
			expect(host.switchTrustedWorkspace).toHaveBeenCalledTimes(2);

			secondSelection.resolve({ outcome: 'ok', path: '/canonical/second' });
			const replacementResult = await replacement;
			expect(replacementResult.ok).toBe(true);
		});

		it('returns a safe result when a queued bookmark switch is disposed before it starts', async () => {
			const selection = createDeferred<{ canceled: boolean; filePaths: string[] }>();
			host.selectWorkspaceFolder.mockReturnValueOnce(selection.promise);
			host.switchTrustedWorkspace.mockResolvedValue({
				outcome: 'ok',
				path: '/canonical/bookmark'
			});

			const pendingSelection = workspaceService.selectWorkspace();
			await vi.waitFor(() => {
				expect(host.selectWorkspaceFolder).toHaveBeenCalledOnce();
			});
			const menuResult = workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bookmark',
				name: 'Bookmark'
			});
			workspaceService.disposeOperations();
			selection.resolve({ canceled: true, filePaths: [] });
			await pendingSelection;

			expect(await menuResult).toEqual({
				ok: false,
				error: 'Workspace selection was superseded'
			});
			expect(host.selectWorkspaceFolder).toHaveBeenCalledOnce();
		});
	});

	describe('closeSongDetails', () => {
		it('should close song details', () => {
			workspaceService.closeSongDetails();

			expect(workspaceStore.closeSongDetails).toHaveBeenCalled();
		});
	});

	describe('switchToBookmark', () => {
		it('switches to a bookmarked folder by asking native to switch by id (no folder picker)', async () => {
			const calls: string[] = [];
			(workspaceStore.reset as any).mockImplementation(() => calls.push('reset'));
			(workspaceStore.setPath as any).mockImplementation(() => calls.push('setPath'));

			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ path: '/bm/path', currentSubWorkspace: null, subWorkspaces: [] });
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.switchTrustedWorkspace.mockImplementation((id: string) => {
				calls.push(`switch-trusted-workspace:${id}`);
				return Promise.resolve({ outcome: 'ok', path: '/canonical/path' });
			});
			host.getCurrentWorkspaceRootId.mockResolvedValue('bm-id');
			host.listDirectories.mockImplementation(() => {
				calls.push('list-directories');
				return Promise.resolve([]);
			});
			host.loadTreeStructure.mockImplementation(() => {
				calls.push('load-tree-structure');
				return Promise.resolve([]);
			});

			const result = await workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bm/path',
				name: 'BM'
			});

			expect(result).toEqual({ ok: true });
			expect(host.switchTrustedWorkspace).toHaveBeenCalledWith('bm-id');
			expect(host.selectWorkspaceFolder).not.toHaveBeenCalled();
			expect(workspaceStore.reset).toHaveBeenCalledTimes(1);
			expect(workspaceStore.setPath).toHaveBeenCalledWith('/canonical/path');
			expect(host.pathExists).not.toHaveBeenCalled();
			expect(calls.indexOf('switch-trusted-workspace:bm-id')).toBeLessThan(
				calls.indexOf('reset')
			);
			expect(calls.indexOf('reset')).toBeLessThan(calls.indexOf('setPath'));
			expect(calls.indexOf('setPath')).toBeLessThan(calls.indexOf('list-directories'));
			expect(calls.indexOf('list-directories')).toBeLessThan(
				calls.indexOf('load-tree-structure')
			);
		});

		it('returns a path-scoped error when native reports notAccessible', async () => {
			host.switchTrustedWorkspace.mockResolvedValue({
				outcome: 'notAccessible',
				path: '/bm/path'
			});

			const result = await workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bm/path',
				name: 'BM'
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('missing or not accessible');
				expect('path' in result).toBe(true);
				if ('path' in result) {
					expect(result.path).toBe('/bm/path');
				}
			}
			expect(workspaceStore.reset).not.toHaveBeenCalled();
			expect(workspaceStore.setPath).not.toHaveBeenCalled();
		});

		it('returns an error without a path when native reports unknownId', async () => {
			host.switchTrustedWorkspace.mockResolvedValue({ outcome: 'unknownId' });

			const result = await workspaceService.switchToBookmark({
				id: 'gone-id',
				path: '/gone',
				name: 'Gone'
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toContain('no longer available');
				expect('path' in result).toBe(false);
			}
			expect(workspaceStore.reset).not.toHaveBeenCalled();
		});

		it('surfaces tree-load errors via setError after native trust establishment', async () => {
			let capturedError: string | null = null;
			(workspaceStore.setError as any).mockImplementation((err: string) => {
				capturedError = err;
			});
			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({
					path: '/bm/path',
					currentSubWorkspace: null,
					subWorkspaces: [],
					error: capturedError
				});
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.switchTrustedWorkspace.mockResolvedValue({
				outcome: 'ok',
				path: '/canonical/path'
			});
			host.getCurrentWorkspaceRootId.mockResolvedValue('bm-id');
			host.listDirectories.mockResolvedValue([]);
			host.loadTreeStructure.mockRejectedValue(new Error('boom'));

			const result = await workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bm/path',
				name: 'BM'
			});

			expect(workspaceStore.setError).toHaveBeenCalledWith('Failed to load tree structure');
			const errArg = (workspaceStore.setError as any).mock.calls[0][0];
			expect(typeof errArg).toBe('string');
			expect((errArg as any).path).toBeUndefined();
			expect(workspaceStore.clearWorkspace).not.toHaveBeenCalled();
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('Failed to load tree structure');
				expect('path' in result).toBe(false);
			}
		});

		it('returns ok: true on successful bookmark switch', async () => {
			const calls: string[] = [];
			(workspaceStore.reset as any).mockImplementation(() => calls.push('reset'));
			(workspaceStore.setPath as any).mockImplementation(() => calls.push('setPath'));

			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ path: '/bm/path', currentSubWorkspace: null, subWorkspaces: [], error: null });
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.switchTrustedWorkspace.mockResolvedValue({
				outcome: 'ok',
				path: '/canonical/path'
			});
			host.getCurrentWorkspaceRootId.mockResolvedValue('bm-id');
			host.listDirectories.mockResolvedValue([]);
			host.loadTreeStructure.mockResolvedValue([]);

			const result = await workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bm/path',
				name: 'BM'
			});

			expect(result).toEqual({ ok: true });
		});

		it('returns an error when concurrent switch is attempted', async () => {
			// Start a slow switch
			let resolveSwitch: (v: any) => void;
			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ path: '/bm/path', currentSubWorkspace: null, subWorkspaces: [], error: null });
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.switchTrustedWorkspace.mockImplementation(() => {
				return new Promise((resolve) => {
					resolveSwitch = resolve;
				});
			});
			host.getCurrentWorkspaceRootId.mockResolvedValue('a-id');

			// Start first switch (will hang)
			const first = workspaceService.switchToBookmark({ id: 'a-id', path: '/a', name: 'A' });

			// Try second switch while first is in progress
			const second = await workspaceService.switchToBookmark({
				id: 'b-id',
				path: '/b',
				name: 'B'
			});

			expect(second.ok).toBe(false);
			if (!second.ok) {
				expect(second.error).toBe('A workspace switch is already in progress');
			}

			// Let the first one complete
			resolveSwitch!({ outcome: 'ok', path: '/canonical/a' });
			host.listDirectories.mockResolvedValue([]);
			host.loadTreeStructure.mockResolvedValue([]);
			const firstResult = await first;
			expect(firstResult.ok).toBe(true);
		});

		it('returns a generic error WITHOUT a path when switchTrustedWorkspace throws', async () => {
			host.switchTrustedWorkspace.mockRejectedValue(new Error('IPC disconnected'));

			const result = await workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bm/path',
				name: 'BM'
			});

			expect(result.ok).toBe(false);
			if (!result.ok) {
				// Transient failures must NOT include a path, so the UI does not
				// offer "Remove bookmark" for a bookmark that may be valid.
				expect(result.error).toContain('Could not switch');
				expect('path' in result).toBe(false);
			}
			expect(workspaceStore.reset).not.toHaveBeenCalled();
		});

		it('hydrates rootId from the bookmark id without an IPC round-trip', async () => {
			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ path: '/bm/path', currentSubWorkspace: null, subWorkspaces: [], error: null });
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.switchTrustedWorkspace.mockResolvedValue({
				outcome: 'ok',
				path: '/canonical/path'
			});
			host.listDirectories.mockResolvedValue([]);
			host.loadTreeStructure.mockResolvedValue([]);

			const result = await workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bm/path',
				name: 'BM'
			});

			expect(result).toEqual({ ok: true });
			// After a successful switch by id, the bookmark id IS the authoritative
			// root id; no extra IPC lookup is needed.
			expect(host.getCurrentWorkspaceRootId).not.toHaveBeenCalled();
			expect(workspaceStore.hydrateRootId).toHaveBeenCalledWith('bm-id');
		});

		it('continues loading the workspace when root-id hydration rejects after a folder selection', async () => {
			host.selectWorkspaceFolder.mockResolvedValue({
				canceled: false,
				filePaths: ['/new/workspace']
			});
			host.getCurrentWorkspaceRootId.mockRejectedValue(new Error('root-id IPC failed'));
			host.listDirectories.mockResolvedValue([]);
			host.loadTreeStructure.mockResolvedValue([]);
			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ path: '/new/workspace', currentSubWorkspace: null });
				return vi.fn();
			});

			await workspaceService.selectWorkspace();

			// The root-id lookup is display-only; its failure must not abort the
			// workspace load. rootId is hydrated to null and the tree still loads.
			expect(workspaceStore.setPath).toHaveBeenCalledWith('/new/workspace');
			expect(workspaceStore.hydrateRootId).toHaveBeenCalledWith(null);
			expect(workspaceStore.setTreeStructure).toHaveBeenCalled();
			expect(workspaceStore.setError).not.toHaveBeenCalledWith(
				'Failed to select workspace directory'
			);
		});

		it('returns superseded when the transition is invalidated after loadSubWorkspaces', async () => {
			const listDeferred = createDeferred<string[]>();
			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({
					path: '/canonical/path',
					currentSubWorkspace: null,
					subWorkspaces: [],
					error: null
				});
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.switchTrustedWorkspace.mockResolvedValue({
				outcome: 'ok',
				path: '/canonical/path'
			});
			host.getCurrentWorkspaceRootId.mockResolvedValue('bm-id');
			host.listDirectories.mockReturnValue(listDeferred.promise);
			host.getWorkspaceRoot.mockResolvedValue(null);

			const pending = workspaceService.switchToBookmark({
				id: 'bm-id',
				path: '/bm/path',
				name: 'BM'
			});

			// Wait until loadSubWorkspaces' listDirectories call is in flight.
			await vi.waitFor(() => {
				expect(host.listDirectories).toHaveBeenCalledOnce();
			});
			// Supersede the transition while sub-workspace loading is pending.
			workspaceService.disposeOperations();
			listDeferred.resolve(['DTXFiles.Songs']);

			const result = await pending;

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error).toBe('Workspace selection was superseded');
				expect('path' in result).toBe(false);
			}
			// loadTreeStructure must not have been called after the supersede.
			expect(host.loadTreeStructure).not.toHaveBeenCalled();
		});
	});
});
