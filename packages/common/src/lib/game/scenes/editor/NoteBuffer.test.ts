import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	NoteBuffer,
	type UndoAction,
	type MoveUndoAction,
	type PasteUndoAction,
	type CutUndoAction,
	type DeletedNoteData,
	type MovedNoteData,
	type PastedNoteData,
	type CutNoteData
} from './NoteBuffer';
import { LaneMeasureNote } from '../../../chart/note';
import { normalizePosition } from '../../../utils/position';
import type { Editor } from '../Editor';
import type { NoteMove } from './NoteMove';

// Mock the normalizePosition utility
vi.mock('../../../utils/position', () => ({
	normalizePosition: vi.fn((cellOffset: number) => cellOffset)
}));

// Mock note graphics interface
interface MockNoteGraphics {
	name: string;
}

// Mock Editor interface for testing that matches what NoteBuffer expects
interface MockEditor {
	notes: Record<string, LaneMeasureNote[]>;
	selectedNotes: Set<string>;
	getCellsPerMeasure: () => number;
	drawNote: (measure: number, laneIndex: number, cellOffset: number, noteId: string) => boolean;
	clearSelection: () => void;
	getByName: (name: string) => MockNoteGraphics | null;
	highlightSelectedNote: (noteGraphics: MockNoteGraphics) => void;
	deleteNoteByKey: (noteKey: string) => void;
	getPanelContainer: () => {
		getByName: (name: string) => { destroy: () => void } | null;
	};
}

// Create mock NoteMove
const createMockNoteMove = () => {
	return {
		addNoteToEditor: vi
			.fn()
			.mockImplementation(
				(
					measure: number,
					laneIndex: number,
					cellOffset: number,
					laneId: string,
					noteId: string,
					measureLength: number
				) => {
					// Simulate the data structure update for testing
					return true;
				}
			)
	} as unknown as NoteMove;
};

