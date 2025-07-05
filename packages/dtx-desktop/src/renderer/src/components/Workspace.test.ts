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

		const searchTerm = query.toLowerCase();

		const filterNode = (node: TreeNode): TreeNode | null => {
			const nameMatches = node.name.toLowerCase().includes(searchTerm);
			const songTitleMatches = node.songTitle?.toLowerCase().includes(searchTerm) || false;
			const matches = nameMatches || songTitleMatches;

			const filteredChildren = node.children
				.map((child) => filterNode(child))
				.filter((child): child is TreeNode => child !== null);

			if (matches || filteredChildren.length > 0) {
				return {
					...node,
					children: filteredChildren,
					isExpanded: filteredChildren.length > 0 || node.isExpanded
				};
			}

			return null;
		};

		return nodes
			.map((node) => filterNode(node))
			.filter((node): node is TreeNode => node !== null);
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

		const result = filterTreeNodes(tree, 'awesome');
		expect(result.length).toBe(1);
		expect(result[0].name).toBe('Folder');
		expect(result[0].isExpanded).toBe(true);
		expect(result[0].children[0].name).toBe('Song1');
	});

	it('returns original tree when query empty', () => {
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

		expect(filterTreeNodes(tree, '')).toEqual(tree);
	});

	it('returns empty array when no nodes match', () => {
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

		expect(filterTreeNodes(tree, 'unknown')).toEqual([]);
	});
});
