import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadAssetFiles } from './assetFileService';
import { desktopHost } from './desktopHost';

vi.mock('./desktopHost', () => ({
	desktopHost: {
		loadAssetFiles: vi.fn()
	}
}));

const host = vi.mocked(desktopHost);

describe('assetFileService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('loadAssetFiles', () => {
		it('throws when simfileId is empty string', async () => {
			await expect(loadAssetFiles('')).rejects.toThrow('SimfileId is required');
		});

		it('calls host with simfileId', async () => {
			const mockFiles = [
				{
					fileName: 'chart.dtx',
					size: 1024,
					lastModified: '2024-01-01',
					key: 'sim1/chart.dtx'
				}
			];
			host.loadAssetFiles.mockResolvedValue({
				success: true,
				data: mockFiles
			});

			await loadAssetFiles('sim1');

			expect(host.loadAssetFiles).toHaveBeenCalledWith('sim1');
		});

		it('returns success result with data from IPC', async () => {
			const mockFiles = [
				{
					fileName: 'chart.dtx',
					size: 1024,
					lastModified: '2024-01-01',
					key: 'sim1/chart.dtx'
				},
				{
					fileName: 'preview.mp3',
					size: 2048,
					lastModified: '2024-01-02',
					key: 'sim1/preview.mp3'
				}
			];
			host.loadAssetFiles.mockResolvedValue({
				success: true,
				data: mockFiles
			});

			const result = await loadAssetFiles('sim1');

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toHaveLength(2);
				expect(result.data[0].fileName).toBe('chart.dtx');
				expect(result.data[1].fileName).toBe('preview.mp3');
			}
		});

		it('returns error result when IPC returns failure', async () => {
			host.loadAssetFiles.mockResolvedValue({
				success: false,
				error: 'Network error'
			});

			const result = await loadAssetFiles('sim1');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('Network error');
			}
		});

		it('propagates host errors', async () => {
			host.loadAssetFiles.mockRejectedValue(new Error('IPC communication error'));

			await expect(loadAssetFiles('sim1')).rejects.toThrow('IPC communication error');
		});

		it('returns success with empty data when no files exist', async () => {
			host.loadAssetFiles.mockResolvedValue({
				success: true,
				data: []
			});

			const result = await loadAssetFiles('sim1');
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toHaveLength(0);
			}
		});
	});
});
