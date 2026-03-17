import { describe, it, expect } from 'vitest';
import { joinPath } from './path';

describe('joinPath', () => {
	it('joins two path segments', () => {
		const result = joinPath('foo', 'bar');
		expect(result).toBe('foo/bar');
	});

	it('joins multiple path segments', () => {
		const result = joinPath('a', 'b', 'c', 'd');
		expect(result).toBe('a/b/c/d');
	});

	it('normalizes redundant separators', () => {
		const result = joinPath('foo/', '/bar');
		expect(result).toBe('foo/bar');
	});

	it('handles single segment', () => {
		const result = joinPath('onlyone');
		expect(result).toBe('onlyone');
	});

	it('handles absolute paths', () => {
		const result = joinPath('/root', 'sub');
		expect(result).toBe('/root/sub');
	});

	it('resolves ".." in paths', () => {
		const result = joinPath('foo', 'bar', '..', 'baz');
		expect(result).toBe('foo/baz');
	});
});
