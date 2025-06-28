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
		it('should normalize ASCII titles correctly', () => {
			expect(linkingService.normalizeTitle('Test Song!')).toBe('test song');
			expect(linkingService.normalizeTitle('  Multiple   Spaces  ')).toBe('multiple spaces');
			expect(linkingService.normalizeTitle('Special@#$%Characters')).toBe(
				'specialcharacters'
			);
		});

		it('should preserve Japanese characters', () => {
			// Hiragana
			expect(linkingService.normalizeTitle('あいうえお')).toBe('あいうえお');
			expect(linkingService.normalizeTitle('ひらがな！')).toBe('ひらがな');

			// Katakana
			expect(linkingService.normalizeTitle('アイウエオ')).toBe('アイウエオ');
			expect(linkingService.normalizeTitle('カタカナ♪')).toBe('カタカナ');

			// Kanji
			expect(linkingService.normalizeTitle('桜')).toBe('桜');
			expect(linkingService.normalizeTitle('音楽ゲーム')).toBe('音楽ゲーム');
			expect(linkingService.normalizeTitle('日本語の歌')).toBe('日本語の歌');
		});

		it('should handle mixed Japanese and ASCII titles', () => {
			expect(linkingService.normalizeTitle('BEMANI 音楽')).toBe('bemani 音楽');
			expect(linkingService.normalizeTitle('DDR ダンスダンスレボリューション')).toBe(
				'ddr ダンスダンスレボリューション'
			);
			expect(linkingService.normalizeTitle('Test 桜 Song!')).toBe('test 桜 song');
		});

		it('should remove special characters but keep Japanese', () => {
			expect(linkingService.normalizeTitle('音楽♪ゲーム！')).toBe('音楽ゲーム');
			expect(linkingService.normalizeTitle('桜@#$%咲く')).toBe('桜咲く');
			expect(linkingService.normalizeTitle('アニメ★ソング')).toBe('アニメソング');
		});

		it('should handle completely Japanese titles', () => {
			expect(linkingService.normalizeTitle('千本桜')).toBe('千本桜');
			expect(linkingService.normalizeTitle('ボーカロイド')).toBe('ボーカロイド');
			expect(linkingService.normalizeTitle('はつねみく')).toBe('はつねみく');
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

	describe('findMatchingSimFile', () => {
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
			},
			{
				id: 2,
				title: 'Test Song Extended Version',
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

		it('should find exact matches', () => {
			const mockFolder: TreeNode = {
				name: 'Test Folder',
				path: '/path/test',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Test Song'
			};

			const result = linkingService.findMatchingSimFile(mockFolder, mockSimFiles);
			expect(result).toBeTruthy();
			expect(result?.title).toBe('Test Song');
		});

		it('should find fuzzy matches when exact match not found', () => {
			const mockFolder: TreeNode = {
				name: 'Test Folder',
				path: '/path/test',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Test Song'
			};

			const simFilesWithoutExact = mockSimFiles.slice(1); // Remove exact match
			const result = linkingService.findMatchingSimFile(mockFolder, simFilesWithoutExact);
			expect(result).toBeTruthy();
			expect(result?.title).toBe('Test Song Extended Version');
		});

		it('should return null when no match found', () => {
			const mockFolder: TreeNode = {
				name: 'Test Folder',
				path: '/path/test',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Completely Different Song'
			};

			const result = linkingService.findMatchingSimFile(mockFolder, mockSimFiles);
			expect(result).toBeNull();
		});

		it('should find the best match when multiple fuzzy matches exist', () => {
			const mockFolder: TreeNode = {
				name: 'Test Folder',
				path: '/path/test',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Test Song Extended'
			};

			const result = linkingService.findMatchingSimFile(mockFolder, mockSimFiles);
			expect(result).toBeTruthy();
			expect(result?.title).toBe('Test Song Extended Version'); // Should pick the better match
		});

		it('should match Japanese titles exactly', () => {
			const japaneseSimFiles: SimfileWithDtx[] = [
				{
					id: 1,
					title: '千本桜',
					artist: 'Test Artist',
					bpm: 120,
					preview_url: null,
					sound_preview_url: null,
					download_url: null,
					is_published: true,
					display_id: null,
					dtx_files: []
				},
				{
					id: 2,
					title: 'ボーカロイド',
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

			const mockFolder: TreeNode = {
				name: 'Japanese Song Folder',
				path: '/path/japanese',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: '千本桜'
			};

			const result = linkingService.findMatchingSimFile(mockFolder, japaneseSimFiles);
			expect(result).toBeTruthy();
			expect(result?.title).toBe('千本桜');
		});

		it('should match mixed Japanese and ASCII titles', () => {
			const mixedSimFiles: SimfileWithDtx[] = [
				{
					id: 1,
					title: 'BEMANI 音楽',
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

			const mockFolder: TreeNode = {
				name: 'Mixed Song Folder',
				path: '/path/mixed',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'BEMANI 音楽'
			};

			const result = linkingService.findMatchingSimFile(mockFolder, mixedSimFiles);
			expect(result).toBeTruthy();
			expect(result?.title).toBe('BEMANI 音楽');
		});
	});

	describe('autoLinkSimFilesToFolders', () => {
		it('should link matching folders to simFiles', () => {
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
					linkedSimFileId: '2' // Already linked to another simFile
				}
			];

			linkingService.autoLinkSimFilesToFolders(mockSimFiles, mockFolders);

			expect(workspaceStore.linkSimFileToFolder).not.toHaveBeenCalled();
		});
	});

	describe('linkSimFilesToNewNodes', () => {
		it('should link newly loaded folders to simFiles', () => {
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

	describe('unlinkSimFileFromFolder', () => {
		it('should call workspaceStore.unlinkSimFileFromFolder with correct path', () => {
			const folderPath = '/path/to/folder';

			linkingService.unlinkSimFileFromFolder(folderPath);

			expect(workspaceStore.unlinkSimFileFromFolder).toHaveBeenCalledWith(folderPath);
		});
	});

	describe('linkSimFileToFolder', () => {
		it('should call workspaceStore.linkSimFileToFolder with correct parameters', () => {
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
			const folderPath = '/path/to/folder';

			linkingService.linkSimFileToFolder(mockSimFile, folderPath);

			expect(workspaceStore.linkSimFileToFolder).toHaveBeenCalledWith(
				folderPath,
				mockSimFile
			);
		});
	});
});
