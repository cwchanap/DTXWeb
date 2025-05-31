import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { linkingService } from './linkingService';
import { workspaceStore } from '../stores/workspaceStore';
import type { TreeNode } from '../stores/workspaceStore';
import type { SimfileWithDtx } from '@dtx/common';

// Mock the workspace store
vi.mock('../stores/workspaceStore', () => ({
	workspaceStore: {
		linkSimFileToFolder: vi.fn(),
		unlinkSimFileFromFolder: vi.fn()
	}
}));

describe('LinkingService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('normalizeTitle', () => {
		it('should normalize titles correctly', () => {
			expect(linkingService.normalizeTitle('Test Song!')).toBe('test song');
			expect(linkingService.normalizeTitle('  Multiple   Spaces  ')).toBe('multiple spaces');
			expect(linkingService.normalizeTitle('Special@#$%Characters')).toBe(
				'specialcharacters'
			);
		});
	});

	describe('getFoldersWithSongs', () => {
		it('should extract folders with DTX files and song titles', () => {
			const mockNodes: TreeNode[] = [
				{
					name: 'Regular Folder',
					path: '/path/regular',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: false
				},
				{
					name: 'Song Folder',
					path: '/path/song',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: 'Test Song'
				},
				{
					name: 'DTX Folder No Title',
					path: '/path/dtx-no-title',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: null
				}
			];

			const result = linkingService.getFoldersWithSongs(mockNodes);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Song Folder');
			expect(result[0].songTitle).toBe('Test Song');
		});

		it('should recursively search through children', () => {
			const mockNodes: TreeNode[] = [
				{
					name: 'Parent Folder',
					path: '/path/parent',
					isExpanded: false,
					isLoading: false,
					children: [
						{
							name: 'Child Song',
							path: '/path/parent/child',
							isExpanded: false,
							isLoading: false,
							children: [],
							hasChildren: false,
							containsDtxFiles: true,
							songTitle: 'Child Song Title'
						}
					],
					hasChildren: true,
					containsDtxFiles: false
				}
			];

			const result = linkingService.getFoldersWithSongs(mockNodes);
			expect(result).toHaveLength(1);
			expect(result[0].name).toBe('Child Song');
		});
	});

	describe('findMatchingFolder', () => {
		const mockFolders: TreeNode[] = [
			{
				name: 'Exact Match',
				path: '/path/exact',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Test Song'
			},
			{
				name: 'Fuzzy Match',
				path: '/path/fuzzy',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Test Song Extended Version'
			}
		];

		it('should find exact matches', () => {
			const mockSimFile: SimfileWithDtx = {
				id: 1,
				title: 'Test Song',
				artist: 'Test Artist',
				bpm: 120,
				preview_url: null,
				sound_preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				dtx_files: []
			};

			const result = linkingService.findMatchingFolder(mockSimFile, mockFolders);
			expect(result).toBeTruthy();
			expect(result?.name).toBe('Exact Match');
		});

		it('should find fuzzy matches when exact match not found', () => {
			const mockSimFile: SimfileWithDtx = {
				id: 1,
				title: 'Test Song',
				artist: 'Test Artist',
				bpm: 120,
				preview_url: null,
				sound_preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				dtx_files: []
			};

			const foldersWithoutExact = mockFolders.slice(1); // Remove exact match
			const result = linkingService.findMatchingFolder(mockSimFile, foldersWithoutExact);
			expect(result).toBeTruthy();
			expect(result?.name).toBe('Fuzzy Match');
		});

		it('should return null when no match found', () => {
			const mockSimFile: SimfileWithDtx = {
				id: 1,
				title: 'Completely Different Song',
				artist: 'Test Artist',
				bpm: 120,
				preview_url: null,
				sound_preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				dtx_files: []
			};

			const result = linkingService.findMatchingFolder(mockSimFile, mockFolders);
			expect(result).toBeNull();
		});
	});

	describe('autoLinkSimFilesToFolders', () => {
		it('should link matching simFiles to folders', () => {
			const mockSimFiles: SimfileWithDtx[] = [
				{
					id: 1,
					title: 'Test Song',
					artist: 'Test Artist',
					bpm: 120,
					preview_url: null,
					sound_preview_url: null,
					download_url: null,
					is_published: true,
					display_id: null,
					dtx_files: []
				}
			];

			const mockFolders: TreeNode[] = [
				{
					name: 'Test Folder',
					path: '/path/test',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: 'Test Song'
				}
			];

			linkingService.autoLinkSimFilesToFolders(mockSimFiles, mockFolders);

			expect(workspaceStore.linkSimFileToFolder).toHaveBeenCalledWith(
				'/path/test',
				mockSimFiles[0]
			);
		});

		it('should not link already linked folders', () => {
			const mockSimFiles: SimfileWithDtx[] = [
				{
					id: 1,
					title: 'Test Song',
					artist: 'Test Artist',
					bpm: 120,
					preview_url: null,
					sound_preview_url: null,
					download_url: null,
					is_published: true,
					display_id: null,
					dtx_files: []
				}
			];

			const mockFolders: TreeNode[] = [
				{
					name: 'Test Folder',
					path: '/path/test',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: 'Test Song',
					linkedSimFileId: 2 // Already linked to another simFile
				}
			];

			linkingService.autoLinkSimFilesToFolders(mockSimFiles, mockFolders);

			expect(workspaceStore.linkSimFileToFolder).not.toHaveBeenCalled();
		});
	});

	describe('linkSimFilesToNewNodes', () => {
		it('should link simFiles to newly loaded nodes', () => {
			const mockSimFiles: SimfileWithDtx[] = [
				{
					id: 1,
					title: 'New Song',
					artist: 'Test Artist',
					bpm: 120,
					preview_url: null,
					sound_preview_url: null,
					download_url: null,
					is_published: true,
					display_id: null,
					dtx_files: []
				}
			];

			const mockNewNodes: TreeNode[] = [
				{
					name: 'New Folder',
					path: '/path/new',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: 'New Song'
				}
			];

			linkingService.linkSimFilesToNewNodes(mockSimFiles, mockNewNodes);

			expect(workspaceStore.linkSimFileToFolder).toHaveBeenCalledWith(
				'/path/new',
				mockSimFiles[0]
			);
		});
	});

	describe('calculateSimilarity', () => {
		it('should calculate similarity correctly', () => {
			expect(linkingService.calculateSimilarity('test', 'test')).toBe(1);
			expect(linkingService.calculateSimilarity('test', 'testing')).toBeGreaterThan(0.5);
			expect(linkingService.calculateSimilarity('abc', 'xyz')).toBeLessThan(0.5);
		});
	});
});
