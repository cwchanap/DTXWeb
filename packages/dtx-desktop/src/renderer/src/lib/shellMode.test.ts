import { describe, it, expect } from 'vitest';
import { resolveShellMode } from './shellMode';

describe('resolveShellMode', () => {
	it('returns wide at >= 1100', () => {
		expect(resolveShellMode(1100)).toBe('wide');
		expect(resolveShellMode(1600)).toBe('wide');
	});
	it('returns medium between 760 and 1099', () => {
		expect(resolveShellMode(760)).toBe('medium');
		expect(resolveShellMode(1099)).toBe('medium');
	});
	it('returns narrow below 760', () => {
		expect(resolveShellMode(759)).toBe('narrow');
		expect(resolveShellMode(320)).toBe('narrow');
	});
});
