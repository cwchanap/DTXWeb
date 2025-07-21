import { describe, it, expect, beforeEach } from 'vitest';
import { FileManager } from './fileManager';

describe('FileManager', () => {
	beforeEach(() => {
		// Clear the file manager before each test
		FileManager.clear();
	});

	describe('setFile and getFile', () => {
		it('should store and retrieve a file', () => {
			const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
			const key = 'test-key';

			FileManager.setFile(key, mockFile);
			const retrievedFile = FileManager.getFile(key);

			expect(retrievedFile).toBe(mockFile);
			expect(retrievedFile?.name).toBe('test.txt');
			expect(retrievedFile?.type).toBe('text/plain');
		});

		it('should return undefined for non-existent key', () => {
			const result = FileManager.getFile('non-existent-key');
			expect(result).toBeUndefined();
		});

		it('should overwrite existing file with same key', () => {
			const file1 = new File(['content 1'], 'file1.txt', { type: 'text/plain' });
			const file2 = new File(['content 2'], 'file2.txt', { type: 'text/plain' });
			const key = 'same-key';

			FileManager.setFile(key, file1);
			FileManager.setFile(key, file2);

			const result = FileManager.getFile(key);
			expect(result).toBe(file2);
			expect(result?.name).toBe('file2.txt');
		});
	});

	describe('removeFile', () => {
		it('should remove existing file and return true', () => {
			const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
			const key = 'test-key';

			FileManager.setFile(key, mockFile);
			expect(FileManager.getFile(key)).toBe(mockFile);

			const removed = FileManager.removeFile(key);
			expect(removed).toBe(true);
			expect(FileManager.getFile(key)).toBeUndefined();
		});

		it('should return false for non-existent file', () => {
			const removed = FileManager.removeFile('non-existent-key');
			expect(removed).toBe(false);
		});
	});

	describe('clear', () => {
		it('should remove all files', () => {
			const file1 = new File(['content 1'], 'file1.txt', { type: 'text/plain' });
			const file2 = new File(['content 2'], 'file2.txt', { type: 'text/plain' });

			FileManager.setFile('key1', file1);
			FileManager.setFile('key2', file2);

			expect(FileManager.getFile('key1')).toBe(file1);
			expect(FileManager.getFile('key2')).toBe(file2);

			FileManager.clear();

			expect(FileManager.getFile('key1')).toBeUndefined();
			expect(FileManager.getFile('key2')).toBeUndefined();
		});

		it('should handle clear on empty manager', () => {
			expect(() => FileManager.clear()).not.toThrow();
		});
	});

	describe('generateKey', () => {
		it('should generate key with simfileId and fileName', () => {
			const key = FileManager.generateKey('simfile123', 'audio.wav');
			expect(key).toBe('simfile123:audio.wav');
		});

		it('should use "local" when simfileId is null', () => {
			const key = FileManager.generateKey(null, 'audio.wav');
			expect(key).toBe('local:audio.wav');
		});

		it('should use "local" when simfileId is empty string', () => {
			const key = FileManager.generateKey('', 'audio.wav');
			expect(key).toBe('local:audio.wav');
		});

		it('should handle special characters in fileName', () => {
			const key = FileManager.generateKey('sim123', 'audio file (1).wav');
			expect(key).toBe('sim123:audio file (1).wav');
		});
	});

	describe('getKeys', () => {
		it('should return empty array when no files stored', () => {
			const keys = FileManager.getKeys();
			expect(keys).toEqual([]);
		});

		it('should return all stored keys', () => {
			const file1 = new File(['content 1'], 'file1.txt', { type: 'text/plain' });
			const file2 = new File(['content 2'], 'file2.txt', { type: 'text/plain' });
			const file3 = new File(['content 3'], 'file3.txt', { type: 'text/plain' });

			FileManager.setFile('key1', file1);
			FileManager.setFile('key2', file2);
			FileManager.setFile('key3', file3);

			const keys = FileManager.getKeys();
			expect(keys).toHaveLength(3);
			expect(keys).toContain('key1');
			expect(keys).toContain('key2');
			expect(keys).toContain('key3');
		});

		it('should reflect changes after adding/removing files', () => {
			const file = new File(['content'], 'file.txt', { type: 'text/plain' });

			// Add file
			FileManager.setFile('test-key', file);
			expect(FileManager.getKeys()).toEqual(['test-key']);

			// Remove file
			FileManager.removeFile('test-key');
			expect(FileManager.getKeys()).toEqual([]);
		});
	});

	describe('integration tests', () => {
		it('should handle multiple files with generated keys', () => {
			const audioFile = new File(['audio data'], 'kick.wav', { type: 'audio/wav' });
			const textFile = new File(['text data'], 'readme.txt', { type: 'text/plain' });

			const audioKey = FileManager.generateKey('song123', 'kick.wav');
			const textKey = FileManager.generateKey(null, 'readme.txt');

			FileManager.setFile(audioKey, audioFile);
			FileManager.setFile(textKey, textFile);

			expect(FileManager.getFile(audioKey)).toBe(audioFile);
			expect(FileManager.getFile(textKey)).toBe(textFile);
			expect(FileManager.getKeys()).toContain(audioKey);
			expect(FileManager.getKeys()).toContain(textKey);
		});

		it('should maintain file references correctly', () => {
			const originalFile = new File(['original'], 'test.wav', { type: 'audio/wav' });
			const key = 'test-key';

			FileManager.setFile(key, originalFile);
			const retrieved1 = FileManager.getFile(key);
			const retrieved2 = FileManager.getFile(key);

			// Should be the same object reference
			expect(retrieved1).toBe(originalFile);
			expect(retrieved2).toBe(originalFile);
			expect(retrieved1).toBe(retrieved2);
		});
	});
});
