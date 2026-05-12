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
				success: true,
				data: mockData,
				fromCache: false
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
				success: false,
				data: [],
				fromCache: false,
				error: 'Authentication failed'
			});

			const result = await simFileService.fetchUserSimFiles();

			expect(result.error).toBe('Authentication failed');
			expect(result.data).toEqual([]);
		});

		it('clears corrupt cache entry and falls through to IPC on JSON parse failure', async () => {
			localStorageMock.getItem
				.mockReturnValueOnce('NOT_VALID_JSON')
				.mockReturnValueOnce(Date.now().toString());

			mockInvoke.mockResolvedValue({
				success: true,
				data: [],
				fromCache: false
			});

			await simFileService.fetchUserSimFiles();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache_timestamp');
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
				success: true,
				data: mockData,
				fromCache: false
			});

			const result = await simFileService.refreshUserSimFiles();

			expect(localStorageMock.removeItem).toHaveBeenCalled();
			expect(result.data).toEqual(mockData);
		});

		it('should fall through to IPC when cache timestamp is expired', async () => {
			const expiredTimestamp = (Date.now() - 10 * 60 * 1000).toString();
			localStorageMock.getItem
				.mockReturnValueOnce(JSON.stringify([{ id: '1' }]))
				.mockReturnValueOnce(expiredTimestamp);

			mockInvoke.mockResolvedValue({ success: true, data: [], fromCache: false });

			await simFileService.fetchUserSimFiles();

			expect(mockInvoke).toHaveBeenCalledWith('fetch-user-simfiles');
		});

		it('should handle setCachedData localStorage errors gracefully', async () => {
			localStorageMock.getItem.mockReturnValue(null);
			localStorageMock.setItem.mockImplementation(() => {
				throw new Error('Storage full');
			});
			mockInvoke.mockResolvedValue({
				success: true,
				data: [{ id: '1', title: 'Test' }],
				fromCache: false
			});

			await expect(simFileService.fetchUserSimFiles()).resolves.toBeDefined();
		});

		it('should return error result when IPC throws', async () => {
			localStorageMock.getItem.mockReturnValue(null);
			mockInvoke.mockRejectedValue(new Error('IPC failure'));

			const result = await simFileService.fetchUserSimFiles();

			expect(result.data).toEqual([]);
			expect(result.fromCache).toBe(false);
			expect(result.error).toBe('IPC failure');
		});
	});

	describe('getPreviewUrl', () => {
		it('should return preview URL from IPC', async () => {
			mockInvoke.mockResolvedValue('https://cdn.example.com/1/preview.jpg');

			const url = await simFileService.getPreviewUrl(1);

			expect(mockInvoke).toHaveBeenCalledWith('get-preview-url', 1);
			expect(url).toBe('https://cdn.example.com/1/preview.jpg');
		});

		it('should return empty string on IPC error', async () => {
			mockInvoke.mockRejectedValue(new Error('network error'));

			const url = await simFileService.getPreviewUrl(42);

			expect(url).toBe('');
		});
	});

	describe('getSoundPreviewUrl', () => {
		it('should return sound preview URL from IPC', async () => {
			mockInvoke.mockResolvedValue('https://cdn.example.com/1/preview.mp3');

			const url = await simFileService.getSoundPreviewUrl(1);

			expect(mockInvoke).toHaveBeenCalledWith('get-sound-preview-url', 1);
			expect(url).toBe('https://cdn.example.com/1/preview.mp3');
		});

		it('should return empty string on IPC error', async () => {
			mockInvoke.mockRejectedValue(new Error('network error'));

			const url = await simFileService.getSoundPreviewUrl(99);

			expect(url).toBe('');
		});
	});

	describe('getNextDisplayId', () => {
		it('returns the next display_id from IPC', async () => {
			mockInvoke.mockResolvedValue(7);

			const result = await simFileService.getNextDisplayId();

			expect(mockInvoke).toHaveBeenCalledWith('get-next-display-id');
			expect(result).toBe(7);
		});

		it('propagates IPC errors', async () => {
			mockInvoke.mockRejectedValue(new Error('IPC failure'));
			await expect(simFileService.getNextDisplayId()).rejects.toThrow('IPC failure');
		});
	});
});
