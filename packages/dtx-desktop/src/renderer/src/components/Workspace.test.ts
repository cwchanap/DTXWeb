import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceService } from '../services/workspaceService';
import { workspaceStore } from '../stores/workspaceStore';
import type { TreeNode } from '../stores/workspaceStore';

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		selectWorkspace: vi.fn(),
		loadSubWorkspaces: vi.fn(),
		loadTreeStructure: vi.fn(),
		clearWorkspace: vi.fn()
	}
}));

vi.mock('../stores/workspaceStore', () => ({
	workspaceStore: {
		showNewSongForm: vi.fn()
	}
}));

describe('Workspace Component Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const handleSelectWorkspace = async () => {
		await workspaceService.selectWorkspace();
	};

	const handleRefreshWorkspace = async () => {
		await workspaceService.loadSubWorkspaces();
		await workspaceService.loadTreeStructure();
	};

	const handleClearWorkspace = () => {
		workspaceService.clearWorkspace();
	};

	const handleNewSong = () => {
		workspaceStore.showNewSongForm();
	};

        const filterTreeNodes = (nodes: TreeNode[], query: string): TreeNode[] => {
                if (!query.trim()) return nodes;

                const term = query.toLowerCase();

                const walk = (node: TreeNode): TreeNode | null => {
                        const matches =
                                node.name.toLowerCase().includes(term) ||
                                node.songTitle?.toLowerCase().includes(term);

                        const children = node.children
                                .map((child) => walk(child))
                                .filter((c): c is TreeNode => c !== null);

                        if (matches || children.length) {
                                return {
                                        ...node,
                                        children,
                                        isExpanded: children.length > 0 || node.isExpanded
                                };
                        }

                        return null;
                };

                return nodes.map((n) => walk(n)).filter((n): n is TreeNode => n !== null);
        };

	it('selects workspace through service', async () => {
		await handleSelectWorkspace();
		expect(workspaceService.selectWorkspace).toHaveBeenCalled();
	});

	it('refreshes workspace data', async () => {
		await handleRefreshWorkspace();
		expect(workspaceService.loadSubWorkspaces).toHaveBeenCalled();
		expect(workspaceService.loadTreeStructure).toHaveBeenCalled();
	});

	it('clears workspace via service', () => {
		handleClearWorkspace();
		expect(workspaceService.clearWorkspace).toHaveBeenCalled();
	});

	it('opens new song form', () => {
		handleNewSong();
		expect(workspaceStore.showNewSongForm).toHaveBeenCalled();
	});

        it('filters tree nodes by query', () => {
                // Arrange
                const tree: TreeNode[] = [
			{
				name: 'Folder',
				path: '/folder',
				isExpanded: false,
				isLoading: false,
				children: [
					{
						name: 'Song1',
						path: '/folder/song1',
						isExpanded: false,
						isLoading: false,
						children: [],
						hasChildren: false,
						containsDtxFiles: true,
						songTitle: 'Awesome Track'
					}
				],
				hasChildren: true
			},
			{
				name: 'Other',
				path: '/other',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false
			}
		];

                // Act
                const result = filterTreeNodes(tree, 'awesome');

                // Assert
                expect(result.length).toBe(1);
                expect(result[0].name).toBe('Folder');
                expect(result[0].isExpanded).toBe(true);
                expect(result[0].children[0].name).toBe('Song1');
        });

        it('returns original tree when query empty', () => {
                // Arrange
                const tree: TreeNode[] = [
			{
				name: 'Folder',
				path: '/folder',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false
			}
		];

                // Act
                const result = filterTreeNodes(tree, '');

                // Assert
                expect(result).toEqual(tree);
        });

        it('returns empty array when no nodes match', () => {
                // Arrange
                const tree: TreeNode[] = [
			{
				name: 'Folder',
				path: '/folder',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false
			}
		];

                // Act
                const result = filterTreeNodes(tree, 'unknown');

                // Assert
                expect(result).toEqual([]);
        });
});
