import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LaneMeasureNote } from './note';

// Mock the position utility since it's an external dependency
vi.mock('../utils/position', () => ({
	normalizePosition: vi.fn(
		(pos: number, subdivision: number = 192) => Math.round(pos * subdivision) / subdivision
	)
}));

describe('LaneMeasureNote', () => {
	describe('constructor', () => {
		it('should create a LaneMeasureNote with provided values', () => {
			const notes = [{ noteID: '01', position: 0.5 }];
			const laneMeasureNote = new LaneMeasureNote(1, 'LC', notes, 2);

			expect(laneMeasureNote.measure).toBe(1);
			expect(laneMeasureNote.laneID).toBe('LC');
			expect(laneMeasureNote.notes).toEqual(notes);
			expect(laneMeasureNote.measureLength).toBe(2);
		});

		it('should use default measureLength of 1', () => {
			const notes = [{ noteID: '01', position: 0.5 }];
			const laneMeasureNote = new LaneMeasureNote(1, 'LC', notes);

			expect(laneMeasureNote.measureLength).toBe(1);
		});
	});

	describe('parseFromPattern', () => {
		it('should parse a simple 4-note pattern', () => {
			const pattern = '01000200';
			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
			expect(result[1]).toEqual({ noteID: '02', position: 0.5 });
		});

		it('should filter out "00" (empty) notes', () => {
			const pattern = '01000000';
			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
		});

		it('should handle empty pattern', () => {
			const pattern = '00000000';
			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(0);
		});

		it('should handle pattern with measureLength scaling', () => {
			const pattern = '0102';
			const result = LaneMeasureNote.parseFromPattern(pattern, 2);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
			expect(result[1]).toEqual({ noteID: '02', position: 1 });
		});

		it('should return empty array for invalid pattern', () => {
			const pattern = '';
			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(0);
		});
	});

	describe('addNote', () => {
		let laneMeasureNote: LaneMeasureNote;

		beforeEach(() => {
			laneMeasureNote = new LaneMeasureNote(0, 'LC', []);
		});

		it('should add a note to empty measure', () => {
			laneMeasureNote.addNote('01', 0.5);

			expect(laneMeasureNote.notes).toHaveLength(1);
			expect(laneMeasureNote.notes[0]).toEqual({ noteID: '01', position: 0.5 });
		});

		it('should add multiple notes and sort by position', () => {
			laneMeasureNote.addNote('02', 0.75);
			laneMeasureNote.addNote('01', 0.25);
			laneMeasureNote.addNote('03', 0.5);

			expect(laneMeasureNote.notes).toHaveLength(3);
			expect(laneMeasureNote.notes[0]).toEqual({ noteID: '01', position: 0.25 });
			expect(laneMeasureNote.notes[1]).toEqual({ noteID: '03', position: 0.5 });
			expect(laneMeasureNote.notes[2]).toEqual({ noteID: '02', position: 0.75 });
		});

		it('should replace existing note at same position', () => {
			laneMeasureNote.addNote('01', 0.5);
			laneMeasureNote.addNote('02', 0.5);

			expect(laneMeasureNote.notes).toHaveLength(1);
			expect(laneMeasureNote.notes[0]).toEqual({ noteID: '02', position: 0.5 });
		});
	});

	describe('removeNote', () => {
		let laneMeasureNote: LaneMeasureNote;

		beforeEach(() => {
			const notes = [
				{ noteID: '01', position: 0.25 },
				{ noteID: '02', position: 0.5 },
				{ noteID: '03', position: 0.75 }
			];
			laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
		});

		it('should remove note at specified position', () => {
			laneMeasureNote.removeNote(0.5);

			expect(laneMeasureNote.notes).toHaveLength(2);
			expect(laneMeasureNote.notes.find((n) => n.position === 0.5)).toBeUndefined();
		});

		it('should do nothing if position does not exist', () => {
			const originalLength = laneMeasureNote.notes.length;
			laneMeasureNote.removeNote(0.1);

			expect(laneMeasureNote.notes).toHaveLength(originalLength);
		});

		it('should remove all notes if called multiple times', () => {
			laneMeasureNote.removeNote(0.25);
			laneMeasureNote.removeNote(0.5);
			laneMeasureNote.removeNote(0.75);

			expect(laneMeasureNote.notes).toHaveLength(0);
		});
	});

	describe('toPattern', () => {
		it('should return empty string for empty notes', () => {
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', []);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toBe('');
		});

		it('should convert simple notes to pattern', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 0.25 }
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toBe('01020000');
		});

		it('should handle notes at quarter positions', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 0.5 }
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toBe('01000200');
		});

		it('should handle higher resolution patterns', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 0.125 } // 1/8 position
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toBe('0102000000000000');
		});

		it('should handle measure length scaling', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 1 }
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes, 2);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toBe('01000200');
		});

		it('should handle notes out of bounds gracefully', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 2 } // Beyond measure length
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const pattern = laneMeasureNote.toPattern();

			// Should only include the first note
			expect(pattern).toBe('01000000');
		});
	});

	describe('getSubdivisionLevel', () => {
		it('should return 16 for patterns up to 16 notes', () => {
			expect(LaneMeasureNote.getSubdivisionLevel(8)).toBe(16);
			expect(LaneMeasureNote.getSubdivisionLevel(16)).toBe(16);
		});

		it('should return 24 for patterns up to 24 notes', () => {
			expect(LaneMeasureNote.getSubdivisionLevel(17)).toBe(24);
			expect(LaneMeasureNote.getSubdivisionLevel(24)).toBe(24);
		});

		it('should return 32 for patterns up to 32 notes', () => {
			expect(LaneMeasureNote.getSubdivisionLevel(25)).toBe(32);
			expect(LaneMeasureNote.getSubdivisionLevel(32)).toBe(32);
		});

		it('should return 48 for patterns up to 48 notes', () => {
			expect(LaneMeasureNote.getSubdivisionLevel(33)).toBe(48);
			expect(LaneMeasureNote.getSubdivisionLevel(48)).toBe(48);
		});

		it('should return 64 for patterns up to 64 notes', () => {
			expect(LaneMeasureNote.getSubdivisionLevel(49)).toBe(64);
			expect(LaneMeasureNote.getSubdivisionLevel(64)).toBe(64);
		});

		it('should cap at 192 for very large patterns', () => {
			expect(LaneMeasureNote.getSubdivisionLevel(100)).toBe(100);
			expect(LaneMeasureNote.getSubdivisionLevel(192)).toBe(192);
			expect(LaneMeasureNote.getSubdivisionLevel(200)).toBe(192);
		});
	});

	describe('getMeasureLengthMultiplier', () => {
		it('should return correct multipliers for subdivision levels', () => {
			expect(LaneMeasureNote.getMeasureLengthMultiplier(16)).toBe(1);
			expect(LaneMeasureNote.getMeasureLengthMultiplier(24)).toBe(1.5);
			expect(LaneMeasureNote.getMeasureLengthMultiplier(32)).toBe(2);
			expect(LaneMeasureNote.getMeasureLengthMultiplier(48)).toBe(3);
			expect(LaneMeasureNote.getMeasureLengthMultiplier(64)).toBe(4);
		});
	});

	describe('parseFromPattern - higher subdivisions', () => {
		it('should parse 24th note patterns correctly', () => {
			// Create a 24-note pattern (48 characters total, 2 chars per note)
			const patternParts = new Array(24).fill('00');
			patternParts[0] = '01'; // First 24th note
			patternParts[1] = '02'; // Second 24th note
			patternParts[8] = '03'; // Ninth 24th note (8/24 = 1/3)
			const pattern = patternParts.join('');

			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
			expect(result[1]).toEqual({ noteID: '02', position: 1 / 24 });
			expect(result[2]).toEqual({ noteID: '03', position: 8 / 24 });
		});

		it('should parse 32nd note patterns correctly', () => {
			// Create a 32-note pattern (64 characters total, 2 chars per note)
			const patternParts = new Array(32).fill('00');
			patternParts[0] = '01'; // First 32nd note
			patternParts[2] = '02'; // Third 32nd note
			patternParts[16] = '03'; // Seventeenth 32nd note (16/32 = 1/2)
			const pattern = patternParts.join('');

			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
			expect(result[1]).toEqual({ noteID: '02', position: 2 / 32 });
			expect(result[2]).toEqual({ noteID: '03', position: 16 / 32 });
		});

		it('should parse 48th note patterns correctly', () => {
			// Create a 48-note pattern
			const patternParts = new Array(48).fill('00');
			patternParts[0] = '01'; // First position
			patternParts[1] = '02'; // Second position (1/48)
			patternParts[2] = '03'; // Third position (2/48)
			const pattern = patternParts.join('');

			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
			expect(result[1]).toEqual({ noteID: '02', position: 1 / 48 });
			expect(result[2]).toEqual({ noteID: '03', position: 2 / 48 });
		});

		it('should parse 64th note patterns correctly', () => {
			// Create a 64-note pattern (128 characters total, 2 chars per note)
			const patternParts = new Array(64).fill('00');
			patternParts[0] = '01'; // First 64th note
			patternParts[7] = '02'; // Eighth 64th note
			patternParts[31] = '03'; // Thirty-second 64th note (31/64)
			const pattern = patternParts.join('');

			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
			expect(result[1]).toEqual({ noteID: '02', position: 7 / 64 });
			expect(result[2]).toEqual({ noteID: '03', position: 31 / 64 });
		});

		it('should handle mixed subdivision patterns', () => {
			// 24-note pattern with notes at various positions
			const patternParts = new Array(24).fill('00');
			patternParts[0] = '01'; // 0/24
			patternParts[6] = '02'; // 6/24 = 1/4
			patternParts[12] = '03'; // 12/24 = 1/2
			patternParts[18] = '04'; // 18/24 = 3/4
			const pattern = patternParts.join('');

			const result = LaneMeasureNote.parseFromPattern(pattern);

			expect(result).toHaveLength(4);
			expect(result[0]).toEqual({ noteID: '01', position: 0 });
			expect(result[1]).toEqual({ noteID: '02', position: 6 / 24 });
			expect(result[2]).toEqual({ noteID: '03', position: 12 / 24 });
			expect(result[3]).toEqual({ noteID: '04', position: 18 / 24 });
		});
	});

	describe('toPattern - higher subdivisions', () => {
		it('should generate correct 24th note patterns', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 1 / 24 },
				{ noteID: '03', position: 8 / 24 } // 1/3
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const pattern = laneMeasureNote.toPattern();

			// Should generate a 24-note pattern
			expect(pattern.length).toBe(48); // 24 notes * 2 chars each
			expect(pattern.substring(0, 2)).toBe('01');
			expect(pattern.substring(2, 4)).toBe('02');
			expect(pattern.substring(16, 18)).toBe('03'); // 8th position (index 8 * 2)
		});

		it('should generate correct 32nd note patterns', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 1 / 32 },
				{ noteID: '03', position: 16 / 32 } // 1/2
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const pattern = laneMeasureNote.toPattern();

			// Should generate a 32-note pattern
			expect(pattern.length).toBe(64); // 32 notes * 2 chars each
			expect(pattern.substring(0, 2)).toBe('01');
			expect(pattern.substring(2, 4)).toBe('02');
			expect(pattern.substring(32, 34)).toBe('03'); // 16th position (index 16 * 2)
		});

		it('should handle fractional positions in higher subdivisions', () => {
			const notes = [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 5 / 48 }, // Specific 48th note position
				{ noteID: '03', position: 23 / 48 }
			];
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const pattern = laneMeasureNote.toPattern();

			// Should generate a 48-note pattern
			expect(pattern.length).toBe(96); // 48 notes * 2 chars each
			expect(pattern.substring(0, 2)).toBe('01');
			expect(pattern.substring(10, 12)).toBe('02'); // 5th position (index 5 * 2)
			expect(pattern.substring(46, 48)).toBe('03'); // 23rd position (index 23 * 2)
		});
	});

	describe('parseFromPattern and toPattern roundtrip - higher subdivisions', () => {
		it('should maintain 24th note pattern integrity in roundtrip', () => {
			const patternParts = new Array(24).fill('00');
			patternParts[0] = '01';
			patternParts[1] = '02';
			patternParts[8] = '03';
			const originalPattern = patternParts.join('');

			const notes = LaneMeasureNote.parseFromPattern(originalPattern);
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const resultPattern = laneMeasureNote.toPattern();

			expect(resultPattern).toBe(originalPattern);
		});

		it('should maintain 32nd note pattern integrity in roundtrip', () => {
			const patternParts = new Array(32).fill('00');
			patternParts[0] = '01';
			patternParts[1] = '02'; // Use position 1 instead of 2 to ensure 32nd precision
			patternParts[31] = '03'; // Use position 31 instead of 16 to ensure 32nd precision
			const originalPattern = patternParts.join('');

			const notes = LaneMeasureNote.parseFromPattern(originalPattern);
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const resultPattern = laneMeasureNote.toPattern();

			expect(resultPattern).toBe(originalPattern);
		});

		it('should maintain 48th note pattern integrity in roundtrip', () => {
			const patternParts = new Array(48).fill('00');
			patternParts[0] = '01';
			patternParts[5] = '02';
			patternParts[23] = '03';
			const originalPattern = patternParts.join('');

			const notes = LaneMeasureNote.parseFromPattern(originalPattern);
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const resultPattern = laneMeasureNote.toPattern();

			expect(resultPattern).toBe(originalPattern);
		});

		it('should maintain 64th note pattern integrity in roundtrip', () => {
			const patternParts = new Array(64).fill('00');
			patternParts[0] = '01';
			patternParts[7] = '02';
			patternParts[31] = '03';
			const originalPattern = patternParts.join('');

			const notes = LaneMeasureNote.parseFromPattern(originalPattern);
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const resultPattern = laneMeasureNote.toPattern();

			expect(resultPattern).toBe(originalPattern);
		});
	});

	describe('parseFromPattern and toPattern roundtrip', () => {
		it('should maintain pattern integrity in roundtrip conversion', () => {
			const originalPattern = '01020300';
			const notes = LaneMeasureNote.parseFromPattern(originalPattern);
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const resultPattern = laneMeasureNote.toPattern();

			expect(resultPattern).toBe(originalPattern);
		});

		it('should handle complex patterns in roundtrip', () => {
			const originalPattern = '01020304';
			const notes = LaneMeasureNote.parseFromPattern(originalPattern);
			const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
			const resultPattern = laneMeasureNote.toPattern();

			expect(resultPattern).toBe(originalPattern);
		});
	});
});
