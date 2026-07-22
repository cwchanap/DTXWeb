import { describe, it, expect } from 'vitest';
import { formatLevel } from './level';

describe('formatLevel', () => {
	it('decodes an encoded ×10 integer to two decimals', () => {
		expect(formatLevel(50)).toBe('5.00');
		expect(formatLevel(55)).toBe('5.50');
	});

	it('decodes an encoded ×100 integer (values > 100)', () => {
		expect(formatLevel(550)).toBe('5.50');
		expect(formatLevel(880)).toBe('8.80');
	});

	it('treats a stray decimal as already display-scale (not ÷10)', () => {
		expect(formatLevel(5.5)).toBe('5.50');
		expect(formatLevel(8.75)).toBe('8.75');
	});

	it('parses string levels and treats non-finite as zero', () => {
		expect(formatLevel('20')).toBe('2.00');
		expect(formatLevel('invalid')).toBe('0.00');
		expect(formatLevel(undefined)).toBe('0.00');
		expect(formatLevel(null)).toBe('0.00');
	});
});
