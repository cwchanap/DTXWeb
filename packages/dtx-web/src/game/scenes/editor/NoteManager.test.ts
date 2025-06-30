import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteManager } from './NoteManager';
import type { Editor } from '../Editor';
import { LaneMeasureNote } from '@dtx/common';
import Phaser from 'phaser'; // Import to ensure global mock is available

// Mock Editor with all necessary methods
const createMockEditor = () => {
	const mockNotes: Record<string, LaneMeasureNote[]> = {};
	const mockGameObjects: Array<{ destroy: ReturnType<typeof vi.fn>; name: string }> = [];

	return {
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
			getByName: vi.fn((name: string) => {
				return mockGameObjects.find((obj) => obj.name === name);
			}),
			getAll: vi.fn((property: string, value: string) => {
				if (property === 'name') {
					return mockGameObjects.filter((obj) => obj.name === value);
				}
				return [];
			}),
			list: [],
			y: 0
		}),
		getLaneConfigs: vi.fn().mockReturnValue([
			{ id: 'lane1', noteColor: 0xff0000 },
			{ id: 'lane2', noteColor: 0x00ff00 }
		]),
		getNotes: vi.fn().mockReturnValue(mockNotes),
		getCellsPerMeasure: 48,
		getOffsetX: vi.fn().mockReturnValue(100),
		getOffsetY: vi.fn().mockReturnValue(200),
		getCellWidth: vi.fn().mockReturnValue(50),
		getCellMargin: vi.fn().mockReturnValue(2),
		getTotalMesaureOffest: vi.fn().mockReturnValue(0),
		getCellHeightAt: vi.fn().mockReturnValue(20),
		getNoteSize: vi.fn().mockReturnValue(18),
		// Helper methods for testing
		_addMockGameObject: (name: string) => {
			const mockGameObject = { destroy: vi.fn(), name };
			mockGameObjects.push(mockGameObject);
			return mockGameObject;
		},
		_addMockNote: (
			laneId: string,
			measure: number,
			cellOffset: number,
			noteId: string = '01'
		) => {
			if (!mockNotes[laneId]) {
				mockNotes[laneId] = [];
			}

			// Create a pattern with the note at the correct position
			const patternLength = 48;
			const notePosition = Math.round(cellOffset * patternLength);
			let pattern = '00'.repeat(patternLength);
			const startIndex = notePosition * 2;
			pattern = pattern.substring(0, startIndex) + noteId + pattern.substring(startIndex + 2);

			// Use the real LaneMeasureNote class to ensure accurate behavior
			const laneMeasureNote = new LaneMeasureNote(measure, laneId, pattern);
			// The constructor already calls parseNote, so our note should be properly created
			mockNotes[laneId].push(laneMeasureNote);
			return laneMeasureNote;
		},
		_getMockGameObjects: () => mockGameObjects,
		_getMockNotes: () => mockNotes
	};
};

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

		it('should remove note from visual game objects and destroy them', () => {
			const noteKey = 'note-0-1-0.5';

			// Add a mock game object
			const mockGameObject = mockEditor._addMockGameObject(noteKey);
			noteManager.selectedNotes.add(noteKey);

			// Add corresponding note data
			mockEditor._addMockNote('lane1', 1, 0.5);

			noteManager.deleteSelectedNotes();

			// Verify the game object's destroy method was called
			expect(mockGameObject.destroy).toHaveBeenCalledTimes(1);
		});

		it('should create note correctly for testing', () => {
			const noteKey = 'note-0-1-0.5';
			const laneId = 'lane1';
			const measure = 1;
			const cellOffset = 0.5;

			// Add note to mock data structure
			const laneMeasureNote = mockEditor._addMockNote(laneId, measure, cellOffset);

			// Verify note was added correctly
			expect(mockEditor._getMockNotes()[laneId]).toHaveLength(1);
			expect(laneMeasureNote.notes).toHaveLength(1);
			expect(laneMeasureNote.notes[0].position).toBe(cellOffset);
		});

		it('should remove note from data structure when deleting a single note', () => {
			const noteKey = 'note-0-1-0.5';
			const laneId = 'lane1';
			const measure = 1;
			const cellOffset = 0.5;

			// Add note to mock data structure
			const laneMeasureNote = mockEditor._addMockNote(laneId, measure, cellOffset);

			// Verify note was added
			expect(mockEditor._getMockNotes()[laneId]).toHaveLength(1);
			expect(laneMeasureNote.notes).toHaveLength(1);
			expect(laneMeasureNote.notes[0].position).toBe(cellOffset);

			// Select and delete the note
			noteManager.selectedNotes.add(noteKey);
			noteManager.deleteSelectedNotes();

			// Verify the note was removed from the pattern
			expect(laneMeasureNote.pattern.includes('01')).toBe(false);
			expect(laneMeasureNote.notes).toHaveLength(0);
		});

		it('should remove entire LaneMeasureNote when last note in measure is deleted', () => {
			const noteKey = 'note-0-1-0.5';
			const laneId = 'lane1';
			const measure = 1;
			const cellOffset = 0.5;

			// Add note to mock data structure
			mockEditor._addMockNote(laneId, measure, cellOffset);

			// Verify note was added
			expect(mockEditor._getMockNotes()[laneId]).toHaveLength(1);

			// Select and delete the note
			noteManager.selectedNotes.add(noteKey);
			noteManager.deleteSelectedNotes();

			// Verify the entire lane was cleaned up since it's now empty
			expect(mockEditor._getMockNotes()[laneId]).toBeUndefined();
		});

		it('should clean up empty lane entries after deletion', () => {
			const noteKey = 'note-0-1-0.5';
			const laneId = 'lane1';
			const measure = 1;
			const cellOffset = 0.5;

			// Add note to mock data structure
			mockEditor._addMockNote(laneId, measure, cellOffset);

			// Verify lane exists
			expect(mockEditor._getMockNotes()[laneId]).toBeDefined();

			// Select and delete the note
			noteManager.selectedNotes.add(noteKey);
			noteManager.deleteSelectedNotes();

			// Verify the entire lane entry was removed since it's now empty
			expect(mockEditor._getMockNotes()[laneId]).toBeUndefined();
		});

		it('should handle multiple note deletions correctly', () => {
			const noteKey1 = 'note-0-1-0.5';
			const noteKey2 = 'note-1-2-0.25';

			// Add multiple mock game objects
			const mockGameObject1 = mockEditor._addMockGameObject(noteKey1);
			const mockGameObject2 = mockEditor._addMockGameObject(noteKey2);

			// Add corresponding note data
			const laneMeasureNote1 = mockEditor._addMockNote('lane1', 1, 0.5);
			const laneMeasureNote2 = mockEditor._addMockNote('lane2', 2, 0.25);

			// Select both notes
			noteManager.selectedNotes.add(noteKey1);
			noteManager.selectedNotes.add(noteKey2);

			noteManager.deleteSelectedNotes();

			// Verify both game objects were destroyed
			expect(mockGameObject1.destroy).toHaveBeenCalledTimes(1);
			expect(mockGameObject2.destroy).toHaveBeenCalledTimes(1);

			// Verify both notes were removed from data
			expect(laneMeasureNote1.notes).toHaveLength(0);
			expect(laneMeasureNote2.notes).toHaveLength(0);

			// Verify selection was cleared
			expect(noteManager.selectedNotes.size).toBe(0);
		});

		it('should record delete actions for undo functionality', () => {
			const noteKey = 'note-0-1-0.5';
			const laneId = 'lane1';
			const measure = 1;
			const cellOffset = 0.5;

			// Spy on the noteBuffer.recordAction method
			const noteBufferSpy = vi.spyOn(
				(
					noteManager as unknown as {
						noteBuffer: { recordAction: (type: string, data: unknown[]) => void };
					}
				).noteBuffer,
				'recordAction'
			);

			// Add note to mock data structure
			mockEditor._addMockNote(laneId, measure, cellOffset);

			// Select and delete the note
			noteManager.selectedNotes.add(noteKey);
			noteManager.deleteSelectedNotes();

			// Verify noteBuffer.recordAction was called with correct data
			expect(noteBufferSpy).toHaveBeenCalledTimes(1);
			expect(noteBufferSpy).toHaveBeenCalledWith(
				'delete',
				expect.arrayContaining([
					expect.objectContaining({
						noteKey,
						laneIndex: 0,
						measure,
						cellOffset,
						laneId
					})
				])
			);

			noteBufferSpy.mockRestore();
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
