import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadAssetFiles } from './assetFileService';

describe('assetFileService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockReset();
	});

	describe('loadAssetFiles', () => {
		it('throws when simfileId is empty string', async () => {
			await expect(loadAssetFiles('')).rejects.toThrow('SimfileId is required');
		});

		it('calls IPC with load-asset-files and simfileId', async () => {
			const mockFiles = [
				{
					fileName: 'chart.dtx',
					size: 1024,
					lastModified: '2024-01-01',
					key: 'sim1/chart.dtx'
				}
			];
			(window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(
				mockFiles
			);

			await loadAssetFiles('sim1');

			expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
				'load-asset-files',
				'sim1'
			);
		});

		it('returns array of asset files from IPC', async () => {
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
			(window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(
				mockFiles
			);

			const result = await loadAssetFiles('sim1');

			expect(result).toHaveLength(2);
			expect(result[0].fileName).toBe('chart.dtx');
			expect(result[1].fileName).toBe('preview.mp3');
		});

		it('propagates IPC errors', async () => {
			(window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('IPC communication error')
			);

			await expect(loadAssetFiles('sim1')).rejects.toThrow('IPC communication error');
		});

		it('returns empty array when no files exist', async () => {
			(window.electron.ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);

			const result = await loadAssetFiles('sim1');
			expect(result).toHaveLength(0);
		});
	});
});
