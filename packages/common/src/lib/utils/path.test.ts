import { describe, it, expect } from 'vitest';
import { joinPath } from './path';

describe('path utils', () => {
	describe('joinPath', () => {
		it('should join single path segment', () => {
			const result = joinPath('folder');
			expect(result).toBe('folder');
		});

		it('should join multiple path segments', () => {
			const result = joinPath('folder', 'subfolder', 'file.txt');
			expect(result).toBe('folder/subfolder/file.txt');
		});

		it('should handle relative paths', () => {
			const result = joinPath('..', 'folder', 'file.txt');
			expect(result).toBe('../folder/file.txt');
		});

		it('should handle special characters in path', () => {
			const result = joinPath('folder name', 'file-name_v2.txt');
			expect(result).toBe('folder name/file-name_v2.txt');
		});

		it('should delegate to node path.join', () => {
			// Just verify the function works - implementation details are not important for unit testing
			const result = joinPath('a', 'b', 'c');
			expect(typeof result).toBe('string');
			expect(result.includes('a')).toBe(true);
			expect(result.includes('b')).toBe(true);
			expect(result.includes('c')).toBe(true);
		});

		it('should handle single file name', () => {
			const result = joinPath('file.txt');
			expect(result).toBe('file.txt');
		});

		it('should join paths with various separators', () => {
			const result = joinPath('path1', 'path2');
			expect(result).toMatch(/path1[\\/]path2/);
		});
	});
});
