import { describe, it, expect } from 'vitest';
import { formatLevel, normalizeLevel } from './level';

describe('formatLevel', () => {
	it('decodes an encoded ×10 integer (level < 100, levelDec = 0) to two decimals', () => {
		expect(formatLevel(50)).toBe('5.00');
		expect(formatLevel(55)).toBe('5.50');
	});

	it('decodes an encoded ×100 integer (level >= 100) to two decimals', () => {
		expect(formatLevel(550)).toBe('5.50');
		expect(formatLevel(880)).toBe('8.80');
	});

	it('decodes level = 100 as ×100 scale (1.00), not ×10 scale (10.00)', () => {
		// DTXManiaCX formula: level >= 100 → level / 100.
		expect(formatLevel(100)).toBe('1.00');
	});

	it('decodes a bare single-digit integer on the ×10 scale (level < 10, levelDec = 0)', () => {
		// With the DTXManiaCX formula, 1–9 decode as 0.1–0.9 (×10 branch).
		// The raw #DLEVEL value is stored directly (no encoding), so bare
		// 1–9 are genuine sub-1.0 levels.
		expect(formatLevel(1)).toBe('0.10');
		expect(formatLevel(5)).toBe('0.50');
		expect(formatLevel(9)).toBe('0.90');
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

describe('normalizeLevel', () => {
	it('decodes level + levelDec using DTXManiaCX formula', () => {
		// 78 + 33 → 7.8 + 0.33 = 8.13 (use toBeCloseTo for float precision)
		expect(normalizeLevel(78, 33)).toBeCloseTo(8.13, 10);
		// 80 + 50 → 8.0 + 0.50 = 8.50
		expect(normalizeLevel(80, 50)).toBe(8.5);
	});

	it('decodes level >= 100 ignoring levelDec', () => {
		expect(normalizeLevel(850, 0)).toBe(8.5);
		expect(normalizeLevel(850, 99)).toBe(8.5);
	});

	it('decodes level < 100 with levelDec = 0 as ×10', () => {
		expect(normalizeLevel(55, 0)).toBe(5.5);
		expect(normalizeLevel(50, 0)).toBe(5.0);
	});

	it('treats stray decimals as already display-scale', () => {
		expect(normalizeLevel(5.5, 33)).toBe(5.5);
	});

	it('handles string input', () => {
		expect(normalizeLevel('55', 0)).toBe(5.5);
	});
});
