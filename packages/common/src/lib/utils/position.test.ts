import { describe, it, expect } from 'vitest';
import { normalizePosition } from './position';

describe('normalizePosition', () => {
	it('returns 0 for offset 0', () => {
		expect(normalizePosition(0)).toBe(0);
	});

	it('returns 1 for offset 1', () => {
		expect(normalizePosition(1)).toBe(1);
	});

	it('returns 0.5 for offset exactly at midpoint', () => {
		expect(normalizePosition(0.5)).toBe(0.5);
	});

	it('rounds to nearest cell boundary with default 16 cells', () => {
		// 1/16 = 0.0625, so offset 0.0625 should round to 0.0625
		expect(normalizePosition(0.0625)).toBe(0.0625);
		// 0.07 rounds to nearest 1/16 = round(0.07 * 16) / 16 = round(1.12) / 16 = 1/16
		expect(normalizePosition(0.07)).toBe(0.0625);
	});

	it('rounds 0.5 offset to 0.5 with 16 cells (8/16)', () => {
		expect(normalizePosition(0.5, 16)).toBe(0.5);
	});

	it('uses default cellsPerMeasure of 16', () => {
		// Verify default matches explicit value of 16
		expect(normalizePosition(0.3)).toBe(normalizePosition(0.3, 16));
	});

	it('rounds up when offset is closer to next boundary', () => {
		// 0.094 * 16 = 1.504 → round to 2 → 2/16 = 0.125
		expect(normalizePosition(0.094, 16)).toBe(0.125);
	});

	it('rounds down when offset is closer to previous boundary', () => {
		// 0.05 * 16 = 0.8 → round to 1 → 1/16 = 0.0625
		expect(normalizePosition(0.05, 16)).toBe(0.0625);
	});

	it('handles custom cellsPerMeasure of 4', () => {
		// boundaries at 0, 0.25, 0.5, 0.75, 1.0
		expect(normalizePosition(0.1, 4)).toBe(0);
		expect(normalizePosition(0.2, 4)).toBe(0.25);
		expect(normalizePosition(0.4, 4)).toBe(0.5);
		expect(normalizePosition(0.9, 4)).toBe(1.0);
	});

	it('handles custom cellsPerMeasure of 24', () => {
		const step = 1 / 24;
		// offset 0 → 0
		expect(normalizePosition(0, 24)).toBe(0);
		// offset at exact 1/24 boundary
		expect(normalizePosition(step, 24)).toBeCloseTo(step);
		// midpoint between 0 and 1/24 rounds to 1/24
		expect(normalizePosition(step / 2, 24)).toBeCloseTo(step);
	});

	it('clamps floating point jitter to clean cell boundaries', () => {
		// Floating point representation of 3/16 may have precision noise
		const threeOver16 = 3 / 16;
		const slightlyOff = threeOver16 + 1e-10;
		expect(normalizePosition(slightlyOff, 16)).toBeCloseTo(threeOver16);
	});

	it('returns exact boundary values for all 16th note positions', () => {
		for (let i = 0; i <= 16; i++) {
			const offset = i / 16;
			const result = normalizePosition(offset, 16);
			expect(result).toBeCloseTo(offset, 10);
		}
	});

	it('handles offset slightly above 0', () => {
		// 0.01 * 16 = 0.16 → round to 0 → 0/16 = 0
		expect(normalizePosition(0.01, 16)).toBe(0);
	});

	it('handles offset slightly below 1', () => {
		// 0.99 * 16 = 15.84 → round to 16 → 16/16 = 1
		expect(normalizePosition(0.99, 16)).toBe(1);
	});

	it('handles cellsPerMeasure of 1 (snaps everything to 0 or 1)', () => {
		expect(normalizePosition(0.4, 1)).toBe(0);
		expect(normalizePosition(0.6, 1)).toBe(1);
		expect(normalizePosition(0.5, 1)).toBe(1); // 0.5 rounds up
	});
});
