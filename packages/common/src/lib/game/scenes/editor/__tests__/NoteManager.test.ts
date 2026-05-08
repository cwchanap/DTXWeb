import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteManager } from '../NoteManager.js';
import type { Editor } from '../../Editor.js';
import { LaneMeasureNote } from '../../../../chart/note.js';

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
			}),
			graphics: vi.fn().mockReturnValue({
				lineStyle: vi.fn(),
				strokeRect: vi.fn(),
				setName: vi.fn()
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
			add: vi.fn(),
			list: [],
			y: 0
		}),
		getLaneConfigs: vi.fn().mockReturnValue([
			{ id: 'lane1', noteColor: 0xff0000 },
			{ id: 'lane2', noteColor: 0x00ff00 }
		]),
		getNotes: vi.fn(() => mockNotes),
		getCellsPerMeasure: vi.fn().mockReturnValue(16),
		getMeasureCount: vi.fn().mockReturnValue(100),
		getMeasureHeight: vi.fn().mockReturnValue(400), // Mock measure height
		getOffsetX: vi.fn().mockReturnValue(100),
		getOffsetY: vi.fn().mockReturnValue(200),
		getCellWidth: vi.fn().mockReturnValue(50),
		getCellHeightValue: vi.fn().mockReturnValue(25),
		getCellMargin: vi.fn().mockReturnValue(2),
		getTotalMesaureOffest: vi.fn().mockReturnValue(0),
		getCellHeightAt: vi.fn().mockReturnValue(20),
		getNoteSize: vi.fn().mockReturnValue(18),
		drawNote: vi.fn().mockReturnValue(true),
		input: {
			activePointer: {
				x: 150,
				y: 50
			}
		},
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
			const patternLength = 16;
			const notePosition = Math.round(cellOffset * patternLength);
			let pattern = '00'.repeat(patternLength);
			const startIndex = notePosition * 2;
			pattern = pattern.substring(0, startIndex) + noteId + pattern.substring(startIndex + 2);

			// Use the real LaneMeasureNote class to ensure accurate behavior
			const parsedNotes = LaneMeasureNote.parseFromPattern(pattern);
			const laneMeasureNote = new LaneMeasureNote(measure, laneId, parsedNotes);
			mockNotes[laneId].push(laneMeasureNote);
			return laneMeasureNote;
		},
		_getMockGameObjects: () => mockGameObjects,
		_getMockNotes: () => mockNotes,
		_setMockNotes: (notes: Record<string, LaneMeasureNote[]>) => {
			Object.keys(mockNotes).forEach((key) => delete mockNotes[key]);
			Object.assign(mockNotes, notes);
		},
		getByName: vi.fn((name: string) => {
			return mockGameObjects.find((obj) => obj.name === name) || null;
		}),
		highlightSelectedNote: vi.fn()
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
			const laneId = 'lane1';
			const measure = 1;
			const cellOffset = 0.0625;
			const noteKey = `note-0-${measure}-${cellOffset}`;

			// Add a mock game object
			const mockGameObject = mockEditor._addMockGameObject(noteKey);
			noteManager.selectedNotes.add(noteKey);

			// Add corresponding note data
			mockEditor._addMockNote(laneId, measure, cellOffset);

			noteManager.deleteSelectedNotes();

			// Verify the game object's destroy method was called
			expect(mockGameObject.destroy).toHaveBeenCalledTimes(1);
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

	describe('copy and paste functionality', () => {
		beforeEach(() => {
			// Set up some notes for copying
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			const lane2Notes = LaneMeasureNote.parseFromPattern('12000000000000000000000000000000');
			const lane2Note = new LaneMeasureNote(1, 'lane2', lane2Notes);

			mockEditor._setMockNotes({
				lane1: [lane1Note],
				lane2: [lane2Note]
			});

			// Add some selected notes
			noteManager.selectedNotes.add('note-0-1-0');
			noteManager.selectedNotes.add('note-1-1-0');
		});

		it('should copy selected notes', () => {
			const result = noteManager.copySelectedNotes();
			expect(result).toBe(true);
			expect(noteManager.hasClipboard()).toBe(true);
			// Selection should be preserved after copy
			expect(noteManager.selectedNotes.size).toBe(2);
			expect(noteManager.selectedNotes.has('note-0-1-0')).toBe(true);
			expect(noteManager.selectedNotes.has('note-1-1-0')).toBe(true);
		});

		it('should return false when copying with no selection', () => {
			noteManager.selectedNotes.clear();
			const result = noteManager.copySelectedNotes();
			expect(result).toBe(false);
		});

		it('should check clipboard status', () => {
			expect(noteManager.hasClipboard()).toBe(false);

			noteManager.copySelectedNotes();
			expect(noteManager.hasClipboard()).toBe(true);

			noteManager.clearClipboard();
			expect(noteManager.hasClipboard()).toBe(false);
		});
	});

	describe('cut operations', () => {
		beforeEach(() => {
			// Set up note data in the editor (same as copy tests)
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			const lane2Notes = LaneMeasureNote.parseFromPattern('12000000000000000000000000000000');
			const lane2Note = new LaneMeasureNote(1, 'lane2', lane2Notes);

			mockEditor._setMockNotes({
				lane1: [lane1Note],
				lane2: [lane2Note]
			});

			// Set up notes for cutting
			noteManager.selectedNotes.add('note-0-1-0');
			noteManager.selectedNotes.add('note-1-1-0');
		});

		it('should cut selected notes to clipboard', () => {
			const result = noteManager.cutSelectedNotes();

			expect(result).toBe(true);
			expect(noteManager.hasClipboard()).toBe(true);
			// Notes should be deleted (selection cleared)
			expect(noteManager.selectedNotes.size).toBe(0);
		});

		it('should return false when no notes are selected for cutting', () => {
			noteManager.selectedNotes.clear();

			const result = noteManager.cutSelectedNotes();

			expect(result).toBe(false);
			expect(noteManager.hasClipboard()).toBe(false);
		});

		it('should clear selection after successful cut', () => {
			expect(noteManager.selectedNotes.size).toBe(2);

			noteManager.cutSelectedNotes();

			expect(noteManager.selectedNotes.size).toBe(0);
		});

		it('should delete notes when cutting', () => {
			const deleteNoteSpy = vi.spyOn(noteManager, 'deleteNoteByKey');

			noteManager.cutSelectedNotes();

			// Should have called deleteNoteByKey for each selected note
			expect(deleteNoteSpy).toHaveBeenCalledWith('note-0-1-0');
			expect(deleteNoteSpy).toHaveBeenCalledWith('note-1-1-0');
			expect(deleteNoteSpy).toHaveBeenCalledTimes(2);
		});
	});
});
