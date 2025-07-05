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

        const handleToggleNode = async (node: TreeNode) => {
                if (node.isLoading) return;

                if (node.containsDtxFiles) {
                        workspaceService.selectSong(node);
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
                // Arrange
                const node: TreeNode = {
			name: 'Loading',
			path: '/loading',
			isExpanded: false,
			isLoading: true,
			children: [],
			hasChildren: false,
			containsDtxFiles: false
		};

                // Act
                await handleToggleNode(node);

                // Assert
                expect(workspaceService.expandTreeNode).not.toHaveBeenCalled();
                expect(workspaceService.collapseTreeNode).not.toHaveBeenCalled();
        });

        it('selects song when node contains DTX files', async () => {
                // Arrange
                const node: TreeNode = {
			name: 'Song',
			path: '/song',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false,
			containsDtxFiles: true
		};

                // Act
                await handleToggleNode(node);

                // Assert
                expect(workspaceService.selectSong).toHaveBeenCalledWith(node);
        });

        it('expands and collapses nodes', async () => {
                // Arrange
                const node: TreeNode = {
			name: 'Folder',
			path: '/folder',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false,
			containsDtxFiles: false
		};

                // Act & Assert - expand
                await handleToggleNode(node);
                expect(workspaceService.expandTreeNode).toHaveBeenCalledWith('/folder');

                // Act & Assert - collapse
                node.isExpanded = true;
                await handleToggleNode(node);
                expect(workspaceService.collapseTreeNode).toHaveBeenCalledWith('/folder');
        });

        it('handles song selection directly', () => {
                // Arrange
                const song: TreeNode = {
			name: 'Song',
			path: '/song',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false,
			containsDtxFiles: true
		};

                // Act
                workspaceService.selectSong(song);

                // Assert
                expect(workspaceService.selectSong).toHaveBeenCalledWith(song);
        });

        it('unlinks folder and stops propagation', () => {
                // Arrange
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

                // Act
                handleUnlinkFolder(event, node);

                // Assert
                expect(event.stopPropagation).toHaveBeenCalled();
                expect(linkingService.unlinkSimFileFromFolder).toHaveBeenCalledWith('/song');
        });

        it('returns correct indentation style', () => {
                // Act
                const result = getIndentStyle(2);

                // Assert
                expect(result).toBe('padding-left: 40px');
        });
});
