import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	type IFileProvider,
	setFileProvider,
	getFileProvider,
	getFile,
	setFile,
	removeFile,
	clearFiles,
	getFileKeys
} from './fileProvider';

describe('fileProvider', () => {
	let mockProvider: IFileProvider;
	let mockFile: File;

	beforeEach(() => {
		vi.clearAllMocks();

		// Reset the file provider instance
		setFileProvider({} as IFileProvider);

		mockFile = new File(['test content'], 'test.txt');

		// Create mock provider
		mockProvider = {
			getFile: vi.fn(),
			setFile: vi.fn(),
			removeFile: vi.fn(),
			clearFiles: vi.fn(),
			getFileKeys: vi.fn()
		};
	});

	describe('setFileProvider', () => {
		it('should set file provider instance', () => {
			setFileProvider(mockProvider);

			const provider = getFileProvider();
			expect(provider).toBe(mockProvider);
		});

		it('should allow overriding existing provider', () => {
			const provider1 = { ...mockProvider };
			const provider2 = { ...mockProvider };

			setFileProvider(provider1);
			setFileProvider(provider2);

			const currentProvider = getFileProvider();
			expect(currentProvider).toBe(provider2);
		});
	});

	describe('getFileProvider', () => {
		it('should return current file provider', () => {
			setFileProvider(mockProvider);

			const provider = getFileProvider();
			expect(provider).toBe(mockProvider);
		});

		it('should throw error when no provider set', () => {
			// Set provider to null to simulate uninitialized state
			setFileProvider(null as unknown as IFileProvider);

			expect(() => getFileProvider()).toThrow(
				'No file provider has been set. Call setFileProvider() during app initialization.'
			);
		});
	});

	describe('convenience functions', () => {
		beforeEach(() => {
			setFileProvider(mockProvider);
		});

		describe('getFile', () => {
			it('should delegate to provider getFile method', async () => {
				const expectedFile = mockFile;
				mockProvider.getFile = vi.fn().mockResolvedValue(expectedFile);

				const result = await getFile('simfile-id', 'test.txt');

				expect(mockProvider.getFile).toHaveBeenCalledWith('simfile-id', 'test.txt');
				expect(result).toBe(expectedFile);
			});

			it('should handle null simfileId', async () => {
				mockProvider.getFile = vi.fn().mockResolvedValue(mockFile);

				await getFile(null, 'test.txt');

				expect(mockProvider.getFile).toHaveBeenCalledWith(null, 'test.txt');
			});

			it('should return undefined when file not found', async () => {
				mockProvider.getFile = vi.fn().mockResolvedValue(undefined);

				const result = await getFile('simfile-id', 'missing.txt');

				expect(result).toBeUndefined();
			});
		});

		describe('setFile', () => {
			it('should delegate to provider setFile method', async () => {
				mockProvider.setFile = vi.fn().mockResolvedValue(true);

				const result = await setFile('simfile-id', 'test.txt', mockFile);

				expect(mockProvider.setFile).toHaveBeenCalledWith(
					'simfile-id',
					'test.txt',
					mockFile
				);
				expect(result).toBe(true);
			});

			it('should handle null simfileId', async () => {
				mockProvider.setFile = vi.fn().mockResolvedValue(true);

				await setFile(null, 'test.txt', mockFile);

				expect(mockProvider.setFile).toHaveBeenCalledWith(null, 'test.txt', mockFile);
			});

			it('should return false on failure', async () => {
				mockProvider.setFile = vi.fn().mockResolvedValue(false);

				const result = await setFile('simfile-id', 'test.txt', mockFile);

				expect(result).toBe(false);
			});
		});

		describe('removeFile', () => {
			it('should delegate to provider removeFile method', async () => {
				mockProvider.removeFile = vi.fn().mockResolvedValue(true);

				const result = await removeFile('simfile-id', 'test.txt');

				expect(mockProvider.removeFile).toHaveBeenCalledWith('simfile-id', 'test.txt');
				expect(result).toBe(true);
			});

			it('should handle null simfileId', async () => {
				mockProvider.removeFile = vi.fn().mockResolvedValue(true);

				await removeFile(null, 'test.txt');

				expect(mockProvider.removeFile).toHaveBeenCalledWith(null, 'test.txt');
			});

			it('should return false when removal fails', async () => {
				mockProvider.removeFile = vi.fn().mockResolvedValue(false);

				const result = await removeFile('simfile-id', 'test.txt');

				expect(result).toBe(false);
			});
		});

		describe('clearFiles', () => {
			it('should delegate to provider clearFiles method', async () => {
				mockProvider.clearFiles = vi.fn().mockResolvedValue(true);

				const result = await clearFiles('simfile-id');

				expect(mockProvider.clearFiles).toHaveBeenCalledWith('simfile-id');
				expect(result).toBe(true);
			});

			it('should handle undefined simfileId', async () => {
				mockProvider.clearFiles = vi.fn().mockResolvedValue(true);

				await clearFiles();

				expect(mockProvider.clearFiles).toHaveBeenCalledWith(undefined);
			});

			it('should handle null simfileId', async () => {
				mockProvider.clearFiles = vi.fn().mockResolvedValue(true);

				await clearFiles(null);

				expect(mockProvider.clearFiles).toHaveBeenCalledWith(null);
			});

			it('should return false on failure', async () => {
				mockProvider.clearFiles = vi.fn().mockResolvedValue(false);

				const result = await clearFiles('simfile-id');

				expect(result).toBe(false);
			});
		});

		describe('getFileKeys', () => {
			it('should delegate to provider getFileKeys method', async () => {
				const expectedKeys = ['file1.txt', 'file2.txt'];
				mockProvider.getFileKeys = vi.fn().mockResolvedValue(expectedKeys);

				const result = await getFileKeys('simfile-id');

				expect(mockProvider.getFileKeys).toHaveBeenCalledWith('simfile-id');
				expect(result).toEqual(expectedKeys);
			});

			it('should handle undefined simfileId', async () => {
				mockProvider.getFileKeys = vi.fn().mockResolvedValue([]);

				await getFileKeys();

				expect(mockProvider.getFileKeys).toHaveBeenCalledWith(undefined);
			});

			it('should handle null simfileId', async () => {
				mockProvider.getFileKeys = vi.fn().mockResolvedValue([]);

				await getFileKeys(null);

				expect(mockProvider.getFileKeys).toHaveBeenCalledWith(null);
			});

			it('should return empty array when no keys found', async () => {
				mockProvider.getFileKeys = vi.fn().mockResolvedValue([]);

				const result = await getFileKeys('simfile-id');

				expect(result).toEqual([]);
			});
		});
	});

	describe('IFileProvider interface', () => {
		it('should define all required methods', () => {
			const requiredMethods = [
				'getFile',
				'setFile',
				'removeFile',
				'clearFiles',
				'getFileKeys'
			];

			requiredMethods.forEach((method) => {
				expect(mockProvider).toHaveProperty(method);
				expect(typeof mockProvider[method as keyof IFileProvider]).toBe('function');
			});
		});
	});
});
