import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { simFileService } from './simFileService';
import { desktopHost } from './desktopHost';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		fetchUserSimfiles: vi.fn(),
		getPreviewUrl: vi.fn(),
		getSoundPreviewUrl: vi.fn(),
		getNextDisplayId: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

// Shared behavioral seam: the exact camelCase full-simfile JSON emitted by
// the native boundary (src-tauri/tests/fixtures/simfile_model.json). Read at
// runtime with Node so tests stay excluded from the production typecheck
// (tsconfig.web.json). This test asserts the renderer reads the current
// model's field names off real native-shaped traffic.
const sharedSimfileFixture = JSON.parse(
	readFileSync(resolve(process.cwd(), 'src-tauri/tests/fixtures/simfile_model.json'), 'utf8')
);

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
		it('should fetch user simFiles from the Rust backend', async () => {
			host.fetchUserSimfiles.mockResolvedValue({
				success: true,
				data: [sharedSimfileFixture],
				fromCache: false
			});

			const result = await simFileService.fetchUserSimFiles();

			expect(host.fetchUserSimfiles).toHaveBeenCalledWith();
			expect(result.data).toEqual([sharedSimfileFixture]);
			// Renderer code reads the current-model field names of the native payload
			expect(result.data[0].title).toBe('Fixture Song');
			expect(result.data[0].artist).toBe('Fixture Artist');
			expect(result.data[0].bpm).toBe(123.5);
			expect(result.data[0].isPublished).toBe(true);
			expect(result.data[0].publishDate).toBe('2026-08-15');
			expect(result.data[0].dtxFiles).toEqual([{ id: 99, label: 'EXT', level: 85 }]);
			expect(result.fromCache).toBe(false);
			expect(result.error).toBeUndefined();
		});

		it('should return cached data when available', async () => {
			const cachedData = [sharedSimfileFixture];
			const cacheTimestamp = Date.now().toString();

			localStorageMock.getItem
				.mockReturnValueOnce(JSON.stringify(cachedData))
				.mockReturnValueOnce(cacheTimestamp);

			const result = await simFileService.fetchUserSimFiles();

			expect(host.fetchUserSimfiles).not.toHaveBeenCalled();
			expect(result.data).toEqual(cachedData);
			expect(result.data[0].title).toBe('Fixture Song');
			expect(result.fromCache).toBe(true);
		});

		it('should handle errors from the Rust backend', async () => {
			host.fetchUserSimfiles.mockResolvedValue({
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

			host.fetchUserSimfiles.mockResolvedValue({
				success: true,
				data: [],
				fromCache: false
			});

			await simFileService.fetchUserSimFiles();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache_v2');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache_timestamp_v2');
		});

		it('ignores a valid-looking legacy cache under the v1 key and still calls IPC', async () => {
			// A previous app version cached the old snake_case shape under
			// 'simfiles_cache'. The v2 service must not read, migrate, or
			// delete it — it simply misses and falls through to IPC.
			localStorageMock.getItem.mockImplementation((key: string) => {
				if (key === 'simfiles_cache') {
					return JSON.stringify([{ id: 1, title: 'Old Shape', is_published: false }]);
				}
				if (key === 'simfiles_cache_timestamp') return Date.now().toString();
				return null;
			});

			host.fetchUserSimfiles.mockResolvedValue({
				success: true,
				data: [sharedSimfileFixture],
				fromCache: false
			});

			const result = await simFileService.fetchUserSimFiles();

			expect(host.fetchUserSimfiles).toHaveBeenCalledWith();
			expect(result.data).toEqual([sharedSimfileFixture]);
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('simfiles_cache');
			expect(localStorageMock.removeItem).not.toHaveBeenCalledWith(
				'simfiles_cache_timestamp'
			);
		});
	});

	describe('cache management', () => {
		it('should clear cache', () => {
			simFileService.clearCache();

			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache_v2');
			expect(localStorageMock.removeItem).toHaveBeenCalledWith('simfiles_cache_timestamp_v2');
		});

		it('should refresh user simFiles by clearing cache and fetching new data', async () => {
			const mockData = [{ id: 1, title: 'Refreshed Song' }];
			host.fetchUserSimfiles.mockResolvedValue({
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
				.mockReturnValueOnce(JSON.stringify([{ id: 1 }]))
				.mockReturnValueOnce(expiredTimestamp);

			host.fetchUserSimfiles.mockResolvedValue({ success: true, data: [], fromCache: false });

			await simFileService.fetchUserSimFiles();

			expect(host.fetchUserSimfiles).toHaveBeenCalledWith();
		});

		it('should handle setCachedData localStorage errors gracefully', async () => {
			localStorageMock.getItem.mockReturnValue(null);
			localStorageMock.setItem.mockImplementation(() => {
				throw new Error('Storage full');
			});
			host.fetchUserSimfiles.mockResolvedValue({
				success: true,
				data: [{ id: 1, title: 'Test' }],
				fromCache: false
			});

			await expect(simFileService.fetchUserSimFiles()).resolves.toBeDefined();
		});

		it('should return error result when IPC throws', async () => {
			localStorageMock.getItem.mockReturnValue(null);
			host.fetchUserSimfiles.mockRejectedValue(new Error('IPC failure'));

			const result = await simFileService.fetchUserSimFiles();

			expect(result.data).toEqual([]);
			expect(result.fromCache).toBe(false);
			expect(result.error).toBe('IPC failure');
		});
	});

	describe('getPreviewUrl', () => {
		it('should return preview URL from IPC', async () => {
			host.getPreviewUrl.mockResolvedValue('https://cdn.example.com/1/preview.jpg');

			const url = await simFileService.getPreviewUrl(1);

			expect(host.getPreviewUrl).toHaveBeenCalledWith(1);
			expect(url).toBe('https://cdn.example.com/1/preview.jpg');
		});

		it('should return empty string on IPC error', async () => {
			host.getPreviewUrl.mockRejectedValue(new Error('network error'));

			const url = await simFileService.getPreviewUrl(42);

			expect(url).toBe('');
		});
	});

	describe('getSoundPreviewUrl', () => {
		it('should return sound preview URL from IPC', async () => {
			host.getSoundPreviewUrl.mockResolvedValue('https://cdn.example.com/1/preview.mp3');

			const url = await simFileService.getSoundPreviewUrl(1);

			expect(host.getSoundPreviewUrl).toHaveBeenCalledWith(1);
			expect(url).toBe('https://cdn.example.com/1/preview.mp3');
		});

		it('should return empty string on IPC error', async () => {
			host.getSoundPreviewUrl.mockRejectedValue(new Error('network error'));

			const url = await simFileService.getSoundPreviewUrl(99);

			expect(url).toBe('');
		});
	});

	describe('getNextDisplayId', () => {
		it('returns the next displayId from IPC', async () => {
			host.getNextDisplayId.mockResolvedValue(7);

			const result = await simFileService.getNextDisplayId();

			expect(host.getNextDisplayId).toHaveBeenCalledWith();
			expect(result).toBe(7);
		});

		it('propagates IPC errors', async () => {
			host.getNextDisplayId.mockRejectedValue(new Error('IPC failure'));
			await expect(simFileService.getNextDisplayId()).rejects.toThrow('IPC failure');
		});

		it('rejects invalid IPC response shapes', async () => {
			host.getNextDisplayId.mockResolvedValue(undefined);
			await expect(simFileService.getNextDisplayId()).rejects.toThrow(
				'Invalid next displayId response'
			);
		});
	});
});
