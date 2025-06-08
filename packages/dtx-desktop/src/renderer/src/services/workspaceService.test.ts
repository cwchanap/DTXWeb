import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workspaceService } from './workspaceService';
import { workspaceStore } from '../stores/workspaceStore';

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
		closeSongDetails: vi.fn()
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

	describe('selectSong', () => {
		it('should call workspaceStore.selectSong with the provided song', () => {
			const mockSong = {
				name: 'TestSong',
				path: '/test/path/TestSong',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Test Song Title'
			};

			workspaceService.selectSong(mockSong);

			expect(workspaceStore.selectSong).toHaveBeenCalledWith(mockSong);
		});
	});
});
