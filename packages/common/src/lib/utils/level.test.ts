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

	it('decodes a bare single-digit integer on the ×100 scale (legacy display-scale signal)', () => {
		// DTX levels range 0.1–9.99, so 0.01–0.09 is below the minimum — a
		// bare 1–9 is unambiguously a legacy display-scale value that was
		// never encoded, not an intentional sub-0.1 level. Migration 0004
		// multiplies such rows by 100 (5 → 500 → 5.0).
		expect(formatLevel(1)).toBe('0.01');
		expect(formatLevel(5)).toBe('0.05');
		expect(formatLevel(9)).toBe('0.09');
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
