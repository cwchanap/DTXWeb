import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAssetFiles, type AssetFile } from './assetFileService';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AssetFileService', () => {
	beforeEach(() => {
		mockFetch.mockClear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('loadAssetFiles', () => {
		it('should throw error when simfileId is empty', async () => {
			await expect(loadAssetFiles('')).rejects.toThrow('SimfileId is required');
		});

		it('should throw error when simfileId is null', async () => {
			await expect(loadAssetFiles(null as any)).rejects.toThrow('SimfileId is required');
		});

		it('should fetch asset files successfully', async () => {
			const mockFiles: AssetFile[] = [
				{
					fileName: 'kick.wav',
					size: 1024,
					lastModified: '2023-01-01T00:00:00Z',
					key: 'kick.wav'
				},
				{
					fileName: 'snare.wav',
					size: 2048,
					lastModified: '2023-01-01T00:00:00Z',
					key: 'snare.wav'
				}
			];

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValueOnce({ files: mockFiles })
			});

			const result = await loadAssetFiles('test-simfile-id');

			expect(mockFetch).toHaveBeenCalledWith('/api/simFile/listFiles/test-simfile-id');
			expect(result).toEqual(mockFiles);
		});

		it('should throw error when fetch fails', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				statusText: 'Not Found'
			});

			await expect(loadAssetFiles('invalid-id')).rejects.toThrow(
				'Error fetching files: Not Found'
			);
		});

		it('should handle network errors', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			await expect(loadAssetFiles('test-id')).rejects.toThrow('Network error');
		});

		it('should handle malformed JSON response', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockRejectedValueOnce(new Error('Invalid JSON'))
			});

			await expect(loadAssetFiles('test-id')).rejects.toThrow('Invalid JSON');
		});

		it('should use correct API endpoint format', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValueOnce({ files: [] })
			});

			await loadAssetFiles('my-simfile-123');

			expect(mockFetch).toHaveBeenCalledWith('/api/simFile/listFiles/my-simfile-123');
		});
	});
});
