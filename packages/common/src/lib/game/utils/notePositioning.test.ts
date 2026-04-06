import { describe, it, expect } from 'vitest';
import { calculateHighResolutionPosition, HIGH_RESOLUTION_CELLS } from './notePositioning';

describe('HIGH_RESOLUTION_CELLS', () => {
	it('equals 192 (LCM of 16, 24, 32, 48, 64)', () => {
		expect(HIGH_RESOLUTION_CELLS).toBe(192);
	});
});

describe('calculateHighResolutionPosition', () => {
	it('returns correct values at the start of a measure (offset 0)', () => {
		const result = calculateHighResolutionPosition(0, 16);
		expect(result.cellPosition).toBe(0);
		expect(result.visualCellPosition).toBe(0);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBe(0);
	});

	it('returns correct values at the end of a measure (offset 1)', () => {
		const result = calculateHighResolutionPosition(1, 16);
		expect(result.cellPosition).toBe(192);
		expect(result.visualCellPosition).toBe(16);
		expect(result.wholeCells).toBe(16);
		expect(result.fractionalCell).toBeCloseTo(0);
	});

	it('handles the midpoint of a measure (offset 0.5)', () => {
		const result = calculateHighResolutionPosition(0.5, 16);
		expect(result.cellPosition).toBe(96);
		expect(result.visualCellPosition).toBe(8);
		expect(result.wholeCells).toBe(8);
		expect(result.fractionalCell).toBeCloseTo(0);
	});

	it('positions 16th notes correctly', () => {
		// 16th note = 1/16 of a measure
		const result = calculateHighResolutionPosition(1 / 16, 16);
		expect(result.cellPosition).toBe(12); // 192 / 16 = 12
		expect(result.visualCellPosition).toBeCloseTo(1);
		expect(result.wholeCells).toBe(1);
		expect(result.fractionalCell).toBeCloseTo(0);
	});

	it('positions 24th notes correctly (triplets)', () => {
		// 24th note = 1/24 of a measure
		const result = calculateHighResolutionPosition(1 / 24, 16);
		expect(result.cellPosition).toBe(8); // floor(192 / 24) = 8
		expect(result.visualCellPosition).toBeCloseTo(8 / 12); // 8/192 * 16
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeGreaterThan(0);
	});

	it('positions 32nd notes correctly', () => {
		// 32nd note = 1/32 of a measure
		const result = calculateHighResolutionPosition(1 / 32, 16);
		expect(result.cellPosition).toBe(6); // floor(192 / 32) = 6
		expect(result.visualCellPosition).toBeCloseTo(0.5);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeCloseTo(0.5);
	});

	it('positions 48th notes correctly', () => {
		// 48th note = 1/48 of a measure
		const result = calculateHighResolutionPosition(1 / 48, 16);
		expect(result.cellPosition).toBe(4); // floor(192 / 48) = 4
		expect(result.visualCellPosition).toBeCloseTo(4 / 12);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeGreaterThan(0);
	});

	it('positions 64th notes correctly', () => {
		// 64th note = 1/64 of a measure
		const result = calculateHighResolutionPosition(1 / 64, 16);
		expect(result.cellPosition).toBe(3); // floor(192 / 64) = 3
		expect(result.visualCellPosition).toBeCloseTo(0.25);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeCloseTo(0.25);
	});

	it('works with different cellsPerMeasure values', () => {
		const result = calculateHighResolutionPosition(0.5, 32);
		expect(result.cellPosition).toBe(96);
		expect(result.visualCellPosition).toBe(16);
		expect(result.wholeCells).toBe(16);
		expect(result.fractionalCell).toBeCloseTo(0);
	});

	it('fractionalCell is always between 0 and 1', () => {
		const offsets = [0, 0.1, 0.25, 0.333, 0.5, 0.75, 0.9, 1];
		for (const offset of offsets) {
			const result = calculateHighResolutionPosition(offset, 16);
			expect(result.fractionalCell).toBeGreaterThanOrEqual(0);
			expect(result.fractionalCell).toBeLessThan(1);
		}
	});

	it('wholeCells + fractionalCell equals visualCellPosition', () => {
		const testCases = [0, 0.125, 0.25, 0.5, 0.75, 1 / 24, 1 / 32];
		for (const offset of testCases) {
			const result = calculateHighResolutionPosition(offset, 16);
			expect(result.wholeCells + result.fractionalCell).toBeCloseTo(
				result.visualCellPosition,
				10
			);
		}
	});

	it('cellPosition is always a non-negative integer', () => {
		const offsets = [0, 0.1, 0.5, 0.9, 1];
		for (const offset of offsets) {
			const result = calculateHighResolutionPosition(offset, 16);
			expect(result.cellPosition).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(result.cellPosition)).toBe(true);
		}
	});
});
