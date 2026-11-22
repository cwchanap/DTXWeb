import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LaneMeasureNote } from './note';

// Mock the position utility since it's an external dependency
vi.mock('../utils/position', () => ({
	normalizePosition: vi.fn(
		(pos: number, subdivision: number = 192) => Math.round(pos * subdivision) / subdivision
	),
	canonicalizeCellOffset: vi.fn((pos: number) => Number(pos.toPrecision(15)))
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

		it('should use 192 slots for off-grid positions instead of quarter-note fallback', () => {
			// Three snare hits at MIDI ticks 3, 487, 500 of a 1920-tick bar:
			// none lands on a coarser grid. A coarse fallback collapses them
			// into shared slots and silently drops notes.
			const notes = [3, 487, 500].map((tick, index) => ({
				noteID: `0${index + 1}`,
				position: tick / 1920
			}));
			const laneMeasureNote = new LaneMeasureNote(0, '12', notes, 1);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toHaveLength(192 * 2);
			const reparsed = LaneMeasureNote.parseFromPattern(pattern);
			expect(reparsed).toHaveLength(3);
			// Each hit keeps its own 1/192 slot (nearest-slot rounding).
			expect(reparsed.map((note) => Math.round(note.position * 192))).toEqual([0, 49, 50]);
		});

		it('should widen past 192 rather than overwrite two hits sharing a cell', () => {
			// Positions 1/384 and 1/192 fit no coarser standard grid. On the
			// 192 fallback both round to cell 1 — the second would silently
			// replace the first. The 384 grid keeps them on distinct cells.
			const laneMeasureNote = new LaneMeasureNote(0, '12', [
				{ noteID: '01', position: 1 / 384 },
				{ noteID: '02', position: 1 / 192 }
			]);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toHaveLength(384 * 2);
			expect(pattern.slice(2, 4)).toBe('01'); // cell 1
			expect(pattern.slice(4, 6)).toBe('02'); // cell 2

			// Reimport keeps the widened cells distinct instead of snapping
			// back onto the 192 grid. Stored positions are canonicalized to
			// 15 digits so editor note keys stay stable.
			expect(LaneMeasureNote.parseFromPattern(pattern)).toEqual([
				{ noteID: '01', position: Number((1 / 384).toPrecision(15)) },
				{ noteID: '02', position: Number((1 / 192).toPrecision(15)) }
			]);
		});

		it('should keep an untouched hit on its widened grid when another is removed', () => {
			// Reproduced from PR #365 review: a 384-cell pattern round-trips,
			// but deleting one hit re-serialized the survivor on the 192
			// fallback because 384/768 were absent from commonResolutions —
			// 1/384 silently moved to 1/192 on save.
			const cells = new Array(384).fill('00');
			cells[1] = '01';
			cells[2] = '02';
			const notes = LaneMeasureNote.parseFromPattern(cells.join('')).filter(
				(note) => note.noteID !== '02'
			);
			const laneMeasureNote = new LaneMeasureNote(0, '12', notes);
			const result = laneMeasureNote.toPattern();

			expect(result).toHaveLength(384 * 2);
			expect(result.slice(2, 4)).toBe('01');
			expect(LaneMeasureNote.parseFromPattern(result)).toEqual([
				{ noteID: '01', position: Number((1 / 384).toPrecision(15)) }
			]);
		});

		it('should export a lone hit at 1/768 on the 768-cell grid without a collision', () => {
			// The grid-limit case: a single off-grid hit at the finest standard
			// resolution must come from the exact-resolution search, not the
			// widening fallback — and round-trips back to the same position.
			const laneMeasureNote = new LaneMeasureNote(0, '12', [
				{ noteID: '01', position: 1 / 768 }
			]);
			const pattern = laneMeasureNote.toPattern();

			expect(pattern).toHaveLength(768 * 2);
			expect(pattern.slice(2, 4)).toBe('01'); // cell 1
			expect(LaneMeasureNote.parseFromPattern(pattern)).toEqual([
				{ noteID: '01', position: Number((1 / 768).toPrecision(15)) }
			]);
		});

		it('should warn when hits still share a cell at the 768-cell cap', () => {
			// 0.5 + 1/2048 sits off every standard grid (it lands 0.002 cells
			// from a boundary even at 4), yet rounds onto the same cell as 0.5
			// at all of 192/384/768 — no allowed grid can keep them apart.
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const laneMeasureNote = new LaneMeasureNote(0, '12', [
				{ noteID: '01', position: 0.5 },
				{ noteID: '02', position: 0.5 + 1 / 2048 }
			]);
			const pattern = laneMeasureNote.toPattern();

			expect(warn).toHaveBeenCalledWith(expect.stringContaining('share a cell'));
			expect(pattern).toHaveLength(768 * 2);
			expect(pattern.slice(768, 770)).toBe('02'); // last note wins cell 384
			warn.mockRestore();
		});

		it('should warn when the per-note tolerance merges distinct positions on a standard grid', () => {
			// 0.5 + 0.5001 both pass res-4 tolerance (2.0004 is within 0.001 of 2)
			// yet share cell 2 — the tolerance check alone would overwrite '01'
			// silently. The distinct-cell requirement forces widening to the cap.
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const laneMeasureNote = new LaneMeasureNote(0, '12', [
				{ noteID: '01', position: 0.5 },
				{ noteID: '02', position: 0.5001 }
			]);
			const pattern = laneMeasureNote.toPattern();

			expect(warn).toHaveBeenCalledWith(expect.stringContaining('share a cell'));
			expect(pattern).toHaveLength(768 * 2);
			warn.mockRestore();
		});

		it('should warn when a note rounds to a cell outside the pattern grid', () => {
			// A position a hair under the bar end rounds to index `resolution`
			// and falls out of the [0, resolution) range — it used to vanish
			// without a word, now it reports through the same warning path as
			// shared-cell drops.
			const warnings: string[] = [];
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const laneMeasureNote = new LaneMeasureNote(0, '12', [
				{ noteID: '01', position: 0.999 },
				{ noteID: '02', position: 0 }
			]);
			const pattern = laneMeasureNote.toPattern((message) => warnings.push(message));

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('dropped');
			expect(warn).not.toHaveBeenCalled();
			// The in-bounds note still lands on cell 0.
			expect(pattern.slice(0, 2)).toBe('02');
			warn.mockRestore();
		});

		it('should report the merged-cell loss to an onWarning sink instead of console.warn', () => {
			const warnings: string[] = [];
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const laneMeasureNote = new LaneMeasureNote(0, '12', [
				{ noteID: '01', position: 0.5 },
				{ noteID: '02', position: 0.5001 }
			]);
			laneMeasureNote.toPattern((message) => warnings.push(message));

			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('share a cell');
			expect(warn).not.toHaveBeenCalled();
			warn.mockRestore();
		});

		it('should keep a note at fraction 0.875 in a 3/4 bar', () => {
			// MIDI-import contract: positions are [0,1) bar fractions with
			// measureLength = 1 even for 3/4; the meter lives only in the
			// channel-02 decimal map. A quarter-note fallback would round the
			// index out of bounds and drop the last-quarter hit.
			const laneMeasureNote = new LaneMeasureNote(
				0,
				'12',
				[{ noteID: '02', position: 0.875 }],
				1
			);
			const pattern = laneMeasureNote.toPattern();

			// 0.875 = 7/8 fits the 8-slot grid exactly — no 192 fallback needed.
			expect(pattern).toHaveLength(8 * 2);
			expect(LaneMeasureNote.parseFromPattern(pattern)).toEqual([
				{ noteID: '02', position: 0.875 }
			]);
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
			expect(result[1]).toEqual({
				noteID: '02',
				position: Number((1 / 24).toPrecision(15))
			});
			expect(result[2]).toEqual({
				noteID: '03',
				position: Number((8 / 24).toPrecision(15))
			});
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
			expect(result[1]).toEqual({
				noteID: '02',
				position: Number((1 / 48).toPrecision(15))
			});
			expect(result[2]).toEqual({
				noteID: '03',
				position: Number((2 / 48).toPrecision(15))
			});
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

		it.each([288, 576])(
			'should maintain %i-cell triplet pattern integrity in roundtrip',
			(cells) => {
				const patternParts = new Array(cells).fill('00');
				patternParts[1] = '01';
				patternParts[100] = '02';
				patternParts[cells - 1] = '03';
				const originalPattern = patternParts.join('');

				const notes = LaneMeasureNote.parseFromPattern(originalPattern);
				const laneMeasureNote = new LaneMeasureNote(0, 'LC', notes);
				const resultPattern = laneMeasureNote.toPattern();

				expect(resultPattern).toBe(originalPattern);
			}
		);
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
