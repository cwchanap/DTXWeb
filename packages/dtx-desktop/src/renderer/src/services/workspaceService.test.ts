import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workspaceService } from './workspaceService';
import { workspaceStore } from '../stores/workspaceStore';
import { simFileStore } from '../stores/simFileStore';
import { linkingService } from './linkingService';
import { linkageCacheService } from './linkageCacheService';

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
		clearWorkspace: vi.fn()
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

		// Mock window.electron.ipcRenderer.invoke
		(window.electron.ipcRenderer.invoke as any).mockImplementation((channel: string) => {
			if (channel === 'load-tree-structure') {
				// Mock tree structure with song title
				return Promise.resolve([
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
			}
			return Promise.resolve([]);
		});
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

			// Verify that the IPC call was made
			expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
				'load-tree-structure',
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

			// Verify that the IPC call was made with the sub-workspace path
			expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
				'load-tree-structure',
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

			// Mock IPC to throw an error
			(window.electron.ipcRenderer.invoke as any).mockRejectedValue(new Error('Test error'));

			await workspaceService.loadTreeStructure();

			// Verify that setError was called
			expect(workspaceStore.setError).toHaveBeenCalledWith('Failed to load tree structure');
		});
	});
	describe('selectWorkspace', () => {
		it('should select a workspace and update path and loading state when a path is chosen', async () => {
			(window.electron.ipcRenderer.invoke as any).mockImplementation((channel: string) => {
				if (channel === 'select-folder') {
					return Promise.resolve({ canceled: false, filePaths: ['/new/workspace'] });
				}
				return Promise.resolve([]);
			});
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
			(window.electron.ipcRenderer.invoke as any).mockImplementation(() =>
				Promise.resolve({ canceled: true, filePaths: [] })
			);

			await workspaceService.selectWorkspace();

			expect(workspaceStore.setPath).not.toHaveBeenCalled();
			expect(workspaceStore.setLoading).toHaveBeenCalledWith(false);
		});

		it('should handle errors during folder selection', async () => {
			(window.electron.ipcRenderer.invoke as any).mockRejectedValue(new Error('IPC error'));

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
			(window.electron.ipcRenderer.invoke as any).mockImplementation(() =>
				Promise.resolve(['DTXFiles.Songs', 'OtherFolder', 'DTXFiles.More'])
			);

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
			expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalled();
		});

		it('should handle errors during sub-workspace loading', async () => {
			(workspaceStore.subscribe as any).mockImplementation((callback: any) => {
				callback({ path: '/test/workspace' });
				return vi.fn();
			});
			(window.electron.ipcRenderer.invoke as any).mockRejectedValue(new Error('list error'));

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
			expect(window.electron.ipcRenderer.invoke).not.toHaveBeenCalled();
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
			(window.electron.ipcRenderer.invoke as any).mockResolvedValue(mockChildren);
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
			(window.electron.ipcRenderer.invoke as any).mockResolvedValue([mockChild]);
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
			(window.electron.ipcRenderer.invoke as any).mockRejectedValue(new Error('load error'));

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
});
