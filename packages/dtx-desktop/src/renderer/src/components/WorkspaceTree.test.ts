import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceService } from '../services/workspaceService';
import { linkingService } from '../services/linkingService';
import type { TreeNode } from '../stores/workspaceStore';

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		collapseTreeNode: vi.fn(),
		expandTreeNode: vi.fn(),
		selectSong: vi.fn()
	}
}));

vi.mock('../services/linkingService', () => ({
	linkingService: {
		unlinkSimFileFromFolder: vi.fn()
	}
}));

describe('WorkspaceTree Component Logic', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const handleSongSelect = (song: TreeNode) => {
		workspaceService.selectSong(song);
	};

	const handleToggleNode = async (node: TreeNode) => {
		if (node.isLoading) return;

		if (node.containsDtxFiles) {
			handleSongSelect(node);
			return;
		}

		if (node.isExpanded) {
			workspaceService.collapseTreeNode(node.path);
		} else {
			await workspaceService.expandTreeNode(node.path);
		}
	};

	const handleUnlinkFolder = (event: Event, node: TreeNode) => {
		event.stopPropagation();
		linkingService.unlinkSimFileFromFolder(node.path);
	};

	const getIndentStyle = (level: number) => `padding-left: ${level * 20}px`;

	it('does nothing when node is loading', async () => {
		const node: TreeNode = {
			name: 'Loading',
			path: '/loading',
			isExpanded: false,
			isLoading: true,
			children: [],
			hasChildren: false,
			containsDtxFiles: false
		};

		await handleToggleNode(node);
		expect(workspaceService.expandTreeNode).not.toHaveBeenCalled();
		expect(workspaceService.collapseTreeNode).not.toHaveBeenCalled();
	});

	it('selects song when node contains DTX files', async () => {
		const node: TreeNode = {
			name: 'Song',
			path: '/song',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false,
			containsDtxFiles: true
		};

		await handleToggleNode(node);
		expect(workspaceService.selectSong).toHaveBeenCalledWith(node);
	});

	it('expands and collapses nodes', async () => {
		const node: TreeNode = {
			name: 'Folder',
			path: '/folder',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false,
			containsDtxFiles: false
		};

		await handleToggleNode(node);
		expect(workspaceService.expandTreeNode).toHaveBeenCalledWith('/folder');

		node.isExpanded = true;
		await handleToggleNode(node);
		expect(workspaceService.collapseTreeNode).toHaveBeenCalledWith('/folder');
	});

	it('handles song selection directly', () => {
		const song: TreeNode = {
			name: 'Song',
			path: '/song',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false,
			containsDtxFiles: true
		};

		handleSongSelect(song);
		expect(workspaceService.selectSong).toHaveBeenCalledWith(song);
	});

	it('unlinks folder and stops propagation', () => {
		const node: TreeNode = {
			name: 'Song',
			path: '/song',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false,
			containsDtxFiles: true,
			linkedSimFileId: '1'
		} as TreeNode;
		const event = { stopPropagation: vi.fn() } as unknown as Event;

		handleUnlinkFolder(event, node);
		expect(event.stopPropagation).toHaveBeenCalled();
		expect(linkingService.unlinkSimFileFromFolder).toHaveBeenCalledWith('/song');
	});

	it('returns correct indentation style', () => {
		expect(getIndentStyle(2)).toBe('padding-left: 40px');
	});
});
