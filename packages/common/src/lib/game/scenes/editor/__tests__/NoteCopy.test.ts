import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoteCopy } from './NoteCopy';
import { LaneMeasureNote } from '../../../chart/note';
import type { Editor } from '../Editor';
import type { NoteMove } from './NoteMove';
// Mock Editor type
const createMockEditor = () => {
	return {
		getNotes: vi.fn(),
		getLaneConfigs: vi.fn(),
		getCellsPerMeasure: vi.fn().mockReturnValue(16),
		getMeasureCount: vi.fn().mockReturnValue(100),
		drawNote: vi.fn().mockReturnValue(true),
		getPanelContainer: vi.fn().mockReturnValue({
			getByName: vi.fn().mockReturnValue(null)
		})
	} as unknown as Editor;
};

// Create mock NoteMove
const createMockNoteMove = () => {
	return {
		addNoteToEditor: vi.fn().mockReturnValue(true)
	} as unknown as NoteMove;
};

describe('NoteCopy', () => {
	let noteCopy: NoteCopy;
	let mockEditor: Editor;
	let mockNoteMove: NoteMove;

	beforeEach(() => {
		mockNoteMove = createMockNoteMove();

		// Create a mock findReferenceNote function that implements the same logic
		const mockFindReferenceNote = (noteKeys: Set<string>) => {
			if (noteKeys.size === 0) {
				return null;
			}

			let referenceLaneIndex = Number.MIN_SAFE_INTEGER;
			let referenceMeasure = Number.MAX_SAFE_INTEGER;
			let referenceCellOffset = Number.MAX_SAFE_INTEGER;

			noteKeys.forEach((noteKey) => {
				const parts = noteKey.split('-');
				if (parts.length === 4) {
					const laneIndex = parseInt(parts[1]);
					const measure = parseInt(parts[2]);
					const cellOffset = parseFloat(parts[3]);

					// Priority: 1) smallest measure, 2) smallest cellOffset, 3) rightmost lane (highest lane index)
					if (
						measure < referenceMeasure ||
						(measure === referenceMeasure && cellOffset < referenceCellOffset) ||
						(measure === referenceMeasure &&
							cellOffset === referenceCellOffset &&
							laneIndex > referenceLaneIndex)
					) {
						referenceLaneIndex = laneIndex;
						referenceMeasure = measure;
						referenceCellOffset = cellOffset;
					}
				}
			});

			// Return null if no valid reference was found
			if (referenceMeasure === Number.MAX_SAFE_INTEGER) {
				return null;
			}

			return {
				laneIndex: referenceLaneIndex,
				measure: referenceMeasure,
				cellOffset: referenceCellOffset
			};
		};

		noteCopy = new NoteCopy(mockNoteMove, mockFindReferenceNote);
		mockEditor = createMockEditor();

		// Set up default lane configs
		vi.mocked(mockEditor.getLaneConfigs).mockReturnValue([
			{ id: 'lane1', name: 'Lane 1', noteColor: 0xffffff, playable: true },
			{ id: 'lane2', name: 'Lane 2', noteColor: 0xffffff, playable: true },
			{ id: 'lane3', name: 'Lane 3', noteColor: 0xffffff, playable: true }
		]);

		// Set up default notes structure with properly parsed notes
		const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
		const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
		const lane2Notes = LaneMeasureNote.parseFromPattern('12000000000000000000000000000000');
		const lane2Note = new LaneMeasureNote(1, 'lane2', lane2Notes);

		vi.mocked(mockEditor.getNotes).mockReturnValue({
			lane1: [lane1Note],
			lane2: [lane2Note]
		});
	});

	describe('constructor', () => {
		it('should create with empty clipboard', () => {
			expect(noteCopy.hasClipboard()).toBe(false);
			expect(noteCopy.getClipboardSize()).toBe(0);
		});
	});

	describe('copyNotes', () => {
		it('should copy selected notes successfully', () => {
			// Make sure the notes are properly parsed
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			const lane2Notes = LaneMeasureNote.parseFromPattern('12000000000000000000000000000000');
			const lane2Note = new LaneMeasureNote(1, 'lane2', lane2Notes);

			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [lane1Note],
				lane2: [lane2Note]
			});

			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);

			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(result).toBe(true);
			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(2);
		});

		it('should return false when no notes are selected', () => {
			const selectedNotes = new Set<string>();

			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(result).toBe(false);
			expect(noteCopy.hasClipboard()).toBe(false);
		});

		it('should return false when all selected note keys are invalid format', () => {
			// All keys have invalid format (not 4 parts when split by '-')
			const selectedNotes = new Set(['invalid', 'alsobad']);

			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(result).toBe(false);
			expect(noteCopy.hasClipboard()).toBe(false);
		});

		it('should calculate relative positions correctly', () => {
			// Test with notes at different positions to verify relative calculation
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);

			noteCopy.copyNotes(selectedNotes, mockEditor);

			// The first note (note-0-1-0) should be the reference with relative position (0, 0, 0)
			// The second note should have relative position (1, 0, 0)
			expect(noteCopy.hasClipboard()).toBe(true);
		});

		it('should handle notes that do not exist in data structure', () => {
			const selectedNotes = new Set(['note-0-1-0', 'note-2-2-0.5']); // Second note doesn't exist

			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			// Should still succeed with the notes that exist
			expect(result).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(1); // Only one note copied
		});

		it('should find the correct reference note (smallest measure first)', () => {
			// Test case to verify measure has priority over lane index
			// note-0-2-0 (lane 0, measure 2) vs note-2-1-0 (lane 2, measure 1)
			// Should choose note-2-1-0 as reference because measure 1 < measure 2
			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [
					new LaneMeasureNote(
						2,
						'lane1',
						LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
					) // measure 2
				],
				lane3: [
					new LaneMeasureNote(
						1,
						'lane3',
						LaneMeasureNote.parseFromPattern('12000000000000000000000000000000')
					) // measure 1
				]
			});

			const selectedNotes = new Set(['note-0-2-0', 'note-2-1-0']); // note-2-1-0 should be reference

			noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(2);
		});
	});

	describe('pasteNotes', () => {
		beforeEach(() => {
			// Set up some copied notes - copy notes at positions (0,1,0) and (1,1,0)
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor);
		});

		it('should paste notes successfully at target position', () => {
			const result = noteCopy.pasteNotes(1, 2, 0, mockEditor); // Paste at lane 1 instead of 0

			expect(result).toBe(true);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledTimes(2);
			// Reference note (rightmost: lane 1, noteId '12') should be pasted at the target position
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				1,
				0,
				'lane2',
				'12'
			);
			// Other note should maintain relative position (-1 lane offset)
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				0,
				0,
				'lane1',
				'11'
			);
		});

		it('should return false when no notes are in clipboard', () => {
			noteCopy.clearClipboard();

			const result = noteCopy.pasteNotes(0, 2, 0, mockEditor);

			expect(result).toBe(false);
			expect(mockEditor.drawNote).not.toHaveBeenCalled();
		});

		it('should wrap cellOffset into previous measure when < 0.0', () => {
			// Note A (reference) in measure 1 at cellOffset 0.75 (pair 24 = '11' at position 24/32)
			// Note B in measure 2 at cellOffset 0.25 (pair 8 = '12' at position 8/32)
			// relativeMeasure for B = 1, relativeCellOffset for B = 0.25 - 0.75 = -0.5
			const laneANotes = LaneMeasureNote.parseFromPattern(
				'0'.repeat(48) + '11' + '0'.repeat(14)
			);
			const laneANote = new LaneMeasureNote(1, 'lane1', laneANotes); // cellOffset = 0.75
			const laneBNotes = LaneMeasureNote.parseFromPattern(
				'0'.repeat(16) + '12' + '0'.repeat(46)
			);
			const laneBNote = new LaneMeasureNote(2, 'lane2', laneBNotes); // cellOffset = 0.25

			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [laneANote],
				lane2: [laneBNote]
			});

			// Select A at (lane=0, measure=1, offset=0.75) and B at (lane=1, measure=2, offset=0.25)
			const selectedNotes = new Set(['note-0-1-0.75', 'note-1-2-0.25']);
			noteCopy.copyNotes(selectedNotes, mockEditor);

			// Paste at targetLane=0, targetMeasure=5, targetCellOffset=0.3
			// A (reference, laneIndex=0): newMeasure=5, newCellOffset=0.3+0=0.3
			// B (laneIndex=1): newMeasure=6, newCellOffset=0.3+(-0.5)=-0.2
			//   → while (newCellOffset < 0.0): newCellOffset+=1.0 → 0.8, newMeasure=5
			const result = noteCopy.pasteNotes(0, 5, 0.3, mockEditor);

			expect(result).toBe(true);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				5,
				0,
				0.3,
				'lane1',
				'11'
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				5,
				1,
				expect.closeTo(0.8, 10),
				'lane2',
				'12'
			);
		});

		it('should wrap cellOffset into next measure when >= 1.0', () => {
			// Copy two notes where lane1 note is at 0.5 relative to the reference (lane2 at 0)
			const lane1Notes = LaneMeasureNote.parseFromPattern(
				'0000000000000000' + '11' + '00000000000000'
			);
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			const lane2Notes = LaneMeasureNote.parseFromPattern(
				'12' + '00000000000000' + '00000000000000'
			);
			const lane2Note = new LaneMeasureNote(1, 'lane2', lane2Notes);

			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [lane1Note],
				lane2: [lane2Note]
			});

			// Copy lane2 (position 0) and lane1 (position 0.5), reference is lane2 at 0
			// lane1 relativeCellOffset = 0.5
			const selectedNotes = new Set(['note-0-1-0.5', 'note-1-1-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor);

			// Paste at cellOffset 0.8 - lane1's newCellOffset = 0.8 + 0.5 = 1.3 → wraps to 0.3, measure+1
			const result = noteCopy.pasteNotes(1, 2, 0.8, mockEditor);

			expect(result).toBe(true);
			// reference note (lane2) at 0.8, lane1 should be at 0.3 of measure 3
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				1,
				0.8,
				'lane2',
				'12'
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				3,
				0,
				expect.closeTo(0.3, 5),
				'lane1',
				'11'
			);
		});

		it('should handle measure boundary crossing', () => {
			// Test pasting near the end of a measure - paste at position 0.9
			// Reference note (lane 1, noteId '12') at target position
			// Other note (lane 0, noteId '11') at relative position (-1 lane offset)
			// With high-resolution positioning, 0.9 stays as 0.9 (no normalization to 16th grid)
			const result = noteCopy.pasteNotes(1, 1, 0.9, mockEditor);

			expect(result).toBe(true);
			// Both notes should be within bounds and preserve exact positioning
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				1,
				0.9,
				'lane2',
				'12'
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.9,
				'lane1',
				'11'
			);
		});

		it('should validate target positions and skip invalid ones', () => {
			// Try to paste at an invalid lane
			const result = noteCopy.pasteNotes(10, 2, 0, mockEditor); // Lane 10 doesn't exist

			expect(result).toBe(false);
			expect(mockEditor.drawNote).not.toHaveBeenCalled();
		});

		it('should skip positions that are already occupied', () => {
			// Mock an existing note at the target position
			const mockGetByName = vi.fn().mockReturnValue({ name: 'existing-note' });
			vi.mocked(mockEditor.getPanelContainer).mockReturnValue({
				getByName: mockGetByName
			} as never);

			const result = noteCopy.pasteNotes(0, 2, 0, mockEditor);

			expect(result).toBe(false); // No notes pasted due to collision
		});

		it('should update data structure when pasting notes', () => {
			const mockNotes = {
				lane1: [],
				lane2: []
			};
			vi.mocked(mockEditor.getNotes).mockReturnValue(mockNotes);

			noteCopy.pasteNotes(1, 2, 0, mockEditor);

			// Should have called addNoteToEditor for both notes
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledTimes(2);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				1,
				0,
				'lane2',
				'12'
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				0,
				0,
				'lane1',
				'11'
			);
		});
	});

	describe('clipboard management', () => {
		it('should clear clipboard correctly', () => {
			const selectedNotes = new Set(['note-0-1-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(noteCopy.hasClipboard()).toBe(true);

			noteCopy.clearClipboard();

			expect(noteCopy.hasClipboard()).toBe(false);
			expect(noteCopy.getClipboardSize()).toBe(0);
		});

		it('should report correct clipboard size', () => {
			expect(noteCopy.getClipboardSize()).toBe(0);

			// Add a third lane note for this test
			const lane3Notes = LaneMeasureNote.parseFromPattern('13000000000000000000000000000000');
			const lane3Note = new LaneMeasureNote(2, 'lane3', lane3Notes);

			const notesWithThird = {
				...vi.mocked(mockEditor.getNotes).getMockImplementation()?.(),
				lane3: [lane3Note]
			};
			vi.mocked(mockEditor.getNotes).mockReturnValue(notesWithThird);

			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0', 'note-2-2-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(noteCopy.getClipboardSize()).toBe(3);
		});
	});

	describe('edge cases', () => {
		it('should handle negative relative positions correctly', () => {
			// Set up notes where the reference is not the first in order
			vi.mocked(mockEditor.getNotes).mockReturnValue({
				lane1: [
					new LaneMeasureNote(
						2,
						'lane1',
						LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
					)
				],
				lane2: [
					new LaneMeasureNote(
						1,
						'lane2',
						LaneMeasureNote.parseFromPattern('12000000000000000000000000000000')
					)
				]
			});

			const selectedNotes = new Set(['note-0-2-0', 'note-1-1-0']); // Second note is reference
			noteCopy.copyNotes(selectedNotes, mockEditor);

			// Paste at position where negative offsets would occur
			const result = noteCopy.pasteNotes(1, 1, 0, mockEditor);

			expect(result).toBe(true);
		});

		it('should handle empty notes structure', () => {
			vi.mocked(mockEditor.getNotes).mockReturnValue({});

			const selectedNotes = new Set(['note-0-1-0']);
			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			expect(result).toBe(false);
		});

		it('should handle malformed note keys', () => {
			const selectedNotes = new Set(['invalid-key', 'note-0-1-0']);
			const result = noteCopy.copyNotes(selectedNotes, mockEditor);

			// Should still process valid keys
			expect(result).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(1);
		});
	});

	describe('cutNotes', () => {
		beforeEach(() => {
			// Set up some notes in the editor for cutting
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);
			noteCopy.copyNotes(selectedNotes, mockEditor); // Set up clipboard first
		});

		it('should cut notes successfully (copy + delete)', () => {
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);
			const mockDeleteNoteByKey = vi.fn();

			const result = noteCopy.cutNotes(selectedNotes, mockEditor, mockDeleteNoteByKey);

			expect(result).toBe(true);
			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.isCutClipboard()).toBe(true);
			expect(noteCopy.getClipboardSize()).toBe(2);

			// Should have called delete for each note
			expect(mockDeleteNoteByKey).toHaveBeenCalledTimes(2);
			expect(mockDeleteNoteByKey).toHaveBeenCalledWith('note-0-1-0');
			expect(mockDeleteNoteByKey).toHaveBeenCalledWith('note-1-1-0');
		});

		it('should return false when no notes are selected for cutting', () => {
			const selectedNotes = new Set<string>();
			const mockDeleteNoteByKey = vi.fn();

			const result = noteCopy.cutNotes(selectedNotes, mockEditor, mockDeleteNoteByKey);

			expect(result).toBe(false);
			expect(mockDeleteNoteByKey).not.toHaveBeenCalled();
		});

		it('should not delete notes if copy fails', () => {
			// Mock empty notes structure to make copy fail
			vi.mocked(mockEditor.getNotes).mockReturnValue({});
			const selectedNotes = new Set(['note-0-1-0']);
			const mockDeleteNoteByKey = vi.fn();

			const result = noteCopy.cutNotes(selectedNotes, mockEditor, mockDeleteNoteByKey);

			expect(result).toBe(false);
			expect(mockDeleteNoteByKey).not.toHaveBeenCalled();
		});
	});

	describe('cut vs copy behavior', () => {
		it('should distinguish between cut and copy operations', () => {
			const selectedNotes = new Set(['note-0-1-0']);

			// Test copy operation
			noteCopy.copyNotes(selectedNotes, mockEditor);
			expect(noteCopy.isCutClipboard()).toBe(false);

			// Test cut operation
			const mockDeleteNoteByKey = vi.fn();
			noteCopy.cutNotes(selectedNotes, mockEditor, mockDeleteNoteByKey);
			expect(noteCopy.isCutClipboard()).toBe(true);
		});

		it('should clear clipboard after pasting cut notes', () => {
			const selectedNotes = new Set(['note-0-1-0']);
			const mockDeleteNoteByKey = vi.fn();

			// Cut notes
			noteCopy.cutNotes(selectedNotes, mockEditor, mockDeleteNoteByKey);
			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.isCutClipboard()).toBe(true);

			// Paste the cut notes
			const result = noteCopy.pasteNotes(0, 2, 0, mockEditor);

			expect(result).toBe(true);
			// Clipboard should be cleared after pasting cut notes
			expect(noteCopy.hasClipboard()).toBe(false);
			expect(noteCopy.isCutClipboard()).toBe(false);
			expect(noteCopy.getClipboardSize()).toBe(0);
		});

		it('should not clear clipboard after pasting copied notes', () => {
			const selectedNotes = new Set(['note-0-1-0']);

			// Copy notes (not cut)
			noteCopy.copyNotes(selectedNotes, mockEditor);
			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.isCutClipboard()).toBe(false);

			// Paste the copied notes
			const result = noteCopy.pasteNotes(0, 2, 0, mockEditor);

			expect(result).toBe(true);
			// Clipboard should remain for copied notes
			expect(noteCopy.hasClipboard()).toBe(true);
			expect(noteCopy.isCutClipboard()).toBe(false);
			expect(noteCopy.getClipboardSize()).toBe(1);
		});
	});
});
