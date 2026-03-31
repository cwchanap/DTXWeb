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
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'test-user-id',
				dtx_files: []
			},
			{
				id: 2,
				title: 'Test Song Extended Version',
				artist: 'Test Artist',
				bpm: 120,
				preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'test-user-id',
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
					download_url: null,
					is_published: true,
					display_id: null,
					publish_date: '2024-01-01',
					video_preview_url: null,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z',
					user_id: 'test-user-id',
					dtx_files: []
				},
				{
					id: 2,
					title: 'ボーカロイド',
					artist: 'Test Artist',
					bpm: 120,
					preview_url: null,
					download_url: null,
					is_published: true,
					display_id: null,
					publish_date: '2024-01-01',
					video_preview_url: null,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z',
					user_id: 'test-user-id',
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
					download_url: null,
					is_published: true,
					display_id: null,
					publish_date: '2024-01-01',
					video_preview_url: null,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z',
					user_id: 'test-user-id',
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
					download_url: null,
					is_published: true,
					display_id: null,
					publish_date: '2024-01-01',
					video_preview_url: null,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z',
					user_id: 'test-user-id',
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
					download_url: null,
					is_published: true,
					display_id: null,
					publish_date: '2024-01-01',
					video_preview_url: null,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z',
					user_id: 'test-user-id',
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
					download_url: null,
					is_published: true,
					display_id: null,
					publish_date: '2024-01-01',
					video_preview_url: null,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z',
					user_id: 'test-user-id',
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

	describe('findMatchingFolder', () => {
		const mockFolders: TreeNode[] = [
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
				name: 'Another Folder',
				path: '/path/another',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: null
			}
		];

		it('returns null when simFile has no title', () => {
			const simFile = {
				id: 1,
				title: null as unknown as string,
				artist: 'Artist',
				bpm: 120,
				preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'user-id',
				dtx_files: []
			};

			const result = linkingService.findMatchingFolder(simFile, mockFolders);
			expect(result).toBeNull();
		});

		it('returns exact matching folder by title', () => {
			const simFile = {
				id: 1,
				title: 'Test Song',
				artist: 'Artist',
				bpm: 120,
				preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'user-id',
				dtx_files: []
			};

			const result = linkingService.findMatchingFolder(simFile, mockFolders);
			expect(result).not.toBeNull();
			expect(result?.songTitle).toBe('Test Song');
		});

		it('returns fuzzy matching folder when no exact match', () => {
			const simFile = {
				id: 1,
				title: 'Test Song Extended',
				artist: 'Artist',
				bpm: 120,
				preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'user-id',
				dtx_files: []
			};

			const result = linkingService.findMatchingFolder(simFile, mockFolders);
			expect(result?.songTitle).toBe('Test Song');
		});

		it('returns null when no folder matches', () => {
			const simFile = {
				id: 1,
				title: 'Completely Different Song XYZ',
				artist: 'Artist',
				bpm: 120,
				preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'user-id',
				dtx_files: []
			};

			const result = linkingService.findMatchingFolder(simFile, mockFolders);
			expect(result).toBeNull();
		});

		it('skips folders without songTitle during matching', () => {
			const foldersWithoutTitles: TreeNode[] = [
				{
					name: 'No Title',
					path: '/path/notitle',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					songTitle: null
				}
			];
			const simFile = {
				id: 1,
				title: 'Any Song',
				artist: 'Artist',
				bpm: 120,
				preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'user-id',
				dtx_files: []
			};

			const result = linkingService.findMatchingFolder(simFile, foldersWithoutTitles);
			expect(result).toBeNull();
		});
	});

	describe('findMatchingSimFile - null songTitle', () => {
		it('returns null when folder has no songTitle', () => {
			const folderWithNoTitle: TreeNode = {
				name: 'Empty Folder',
				path: '/path/empty',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: null
			};

			const result = linkingService.findMatchingSimFile(folderWithNoTitle, []);
			expect(result).toBeNull();
		});
	});

	describe('linkSimFileToFolder', () => {
		it('calls workspaceStore.linkSimFileToFolder with correct arguments', () => {
			const simFile = {
				id: 1,
				title: 'Test Song',
				artist: 'Test Artist',
				bpm: 120,
				preview_url: null,
				download_url: null,
				is_published: true,
				display_id: null,
				publish_date: '2024-01-01',
				video_preview_url: null,
				created_at: '2024-01-01T00:00:00Z',
				updated_at: '2024-01-01T00:00:00Z',
				user_id: 'test-user-id',
				dtx_files: []
			};

			linkingService.linkSimFileToFolder(simFile, '/path/to/folder');

			expect(workspaceStore.linkSimFileToFolder).toHaveBeenCalledWith(
				'/path/to/folder',
				simFile
			);
		});
	});

	describe('calculateSimilarity', () => {
		it('should calculate similarity correctly', () => {
			expect(linkingService.calculateSimilarity('test', 'test')).toBe(1);
			expect(linkingService.calculateSimilarity('test', 'testing')).toBeGreaterThan(0.5);
			expect(linkingService.calculateSimilarity('abc', 'xyz')).toBeLessThan(0.5);
		});

		it('should return 1 when both strings are empty', () => {
			expect(linkingService.calculateSimilarity('', '')).toBe(1);
		});
	});

	describe('unlinkSimFileFromFolder', () => {
		it('should call workspaceStore.unlinkSimFileFromFolder with the folder path', () => {
			linkingService.unlinkSimFileFromFolder('/path/to/folder');
			expect(workspaceStore.unlinkSimFileFromFolder).toHaveBeenCalledWith('/path/to/folder');
		});
	});

	describe('linkSimFilesToNewNodes - already linked folder', () => {
		it('should skip folders that already have a linked simFile', () => {
			const mockSimFiles: SimfileWithDtx[] = [
				{
					id: 1,
					title: 'Song',
					artist: 'Artist',
					bpm: 120,
					preview_url: null,
					download_url: null,
					is_published: true,
					display_id: null,
					publish_date: '2024-01-01',
					video_preview_url: null,
					created_at: '2024-01-01T00:00:00Z',
					updated_at: '2024-01-01T00:00:00Z',
					user_id: 'user',
					dtx_files: []
				}
			];

			const alreadyLinkedNode: TreeNode = {
				name: 'Linked Folder',
				path: '/path/linked',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'Song',
				linkedSimFileId: 'already-linked-id'
			};

			linkingService.linkSimFilesToNewNodes(mockSimFiles, [alreadyLinkedNode]);

			// Already linked folder should be skipped — no new link call
			expect(workspaceStore.linkSimFileToFolder).not.toHaveBeenCalled();
		});
	});
});
