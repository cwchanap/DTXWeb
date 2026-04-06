import { describe, it, expect } from 'vitest';
import { HIGH_RESOLUTION_CELLS, calculateHighResolutionPosition } from './notePositioning';

describe('HIGH_RESOLUTION_CELLS', () => {
	it('equals 192 (LCM of 16, 24, 32, 48, 64)', () => {
		expect(HIGH_RESOLUTION_CELLS).toBe(192);
	});
});

describe('calculateHighResolutionPosition', () => {
	it('returns zero position at offset 0', () => {
		const result = calculateHighResolutionPosition(0, 16);
		expect(result).toEqual({
			cellPosition: 0,
			visualCellPosition: 0,
			wholeCells: 0,
			fractionalCell: 0
		});
	});

	it('returns full measure position at offset 1', () => {
		const result = calculateHighResolutionPosition(1, 16);
		expect(result).toEqual({
			cellPosition: 192,
			visualCellPosition: 16,
			wholeCells: 16,
			fractionalCell: 0
		});
	});

	it('returns midpoint at offset 0.5', () => {
		const result = calculateHighResolutionPosition(0.5, 16);
		expect(result).toEqual({
			cellPosition: 96,
			visualCellPosition: 8,
			wholeCells: 8,
			fractionalCell: 0
		});
	});

	it('calculates quarter note position at offset 0.25', () => {
		const result = calculateHighResolutionPosition(0.25, 16);
		expect(result).toEqual({
			cellPosition: 48,
			visualCellPosition: 4,
			wholeCells: 4,
			fractionalCell: 0
		});
	});

	it('calculates 8th note position at offset 0.125', () => {
		const result = calculateHighResolutionPosition(0.125, 16);
		expect(result).toEqual({
			cellPosition: 24,
			visualCellPosition: 2,
			wholeCells: 2,
			fractionalCell: 0
		});
	});

	it('calculates 16th note position at offset 1/16', () => {
		const result = calculateHighResolutionPosition(1 / 16, 16);
		expect(result.cellPosition).toBe(12);
		expect(result.visualCellPosition).toBe(1);
		expect(result.wholeCells).toBe(1);
		expect(result.fractionalCell).toBeCloseTo(0);
	});

	it('calculates 24th note (triplet) position at offset 1/24', () => {
		// 1/24 of measure = 8 high-res cells
		const result = calculateHighResolutionPosition(1 / 24, 16);
		expect(result.cellPosition).toBe(8);
		expect(result.visualCellPosition).toBeCloseTo(16 / 24);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeCloseTo(16 / 24);
	});

	it('calculates 32nd note position at offset 1/32', () => {
		// 1/32 of measure = 6 high-res cells
		const result = calculateHighResolutionPosition(1 / 32, 16);
		expect(result.cellPosition).toBe(6);
		expect(result.visualCellPosition).toBeCloseTo(0.5);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeCloseTo(0.5);
	});

	it('calculates 48th note position at offset 1/48', () => {
		// 1/48 of measure = 4 high-res cells
		const result = calculateHighResolutionPosition(1 / 48, 16);
		expect(result.cellPosition).toBe(4);
		expect(result.visualCellPosition).toBeCloseTo(16 / 48);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeCloseTo(16 / 48);
	});

	it('calculates 64th note position at offset 1/64', () => {
		// 1/64 of measure = 3 high-res cells
		const result = calculateHighResolutionPosition(1 / 64, 16);
		expect(result.cellPosition).toBe(3);
		expect(result.visualCellPosition).toBeCloseTo(0.25);
		expect(result.wholeCells).toBe(0);
		expect(result.fractionalCell).toBeCloseTo(0.25);
	});

	it('works with custom cellsPerMeasure of 8', () => {
		const result = calculateHighResolutionPosition(0.5, 8);
		expect(result.cellPosition).toBe(96);
		expect(result.visualCellPosition).toBe(4);
		expect(result.wholeCells).toBe(4);
		expect(result.fractionalCell).toBe(0);
	});

	it('works with custom cellsPerMeasure of 32', () => {
		const result = calculateHighResolutionPosition(0.25, 32);
		expect(result.cellPosition).toBe(48);
		expect(result.visualCellPosition).toBe(8);
		expect(result.wholeCells).toBe(8);
		expect(result.fractionalCell).toBe(0);
	});

	it('fractionalCell is always between 0 (inclusive) and 1 (exclusive)', () => {
		const offsets = [0, 0.1, 0.333, 0.5, 0.75, 0.9, 0.999];
		for (const offset of offsets) {
			const result = calculateHighResolutionPosition(offset, 16);
			expect(result.fractionalCell).toBeGreaterThanOrEqual(0);
			expect(result.fractionalCell).toBeLessThan(1);
		}
	});

	it('wholeCells plus fractionalCell equals visualCellPosition', () => {
		const offsets = [0, 1 / 24, 1 / 16, 0.3, 0.5, 0.75];
		for (const offset of offsets) {
			const result = calculateHighResolutionPosition(offset, 16);
			expect(result.wholeCells + result.fractionalCell).toBeCloseTo(
				result.visualCellPosition
			);
		}
	});

	it('cellPosition uses floor of high-res grid', () => {
		// offset 0.001 → cellPosition = floor(0.001 * 192) = floor(0.192) = 0
		const result = calculateHighResolutionPosition(0.001, 16);
		expect(result.cellPosition).toBe(0);
	});

	it('three-quarter position at offset 0.75 with 16 cells', () => {
		const result = calculateHighResolutionPosition(0.75, 16);
		expect(result.cellPosition).toBe(144);
		expect(result.visualCellPosition).toBe(12);
		expect(result.wholeCells).toBe(12);
		expect(result.fractionalCell).toBe(0);
	});
});
