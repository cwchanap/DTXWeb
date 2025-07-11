import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LaneMeasureNote } from './note.js';

// Mock the position utility since it's an external dependency
vi.mock('../utils/position.js', () => ({
	normalizePosition: vi.fn((pos: number) => Math.round(pos * 16) / 16)
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
