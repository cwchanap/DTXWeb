import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simFileService } from './simFileService';

// Mock the electron API
const mockInvoke = vi.fn();
global.window = {
	...global.window,
	electron: {
		ipcRenderer: {
			invoke: mockInvoke
		}
	}
} as any;

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

Object.defineProperty(global, 'localStorage', {
	value: localStorageMock,
	writable: true
});

describe('SimFileService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.getItem.mockReturnValue(null);
	});

	describe('fetchUserSimFiles', () => {
		it('should fetch user simFiles from main process', async () => {
			const mockData = [
				{
					id: '1',
					title: 'Test Song',
					artist: 'Test Artist',
					bpm: 120,
					dtx_files: [{ level: 5 }]
				}
			];

			mockInvoke.mockResolvedValue({
				data: mockData,
				fromCache: false,
				error: null
			});

			const result = await simFileService.fetchUserSimFiles();

			expect(mockInvoke).toHaveBeenCalledWith('fetch-user-simfiles');
			expect(result.data).toEqual(mockData);
			expect(result.fromCache).toBe(false);
			expect(result.error).toBeUndefined();
		});

		it('should return cached data when available', async () => {
			const cachedData = [{ id: '1', title: 'Cached Song' }];
			const cacheTimestamp = Date.now().toString();

			localStorageMock.getItem
				.mockReturnValueOnce(JSON.stringify(cachedData))
				.mockReturnValueOnce(cacheTimestamp);

			const result = await simFileService.fetchUserSimFiles();

			expect(mockInvoke).not.toHaveBeenCalled();
			expect(result.data).toEqual(cachedData);
			expect(result.fromCache).toBe(true);
		});

		it('should handle errors from main process', async () => {
			mockInvoke.mockResolvedValue({
				data: [],
				fromCache: false,
				error: 'Authentication failed'
			});

			const result = await simFileService.fetchUserSimFiles();

			expect(result.error).toBe('Authentication failed');
			expect(result.data).toEqual([]);
		});
	});

	describe('getPreviewUrl', () => {
		it('should get preview URL from main process', async () => {
			const mockUrl = 'https://example.com/preview.jpg';
			mockInvoke.mockResolvedValue(mockUrl);

			const result = await simFileService.getPreviewUrl('test-preview');

			expect(mockInvoke).toHaveBeenCalledWith('get-preview-url', 'test-preview');
			expect(result).toBe(mockUrl);
		});
	});

	describe('getSoundPreviewUrl', () => {
		it('should get sound preview URL from main process', async () => {
			const mockUrl = 'https://example.com/sound-preview.mp3';
			mockInvoke.mockResolvedValue(mockUrl);

			const result = await simFileService.getSoundPreviewUrl('test-sound-preview');

			expect(mockInvoke).toHaveBeenCalledWith('get-sound-preview-url', 'test-sound-preview');
			expect(result).toBe(mockUrl);
		});

		it('should handle null sound preview URL', async () => {
			mockInvoke.mockResolvedValue(null);

			const result = await simFileService.getSoundPreviewUrl(null);

			expect(mockInvoke).toHaveBeenCalledWith('get-sound-preview-url', null);
			expect(result).toBe(null);
		});
	});

	describe('cache management', () => {
		it('should clear cache', () => {
			simFileService.clearCache();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache_timestamp');
		});

		it('should refresh user simFiles by clearing cache and fetching new data', async () => {
			const mockData = [{ id: '1', title: 'Refreshed Song' }];
			mockInvoke.mockResolvedValue({
				data: mockData,
				fromCache: false
			});

			const result = await simFileService.refreshUserSimFiles();

			expect(localStorageMock.removeItem).toHaveBeenCalled();
			expect(result.data).toEqual(mockData);
		});
	});
});
