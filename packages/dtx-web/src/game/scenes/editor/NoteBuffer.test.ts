import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoteBuffer, type UndoAction, type DeletedNoteData } from './NoteBuffer';
import { LaneMeasureNote } from '@dtx/common';
import type { Editor } from '../Editor';

// Mock note graphics interface
interface MockNoteGraphics {
	name: string;
}

// Mock Editor interface for testing that matches what NoteBuffer expects
interface MockEditor {
	notes: Record<string, LaneMeasureNote[]>;
	selectedNotes: Set<string>;
	getCellsPerMeasure: number;
	drawNote: (measure: number, laneIndex: number, cellOffset: number, noteId: string) => boolean;
	clearSelection: () => void;
	getByName: (name: string) => MockNoteGraphics | null;
	highlightSelectedNote: (noteGraphics: MockNoteGraphics) => void;
}

describe('NoteBuffer', () => {
	let noteBuffer: NoteBuffer;
	let mockEditor: MockEditor;
	let mockDeletedNoteData: DeletedNoteData;

	beforeEach(() => {
		noteBuffer = new NoteBuffer();

		// Create mock editor
		mockEditor = {
			notes: {},
			selectedNotes: new Set<string>(),
			getCellsPerMeasure: 16,
			drawNote: vi.fn().mockReturnValue(true),
			clearSelection: vi.fn(),
			getByName: vi.fn().mockReturnValue({ name: 'mockNote' }),
			highlightSelectedNote: vi.fn()
		};

		// Create mock deleted note data
		mockDeletedNoteData = {
			noteKey: 'test-note-1',
			laneIndex: 0,
			measure: 1,
			cellOffset: 0.5,
			laneId: 'lane1',
			noteId: '11',
			laneMeasureNote: new LaneMeasureNote(1, 'lane1', '1100000000000000000000000000000000')
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
			const result = noteBuffer.undoLastAction(mockEditor as Editor);
			expect(result).toBe(false);
		});

		it('should successfully undo a delete action', () => {
			// Setup: Add a note to editor and record its deletion
			mockEditor.notes['lane1'] = [];
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			const result = noteBuffer.undoLastAction(mockEditor as Editor);

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

			const result = noteBuffer.undoLastAction(mockEditor as Editor);

			expect(result).toBe(true);
			expect(mockEditor.drawNote).toHaveBeenCalledTimes(2);
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.5, '11');
			expect(mockEditor.drawNote).toHaveBeenCalledWith(1, 0, 0.75, '12');
		});

		it('should handle add/move actions (not implemented)', () => {
			noteBuffer.recordAction('add', [mockDeletedNoteData]);

			const result = noteBuffer.undoLastAction(mockEditor as Editor);

			expect(result).toBe(false);
			expect(noteBuffer.getHistoryLength()).toBe(0); // Action is still removed
		});

		it('should restore action to history if undo fails', () => {
			// Mock drawNote to throw an error
			mockEditor.drawNote = vi.fn().mockImplementation(() => {
				throw new Error('Draw failed');
			});

			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			expect(() => noteBuffer.undoLastAction(mockEditor as Editor)).toThrow('Draw failed');
			expect(noteBuffer.getHistoryLength()).toBe(1); // Action restored to history
		});
	});

	describe('note restoration logic', () => {
		it('should create new LaneMeasureNote when lane does not exist', () => {
			mockEditor.notes = {}; // Empty notes
			noteBuffer.recordAction('delete', [mockDeletedNoteData]);

			noteBuffer.undoLastAction(mockEditor as Editor);

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
			noteBuffer.undoLastAction(mockEditor as Editor);

			// Should update existing note, not create new one
			expect(mockEditor.notes['lane1']).toHaveLength(1);
			expect(mockEditor.notes['lane1'][0]).toBe(existingNote);
		});

		it('should select restored notes', () => {
			const data = [mockDeletedNoteData, { ...mockDeletedNoteData, noteKey: 'test-note-2' }];

			mockEditor.notes['lane1'] = [];
			noteBuffer.recordAction('delete', data);

			noteBuffer.undoLastAction(mockEditor as Editor);

			expect(mockEditor.clearSelection).toHaveBeenCalled();
			expect(mockEditor.selectedNotes.has('test-note-1')).toBe(true);
			expect(mockEditor.selectedNotes.has('test-note-2')).toBe(true);
			expect(mockEditor.highlightSelectedNote).toHaveBeenCalledTimes(2);
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

			noteBuffer.undoLastAction(mockEditor as any);
			expect(noteBuffer.canUndo()).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('should handle empty deleted notes array in undo', () => {
			// This shouldn't happen due to recordAction filtering, but test defensive coding
			const emptyAction: UndoAction = { type: 'delete', data: [] };
			noteBuffer['undoHistory'] = [emptyAction]; // Direct manipulation for edge case test

			const result = noteBuffer.undoLastAction(mockEditor as Editor);

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

			noteBuffer.undoLastAction(mockEditor as Editor);

			expect(mockEditor.notes['lane1']).toHaveLength(2); // Two LaneMeasureNotes created
		});

		it('should handle notes from different lanes', () => {
			const data = [
				mockDeletedNoteData, // lane1
				{ ...mockDeletedNoteData, noteKey: 'note-2', laneId: 'lane2' } // lane2
			];

			mockEditor.notes = {};
			noteBuffer.recordAction('delete', data);

			noteBuffer.undoLastAction(mockEditor as Editor);

			expect(mockEditor.notes['lane1']).toBeDefined();
			expect(mockEditor.notes['lane2']).toBeDefined();
			expect(mockEditor.notes['lane1']).toHaveLength(1);
			expect(mockEditor.notes['lane2']).toHaveLength(1);
		});
	});
});
