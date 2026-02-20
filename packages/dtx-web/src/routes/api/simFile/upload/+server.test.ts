import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _sanitizeFilename, _purgeCacheForFile } from './+server';
import { env } from '$env/dynamic/private';
import logger from '$lib/server/logger';

// Mock dependencies
vi.mock('$env/dynamic/private', () => ({
	env: {
		CLOUDFLARE_ZONE_ID: 'test-zone-id',
		CLOUDFLARE_API_TOKEN: 'test-api-token'
	}
}));

vi.mock('$lib/server/logger', () => ({
	default: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn()
	}
}));

describe('upload server utilities', () => {
	describe('_sanitizeFilename', () => {
		it('should preserve normal filenames', () => {
			expect(_sanitizeFilename('song.dtx')).toBe('song.dtx');
			expect(_sanitizeFilename('preview.mp3')).toBe('preview.mp3');
			expect(_sanitizeFilename('set.def')).toBe('set.def');
		});

		it('should preserve directory structure', () => {
			expect(_sanitizeFilename('folder/song.dtx')).toBe('folder/song.dtx');
			expect(_sanitizeFilename('audio/kick.wav')).toBe('audio/kick.wav');
		});

		it('should remove path traversal sequences', () => {
			expect(_sanitizeFilename('../../../etc/passwd')).toBe('etc/passwd');
			expect(_sanitizeFilename(String.raw`..\..\..\secret`)).toBe('secret');
			expect(_sanitizeFilename('folder/../../../secret')).toBe('folder/secret');
		});

		it('should handle multiple consecutive path traversals', () => {
			expect(_sanitizeFilename(String.raw`..\..\..\..\..\secret`)).toBe('secret');
		});

		it('should remove leading slashes', () => {
			expect(_sanitizeFilename('/absolute/path')).toBe('absolute/path');
			expect(_sanitizeFilename('///multiple/slashes')).toBe('multiple/slashes');
		});

		it('should remove trailing slashes', () => {
			expect(_sanitizeFilename('path/')).toBe('path');
			expect(_sanitizeFilename('path///')).toBe('path');
		});

		it('should normalize backslashes to forward slashes', () => {
			expect(_sanitizeFilename('folder\\file.dtx')).toBe('folder/file.dtx');
			expect(_sanitizeFilename('..\\..\\secret')).toBe('secret');
		});

		it('should remove null bytes and control characters', () => {
			expect(_sanitizeFilename('file\x00.dtx')).toBe('file.dtx');
			expect(_sanitizeFilename('file\x1f.dtx')).toBe('file.dtx');
		});

		it('should truncate very long filenames while preserving extension', () => {
			const longName = 'a'.repeat(1100) + '.dtx';
			const result = _sanitizeFilename(longName);
			expect(result.length).toBeLessThanOrEqual(1024);
			expect(result.endsWith('.dtx')).toBe(true);
		});

		it('should generate fallback for empty or invalid results', () => {
			const result1 = _sanitizeFilename('');
			expect(result1.startsWith('file_')).toBe(true);

			const result2 = _sanitizeFilename('...');
			expect(result2.startsWith('file_')).toBe(true);

			const result3 = _sanitizeFilename('//');
			expect(result3.startsWith('file_')).toBe(true);
		});

		it('should preserve non-ASCII characters', () => {
			expect(_sanitizeFilename('日本語.dtx')).toBe('日本語.dtx');
			expect(_sanitizeFilename('曲名/song.dtx')).toBe('曲名/song.dtx');
		});
	});

	describe('_purgeCacheForFile', () => {
		const originalFetch = global.fetch;

		beforeEach(() => {
			vi.clearAllMocks();
			global.fetch = vi.fn();
		});

		afterEach(() => {
			global.fetch = originalFetch;
		});

		it('should return false when credentials are not configured', async () => {
			vi.mocked(env).CLOUDFLARE_ZONE_ID = undefined as unknown as string;
			vi.mocked(env).CLOUDFLARE_API_TOKEN = undefined as unknown as string;

			const result = await _purgeCacheForFile('https://example.com/file.dtx');

			expect(result).toBe(false);
			expect(logger.warn).toHaveBeenCalledWith(
				'Cloudflare cache purge skipped: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not configured'
			);
		});

		it('should successfully purge cache', async () => {
			vi.mocked(env).CLOUDFLARE_ZONE_ID = 'test-zone-id';
			vi.mocked(env).CLOUDFLARE_API_TOKEN = 'test-api-token';

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ success: true })
			} as Response);

			const result = await _purgeCacheForFile('https://example.com/123/song.dtx');

			expect(result).toBe(true);
			expect(global.fetch).toHaveBeenCalledWith(
				'https://api.cloudflare.com/client/v4/zones/test-zone-id/purge_cache',
				{
					method: 'POST',
					headers: {
						Authorization: 'Bearer test-api-token',
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ files: ['https://example.com/123/song.dtx'] })
				}
			);
			expect(logger.info).toHaveBeenCalledWith(
				'Successfully purged cache for: https://example.com/123/song.dtx'
			);
		});

		it('should handle API errors', async () => {
			vi.mocked(env).CLOUDFLARE_ZONE_ID = 'test-zone-id';
			vi.mocked(env).CLOUDFLARE_API_TOKEN = 'test-api-token';

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: false,
				status: 403,
				text: () => Promise.resolve('Forbidden')
			} as Response);

			const result = await _purgeCacheForFile('https://example.com/123/song.dtx');

			expect(result).toBe(false);
			expect(logger.error).toHaveBeenCalledWith(
				'Failed to purge cache for https://example.com/123/song.dtx: 403 Forbidden'
			);
		});

		it('should handle unsuccessful purge response', async () => {
			vi.mocked(env).CLOUDFLARE_ZONE_ID = 'test-zone-id';
			vi.mocked(env).CLOUDFLARE_API_TOKEN = 'test-api-token';

			vi.mocked(global.fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ success: false, errors: ['Invalid file URL'] })
			} as Response);

			const result = await _purgeCacheForFile('https://example.com/123/song.dtx');

			expect(result).toBe(false);
			expect(logger.error).toHaveBeenCalledWith(
				'Cache purge failed for https://example.com/123/song.dtx:',
				['Invalid file URL']
			);
		});

		it('should handle network errors', async () => {
			vi.mocked(env).CLOUDFLARE_ZONE_ID = 'test-zone-id';
			vi.mocked(env).CLOUDFLARE_API_TOKEN = 'test-api-token';

			vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

			const result = await _purgeCacheForFile('https://example.com/123/song.dtx');

			expect(result).toBe(false);
			expect(logger.error).toHaveBeenCalledWith(
				'Error purging cache for https://example.com/123/song.dtx:',
				expect.any(Error)
			);
		});
	});
});
