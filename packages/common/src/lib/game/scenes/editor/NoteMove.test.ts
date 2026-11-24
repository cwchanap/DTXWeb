import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteMove } from './NoteMove';
import { NoteBuffer } from './NoteBuffer';
import type { Editor } from '../Editor';
// import type { MovedNoteData } from './NoteBuffer';
import { LaneMeasureNote } from '../../../chart/note';
import { canonicalizeCellOffset, parseNoteKey } from '../../../utils/position';
import Phaser from 'phaser'; // Import to ensure global mock is available

const createMockGraphics = (): Phaser.GameObjects.Graphics =>
	new Phaser.GameObjects.Graphics({} as Phaser.Scene);

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
			expect(mockRecordMoveAction).toHaveBeenCalled();
		});

		it('should canonicalize the offset after wrapping across a barline', () => {
			// Moving 7/12 from 0.75 wraps to 0.33333333333333326 unless the
			// subtraction residue is canonicalized; the recorded new key
			// must match the stored position so undoMove can delete it.
			const notesToMove: Array<{ newKey: string }> = [];
			const noteMoveInternals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<Record<string, unknown>>
				) => void;
			};
			noteMoveInternals.draggedNotes = new Set(['note-1-1-0.75']);

			noteMoveInternals.calculateNewPositions(
				0,
				0,
				7 / 12,
				new Map([['note-1-1-0.75', '12']]),
				notesToMove as Array<Record<string, unknown>>
			);

			expect(notesToMove).toHaveLength(1);
			expect(notesToMove[0].newKey).toBe('note-1-2-0.3333333333333333');
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
			expect(mockRecordMoveAction).toHaveBeenCalled();
			expect(mockEditor.drawNote).toHaveBeenCalled();
		});

		it('should resolve the chip at the exact key position when another line sits within the old tolerance', () => {
			// Duplicate pattern lines keep distinct positions closer than the
			// old 0.001 fuzzy lookup: 145/576 and 97/384 are ~0.00087 apart.
			// A tolerance find lands on whichever group sorts first, recording
			// a noteID that deleteNoteByKey (exact match) never removes.
			const posA = canonicalizeCellOffset(145 / 576);
			const posB = canonicalizeCellOffset(97 / 384);
			expect(Math.abs(posA - posB)).toBeLessThan(0.001);

			const lineA = new LaneMeasureNote(1, 'lane1', [{ noteID: '01', position: posA }]);
			const lineB = new LaneMeasureNote(1, 'lane1', [{ noteID: '02', position: posB }]);
			mockEditor._setMockNotes({ lane1: [lineA, lineB] });

			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				collectOriginalNoteIds: () => Map<string, string>;
			};
			const key = `note-0-1-${posB}`;
			internals.draggedNotes = new Set([key]);

			expect(internals.collectOriginalNoteIds().get(key)).toBe('02');
		});

		it('should refuse a destination whose dragged graphic leaves a survivor chip', () => {
			// Two pattern lines share cell 0.5: '02' is dragged away but '03'
			// keeps the graphic alive, so '01'@0 moving there would be deleted
			// at its source and then refused by drawNote.
			const lineA = new LaneMeasureNote(1, 'lane1', [{ noteID: '01', position: 0 }]);
			const lineB = new LaneMeasureNote(1, 'lane1', [{ noteID: '02', position: 0.5 }]);
			const lineC = new LaneMeasureNote(1, 'lane1', [{ noteID: '03', position: 0.5 }]);
			mockEditor._setMockNotes({ lane1: [lineA, lineB, lineC] });
			mockEditor._addMockGameObject('note-0-1-0.5');

			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<{ oldKey: string; newKey: string }>
				) => void;
			};
			internals.draggedNotes = new Set(['note-0-1-0', 'note-0-1-0.5']);

			const notesToMove: Array<{ oldKey: string; newKey: string }> = [];
			internals.calculateNewPositions(0, 0, 0.5, new Map(), notesToMove);

			expect(notesToMove.map((n) => n.oldKey)).toEqual(['note-0-1-0.5']);
			expect(notesToMove[0].newKey).toBe('note-0-2-0');
		});

		it('should refuse a move chained behind a blocked dragged destination', () => {
			// Chain 0→0.25→0.5 where a duplicate line keeps a chip at 0.5:
			// the 0.25 move is refused by the survivor check, so 0→0.25 must
			// be refused too — its destination stays occupied and the deleted
			// source chip would be lost.
			const lineA = new LaneMeasureNote(1, 'lane1', [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 0.25 },
				{ noteID: '03', position: 0.5 }
			]);
			const lineB = new LaneMeasureNote(1, 'lane1', [{ noteID: '04', position: 0.5 }]);
			mockEditor._setMockNotes({ lane1: [lineA, lineB] });
			mockEditor._addMockGameObject('note-0-1-0.25');
			mockEditor._addMockGameObject('note-0-1-0.5');

			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<{ oldKey: string; newKey: string }>
				) => void;
			};
			internals.draggedNotes = new Set(['note-0-1-0', 'note-0-1-0.25', 'note-0-1-0.5']);

			const notesToMove: Array<{ oldKey: string; newKey: string }> = [];
			internals.calculateNewPositions(0, 0, 0.25, new Map(), notesToMove);

			expect(notesToMove.map((n) => n.oldKey)).toEqual(['note-0-1-0.5']);
			expect(notesToMove[0].newKey).toBe('note-0-1-0.75');
		});

		it('should cascade a refusal through a chain of dragged destinations', () => {
			// 0→0.25→0.5→0.75 where an unselected chip keeps 0.75: the 0.5
			// move is refused outright, and the refusal must propagate back
			// through both dragged dependents — a single-hop check would
			// still schedule 0→0.25 after 0.25→0.5 is refused.
			const lineA = new LaneMeasureNote(1, 'lane1', [
				{ noteID: '01', position: 0 },
				{ noteID: '02', position: 0.25 },
				{ noteID: '03', position: 0.5 },
				{ noteID: '04', position: 0.75 }
			]);
			mockEditor._setMockNotes({ lane1: [lineA] });
			mockEditor._addMockGameObject('note-0-1-0.25');
			mockEditor._addMockGameObject('note-0-1-0.5');
			mockEditor._addMockGameObject('note-0-1-0.75');

			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<{ oldKey: string; newKey: string }>
				) => void;
			};
			internals.draggedNotes = new Set(['note-0-1-0', 'note-0-1-0.25', 'note-0-1-0.5']);

			const notesToMove: Array<{ oldKey: string; newKey: string }> = [];
			internals.calculateNewPositions(0, 0, 0.25, new Map(), notesToMove);

			expect(notesToMove).toEqual([]);
		});

		it('should refuse a destination held by a chip a few ulps off the computed key', () => {
			// Reproduced from PR #365 review: a seven-cell pattern holds same-lane
			// hits at 1/7, 3/7, 4/7. Dragging 3/7 to offset 0 moves 4/7 onto
			// 0.14285714285714, but the stored 1/7 chip sits at
			// 0.142857142857143 — the exact graphic-key lookup misses it and the
			// moved hit duplicates the occupied cell.
			const p17 = canonicalizeCellOffset(1 / 7); // 0.142857142857143
			const p37 = canonicalizeCellOffset(3 / 7); // 0.42857142857143
			const p47 = canonicalizeCellOffset(4 / 7); // 0.57142857142857
			expect(canonicalizeCellOffset(p47 - p37)).not.toBe(p17);

			const lineA = new LaneMeasureNote(1, 'lane1', [
				{ noteID: '01', position: p17 },
				{ noteID: '02', position: p37 },
				{ noteID: '03', position: p47 }
			]);
			mockEditor._setMockNotes({ lane1: [lineA] });
			mockEditor._addMockGameObject(`note-0-1-${p17}`);

			const key37 = `note-0-1-${p37}`;
			const key47 = `note-0-1-${p47}`;
			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<{ oldKey: string; newKey: string }>
				) => void;
			};
			internals.draggedNotes = new Set([key37, key47]);

			const notesToMove: Array<{ oldKey: string; newKey: string }> = [];
			internals.calculateNewPositions(0, 0, -p37, new Map(), notesToMove);

			// The 3/7 note lands on empty offset 0; the 4/7 note is refused
			// instead of duplicating the drifted 1/7 cell.
			expect(notesToMove.map((n) => n.oldKey)).toEqual([key37]);
			expect(notesToMove[0].newKey).toBe('note-0-1-0');
		});

		it('moves a group note onto an off-grid cell vacated by another selected note', () => {
			// 1/7, 3/7, and 4/7 are selected; dragging 3/7 to the measure
			// start moves 1/7 into the previous measure. The 4/7 note's
			// computed cell is a few ulps off the stored 1/7 position, but
			// that occupant vacates in the same drag, so 4/7 must follow it
			// instead of staying behind.
			const p17 = canonicalizeCellOffset(1 / 7);
			const p37 = canonicalizeCellOffset(3 / 7);
			const p47 = canonicalizeCellOffset(4 / 7);
			expect(canonicalizeCellOffset(p47 - p37)).not.toBe(p17);

			const lineA = new LaneMeasureNote(2, 'lane1', [
				{ noteID: '01', position: p17 },
				{ noteID: '02', position: p37 },
				{ noteID: '03', position: p47 }
			]);
			mockEditor._setMockNotes({ lane1: [lineA] });

			const key17 = `note-0-2-${p17}`;
			const key37 = `note-0-2-${p37}`;
			const key47 = `note-0-2-${p47}`;
			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<{ oldKey: string; newKey: string }>
				) => void;
			};
			internals.draggedNotes = new Set([key17, key37, key47]);

			const notesToMove: Array<{ oldKey: string; newKey: string }> = [];
			internals.calculateNewPositions(0, 0, -p37, new Map(), notesToMove);

			expect(notesToMove.map((n) => n.oldKey)).toEqual([key17, key37, key47]);
			expect(notesToMove.map((n) => n.newKey)).toEqual([
				`note-0-1-${canonicalizeCellOffset(p17 - p37 + 1)}`,
				'note-0-2-0',
				`note-0-2-${canonicalizeCellOffset(p47 - p37)}`
			]);
		});

		it('refuses an off-grid destination whose selected occupant cannot vacate', () => {
			// Same 1/7, 3/7, 4/7 group in measure 0. Dragging 3/7 to the
			// measure start pushes 1/7 into measure -1, so its move is
			// refused and the drifted cell stays occupied — 4/7 must stay
			// behind rather than land on top of it.
			const p17 = canonicalizeCellOffset(1 / 7);
			const p37 = canonicalizeCellOffset(3 / 7);
			const p47 = canonicalizeCellOffset(4 / 7);

			const lineA = new LaneMeasureNote(0, 'lane1', [
				{ noteID: '01', position: p17 },
				{ noteID: '02', position: p37 },
				{ noteID: '03', position: p47 }
			]);
			mockEditor._setMockNotes({ lane1: [lineA] });

			const key17 = `note-0-0-${p17}`;
			const key37 = `note-0-0-${p37}`;
			const key47 = `note-0-0-${p47}`;
			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<{ oldKey: string; newKey: string }>
				) => void;
			};
			internals.draggedNotes = new Set([key17, key37, key47]);

			const notesToMove: Array<{ oldKey: string; newKey: string }> = [];
			internals.calculateNewPositions(0, 0, -p37, new Map(), notesToMove);

			expect(notesToMove.map((n) => n.oldKey)).toEqual([key37]);
			expect(notesToMove[0].newKey).toBe('note-0-0-0');
		});

		it('moves and restores every chip in an off-grid group drag', () => {
			// End-to-end: performMove deletes all three sources before
			// placing them, so the drift dependency must not lose a chip.
			// Undo then restores the same IDs at their original positions.
			const p17 = canonicalizeCellOffset(1 / 7);
			const p37 = canonicalizeCellOffset(3 / 7);
			const p47 = canonicalizeCellOffset(4 / 7);

			const notes: Record<string, LaneMeasureNote[]> = {
				lane1: [
					new LaneMeasureNote(2, 'lane1', [
						{ noteID: '01', position: p17 },
						{ noteID: '02', position: p37 },
						{ noteID: '03', position: p47 }
					])
				]
			};
			const graphics = new Map<string, { name: string; destroy: ReturnType<typeof vi.fn> }>();
			const selectedNotes = new Set<string>();
			const keyOf = (measure: number, offset: number) => `note-0-${measure}-${offset}`;

			const editor = {
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
					getByName: (name: string) => graphics.get(name),
					y: 0
				}),
				getLaneConfigs: vi.fn().mockReturnValue([{ id: 'lane1', noteColor: 0xff0000 }]),
				getNotes: vi.fn(() => notes),
				getCellsPerMeasure: vi.fn().mockReturnValue(16),
				getMeasureCount: vi.fn().mockReturnValue(100),
				getMeasureHeight: vi.fn().mockReturnValue(400),
				getOffsetX: vi.fn().mockReturnValue(100),
				getOffsetY: vi.fn().mockReturnValue(200),
				getCellWidth: vi.fn().mockReturnValue(50),
				getCellHeightValue: vi.fn().mockReturnValue(25),
				getCellMargin: vi.fn().mockReturnValue(2),
				getTotalMesaureOffest: vi.fn().mockReturnValue(0),
				getCellHeightAt: vi.fn().mockReturnValue(20),
				getNoteSize: vi.fn().mockReturnValue(18),
				drawNote: vi.fn((measure: number, _laneIndex: number, cellOffset: number) => {
					const key = keyOf(measure, cellOffset);
					if (graphics.has(key)) return false;
					graphics.set(key, { name: key, destroy: vi.fn() });
					return true;
				}),
				deleteNoteByKey: vi.fn((key: string) => {
					const parsed = parseNoteKey(key);
					if (!parsed) return;
					const group = notes.lane1.find(
						(note) =>
							note.measure === parsed.measure &&
							note.notes.some((chip) => chip.position === parsed.cellOffset)
					);
					if (group) {
						const chipIndex = group.notes.findIndex(
							(chip) => chip.position === parsed.cellOffset
						);
						group.notes.splice(chipIndex, 1);
					}
					const occupied = notes.lane1.some(
						(note) =>
							note.measure === parsed.measure &&
							note.notes.some((chip) => chip.position === parsed.cellOffset)
					);
					if (!occupied) {
						graphics.get(key)?.destroy();
						graphics.delete(key);
					}
				}),
				clearSelection: vi.fn(() => selectedNotes.clear()),
				selectedNotes,
				highlightSelectedNote: vi.fn(),
				input: { activePointer: { x: 100, y: -600 } }
			};

			for (const position of [p17, p37, p47]) {
				graphics.set(keyOf(2, position), { name: keyOf(2, position), destroy: vi.fn() });
			}

			const noteBuffer = new NoteBuffer();
			const dragMove = new NoteMove(editor as unknown as Editor, (moved) =>
				noteBuffer.recordAction('move', moved)
			);
			noteBuffer.setNoteMove(dragMove);

			const selection = new Set([keyOf(2, p17), keyOf(2, p37), keyOf(2, p47)]);
			dragMove.startDrag(
				{ x: 100, y: -600 } as Phaser.Input.Pointer,
				keyOf(2, p37),
				selection
			);
			dragMove.completeDrag(
				selection,
				editor.clearSelection,
				editor.highlightSelectedNote,
				editor.deleteNoteByKey
			);

			const chipsByMeasure = (measure: number) =>
				notes.lane1
					.filter((note) => note.measure === measure)
					.flatMap((note) => note.notes)
					.sort((a, b) => a.position - b.position);

			expect(chipsByMeasure(1)).toEqual([
				{ noteID: '01', position: canonicalizeCellOffset(p17 - p37 + 1) }
			]);
			expect(chipsByMeasure(2)).toEqual([
				{ noteID: '02', position: 0 },
				{ noteID: '03', position: canonicalizeCellOffset(p47 - p37) }
			]);

			expect(noteBuffer.undoLastAction(editor as unknown as Editor)).toBe(true);
			expect(chipsByMeasure(1)).toEqual([]);
			expect(chipsByMeasure(2)).toEqual([
				{ noteID: '01', position: p17 },
				{ noteID: '02', position: p37 },
				{ noteID: '03', position: p47 }
			]);
		});

		it('should not record a move whose destination placement failed', () => {
			const selectedNotes = new Set(['note-0-1-0']);
			const deleteNoteByKey = vi.fn();
			mockEditor.drawNote.mockReturnValue(false);

			const lane1Notes = LaneMeasureNote.parseFromPattern('11000000000000000000000000000000');
			mockEditor._setMockNotes({ lane1: [new LaneMeasureNote(1, 'lane1', lane1Notes)] });

			const pointer = createMockPointer(150, 50);
			noteMove.startDrag(pointer, 'note-0-1-0', selectedNotes);
			noteMove.completeDrag(selectedNotes, vi.fn(), vi.fn(), deleteNoteByKey);

			expect(deleteNoteByKey).toHaveBeenCalledWith('note-0-1-0');
			expect(mockRecordMoveAction).not.toHaveBeenCalled();
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

		it('should keep a same-position chip in another pattern line instead of overwriting it', () => {
			const lineA = new LaneMeasureNote(1, 'lane1', [{ noteID: '11', position: 0.5 }]);
			const lineB = new LaneMeasureNote(1, 'lane1', [{ noteID: '12', position: 0.5 }]);
			mockEditor._setMockNotes({ lane1: [lineA, lineB] });
			mockEditor.drawNote.mockReturnValue(true);

			noteMove.addNoteToEditor(1, 0, 0.5, 'lane1', '13');

			const groups = mockEditor._getMockNotes().lane1;
			expect(groups).toHaveLength(3);
			expect(groups[0].notes).toContainEqual({ noteID: '11', position: 0.5 });
			expect(groups[1].notes).toContainEqual({ noteID: '12', position: 0.5 });
			expect(groups[2].notes).toContainEqual({ noteID: '13', position: 0.5 });
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

			const mockGraphics = createMockGraphics();
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

			const mockGraphics = createMockGraphics();
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

	describe('duplicate destination claim before dependency propagation', () => {
		it('refuses a dependent note when its dragged target loses a duplicate-destination claim', () => {
			const deleteNoteByKey = vi.fn();
			const offsetB = 0.700000000000003;
			const offsetC = 0.200000000000003;
			const noteData = new LaneMeasureNote(0, 'lane1', [
				{ noteID: '14', position: offsetC },
				{ noteID: '12', position: 0.7 },
				{ noteID: '13', position: offsetB }
			]);
			mockEditor._setMockNotes({ lane1: [noteData] });

			const keyA = 'note-0-0-0.7';
			const keyB = `note-0-0-${offsetB}`;
			const keyC = `note-0-0-${offsetC}`;
			mockEditor._addMockGameObject(keyA);
			mockEditor._addMockGameObject(keyB);
			mockEditor._addMockGameObject(keyC);

			const internals = noteMove as unknown as {
				draggedNotes: Set<string>;
				calculateNewPositions: (
					laneOffsetDelta: number,
					measureOffsetDelta: number,
					cellOffsetDelta: number,
					originalNoteIds: Map<string, string>,
					notesToMove: Array<{
						oldKey: string;
						newKey: string;
						laneIndex: number;
						measure: number;
						cellOffset: number;
						laneId: string;
						originalNoteId: string;
					}>
				) => void;
				performMove: (
					notesToMove: Array<{
						oldKey: string;
						newKey: string;
						laneIndex: number;
						measure: number;
						cellOffset: number;
						laneId: string;
						originalNoteId: string;
					}>,
					deleteNoteByKey: (noteKey: string) => void
				) => { movedNotes: string[]; unmovableNotes: string[] };
			};

			// Adding +0.5 crosses 1.0 for A (0.7) and B (0.700000000000003), where
			// toPrecision(15) collapses both to 1.2 -> note-0-1-0.2. A claims
			// note-0-1-0.2 so B stays at offsetB. C (0.200000000000003 + 0.5) stays
			// under 1.0 and targets B's original cell (offsetB), so C must also be
			// refused before performMove.
			internals.draggedNotes = new Set([keyA, keyB, keyC]);
			const notesToMove: Array<{
				oldKey: string;
				newKey: string;
				laneIndex: number;
				measure: number;
				cellOffset: number;
				laneId: string;
				originalNoteId: string;
			}> = [];
			internals.calculateNewPositions(
				0,
				0,
				0.5,
				new Map([
					[keyA, '12'],
					[keyB, '13'],
					[keyC, '14']
				]),
				notesToMove
			);

			expect(notesToMove.map((n) => n.oldKey)).toEqual([keyA]);
			internals.performMove(notesToMove, deleteNoteByKey);
			expect(deleteNoteByKey).toHaveBeenCalledTimes(1);
			expect(deleteNoteByKey).toHaveBeenCalledWith(keyA);
			expect(deleteNoteByKey).not.toHaveBeenCalledWith(keyC);
		});
	});
});
