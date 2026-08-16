import { describe, it, expect, beforeEach, vi } from 'vitest';
import { linkageCacheService } from './linkageCacheService';

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

// Current-model (camelCase) simfile shape, mirroring what the native boundary
// emits (src-tauri/tests/fixtures/simfile_model.json).
const sampleSimfile = {
	id: 1,
	title: 'Test Song',
	artist: 'Artist',
	bpm: 120,
	displayId: null,
	userId: 'test-user-id',
	googleDriveFileId: null,
	isPublished: false,
	downloadUrl: null,
	previewUrl: null,
	videoPreviewUrl: null,
	publishDate: '2024-01-01',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-01T00:00:00Z',
	dtxFiles: []
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
				'dtx_linkage_cache_v2',
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

		it('should handle getCache throwing gracefully', () => {
			vi.spyOn(linkageCacheService, 'getCache').mockImplementationOnce(() => {
				throw new Error('unexpected error');
			});

			const result = linkageCacheService.getLinkage('/path');
			expect(result).toBeNull();
		});

		it('ignores a legacy cache seeded under the v1 key', () => {
			// A previous app version wrote linkage entries (old snake_case
			// shape) under 'dtx_linkage_cache'. The v2 service must not read,
			// migrate, or delete it — every read misses.
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key !== 'dtx_linkage_cache') return null;
				return JSON.stringify({
					'/path/to/song': {
						linkedSimFileId: 'song123',
						linkedAt: '2025-06-28T12:00:00.000Z',
						cloudSongData: { id: 1, title: 'Old Shape', is_published: false }
					}
				});
			});

			expect(linkageCacheService.getLinkage('/path/to/song')).toBeNull();
			expect(linkageCacheService.hasLinkage('/path/to/song')).toBe(false);
			expect(linkageCacheService.getLinkedSongPaths()).toEqual([]);

			// saveLinkage must start from an empty v2 cache, not inherit v1 entries
			linkageCacheService.saveLinkage('/new/path', 'song123', sampleSimfile);
			const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1]);
			expect(savedData).toEqual({
				'/new/path': {
					linkedSimFileId: 'song123',
					linkedAt: expect.any(String),
					cloudSongData: sampleSimfile
				}
			});
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('dtx_linkage_cache');
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

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('dtx_linkage_cache_v2');
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

	describe('removeLinkage error handling', () => {
		it('should handle localStorage errors gracefully', () => {
			localStorageMock.getItem.mockImplementation(() => {
				throw new Error('localStorage error');
			});

			expect(() => linkageCacheService.removeLinkage('/path')).not.toThrow();
		});
	});

	describe('clearCache error handling', () => {
		it('should handle localStorage errors gracefully', () => {
			localStorageMock.removeItem.mockImplementation(() => {
				throw new Error('localStorage error');
			});

			expect(() => linkageCacheService.clearCache()).not.toThrow();
		});
	});

	describe('getAllLinkageData', () => {
		it('should return all cache data and log debug output', () => {
			const cache = {
				'/path/song1': {
					linkedSimFileId: 'id1',
					linkedAt: '2025-01-01T00:00:00Z',
					cloudSongData: sampleSimfile
				}
			};
			localStorageMock.getItem.mockReturnValue(JSON.stringify(cache));

			const result = linkageCacheService.getAllLinkageData();

			expect(result).toEqual(cache);
		});

		it('should return empty object when cache is empty', () => {
			localStorageMock.getItem.mockReturnValue(JSON.stringify({}));

			const result = linkageCacheService.getAllLinkageData();

			expect(result).toEqual({});
		});
	});

	describe('debugLocalStorage', () => {
		it('should log debug info without throwing', () => {
			localStorageMock.getItem.mockReturnValue(
				JSON.stringify({
					'/path': { linkedSimFileId: 'id', linkedAt: '', cloudSongData: {} }
				})
			);

			expect(() => linkageCacheService.debugLocalStorage()).not.toThrow();
		});

		it('should handle invalid JSON in localStorage gracefully', () => {
			localStorageMock.getItem.mockReturnValue('INVALID_JSON');

			expect(() => linkageCacheService.debugLocalStorage()).not.toThrow();
		});
	});
});
