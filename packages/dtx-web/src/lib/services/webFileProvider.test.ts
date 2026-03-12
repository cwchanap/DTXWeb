import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebFileProvider } from './webFileProvider';
import * as FileManager from '@dtx/common/services/fileManager';

vi.mock('@dtx/common/services/fileManager');

const mockFileManager = vi.mocked(FileManager);

describe('WebFileProvider', () => {
	let provider: WebFileProvider;
	const mockFile = new File(['test content'], 'test.dtx', { type: 'text/plain' });

	beforeEach(() => {
		provider = new WebFileProvider();
		vi.clearAllMocks();
	});

	describe('getFile', () => {
		it('should get file using generated key', async () => {
			const simfileId = 'test-simfile';
			const fileName = 'test.dtx';
			const expectedKey = 'generated-key';

			mockFileManager.generateKey.mockReturnValue(expectedKey);
			mockFileManager.getFile.mockReturnValue(mockFile);

			const result = await provider.getFile(simfileId, fileName);

			expect(mockFileManager.generateKey).toHaveBeenCalledWith(simfileId, fileName);
			expect(mockFileManager.getFile).toHaveBeenCalledWith(expectedKey);
			expect(result).toBe(mockFile);
		});

		it('should handle null simfileId', async () => {
			const fileName = 'test.dtx';
			const expectedKey = 'generated-key';

			mockFileManager.generateKey.mockReturnValue(expectedKey);
			mockFileManager.getFile.mockReturnValue(undefined);

			const result = await provider.getFile(null, fileName);

			expect(mockFileManager.generateKey).toHaveBeenCalledWith(null, fileName);
			expect(result).toBeUndefined();
		});
	});

	describe('setFile', () => {
		it('should set file successfully', async () => {
			const simfileId = 'test-simfile';
			const fileName = 'test.dtx';
			const expectedKey = 'generated-key';

			mockFileManager.generateKey.mockReturnValue(expectedKey);
			mockFileManager.setFile.mockImplementation(() => {});

			const result = await provider.setFile(simfileId, fileName, mockFile);

			expect(mockFileManager.generateKey).toHaveBeenCalledWith(simfileId, fileName);
			expect(mockFileManager.setFile).toHaveBeenCalledWith(expectedKey, mockFile);
			expect(result).toBe(true);
		});

		it('should handle errors and return false', async () => {
			const simfileId = 'test-simfile';
			const fileName = 'test.dtx';
			const expectedKey = 'generated-key';

			mockFileManager.generateKey.mockReturnValue(expectedKey);
			mockFileManager.setFile.mockImplementation(() => {
				throw new Error('Storage error');
			});

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await provider.setFile(simfileId, fileName, mockFile);

			expect(result).toBe(false);
			expect(consoleSpy).toHaveBeenCalledWith('Failed to set file:', expect.any(Error));

			consoleSpy.mockRestore();
		});
	});

	describe('removeFile', () => {
		it('should remove file using generated key', async () => {
			const simfileId = 'test-simfile';
			const fileName = 'test.dtx';
			const expectedKey = 'generated-key';

			mockFileManager.generateKey.mockReturnValue(expectedKey);
			mockFileManager.removeFile.mockReturnValue(true);

			const result = await provider.removeFile(simfileId, fileName);

			expect(mockFileManager.generateKey).toHaveBeenCalledWith(simfileId, fileName);
			expect(mockFileManager.removeFile).toHaveBeenCalledWith(expectedKey);
			expect(result).toBe(true);
		});

		it('should return false when removal fails', async () => {
			const simfileId = 'test-simfile';
			const fileName = 'test.dtx';
			const expectedKey = 'generated-key';

			mockFileManager.generateKey.mockReturnValue(expectedKey);
			mockFileManager.removeFile.mockReturnValue(false);

			const result = await provider.removeFile(simfileId, fileName);

			expect(result).toBe(false);
		});
	});

	describe('clearFiles', () => {
		it('should clear all files when simfileId is undefined', async () => {
			mockFileManager.clear.mockImplementation(() => {});

			const result = await provider.clearFiles(undefined);

			expect(mockFileManager.clear).toHaveBeenCalled();
			expect(result).toBe(true);
		});

		it('should clear files for specific simfile', async () => {
			const simfileId = 'test-simfile';
			const allKeys = [
				'test-simfile:file1.dtx',
				'test-simfile:file2.wav',
				'other-simfile:file3.dtx'
			];

			mockFileManager.getKeys.mockReturnValue(allKeys);
			mockFileManager.generateKey.mockImplementation(
				(id, fileName) => `${id || 'local'}:${fileName}`
			);
			mockFileManager.removeFile.mockReturnValue(true);

			const result = await provider.clearFiles(simfileId);

			expect(mockFileManager.getKeys).toHaveBeenCalled();
			expect(mockFileManager.removeFile).toHaveBeenCalledTimes(2);
			expect(mockFileManager.removeFile).toHaveBeenCalledWith('test-simfile:file1.dtx');
			expect(mockFileManager.removeFile).toHaveBeenCalledWith('test-simfile:file2.wav');
			expect(result).toBe(true);
		});

		it('should handle null simfileId', async () => {
			const allKeys = ['local:file1.dtx', 'local:file2.wav', 'other-simfile:file3.dtx'];

			mockFileManager.getKeys.mockReturnValue(allKeys);
			mockFileManager.generateKey.mockImplementation(
				(id, fileName) => `${id || 'local'}:${fileName}`
			);
			mockFileManager.removeFile.mockReturnValue(true);

			const result = await provider.clearFiles(null);

			expect(mockFileManager.removeFile).toHaveBeenCalledTimes(2);
			expect(mockFileManager.removeFile).toHaveBeenCalledWith('local:file1.dtx');
			expect(mockFileManager.removeFile).toHaveBeenCalledWith('local:file2.wav');
			expect(result).toBe(true);
		});

		it('should handle errors and return false', async () => {
			mockFileManager.clear.mockImplementation(() => {
				throw new Error('Clear error');
			});

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await provider.clearFiles(undefined);

			expect(result).toBe(false);
			expect(consoleSpy).toHaveBeenCalledWith('Failed to clear files:', expect.any(Error));

			consoleSpy.mockRestore();
		});

		it('should return true without removals when no keys match simfileId', async () => {
			const simfileId = 'target-simfile';
			mockFileManager.getKeys.mockReturnValue(['other:file1.dtx', 'another:file2.wav']);

			const result = await provider.clearFiles(simfileId);

			expect(result).toBe(true);
			expect(mockFileManager.removeFile).not.toHaveBeenCalled();
		});

		it('should handle errors in simfile-specific clear path and return false', async () => {
			mockFileManager.getKeys.mockImplementation(() => {
				throw new Error('Get keys error');
			});

			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const result = await provider.clearFiles('test-simfile');

			expect(result).toBe(false);
			expect(consoleSpy).toHaveBeenCalledWith('Failed to clear files:', expect.any(Error));

			consoleSpy.mockRestore();
		});
	});

	describe('getFileKeys', () => {
		it('should return all keys when simfileId is undefined', async () => {
			const allKeys = ['test-simfile:file1.dtx', 'other-simfile:file2.wav'];

			mockFileManager.getKeys.mockReturnValue(allKeys);

			const result = await provider.getFileKeys(undefined);

			expect(mockFileManager.getKeys).toHaveBeenCalled();
			expect(result).toEqual(allKeys);
		});

		it('should return filtered keys for specific simfile', async () => {
			const simfileId = 'test-simfile';
			const allKeys = [
				'test-simfile:file1.dtx',
				'test-simfile:file2.wav',
				'other-simfile:file3.dtx'
			];

			mockFileManager.getKeys.mockReturnValue(allKeys);

			const result = await provider.getFileKeys(simfileId);

			expect(result).toEqual(['file1.dtx', 'file2.wav']);
		});

		it('should handle null simfileId with local prefix', async () => {
			const allKeys = ['local:file1.dtx', 'local:file2.wav', 'other-simfile:file3.dtx'];

			mockFileManager.getKeys.mockReturnValue(allKeys);

			const result = await provider.getFileKeys(null);

			expect(result).toEqual(['file1.dtx', 'file2.wav']);
		});

		it('should return empty array when no matching keys', async () => {
			const simfileId = 'non-existent';
			const allKeys = ['test-simfile:file1.dtx', 'other-simfile:file2.wav'];

			mockFileManager.getKeys.mockReturnValue(allKeys);

			const result = await provider.getFileKeys(simfileId);

			expect(result).toEqual([]);
		});

		it('should treat empty simfileId as local prefix', async () => {
			const allKeys = ['local:file1.dtx', 'local:file2.wav', 'remote:file3.wav'];

			mockFileManager.getKeys.mockReturnValue(allKeys);

			const result = await provider.getFileKeys('');

			expect(result).toEqual(['file1.dtx', 'file2.wav']);
		});
	});
});
