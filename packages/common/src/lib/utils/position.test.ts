import { describe, it, expect } from 'vitest';
import { normalizePosition } from './position';

describe('normalizePosition', () => {
	it('returns 0 for offset 0', () => {
		expect(normalizePosition(0)).toBe(0);
	});

	it('returns 1 for offset 1', () => {
		expect(normalizePosition(1)).toBe(1);
	});

	it('rounds to nearest 16th note boundary by default', () => {
		// 1/16 = 0.0625
		expect(normalizePosition(0.0625)).toBe(0.0625);
		expect(normalizePosition(0.125)).toBe(0.125);
		expect(normalizePosition(0.25)).toBe(0.25);
		expect(normalizePosition(0.5)).toBe(0.5);
		expect(normalizePosition(0.75)).toBe(0.75);
	});

	it('snaps slightly off values to nearest cell boundary', () => {
		// 0.0624 should round to 0.0625 (1/16)
		expect(normalizePosition(0.0624)).toBe(0.0625);
		// 0.0626 should round to 0.0625 (1/16)
		expect(normalizePosition(0.0626)).toBe(0.0625);
	});

	it('handles exact midpoint (0.5) correctly', () => {
		expect(normalizePosition(0.5)).toBe(0.5);
	});

	it('accepts custom cellsPerMeasure value', () => {
		// With 32 cells per measure, minimum step is 1/32 = 0.03125
		expect(normalizePosition(0.03125, 32)).toBe(0.03125);
		expect(normalizePosition(0.5, 32)).toBe(0.5);
	});

	it('handles 24-cell resolution', () => {
		// With 24 cells, step is 1/24
		const step = 1 / 24;
		expect(normalizePosition(step, 24)).toBeCloseTo(step);
		expect(normalizePosition(step * 2, 24)).toBeCloseTo(step * 2);
	});

	it('snaps to 0 when near the start', () => {
		expect(normalizePosition(0.001)).toBe(0);
	});

	it('snaps to 1 when near the end with 16 cells', () => {
		expect(normalizePosition(0.999)).toBe(1);
	});

	it('always returns a multiple of (1 / cellsPerMeasure)', () => {
		const cells = 16;
		const step = 1 / cells;
		const testValues = [0, 0.1, 0.234, 0.5, 0.789, 1];
		for (const val of testValues) {
			const result = normalizePosition(val, cells);
			const multiplied = Math.round(result / step);
			expect(result).toBeCloseTo(multiplied * step, 10);
		}
	});
});
