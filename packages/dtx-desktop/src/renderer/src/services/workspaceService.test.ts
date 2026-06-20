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
		pathExists: vi.fn(),
		listDirectories: vi.fn(),
		loadTreeStructure: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

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
			expect(host.loadTreeStructure).toHaveBeenCalledWith(
				'/test/workspace',
				'/test/workspace'
			);

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
	});
	describe('selectWorkspace', () => {
		it('should select a workspace and update path and loading state when a path is chosen', async () => {
			host.selectFolder.mockResolvedValue({ canceled: false, filePaths: ['/new/workspace'] });
			host.loadTreeStructure.mockResolvedValue([]);
			host.listDirectories.mockResolvedValue([]);
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/new/workspace', currentSubWorkspace: null });
				return vi.fn();
			});

			await workspaceService.selectWorkspace();

			expect(workspaceStore.setLoading).toHaveBeenCalledWith(true);
			expect(workspaceStore.setPath).toHaveBeenCalledWith('/new/workspace');
			expect(workspaceStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('should return early when dialog is canceled', async () => {
			host.selectFolder.mockResolvedValue({ canceled: true, filePaths: [] });

			await workspaceService.selectWorkspace();

			expect(workspaceStore.setPath).not.toHaveBeenCalled();
			expect(workspaceStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('should handle errors during folder selection', async () => {
			host.selectFolder.mockRejectedValue(new Error('IPC error'));

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
		it('should clear the workspace', () => {
			workspaceService.clearWorkspace();

			expect(workspaceStore.clearWorkspace).toHaveBeenCalled();
		});
	});

	describe('closeSongDetails', () => {
		it('should close song details', () => {
			workspaceService.closeSongDetails();

			expect(workspaceStore.closeSongDetails).toHaveBeenCalled();
		});
	});

	describe('switchToBookmark', () => {
		it('validates path, then resets, sets the path, and reloads sub-workspaces and tree in order', async () => {
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
			host.pathExists.mockImplementation(() => {
				calls.push('path-exists');
				return Promise.resolve({ exists: true, error: null });
			});
			host.listDirectories.mockImplementation(() => {
				calls.push('list-directories');
				return Promise.resolve([]);
			});
			host.loadTreeStructure.mockImplementation(() => {
				calls.push('load-tree-structure');
				return Promise.resolve([]);
			});

			const result = await workspaceService.switchToBookmark({
				path: '/bm/path',
				name: 'BM'
			});

			expect(result).toEqual({ ok: true });
			expect(workspaceStore.reset).toHaveBeenCalledTimes(1);
			expect(workspaceStore.setPath).toHaveBeenCalledWith('/bm/path');
			expect(calls.indexOf('path-exists')).toBeLessThan(calls.indexOf('reset'));
			expect(calls.indexOf('reset')).toBeLessThan(calls.indexOf('setPath'));
			expect(calls.indexOf('setPath')).toBeLessThan(calls.indexOf('list-directories'));
			expect(calls.indexOf('list-directories')).toBeLessThan(
				calls.indexOf('load-tree-structure')
			);
		});

		it('surfaces tree-load errors via setError without clearing the path', async () => {
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
			host.pathExists.mockResolvedValue({ exists: true, error: null });
			host.listDirectories.mockResolvedValue([]);
			host.loadTreeStructure.mockRejectedValue(new Error('boom'));

			const result = await workspaceService.switchToBookmark({
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

		it('returns an error result and does not reset workspace when bookmark path does not exist', async () => {
			host.pathExists.mockResolvedValue({ exists: false, error: 'not-found' });

			const result = await workspaceService.switchToBookmark({
				path: '/gone/path',
				name: 'Gone'
			});

			expect(result).toEqual({
				ok: false,
				error: expect.stringContaining('/gone/path'),
				path: '/gone/path'
			});
			expect(workspaceStore.setError).not.toHaveBeenCalled();
			expect(workspaceStore.reset).not.toHaveBeenCalled();
			expect(workspaceStore.setPath).not.toHaveBeenCalled();
			expect(workspaceStore.setTreeStructure).not.toHaveBeenCalled();
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
			host.pathExists.mockResolvedValue({ exists: true, error: null });
			host.listDirectories.mockResolvedValue([]);
			host.loadTreeStructure.mockResolvedValue([]);

			const result = await workspaceService.switchToBookmark({
				path: '/bm/path',
				name: 'BM'
			});

			expect(result).toEqual({ ok: true });
		});

		it('returns an error when concurrent switch is attempted', async () => {
			// Start a slow switch
			let resolvePathExists: (v: any) => void;
			(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ path: '/bm/path', currentSubWorkspace: null, subWorkspaces: [], error: null });
				return vi.fn();
			});
			(simFileStore.subscribe as any).mockImplementation((cb: any) => {
				cb({ userSimFiles: [] });
				return vi.fn();
			});
			host.pathExists.mockImplementation(() => {
				return new Promise((resolve) => {
					resolvePathExists = resolve;
				});
			});

			// Start first switch (will hang)
			const first = workspaceService.switchToBookmark({ path: '/a', name: 'A' });

			// Try second switch while first is in progress
			const second = await workspaceService.switchToBookmark({ path: '/b', name: 'B' });

			expect(second.ok).toBe(false);
			if (!second.ok) {
				expect(second.error).toBe('A workspace switch is already in progress');
			}

			// Let the first one complete
			resolvePathExists!({ exists: false, error: 'not-found' });
			const firstResult = await first;
			expect(firstResult.ok).toBe(false);
		});

		it('returns an error when path-exists IPC throws', async () => {
			host.pathExists.mockRejectedValue(new Error('IPC disconnected'));

			const result = await workspaceService.switchToBookmark({
				path: '/bm/path',
				name: 'BM'
			});

			expect(result).toEqual({
				ok: false,
				error: expect.stringContaining('Unable to verify workspace path'),
				path: '/bm/path'
			});
			expect(workspaceStore.reset).not.toHaveBeenCalled();
		});

		it('returns permission-denied message when EACCES', async () => {
			host.pathExists.mockResolvedValue({ exists: false, error: 'permission-denied' });

			const result = await workspaceService.switchToBookmark({
				path: '/locked/path',
				name: 'Locked'
			});

			expect(result).toEqual({
				ok: false,
				error: expect.stringContaining('Permission denied'),
				path: '/locked/path'
			});
			if (!result.ok) {
				expect(result.error).toContain('/locked/path');
				expect(result.error).not.toContain('no longer exists');
			}
		});
	});
});
