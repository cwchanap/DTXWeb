import { describe, it, expect } from 'vitest';
import { fuzzyScore, searchItems } from './fuzzy';

describe('fuzzyScore', () => {
	it('returns 0 when characters are missing in order', () => {
		expect(fuzzyScore('xyz', 'tank')).toBe(0);
	});
	it('returns >0 for subsequence match', () => {
		expect(fuzzyScore('tnk', 'tank')).toBeGreaterThan(0);
	});
	it('scores a contiguous/prefix match higher than a scattered one', () => {
		expect(fuzzyScore('tan', 'tank')).toBeGreaterThan(fuzzyScore('tan', 'titan'));
	});
	it('is case-insensitive', () => {
		expect(fuzzyScore('TANK', 'tank')).toBeGreaterThan(0);
	});
	it('scores astral (surrogate-pair) characters as single code points', () => {
		// 🎵 is U+1F3B5 — two UTF-16 code units. Searching by it must match.
		expect(fuzzyScore('🎵', '🎵 Ripple')).toBeGreaterThan(0);
		// A matching subsequence that straddles an astral char still works.
		expect(fuzzyScore('rpe', '🎵 Ripple')).toBeGreaterThan(0);
		// A BMP char that isn't present must not match.
		expect(fuzzyScore('z', '🎵 Ripple')).toBe(0);
	});
	it('treats a surrogate pair and a BMP char as the same number of units', () => {
		// '🐉a' and 'Xa' both have 2 code points; 'a' sits at index 1 in each,
		// so the score for query 'a' must be identical.
		expect(fuzzyScore('a', '🐉a')).toBe(fuzzyScore('a', 'Xa'));
	});
});

describe('searchItems', () => {
	const items = [{ n: 'Tank' }, { n: 'Titan' }, { n: 'Spice and Wolf' }];
	it('returns all items unchanged for empty query', () => {
		expect(searchItems('', items, (i) => i.n)).toEqual(items);
	});
	it('filters and ranks by score', () => {
		const r = searchItems('tan', items, (i) => i.n);
		expect(r[0].n).toBe('Tank');
		expect(r.find((i) => i.n === 'Spice and Wolf')).toBeUndefined();
	});
});
