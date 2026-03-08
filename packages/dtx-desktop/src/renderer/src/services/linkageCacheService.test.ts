import { describe, it, expect, beforeEach, vi } from 'vitest';
import { linkageCacheService } from './linkageCacheService';
import type { SimfileWithDtx } from '@dtx/common';

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

const sampleSimfile: SimfileWithDtx = {
	id: 1,
	title: 'Test Song',
	artist: 'Artist',
	bpm: 120,
	preview_url: null,
	download_url: null,
	is_published: false,
	display_id: null,
	publish_date: '2024-01-01',
	video_preview_url: null,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	user_id: 'test-user-id',
	dtx_files: []
};

// Replace global localStorage with mock
Object.defineProperty(window, 'localStorage', {
	value: localStorageMock,
	writable: true
});

describe('linkageCacheService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset localStorage mock to return empty cache
		localStorageMock.getItem.mockReturnValue(null);
	});

	describe('saveLinkage', () => {
		it('should save linkage data to localStorage', () => {
			const songPath = '/path/to/song';
			const cloudSongId = 'song123';
			const cloudSongData = sampleSimfile;

			linkageCacheService.saveLinkage(songPath, cloudSongId, cloudSongData);

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'dtx_linkage_cache',
				expect.stringContaining(songPath)
			);

			// Verify the data structure
			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData[songPath]).toEqual({
				linkedSimFileId: cloudSongId,
				linkedAt: expect.any(String),
				cloudSongData
			});
		});

		it('should handle localStorage errors gracefully', () => {
			localStorageMock.setItem.mockImplementation(() => {
				throw new Error('localStorage error');
			});

			// Should not throw
			expect(() => {
				linkageCacheService.saveLinkage('/path', 'id', sampleSimfile);
			}).not.toThrow();
		});
	});

	describe('getLinkage', () => {
		it('should return linkage data for existing song path', () => {
			const songPath = '/path/to/song';
			const linkageData = {
				linkedSimFileId: 'song123',
				linkedAt: '2025-06-28T12:00:00.000Z',
				cloudSongData: sampleSimfile
			};

			localStorageMock.getItem.mockReturnValue(JSON.stringify({ [songPath]: linkageData }));

			const result = linkageCacheService.getLinkage(songPath);
			expect(result).toEqual(linkageData);
		});

		it('should return null for non-existing song path', () => {
			localStorageMock.getItem.mockReturnValue(JSON.stringify({}));

			const result = linkageCacheService.getLinkage('/non-existing');
			expect(result).toBeNull();
		});

		it('should handle localStorage errors gracefully', () => {
			localStorageMock.getItem.mockImplementation(() => {
				throw new Error('localStorage error');
			});

			const result = linkageCacheService.getLinkage('/path');
			expect(result).toBeNull();
		});
	});

	describe('removeLinkage', () => {
		it('should remove linkage data for specific song path', () => {
			const existingCache = {
				'/path/to/song1': {
					linkedSimFileId: 'id1',
					linkedAt: '',
					cloudSongData: sampleSimfile
				},
				'/path/to/song2': {
					linkedSimFileId: 'id2',
					linkedAt: '',
					cloudSongData: sampleSimfile
				}
			};

			localStorageMock.getItem.mockReturnValue(JSON.stringify(existingCache));

			linkageCacheService.removeLinkage('/path/to/song1');

			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toEqual({
				'/path/to/song2': {
					linkedSimFileId: 'id2',
					linkedAt: '',
					cloudSongData: sampleSimfile
				}
			});
		});
	});

	describe('hasLinkage', () => {
		it('should return true for existing linkage', () => {
			const songPath = '/path/to/song';
			localStorageMock.getItem.mockReturnValue(
				JSON.stringify({
					[songPath]: { linkedSimFileId: 'id', linkedAt: '', cloudSongData: {} }
				})
			);

			expect(linkageCacheService.hasLinkage(songPath)).toBe(true);
		});

		it('should return false for non-existing linkage', () => {
			localStorageMock.getItem.mockReturnValue(JSON.stringify({}));

			expect(linkageCacheService.hasLinkage('/non-existing')).toBe(false);
		});
	});

	describe('clearCache', () => {
		it('should remove the entire cache from localStorage', () => {
			linkageCacheService.clearCache();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('dtx_linkage_cache');
		});
	});

	describe('getLinkedSongPaths', () => {
		it('should return all song paths with linkage data', () => {
			const cache = {
				'/path/to/song1': {
					linkedSimFileId: 'id1',
					linkedAt: '',
					cloudSongData: sampleSimfile
				},
				'/path/to/song2': {
					linkedSimFileId: 'id2',
					linkedAt: '',
					cloudSongData: sampleSimfile
				}
			};

			localStorageMock.getItem.mockReturnValue(JSON.stringify(cache));

			const result = linkageCacheService.getLinkedSongPaths();
			expect(result).toEqual(['/path/to/song1', '/path/to/song2']);
		});

		it('should return empty array for empty cache', () => {
			localStorageMock.getItem.mockReturnValue(JSON.stringify({}));

			const result = linkageCacheService.getLinkedSongPaths();
			expect(result).toEqual([]);
		});
	});
});
