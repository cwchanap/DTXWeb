import { describe, it, expect } from 'vitest';
import { normalizePosition } from './position';

describe('normalizePosition', () => {
	describe('basic functionality', () => {
		it('should normalize position to 16th note grid by default', () => {
			expect(normalizePosition(0)).toBe(0);
			expect(normalizePosition(0.25)).toBe(0.25);
			expect(normalizePosition(0.5)).toBe(0.5);
			expect(normalizePosition(0.75)).toBe(0.75);
			expect(normalizePosition(1)).toBe(1);
		});

		it('should round to nearest subdivision boundary', () => {
			// Test rounding to 16th note boundaries
			expect(normalizePosition(0.124, 16)).toBe(0.125); // Round to 2/16
			expect(normalizePosition(0.126, 16)).toBe(0.125); // Round to 2/16
			expect(normalizePosition(0.24, 16)).toBe(0.25); // Round to 4/16
			expect(normalizePosition(0.26, 16)).toBe(0.25); // Round to 4/16
		});

		it('should handle edge cases', () => {
			expect(normalizePosition(0.001, 16)).toBe(0);
			expect(normalizePosition(0.999, 16)).toBe(1);
			// Note: normalizePosition doesn't clamp negatives, it just rounds them
			expect(normalizePosition(-0.1, 16)).toBe(-0.125); // Rounds to -2/16
		});
	});

	describe('higher subdivision grids', () => {
		it('should normalize to 24th note grid', () => {
			expect(normalizePosition(0, 24)).toBe(0);
			expect(normalizePosition(1 / 24, 24)).toBe(1 / 24);
			expect(normalizePosition(2 / 24, 24)).toBe(2 / 24);
			expect(normalizePosition(8 / 24, 24)).toBe(8 / 24);
			expect(normalizePosition(12 / 24, 24)).toBe(12 / 24);
			expect(normalizePosition(24 / 24, 24)).toBe(1);
		});

		it('should normalize to 32nd note grid', () => {
			expect(normalizePosition(0, 32)).toBe(0);
			expect(normalizePosition(1 / 32, 32)).toBe(1 / 32);
			expect(normalizePosition(7 / 32, 32)).toBe(7 / 32);
			expect(normalizePosition(16 / 32, 32)).toBe(16 / 32);
			expect(normalizePosition(31 / 32, 32)).toBe(31 / 32);
		});

		it('should normalize to 48th note grid', () => {
			expect(normalizePosition(0, 48)).toBe(0);
			expect(normalizePosition(1 / 48, 48)).toBe(1 / 48);
			expect(normalizePosition(5 / 48, 48)).toBe(5 / 48);
			expect(normalizePosition(23 / 48, 48)).toBe(23 / 48);
			expect(normalizePosition(47 / 48, 48)).toBe(47 / 48);
		});

		it('should normalize to 64th note grid', () => {
			expect(normalizePosition(0, 64)).toBe(0);
			expect(normalizePosition(1 / 64, 64)).toBe(1 / 64);
			expect(normalizePosition(7 / 64, 64)).toBe(7 / 64);
			expect(normalizePosition(31 / 64, 64)).toBe(31 / 64);
			expect(normalizePosition(63 / 64, 64)).toBe(63 / 64);
		});

		it('should normalize to 192nd note grid (high precision)', () => {
			expect(normalizePosition(0, 192)).toBe(0);
			expect(normalizePosition(1 / 192, 192)).toBe(1 / 192);
			expect(normalizePosition(63 / 192, 192)).toBe(63 / 192);
			expect(normalizePosition(127 / 192, 192)).toBe(127 / 192);
			expect(normalizePosition(191 / 192, 192)).toBe(191 / 192);
		});
	});

	describe('rounding behavior with higher subdivisions', () => {
		it('should round to nearest 24th note boundary', () => {
			const tolerance = 0.0001;

			// Test positions that should round to specific 24th note boundaries
			expect(normalizePosition(1 / 24 + tolerance, 24)).toBe(1 / 24);
			expect(normalizePosition(1 / 24 - tolerance, 24)).toBe(1 / 24);
			expect(normalizePosition(8 / 24 + tolerance, 24)).toBe(8 / 24);
			expect(normalizePosition(8 / 24 - tolerance, 24)).toBe(8 / 24);
		});

		it('should round to nearest 32nd note boundary', () => {
			const tolerance = 0.0001;

			expect(normalizePosition(7 / 32 + tolerance, 32)).toBe(7 / 32);
			expect(normalizePosition(7 / 32 - tolerance, 32)).toBe(7 / 32);
			expect(normalizePosition(15 / 32 + tolerance, 32)).toBe(15 / 32);
			expect(normalizePosition(15 / 32 - tolerance, 32)).toBe(15 / 32);
		});

		it('should round to nearest 48th note boundary', () => {
			const tolerance = 0.0001;

			expect(normalizePosition(5 / 48 + tolerance, 48)).toBe(5 / 48);
			expect(normalizePosition(5 / 48 - tolerance, 48)).toBe(5 / 48);
			expect(normalizePosition(23 / 48 + tolerance, 48)).toBe(23 / 48);
			expect(normalizePosition(23 / 48 - tolerance, 48)).toBe(23 / 48);
		});

		it('should round to nearest 64th note boundary', () => {
			const tolerance = 0.0001;

			expect(normalizePosition(7 / 64 + tolerance, 64)).toBe(7 / 64);
			expect(normalizePosition(7 / 64 - tolerance, 64)).toBe(7 / 64);
			expect(normalizePosition(31 / 64 + tolerance, 64)).toBe(31 / 64);
			expect(normalizePosition(31 / 64 - tolerance, 64)).toBe(31 / 64);
		});
	});

	describe('precision validation', () => {
		it('should maintain high precision for 192nd notes', () => {
			// Test that very small fractional positions are preserved
			const positions = [1 / 192, 5 / 192, 37 / 192, 127 / 192, 189 / 192];

			positions.forEach((pos) => {
				const normalized = normalizePosition(pos, 192);
				expect(normalized).toBeCloseTo(pos, 10);
			});
		});

		it('should handle floating point precision issues', () => {
			// Test positions that might cause floating point precision issues
			const problematicPositions = [
				1 / 3, // 0.333...
				1 / 6, // 0.166...
				1 / 7, // 0.142857...
				2 / 3, // 0.666...
				5 / 6 // 0.833...
			];

			problematicPositions.forEach((pos) => {
				const normalized = normalizePosition(pos, 192);
				expect(normalized).toBeGreaterThanOrEqual(0);
				expect(normalized).toBeLessThanOrEqual(1);
				// Should be a valid fraction of 192
				expect(Math.abs(normalized * 192 - Math.round(normalized * 192))).toBeLessThan(
					0.0001
				);
			});
		});

		it('should be consistent with repeated normalization', () => {
			const testPositions = [0.123, 0.456, 0.789, 1 / 24, 7 / 32, 23 / 48];

			testPositions.forEach((pos) => {
				const once = normalizePosition(pos, 192);
				const twice = normalizePosition(once, 192);
				expect(once).toBe(twice); // Should be idempotent
			});
		});
	});

	describe('subdivision compatibility', () => {
		it('should maintain compatibility between subdivision levels', () => {
			// 16th note positions should be preserved in higher subdivisions
			const sixteenthNotePositions = [0, 1 / 16, 2 / 16, 4 / 16, 8 / 16, 15 / 16];

			sixteenthNotePositions.forEach((pos) => {
				const normalized16 = normalizePosition(pos, 16);
				const normalized192 = normalizePosition(pos, 192);
				expect(normalized16).toBeCloseTo(normalized192, 10);
			});
		});

		it('should handle subdivision level relationships correctly', () => {
			// 24th notes in a 192-subdivision grid (192/24 = 8, so every 8th position)
			expect(normalizePosition(1 / 24, 192)).toBeCloseTo(8 / 192, 10);
			expect(normalizePosition(8 / 24, 192)).toBeCloseTo(64 / 192, 10);
			expect(normalizePosition(12 / 24, 192)).toBeCloseTo(96 / 192, 10);

			// 32nd notes in a 192-subdivision grid (192/32 = 6, so every 6th position)
			expect(normalizePosition(1 / 32, 192)).toBeCloseTo(6 / 192, 10);
			expect(normalizePosition(16 / 32, 192)).toBeCloseTo(96 / 192, 10);

			// 48th notes in a 192-subdivision grid (192/48 = 4, so every 4th position)
			expect(normalizePosition(1 / 48, 192)).toBeCloseTo(4 / 192, 10);
			expect(normalizePosition(23 / 48, 192)).toBeCloseTo(92 / 192, 10);

			// 64th notes in a 192-subdivision grid (192/64 = 3, so every 3rd position)
			expect(normalizePosition(1 / 64, 192)).toBeCloseTo(3 / 192, 10);
			expect(normalizePosition(31 / 64, 192)).toBeCloseTo(93 / 192, 10);
		});
	});
});