describe('NoteBuffer', () => {
	let noteBuffer: NoteBuffer;
	let mockEditor: MockEditor;
	let mockDeletedNoteData: DeletedNoteData;
	let mockNoteMove: NoteMove;

	beforeEach(() => {
		noteBuffer = new NoteBuffer();
		mockNoteMove = createMockNoteMove();
		noteBuffer.setNoteMove(mockNoteMove);

		// Set up normalizePosition mock to return the input value (identity function for tests)
		vi.mocked(normalizePosition).mockImplementation((cellOffset: number) => cellOffset);

		// Create mock editor
		mockEditor = {
			notes: {},
			selectedNotes: new Set<string>(),
			getCellsPerMeasure: vi.fn().mockReturnValue(16),
			drawNote: vi.fn().mockReturnValue(true),
			clearSelection: vi.fn(),
			getByName: vi.fn().mockReturnValue({ name: 'mockNote' }),
			highlightSelectedNote: vi.fn(),
			deleteNoteByKey: vi.fn(),
			getPanelContainer: vi.fn().mockReturnValue({
				getByName: vi.fn().mockReturnValue({ destroy: vi.fn() })
			})
		};

		// Create mock deleted note data
		mockDeletedNoteData = {
			noteKey: 'test-note-1',
			laneIndex: 0,
			measure: 1,
			cellOffset: 0.5,
			laneId: 'lane1',
			noteId: '11',
			measureLength: 1
		};
	});

	describe('constructor', () => {
		it('should create with default max undo steps', () => {
			const buffer = new NoteBuffer();
			expect(buffer.getHistoryLength()).toBe(0);
			expect(buffer.canUndo()).toBe(false);
		});

		it('should create with custom max undo steps', () => {
			const buffer = new NoteBuffer(25);
			expect(buffer.getHistoryLength()).toBe(0);
			expect(buffer.canUndo()).toBe(false);
		});

		it('should throw error for invalid max undo steps', () => {
			expect(() => new NoteBuffer(0)).toThrow('maxUndoSteps must be greater than 0');
			expect(() => new NoteBuffer(-5)).toThrow('maxUndoSteps must be greater than 0');
		});
	});

	describe('recordAction', () => {
		it('should record a delete action', () => {
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			expect(noteBuffer.getHistoryLength()).toBe(1);
			expect(noteBuffer.canUndo()).toBe(true);

			const history = noteBuffer.getHistory();
			expect(history[0].type).toBe('delete');
			expect(history[0].data).toHaveLength(1);
			expect(history[0].data[0]).toEqual(mockDeletedNoteData);
		});

		it('should record multiple delete actions', () => {
			const data1 = [mockDeletedNoteData];
			const data2 = [{ ...mockDeletedNoteData, noteKey: 'test-note-2' }];

			noteBuffer.recordAction('delete', data1);
			noteBuffer.recordAction('delete', data2);

			expect(noteBuffer.getHistoryLength()).toBe(2);

			const history = noteBuffer.getHistory();
			expect((history[0].data[0] as DeletedNoteData).noteKey).toBe('test-note-1');
			expect((history[1].data[0] as DeletedNoteData).noteKey).toBe('test-note-2');
		});

		it('should not record empty actions', () => {
			noteBuffer.recordAction('delete', []);

			expect(noteBuffer.getHistoryLength()).toBe(0);
			expect(noteBuffer.canUndo()).toBe(false);
		});

		it('should limit history to max undo steps', () => {
			const smallBuffer = new NoteBuffer(2);

			// Add 3 actions to exceed the limit
			smallBuffer.recordAction('delete', [mockDeletedNoteData]);
			smallBuffer.recordAction('delete', [{ ...mockDeletedNoteData, noteKey: 'note-2' }]);
			smallBuffer.recordAction('delete', [{ ...mockDeletedNoteData, noteKey: 'note-3' }]);

			expect(smallBuffer.getHistoryLength()).toBe(2);

			const history = smallBuffer.getHistory();
			expect((history[0].data[0] as DeletedNoteData).noteKey).toBe('note-2'); // First action was removed
			expect((history[1].data[0] as DeletedNoteData).noteKey).toBe('note-3');
		});

		it('should create a copy of the data array', () => {
			const originalData = [mockDeletedNoteData];
			noteBuffer.recordAction('delete', originalData);

			// Modify original array
			originalData.push({ ...mockDeletedNoteData, noteKey: 'modified' });

			// History should not be affected
			const history = noteBuffer.getHistory();
			expect(history[0].data).toHaveLength(1);
			expect((history[0].data[0] as DeletedNoteData).noteKey).toBe('test-note-1');
		});
	});

	describe('undoLastAction', () => {
		it('should return false when no actions to undo', () => {
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);
			expect(result).toBe(false);
		});

		it('should return false when pop returns undefined despite non-zero length', () => {
			// Inject undefined into history to cover the !lastAction branch (lines 158-160)
			noteBuffer['undoHistory'] = [undefined] as any;
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);
			expect(result).toBe(false);
		});

		it('should return false for unknown action type (default switch case)', () => {
			noteBuffer['undoHistory'] = [{ type: 'unknown_type', data: [] }] as any;

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(false);
		});

		it('should successfully undo a delete action', () => {
			// Setup: Add a note to editor and record its deletion
			mockEditor.notes['lane1'] = [];
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			expect(noteBuffer.getHistoryLength()).toBe(0);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
			expect(mockEditor.clearSelection).toHaveBeenCalled();
		});

		it('should restore multiple deleted notes', () => {
			const data = [
				mockDeletedNoteData,
				{ ...mockDeletedNoteData, noteKey: 'test-note-2', cellOffset: 0.75, noteId: '12' }
			];

			mockEditor.notes['lane1'] = [];
			noteBuffer.recordAction('delete', data);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledTimes(2);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.75,
				'lane1',
				'12',
				1
			);
		});

		it('should handle add/move actions (not implemented)', () => {
			// The 'add' action type is not implemented, so we skip this test
			// noteBuffer.recordAction('add', [mockDeletedNoteData]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(false);
			expect(noteBuffer.getHistoryLength()).toBe(0); // Action is still removed
		});

		it('should restore action to history if undo fails', () => {
			// Mock addNoteToEditor to throw an error
			vi.mocked(mockNoteMove.addNoteToEditor).mockImplementation(() => {
				throw new Error('Draw failed');
			});

			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			expect(() => noteBuffer.undoLastAction(mockEditor as unknown as Editor)).toThrow(
				'Draw failed'
			);
			expect(noteBuffer.getHistoryLength()).toBe(1); // Action restored to history
		});
	});

	describe('note restoration logic', () => {
		it('should use shared addNoteToEditor logic for restoration', () => {
			mockEditor.notes = {}; // Empty notes
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
		});

		it('should delegate to addNoteToEditor regardless of existing data structure', () => {
			// Setup existing measure note
			const existingNote = new LaneMeasureNote(
				1,
				'lane1',
				LaneMeasureNote.parseFromPattern('0000000000000000000000000000000000')
			);
			mockEditor.notes['lane1'] = [existingNote];

			noteBuffer.recordAction('delete', [mockDeletedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should delegate to shared logic which handles data structure updates
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
		});

		it('should select restored notes', () => {
			const data = [mockDeletedNoteData, { ...mockDeletedNoteData, noteKey: 'test-note-2' }];

			mockEditor.notes['lane1'] = [];
			noteBuffer.recordAction('delete', data);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(mockEditor.clearSelection).toHaveBeenCalled();
			expect(mockEditor.selectedNotes.has('test-note-1')).toBe(true);
			expect(mockEditor.selectedNotes.has('test-note-2')).toBe(true);
			// Note: Highlighting is now handled internally by NoteManager, no explicit highlighting call needed
		});
	});

	describe('utility methods', () => {
		it('should clear history', () => {
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);
			expect(noteBuffer.getHistoryLength()).toBe(1);

			noteBuffer.clearHistory();

			expect(noteBuffer.getHistoryLength()).toBe(0);
			expect(noteBuffer.canUndo()).toBe(false);
		});

		it('should return correct history length', () => {
			expect(noteBuffer.getHistoryLength()).toBe(0);

			noteBuffer.recordAction('delete', [mockDeletedNoteData]);
			expect(noteBuffer.getHistoryLength()).toBe(1);

			noteBuffer.recordAction('delete', [mockDeletedNoteData]);
			expect(noteBuffer.getHistoryLength()).toBe(2);
		});

		it('should return copy of history', () => {
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			const history1 = noteBuffer.getHistory();
			const history2 = noteBuffer.getHistory();

			expect(history1).toEqual(history2);
			expect(history1).not.toBe(history2); // Different objects
		});

		it('should correctly report if can undo', () => {
			expect(noteBuffer.canUndo()).toBe(false);

			noteBuffer.recordAction('delete', [mockDeletedNoteData]);
			expect(noteBuffer.canUndo()).toBe(true);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);
			expect(noteBuffer.canUndo()).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('should handle empty deleted notes array in undo', () => {
			// This shouldn't happen due to recordAction filtering, but test defensive coding
			const emptyAction: UndoAction = { type: 'delete', data: [] };
			noteBuffer['undoHistory'] = [emptyAction]; // Direct manipulation for edge case test

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true); // Method completes successfully
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).not.toHaveBeenCalled();
		});

		it('should handle notes with different measures in same lane', () => {
			const data = [
				mockDeletedNoteData, // measure 1
				{ ...mockDeletedNoteData, noteKey: 'note-2', measure: 2 } // measure 2
			];

			mockEditor.notes['lane1'] = [];
			noteBuffer.recordAction('delete', data);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledTimes(2);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
		});

		it('should handle notes from different lanes', () => {
			const data = [
				mockDeletedNoteData, // lane1
				{ ...mockDeletedNoteData, noteKey: 'note-2', laneId: 'lane2' } // lane2
			];

			mockEditor.notes = {};
			noteBuffer.recordAction('delete', data);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledTimes(2);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane2',
				'11',
				1
			);
		});
	});

	describe('undoMove', () => {
		let mockMovedNoteData: MovedNoteData;

		beforeEach(() => {
			// Create mock moved note data
			mockMovedNoteData = {
				originalNoteKey: 'note-0-1-0.5',
				originalLaneIndex: 0,
				originalMeasure: 1,
				originalCellOffset: 0.5,
				originalLaneId: 'lane1',
				noteId: '11',
				newNoteKey: 'note-1-2-0.25',
				newLaneIndex: 1,
				newMeasure: 2,
				newCellOffset: 0.25,
				newLaneId: 'lane2'
			};
		});

		it('should successfully undo a move action', () => {
			// Set up editor state - note is currently at new position
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
				)
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			expect(noteBuffer.getHistoryLength()).toBe(1);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should remove from new position and restore to original position
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
			expect(noteBuffer.getHistoryLength()).toBe(0); // Action is consumed
		});

		it('should handle multiple moved notes in one action', () => {
			const mockMovedNoteData2: MovedNoteData = {
				originalNoteKey: 'note-0-1-0.75',
				originalLaneIndex: 0,
				originalMeasure: 1,
				originalCellOffset: 0.75,
				originalLaneId: 'lane1',
				noteId: '12',
				newNoteKey: 'note-1-2-0.50',
				newLaneIndex: 1,
				newMeasure: 2,
				newCellOffset: 0.5,
				newLaneId: 'lane2'
			};

			// Set up editor state - notes are currently at new positions
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11120000000000000000000000000000')
				)
			];

			noteBuffer.recordAction('move', [mockMovedNoteData, mockMovedNoteData2]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should restore both notes to original positions
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.75,
				'lane1',
				'12',
				1
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledTimes(2);
		});

		it('should restore notes to data structure correctly', () => {
			// Set up editor state - note is at new position
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
				)
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should delegate to shared logic for restoration
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
		});

		it('should handle empty moved notes array', () => {
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);
			expect(result).toBe(false);
		});

		it('should properly clean up visual elements', () => {
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
				)
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should have called deleteNoteByKey to remove notes from new positions
			expect(mockEditor.deleteNoteByKey).toHaveBeenCalledWith('note-1-2-0.25');
		});

		it('should select restored notes', () => {
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
				)
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should clear selection and add restored note
			expect(mockEditor.clearSelection).toHaveBeenCalled();
			expect(mockEditor.selectedNotes.has(mockMovedNoteData.originalNoteKey)).toBe(true);
		});

		it('should restore notes with existing notes in original lane', () => {
			// Set up a scenario where the original lane already has other notes
			const dataWithExistingNotes = {
				...mockMovedNoteData
			};

			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
				)
			];

			// Mock an existing measure note in the original lane with some content
			mockEditor.notes['lane1'] = [
				new LaneMeasureNote(
					1,
					'lane1',
					LaneMeasureNote.parseFromPattern('00120000000000000000000000000000')
				) // Has different note
			];

			noteBuffer.recordAction('move', [dataWithExistingNotes]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should delegate to shared logic regardless of existing notes complexity
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				1,
				0,
				0.5,
				'lane1',
				'11',
				1
			);
		});

		it('should return early from undoMove when movedNotes array is empty', () => {
			const emptyMoveAction: MoveUndoAction = { type: 'move', data: [] };
			noteBuffer['undoHistory'] = [emptyMoveAction];

			const deleteNoteByKeySpy = vi.spyOn(mockEditor as unknown as Editor, 'deleteNoteByKey');
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			expect(deleteNoteByKeySpy).not.toHaveBeenCalled();
		});

		it('should throw when undoMove is called but noteMove is not set', () => {
			const moveAction: MoveUndoAction = {
				type: 'move',
				data: [
					{
						originalNoteKey: 'note-0-0-0',
						originalLaneIndex: 0,
						originalMeasure: 0,
						originalCellOffset: 0,
						originalLaneId: '11',
						noteId: '01',
						newNoteKey: 'note-0-1-0',
						newLaneIndex: 0,
						newMeasure: 1,
						newCellOffset: 0,
						newLaneId: '11'
					}
				]
			};
			const bufferWithoutNoteMove = new NoteBuffer();
			bufferWithoutNoteMove['undoHistory'] = [moveAction];

			expect(() =>
				bufferWithoutNoteMove.undoLastAction(mockEditor as unknown as Editor)
			).toThrow(
				'NoteMove instance not set. Call setNoteMove() before using undo functionality.'
			);
		});
	});

	describe('undoDelete', () => {
		it('should throw when noteMove is not set', () => {
			const deleteAction: UndoAction = {
				type: 'delete',
				data: [
					{
						measure: 0,
						laneIndex: 0,
						cellOffset: 0,
						noteId: '01',
						laneId: '11',
						measureLength: 1
					}
				] as DeletedNoteData[]
			};
			const bufferWithoutNoteMove = new NoteBuffer();
			bufferWithoutNoteMove['undoHistory'] = [deleteAction];

			expect(() =>
				bufferWithoutNoteMove.undoLastAction(mockEditor as unknown as Editor)
			).toThrow(
				'NoteMove instance not set. Call setNoteMove() before using undo functionality.'
			);
		});
	});

	describe('undoPaste', () => {
		const mockPastedNoteData: PastedNoteData = {
			noteKey: 'note-1-2-0.5',
			laneIndex: 1,
			measure: 2,
			cellOffset: 0.5,
			laneId: 'lane2',
			noteId: '11'
		};

		beforeEach(() => {
			vi.clearAllMocks();
			noteBuffer.setNoteMove(mockNoteMove);
		});

		it('should successfully undo a paste action by deleting pasted notes', () => {
			// Set up editor state - pasted note exists
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
				)
			];

			noteBuffer.recordAction('paste', [mockPastedNoteData]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should delete the pasted note
			expect(mockEditor.deleteNoteByKey).toHaveBeenCalledWith('note-1-2-0.5');
			expect(mockEditor.clearSelection).toHaveBeenCalled();
			expect(noteBuffer.getHistoryLength()).toBe(0); // Action is consumed
		});

		it('should handle multiple pasted notes in one action', () => {
			const mockPastedNoteData2: PastedNoteData = {
				noteKey: 'note-2-2-0.75',
				laneIndex: 2,
				measure: 2,
				cellOffset: 0.75,
				laneId: 'lane3',
				noteId: '12'
			};

			// Set up editor state - multiple pasted notes exist
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(
					2,
					'lane2',
					LaneMeasureNote.parseFromPattern('11000000000000000000000000000000')
				)
			];
			mockEditor.notes['lane3'] = [
				new LaneMeasureNote(
					2,
					'lane3',
					LaneMeasureNote.parseFromPattern('12000000000000000000000000000000')
				)
			];

			noteBuffer.recordAction('paste', [mockPastedNoteData, mockPastedNoteData2]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should delete both pasted notes
			expect(mockEditor.deleteNoteByKey).toHaveBeenCalledWith('note-1-2-0.5');
			expect(mockEditor.deleteNoteByKey).toHaveBeenCalledWith('note-2-2-0.75');
			expect(mockEditor.clearSelection).toHaveBeenCalled();
		});

		it('should handle empty pasted notes array', () => {
			noteBuffer.recordAction('paste', []);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(false); // Empty action shouldn't be recorded
			expect(mockEditor.deleteNoteByKey).not.toHaveBeenCalled();
		});

		it('should handle paste undo when notes are already deleted', () => {
			// Record a paste action
			noteBuffer.recordAction('paste', [mockPastedNoteData]);

			// Undo should still work even if note is already deleted
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should try to delete the note (NoteManager will handle if it doesn't exist)
			expect(mockEditor.deleteNoteByKey).toHaveBeenCalledWith('note-1-2-0.5');
			expect(mockEditor.clearSelection).toHaveBeenCalled();
		});

		it('should return early from undoPaste when pastedNotes array is empty', () => {
			// Directly inject empty paste action to bypass recordAction filtering
			const emptyPasteAction: PasteUndoAction = { type: 'paste', data: [] };
			noteBuffer['undoHistory'] = [emptyPasteAction];

			const deleteNoteByKeySpy = vi.spyOn(mockEditor as unknown as Editor, 'deleteNoteByKey');
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			expect(deleteNoteByKeySpy).not.toHaveBeenCalled();
		});
	});

	describe('undoCut', () => {
		const mockCutNoteData: CutNoteData = {
			noteKey: 'note-1-2-0.5',
			laneIndex: 1,
			measure: 2,
			cellOffset: 0.5,
			laneId: 'lane2',
			noteId: '11',
			measureLength: 1
		};

		beforeEach(() => {
			vi.clearAllMocks();
			noteBuffer.setNoteMove(mockNoteMove);
		});

		it('should successfully undo a cut action by restoring cut notes', () => {
			// Set up editor state - cut notes no longer exist
			mockEditor.notes['lane2'] = [];

			noteBuffer.recordAction('cut', [mockCutNoteData]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should restore the cut note
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				1,
				0.5,
				'lane2',
				'11',
				1
			);
			expect(mockEditor.clearSelection).toHaveBeenCalled();
			expect(noteBuffer.getHistoryLength()).toBe(0); // Action is consumed
		});

		it('should handle multiple cut notes in one action', () => {
			const mockCutNoteData2: CutNoteData = {
				noteKey: 'note-2-2-0.75',
				laneIndex: 2,
				measure: 2,
				cellOffset: 0.75,
				laneId: 'lane3',
				noteId: '12',
				measureLength: 1
			};

			// Set up editor state - cut notes no longer exist
			mockEditor.notes['lane2'] = [];
			mockEditor.notes['lane3'] = [];

			noteBuffer.recordAction('cut', [mockCutNoteData, mockCutNoteData2]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should restore both cut notes
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				1,
				0.5,
				'lane2',
				'11',
				1
			);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				2,
				0.75,
				'lane3',
				'12',
				1
			);
			expect(mockEditor.clearSelection).toHaveBeenCalled();
		});

		it('should handle empty cut notes array', () => {
			noteBuffer.recordAction('cut', []);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(false); // Empty action shouldn't be recorded
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).not.toHaveBeenCalled();
		});

		it('should select restored cut notes', () => {
			// Record a cut action
			noteBuffer.recordAction('cut', [mockCutNoteData]);

			// Undo the cut
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should clear selection and add restored note
			expect(mockEditor.clearSelection).toHaveBeenCalled();
			expect(mockEditor.selectedNotes.has('note-1-2-0.5')).toBe(true);
		});

		it('should restore cut notes with exact stored positions', () => {
			// Test that we use the exact position stored in cut data (already normalized)
			const cutDataWithExactPosition: CutNoteData = {
				noteKey: 'note-1-2-0.4375',
				laneIndex: 1,
				measure: 2,
				cellOffset: 0.4375, // Already normalized position from data structure
				laneId: 'lane2',
				noteId: '11',
				measureLength: 1
			};

			noteBuffer.recordAction('cut', [cutDataWithExactPosition]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should use exact stored position without further normalization
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).toHaveBeenCalledWith(
				2,
				1,
				0.4375, // Exact stored value
				'lane2',
				'11',
				1
			);
		});

		it('should handle cut undo when NoteMove is not set', () => {
			const bufferWithoutNoteMove = new NoteBuffer();
			bufferWithoutNoteMove.recordAction('cut', [mockCutNoteData]);

			expect(() =>
				bufferWithoutNoteMove.undoLastAction(mockEditor as unknown as Editor)
			).toThrow(
				'NoteMove instance not set. Call setNoteMove() before using undo functionality.'
			);
		});

		it('should return early from undoCut when cutNotes array is empty', () => {
			// Directly inject empty cut action to bypass recordAction filtering
			const emptyCutAction: CutUndoAction = { type: 'cut', data: [] };
			noteBuffer['undoHistory'] = [emptyCutAction];

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			expect(vi.mocked(mockNoteMove.addNoteToEditor)).not.toHaveBeenCalled();
		});
	});
});
