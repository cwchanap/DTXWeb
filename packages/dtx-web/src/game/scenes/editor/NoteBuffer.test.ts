import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	NoteBuffer,
	type UndoAction,
	type DeletedNoteData,
	type MovedNoteData
} from './NoteBuffer';
import { LaneMeasureNote, normalizePosition } from '@dtx/common';
import type { Editor } from '../Editor';

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
	getPanelContainer: () => {
		getByName: (name: string) => { destroy: () => void } | null;
	};
}

describe('NoteBuffer', () => {
	let noteBuffer: NoteBuffer;
	let mockEditor: MockEditor;
	let mockDeletedNoteData: DeletedNoteData;

	beforeEach(() => {
		noteBuffer = new NoteBuffer();

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
			originalPattern: '1100000000000000000000000000000000',
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
			expect(history[0].data[0].noteKey).toBe('test-note-1');
			expect(history[1].data[0].noteKey).toBe('test-note-2');
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
			expect(history[0].data[0].noteKey).toBe('note-2'); // First action was removed
			expect(history[1].data[0].noteKey).toBe('note-3');
		});

		it('should create a copy of the data array', () => {
			const originalData = [mockDeletedNoteData];
			noteBuffer.recordAction('delete', originalData);

			// Modify original array
			originalData.push({ ...mockDeletedNoteData, noteKey: 'modified' });

			// History should not be affected
			const history = noteBuffer.getHistory();
			expect(history[0].data).toHaveLength(1);
			expect(history[0].data[0].noteKey).toBe('test-note-1');
		});
	});

	describe('undoLastAction', () => {
		it('should return false when no actions to undo', () => {
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
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.5, '11');
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
			expect(mockEditor.drawNote).toHaveBeenCalledTimes(2);
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.5, '11');
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.75, '12');
		});

		it('should handle add/move actions (not implemented)', () => {
			noteBuffer.recordAction('add', [mockDeletedNoteData]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(false);
			expect(noteBuffer.getHistoryLength()).toBe(0); // Action is still removed
		});

		it('should restore action to history if undo fails', () => {
			// Mock drawNote to throw an error
			mockEditor.drawNote = vi.fn().mockImplementation(() => {
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
		it('should create new LaneMeasureNote when lane does not exist', () => {
			mockEditor.notes = {}; // Empty notes
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(mockEditor.notes['lane1']).toBeDefined();
			expect(mockEditor.notes['lane1']).toHaveLength(1);
			expect(mockEditor.notes['lane1'][0].measure).toBe(1);
		});

		it('should update existing LaneMeasureNote when measure exists', () => {
			// Setup existing measure note
			const existingNote = new LaneMeasureNote(
				1,
				'lane1',
				'0000000000000000000000000000000000'
			);
			mockEditor.notes['lane1'] = [existingNote];

			noteBuffer.recordAction('delete', [mockDeletedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should update existing note, not create new one
			expect(mockEditor.notes['lane1']).toHaveLength(1);
			expect(mockEditor.notes['lane1'][0]).toBe(existingNote);
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
			expect(mockEditor.drawNote).not.toHaveBeenCalled();
		});

		it('should handle notes with different measures in same lane', () => {
			const data = [
				mockDeletedNoteData, // measure 1
				{ ...mockDeletedNoteData, noteKey: 'note-2', measure: 2 } // measure 2
			];

			mockEditor.notes['lane1'] = [];
			noteBuffer.recordAction('delete', data);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(mockEditor.notes['lane1']).toHaveLength(2); // Two LaneMeasureNotes created
		});

		it('should handle notes from different lanes', () => {
			const data = [
				mockDeletedNoteData, // lane1
				{ ...mockDeletedNoteData, noteKey: 'note-2', laneId: 'lane2' } // lane2
			];

			mockEditor.notes = {};
			noteBuffer.recordAction('delete', data);

			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(mockEditor.notes['lane1']).toBeDefined();
			expect(mockEditor.notes['lane2']).toBeDefined();
			expect(mockEditor.notes['lane1']).toHaveLength(1);
			expect(mockEditor.notes['lane2']).toHaveLength(1);
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
				newLaneId: 'lane2',
				originalPattern: '00110000000000000000000000000000'
			};
		});

		it('should successfully undo a move action', () => {
			// Set up editor state - note is currently at new position
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(2, 'lane2', '11000000000000000000000000000000')
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			expect(noteBuffer.getHistoryLength()).toBe(1);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should remove from new position and restore to original position
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.5, '11');
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
				new LaneMeasureNote(2, 'lane2', '11120000000000000000000000000000')
			];

			noteBuffer.recordAction('move', [mockMovedNoteData, mockMovedNoteData2]);

			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			expect(result).toBe(true);
			// Should restore both notes to original positions
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.5, '11');
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.75, '12');
			expect(mockEditor.drawNote).toHaveBeenCalledTimes(2);
		});

		it('should restore notes to data structure correctly', () => {
			// Set up editor state - note is at new position
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(2, 'lane2', '11000000000000000000000000000000')
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should have restored to original lane
			expect(mockEditor.notes['lane1']).toBeDefined();
			expect(mockEditor.notes['lane1']).toHaveLength(1);
			expect(mockEditor.notes['lane1'][0].measure).toBe(1);
			expect(mockEditor.notes['lane1'][0].pattern).toContain('11');
		});

		it('should handle empty moved notes array', () => {
			const result = noteBuffer.undoLastAction(mockEditor as unknown as Editor);
			expect(result).toBe(false);
		});

		it('should properly clean up visual elements', () => {
			// Set up mock panel container with destroy method
			const mockDestroy = vi.fn();
			mockEditor.getPanelContainer = vi.fn().mockReturnValue({
				getByName: vi.fn().mockReturnValue({ destroy: mockDestroy })
			});

			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(2, 'lane2', '11000000000000000000000000000000')
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should have called destroy on visual elements
			expect(mockDestroy).toHaveBeenCalled();
		});

		it('should select restored notes', () => {
			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(2, 'lane2', '11000000000000000000000000000000')
			];

			noteBuffer.recordAction('move', [mockMovedNoteData]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should clear selection and add restored note
			expect(mockEditor.clearSelection).toHaveBeenCalled();
			expect(mockEditor.selectedNotes.has(mockMovedNoteData.originalNoteKey)).toBe(true);
		});

		it('should restore notes with original pattern when available', () => {
			// Set up a scenario where original pattern data is used
			const dataWithOriginalPattern = {
				...mockMovedNoteData,
				originalPattern: '00110000000000000000000000000000'
			};

			mockEditor.notes['lane2'] = [
				new LaneMeasureNote(2, 'lane2', '11000000000000000000000000000000')
			];

			// Mock an existing measure note in the original lane with some content
			mockEditor.notes['lane1'] = [
				new LaneMeasureNote(1, 'lane1', '00120000000000000000000000000000') // Has different note
			];

			noteBuffer.recordAction('move', [dataWithOriginalPattern]);
			noteBuffer.undoLastAction(mockEditor as unknown as Editor);

			// Should have used original pattern data for restoration
			expect(mockEditor.notes['lane1']).toBeDefined();
			expect(mockEditor.notes['lane1'][0].pattern).toContain('11'); // Original note restored
		});
	});
});
