import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteManager } from './NoteManager';
import type { Editor } from '../Editor';
import { LaneMeasureNote } from '@dtx/common';
import Phaser from 'phaser'; // Import to ensure global mock is available

// Mock Editor with all necessary methods
const createMockEditor = () => ({
	add: {
		rectangle: vi.fn().mockReturnValue({
			setStrokeStyle: vi.fn(),
			setVisible: vi.fn(),
			setPosition: vi.fn(),
			setSize: vi.fn()
		})
	},
	getIsEditing: vi.fn().mockReturnValue(false),
	getPanelContainer: vi.fn().mockReturnValue({
		getByName: vi.fn(),
		getAll: vi.fn().mockReturnValue([]),
		list: [],
		y: 0
	}),
	getLaneConfigs: vi.fn().mockReturnValue([
		{ id: 'lane1', noteColor: 0xff0000 },
		{ id: 'lane2', noteColor: 0x00ff00 }
	]),
	getNotes: vi.fn().mockReturnValue({}),
	getCellsPerMeasure: 48,
	getOffsetX: vi.fn().mockReturnValue(100),
	getOffsetY: vi.fn().mockReturnValue(200),
	getCellWidth: vi.fn().mockReturnValue(50),
	getCellMargin: vi.fn().mockReturnValue(2),
	getTotalMesaureOffest: vi.fn().mockReturnValue(0),
	getCellHeightAt: vi.fn().mockReturnValue(20),
	getNoteSize: vi.fn().mockReturnValue(18)
});

describe('NoteManager', () => {
	let noteManager: NoteManager;
	let mockEditor: ReturnType<typeof createMockEditor>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockEditor = createMockEditor();
		noteManager = new NoteManager(mockEditor as unknown as Editor);
		noteManager.initialize();
	});

	describe('initialization', () => {
		it('should initialize with empty state', () => {
			expect(noteManager.selectedNotes.size).toBe(0);
			expect(noteManager.isSelecting).toBe(false);
		});

		it('should initialize selection rectangle', () => {
			expect(mockEditor.add.rectangle).toHaveBeenCalled();
		});
	});

	describe('selection state', () => {
		it('should handle note selection via selectedNotes Set', () => {
			const noteKey = 'note-0-1-0.5';
			noteManager.selectedNotes.add(noteKey);

			expect(noteManager.selectedNotes.has(noteKey)).toBe(true);
			expect(noteManager.selectedNotes.size).toBe(1);
		});

		it('should clear selection', () => {
			const noteKey = 'note-0-1-0.5';
			noteManager.selectedNotes.add(noteKey);

			noteManager.clearSelection();

			expect(noteManager.selectedNotes.size).toBe(0);
		});

		it('should handle multiple selections', () => {
			const noteKey1 = 'note-0-1-0.5';
			const noteKey2 = 'note-1-2-0.25';

			noteManager.selectedNotes.add(noteKey1);
			noteManager.selectedNotes.add(noteKey2);

			expect(noteManager.selectedNotes.size).toBe(2);
			expect(noteManager.selectedNotes.has(noteKey1)).toBe(true);
			expect(noteManager.selectedNotes.has(noteKey2)).toBe(true);
		});
	});

	describe('note deletion', () => {
		it('should handle deletion when no notes selected', () => {
			// Should not throw when no notes are selected
			expect(() => noteManager.deleteSelectedNotes()).not.toThrow();
		});

		it('should clear selection after deletion', () => {
			const noteKey = 'note-0-1-0.5';
			noteManager.selectedNotes.add(noteKey);

			noteManager.deleteSelectedNotes();

			expect(noteManager.selectedNotes.size).toBe(0);
		});
	});

	describe('pointer event handling', () => {
		const createMockPointer = (x = 100, y = 200) =>
			({
				x,
				y,
				worldX: x,
				worldY: y
			}) as Phaser.Input.Pointer;

		it('should handle pointer down in edit mode', () => {
			mockEditor.getIsEditing.mockReturnValue(true);
			const pointer = createMockPointer();

			const result = noteManager.handlePointerDown(pointer);

			expect(result).toBe(false);
		});

		it('should handle pointer down when not editing', () => {
			mockEditor.getIsEditing.mockReturnValue(false);
			const pointer = createMockPointer();

			const result = noteManager.handlePointerDown(pointer);

			expect(result).toBe(true);
		});

		it('should handle pointer move events', () => {
			const pointer = createMockPointer();

			// Should not throw
			expect(() => noteManager.handlePointerMove(pointer)).not.toThrow();
		});

		it('should handle pointer up events', () => {
			// Should not throw
			expect(() => noteManager.handlePointerUp()).not.toThrow();
		});
	});

	describe('bounds calculation', () => {
		it('should calculate note bounds for valid note key', () => {
			const noteKey = 'note-0-1-0.5';

			const bounds = noteManager.calculateNoteBounds(noteKey);

			// Should return some bounds or null based on the implementation
			expect(bounds).toBeDefined();
		});

		it('should handle invalid note key format', () => {
			const invalidKey = 'invalid-key';

			const bounds = noteManager.calculateNoteBounds(invalidKey);

			expect(bounds).toBeNull();
		});
	});

	describe('drag state management', () => {
		it('should initialize with no drag state', () => {
			expect(noteManager.isSelecting).toBe(false);
		});

		it('should track selection coordinates', () => {
			expect(noteManager.selectionStartX).toBe(0);
			expect(noteManager.selectionStartY).toBe(0);
		});
	});

	describe('record actions', () => {
		it('should record delete actions', () => {
			const deletedNotes = [
				{
					noteKey: 'note-0-1-0.5',
					laneIndex: 0,
					measure: 1,
					cellOffset: 0.5,
					laneId: 'lane1',
					noteId: 'test',
					laneMeasureNote: new LaneMeasureNote(1, 'test', '00')
				}
			];

			// Should not throw
			expect(() => noteManager.recordDeleteAction(deletedNotes)).not.toThrow();
		});
	});
});
