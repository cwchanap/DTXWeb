import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteMove } from './NoteMove';
import type { Editor } from '../Editor';
// import type { MovedNoteData } from './NoteBuffer';
import { LaneMeasureNote } from '../../../chart/note';
import Phaser from 'phaser'; // Import to ensure global mock is available

// Mock Editor with all necessary methods
const createMockEditor = () => {
	const mockNotes: Record<string, LaneMeasureNote[]> = {};
	const mockGameObjects: Array<{ destroy: ReturnType<typeof vi.fn>; name: string }> = [];

	return {
		add: {
			graphics: vi.fn().mockReturnValue({
				setAlpha: vi.fn(),
				clear: vi.fn(),
				fillStyle: vi.fn(),
				fillRect: vi.fn(),
				strokeRect: vi.fn(),
				destroy: vi.fn()
			})
		},
		getPanelContainer: vi.fn().mockReturnValue({
			getByName: vi.fn((name: string) => {
				return mockGameObjects.find((obj) => obj.name === name);
			}),
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
		}
	};
};

describe('NoteMove', () => {
	let noteMove: NoteMove;
	let mockEditor: ReturnType<typeof createMockEditor>;
	let mockRecordMoveAction: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockEditor = createMockEditor();
		mockRecordMoveAction = vi.fn();
		noteMove = new NoteMove(mockEditor as unknown as Editor, mockRecordMoveAction);
	});

	describe('initialization', () => {
		it('should initialize with no drag state', () => {
			expect(noteMove.isCurrentlyDragging).toBe(false);
		});
	});

	describe('drag operations', () => {
		const createMockPointer = (x = 100, y = 200) =>
			({
				x,
				y,
				worldX: x,
				worldY: y
			}) as Phaser.Input.Pointer;

		it('should start drag operation', () => {
			const pointer = createMockPointer();
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);

			expect(noteMove.isCurrentlyDragging).toBe(true);
		});

		it('should update drag when dragging', () => {
			const pointer = createMockPointer();
			const selectedNotes = new Set(['note-0-1-0']);

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);

			// Should not throw when updating drag
			expect(() => noteMove.updateDrag()).not.toThrow();
		});

		it('should not update drag when not dragging', () => {
			// Should not throw when not dragging
			expect(() => noteMove.updateDrag()).not.toThrow();
		});

		it('should complete drag operation', () => {
			const pointer = createMockPointer();
			const selectedNotes = new Set(['note-0-1-0']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up some notes for moving
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			mockEditor._setMockNotes({
				lane1: [lane1Note]
			});

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			expect(noteMove.isCurrentlyDragging).toBe(false);
		});

		it('should cleanup drag state', () => {
			const pointer = createMockPointer();
			const selectedNotes = new Set(['note-0-1-0']);

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.cleanupDrag();

			expect(noteMove.isCurrentlyDragging).toBe(false);
		});
	});

	describe('note movement', () => {
		const createMockPointer = (x = 100, y = 200) =>
			({
				x,
				y,
				worldX: x,
				worldY: y
			}) as Phaser.Input.Pointer;

		it('should move notes to new positions', () => {
			const pointer = createMockPointer(200, 100); // Different position
			const selectedNotes = new Set(['note-0-1-0']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up some notes for moving
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			mockEditor._setMockNotes({
				lane1: [lane1Note]
			});

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Should have called deleteNoteByKey for old position
			expect(deleteNoteByKey).toHaveBeenCalledWith('note-0-1-0');
			// Should have called drawNote for new position
			expect(mockEditor.drawNote).toHaveBeenCalled();
		});

		it('should handle multiple notes movement', () => {
			const pointer = createMockPointer(200, 100);
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up some notes for moving
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			const lane2Notes = LaneMeasureNote.parseFromPattern('12000000000000000000000000000000');
			const lane2Note = new LaneMeasureNote(1, 'lane2', lane2Notes);
			mockEditor._setMockNotes({
				lane1: [lane1Note],
				lane2: [lane2Note]
			});

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Should have called deleteNoteByKey for the origin note
			expect(deleteNoteByKey).toHaveBeenCalledWith('note-0-1-0');
		});

		it('should record move actions for undo', () => {
			const pointer = createMockPointer(200, 100);
			const selectedNotes = new Set(['note-0-1-0']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up some notes for moving
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			mockEditor._setMockNotes({
				lane1: [lane1Note]
			});

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Should have recorded move action for undo
			expect(mockRecordMoveAction).toHaveBeenCalled();
		});

		it('should handle boundary crossing for measure overflow', () => {
			const pointer = createMockPointer(150, 50); // Position that would cause measure boundary crossing
			const selectedNotes = new Set(['note-0-15-0.9375']); // Note near end of measure
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up notes
			const lane1Notes = LaneMeasureNote.parseFromPattern('00000000000000000000000000000011');
			const lane1Note = new LaneMeasureNote(15, 'lane1', lane1Notes);
			mockEditor._setMockNotes({
				lane1: [lane1Note]
			});

			noteMove.startDrag(pointer, 'note-0-15-0.9375', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Should not throw and should handle boundary crossing
			expect(deleteNoteByKey).toHaveBeenCalled();
		});

		it('should validate target positions', () => {
			const pointer = createMockPointer(-100, -100); // Invalid position
			const selectedNotes = new Set(['note-0-1-0']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up notes
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			mockEditor._setMockNotes({
				lane1: [lane1Note]
			});

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Should complete drag even with invalid mouse position
			// The drag system handles invalid positions gracefully
			expect(noteMove.isCurrentlyDragging).toBe(false);
		});

		it('should handle existing notes at target position', () => {
			const pointer = createMockPointer(200, 100);
			const selectedNotes = new Set(['note-0-1-0']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up notes and add an existing note at target position
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			mockEditor._setMockNotes({
				lane1: [lane1Note]
			});

			// Add existing note at potential target position
			mockEditor._addMockGameObject('note-1-0-0.125');

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Should handle the collision appropriately
			expect(deleteNoteByKey).toHaveBeenCalled();
		});

		it('should handle backward measure boundary crossing when cellOffset goes negative', () => {
			// Origin note at cell 0.5, another dragged note at cell 0.0625
			// Target is measure 2 cellOffset 0, so delta = -0.5
			// Note at 0.0625 gets newCellOffset = -0.4375, triggering while(newCellOffset < 0)
			const selectedNotes = new Set(['note-0-2-0.5', 'note-0-2-0.0625']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up notes in measure 2
			const lane1Note = mockEditor._addMockNote('lane1', 2, 0.5, '01');
			const lane1Note2 = mockEditor._addMockNote('lane1', 2, 0.0625, '01');
			mockEditor._setMockNotes({
				lane1: [lane1Note, lane1Note2]
			});

			// Set activePointer so that targetMeasure=2, targetCellOffset=0
			// clickY = 200 - pointer.y = 801 → measure 2 (currentY=800), positionInMeasure=1/400≈0
			mockEditor.input.activePointer = { x: 150, y: -601 } as any;

			const startPointer = createMockPointer(150, -601);
			noteMove.startDrag(startPointer, 'note-0-2-0.5', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Should not throw and should complete the drag
			expect(noteMove.isCurrentlyDragging).toBe(false);
		});

		it('should allow move when existing note at target position is part of dragged set', () => {
			// Origin at note-0-1-0, also dragging note-0-1-0.5
			// Target: measure 1, cellOffset 0.5 → origin moves to where note-0-1-0.5 is
			// note-0-1-0.5 is in draggedNotes, so movement is allowed
			const selectedNotes = new Set(['note-0-1-0', 'note-0-1-0.5']);
			const clearSelection = vi.fn();
			const highlightSelectedNote = vi.fn();
			const deleteNoteByKey = vi.fn();

			const lane1Note = mockEditor._addMockNote('lane1', 1, 0, '01');
			const lane1Note2 = mockEditor._addMockNote('lane1', 1, 0.5, '01');
			mockEditor._setMockNotes({
				lane1: [lane1Note, lane1Note2]
			});

			// Add a game object for note-0-1-0.5 so getByName returns it
			mockEditor._addMockGameObject('note-0-1-0.5');

			// Set activePointer: targetLaneIndex=0 (x=100→x-offsetX=0→lane 0),
			// targetMeasure=1, targetCellOffset=0.5
			// clickY=600 → measure1(currentY=400), positionInMeasure=200/400=0.5
			// 200 - pointer.y = 600 → pointer.y = -400
			mockEditor.input.activePointer = { x: 100, y: -400 } as any;

			const startPointer = createMockPointer(100, -400);
			noteMove.startDrag(startPointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// Origin note moved to note-0-1-0.5 (where dragged note was) - allowed
			expect(noteMove.isCurrentlyDragging).toBe(false);
		});
	});

	describe('cleanup', () => {
		const createMockPointer = (x = 100, y = 200) =>
			({
				x,
				y,
				worldX: x,
				worldY: y
			}) as Phaser.Input.Pointer;

		it('should cleanup resources when destroyed', () => {
			const pointer = createMockPointer();
			const selectedNotes = new Set(['note-0-1-0']);

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);

			// Should not throw
			expect(() => noteMove.destroy()).not.toThrow();
			expect(noteMove.isCurrentlyDragging).toBe(false);
		});
	});

	describe('preview graphics', () => {
		const createMockPointer = (x = 100, y = 200) =>
			({
				x,
				y,
				worldX: x,
				worldY: y
			}) as Phaser.Input.Pointer;

		it('should create and update drag preview', () => {
			const pointer = createMockPointer();
			const selectedNotes = new Set(['note-0-1-0']);

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);

			// Should have created graphics
			expect(mockEditor.add.graphics).toHaveBeenCalled();

			// Should not throw when updating preview
			expect(() => noteMove.updateDrag()).not.toThrow();
		});
	});

	describe('addNoteToEditor fallback branch (no addNote method)', () => {
		it('should push note to notes array when existingMeasureNote lacks addNote', () => {
			const noteObj = { position: 0, noteID: '01' };
			const plainMeasureNote = {
				measure: 1,
				notes: [noteObj],
				measureLength: 1
				// deliberately no addNote method
			};

			mockEditor._setMockNotes({ lane1: [plainMeasureNote as any] });

			// drawNote returns true (note is added)
			mockEditor.drawNote.mockReturnValue(true);

			noteMove.addNoteToEditor(1, 0, 0.5, 'lane1', '11');

			// The fallback branch should have added position 0.5 to the notes array
			const addedNote = plainMeasureNote.notes.find((n) => n.position === 0.5);
			expect(addedNote).toBeDefined();
		});

		it('should call addNote when existingMeasureNote has the method', () => {
			// Use a real LaneMeasureNote so addNote exists
			const realNote = mockEditor._addMockNote('lane1', 2, 0, '01');
			const addNoteSpy = vi.spyOn(realNote, 'addNote');

			mockEditor.drawNote.mockReturnValue(true);

			noteMove.addNoteToEditor(2, 0, 0.5, 'lane1', '11');

			// addNote(noteID, position) should have been explicitly called on the existing LaneMeasureNote
			expect(addNoteSpy).toHaveBeenCalledWith('11', 0.5);
			const addedChip = realNote.notes.find((n) => n.position === 0.5);
			expect(addedChip).toBeDefined();
		});
	});

	describe('updateSelectionAfterMove with Graphics instances', () => {
		it('should call highlightSelectedNote when getByName returns a Graphics instance for moved notes', () => {
			const highlightSelectedNote = vi.fn();
			const clearSelection = vi.fn();
			const deleteNoteByKey = vi.fn();

			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			mockEditor._setMockNotes({ lane1: [lane1Note] });

			const mockGraphics = new Phaser.GameObjects.Graphics();
			// First call: return null so target position is NOT occupied (note can move)
			// Subsequent calls: return mockGraphics so highlight branch is triggered
			mockEditor.getPanelContainer.mockReturnValue({
				getByName: vi.fn().mockReturnValueOnce(null).mockReturnValue(mockGraphics),
				y: 0
			});

			const pointer = { x: 200, y: 100, worldX: 200, worldY: 100 } as Phaser.Input.Pointer;
			const selectedNotes = new Set(['note-0-1-0']);

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// highlightSelectedNote should have been called with the Graphics instance
			expect(highlightSelectedNote).toHaveBeenCalledWith(mockGraphics);
		});

		it('should call highlightSelectedNote for unmovable notes that have Graphics instances', () => {
			const highlightSelectedNote = vi.fn();
			const clearSelection = vi.fn();
			const deleteNoteByKey = vi.fn();

			// Set up two notes: one in each lane at measure 1
			// note-0-1-0 (lane 0) → will move to lane 1 (within bounds → movable)
			// note-1-1-0 (lane 1) → would move to lane 2 (out of bounds → unmovable)
			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane1Note = new LaneMeasureNote(1, 'lane1', lane1Notes);
			const lane2Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			const lane2Note = new LaneMeasureNote(1, 'lane2', lane2Notes);
			mockEditor._setMockNotes({ lane1: [lane1Note], lane2: [lane2Note] });

			const mockGraphics = new Phaser.GameObjects.Graphics();
			// First call returns null (target position not occupied → note-0-1-0 is movable)
			// Subsequent calls return mockGraphics (for highlighting moved + unmovable notes)
			mockEditor.getPanelContainer.mockReturnValue({
				getByName: vi.fn().mockReturnValueOnce(null).mockReturnValue(mockGraphics),
				y: 0
			});

			const pointer = { x: 200, y: 100, worldX: 200, worldY: 100 } as Phaser.Input.Pointer;
			// Drag both notes — note-1-1-0 goes out of bounds (lane 2) → unmovable
			const selectedNotes = new Set(['note-0-1-0', 'note-1-1-0']);

			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);

			// highlightSelectedNote should have been called for both moved and unmovable notes
			expect(highlightSelectedNote).toHaveBeenCalledWith(mockGraphics);
		});
	});
});
