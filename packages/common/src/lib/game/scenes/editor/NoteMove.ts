import { LaneMeasureNote } from '../../../chart/note';
import type { Editor } from '../Editor';
import { type MovedNoteData } from './NoteBuffer';
import {
	canonicalizeCellOffset,
	isSameCellOffset,
	parseNoteKey,
	snapCellOffsetToBarline
} from '../../../utils/position';
import Phaser from 'phaser';

/**
 * Manages note drag and move operations in the DTX editor
 */
export class NoteMove {
	private editor: Editor;

	// Drag state
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private draggedNotes: Set<string> = new Set();
	private dragOriginNote: string = '';
	private dragPreviewGraphics: Phaser.GameObjects.Graphics | null = null;

	// Callback for recording move actions
	private recordMoveAction: (movedNotes: MovedNoteData[]) => void;

	constructor(editor: Editor, recordMoveAction: (movedNotes: MovedNoteData[]) => void) {
		this.editor = editor;
		this.recordMoveAction = recordMoveAction;
	}

	/**
	 * Check if currently dragging
	 */
	get isCurrentlyDragging(): boolean {
		return this.isDragging;
	}

	/**
	 * Start drag operation
	 */
	startDrag(
		pointer: Phaser.Input.Pointer,
		originNoteKey: string,
		selectedNotes: Set<string>
	): void {
		this.isDragging = true;
		this.dragStartX = pointer.x;
		this.dragStartY = pointer.y;
		this.dragOriginNote = originNoteKey;

		// Copy selected notes to dragged notes
		this.draggedNotes = new Set(selectedNotes);

		// Create drag preview graphics
		this.createDragPreview();
	}

	/**
	 * Update drag operation
	 */
	updateDrag(): void {
		if (!this.isDragging || !this.dragPreviewGraphics) return;

		// Update the drag preview to show all notes moving together
		this.updateDragPreview();
	}

	/**
	 * Complete drag operation and move notes to new positions
	 */
	completeDrag(
		selectedNotes: Set<string>,
		clearSelection: () => void,
		highlightSelectedNote: (noteGraphics: { name: string }) => void,
		deleteNoteByKey: (noteKey: string) => void
	): void {
		if (!this.isDragging) return;

		// Get current mouse position
		const pointer = this.editor.input.activePointer;
		const x = pointer.x - this.editor.getOffsetX();
		const absoluteY = pointer.y - this.editor.getOffsetY() - this.editor.getPanelContainer().y;

		const targetLaneIndex = Math.floor(x / this.editor.getCellWidth());

		// Calculate target position using same logic as Editor note creation
		// Find the measure and position within measure using same calculation as Editor
		const clickY = -absoluteY;
		let currentY = 0;
		let targetMeasure = -1;
		let positionInMeasure = 0;

		// Iterate through measures to find which one contains the cursor (same as Editor logic)
		for (let m = 0; m < this.editor.getMeasureCount(); m++) {
			const measureHeight = this.editor.getMeasureHeight(m);
			if (clickY >= currentY && clickY < currentY + measureHeight) {
				targetMeasure = m;
				positionInMeasure = (clickY - currentY) / measureHeight;
				break;
			}
			currentY += measureHeight;
		}

		// Validate target position
		if (
			targetLaneIndex >= 0 &&
			targetLaneIndex < this.editor.getLaneConfigs().length &&
			targetMeasure >= 0 &&
			targetMeasure < this.editor.getMeasureCount()
		) {
			// Snap reference position to 16th note grid (not high-resolution grid)
			// This ensures the reference note is placed at the nearest 16th note grid cell
			const cellsPerMeasure = this.editor.getCellsPerMeasure(); // This is 16 for 16th note grid
			const gridPosition = Math.round(positionInMeasure * cellsPerMeasure);
			const targetCellOffset = gridPosition / cellsPerMeasure;

			// Move each dragged note
			this.moveNotesToPosition(
				targetLaneIndex,
				targetMeasure,
				targetCellOffset,
				selectedNotes,
				clearSelection,
				highlightSelectedNote,
				deleteNoteByKey
			);
		}

		// Clean up drag state
		this.cleanupDrag();
	}

	/**
	 * Clean up drag state and graphics
	 */
	cleanupDrag(): void {
		this.isDragging = false;
		this.draggedNotes.clear();
		this.dragOriginNote = '';

		if (this.dragPreviewGraphics) {
			this.dragPreviewGraphics.destroy();
			this.dragPreviewGraphics = null;
		}
	}

	/**
	 * Move notes to specified position maintaining relative positions
	 */
	private moveNotesToPosition(
		targetLaneIndex: number,
		targetMeasure: number,
		targetCellOffset: number,
		selectedNotes: Set<string>,
		clearSelection: () => void,
		highlightSelectedNote: (noteGraphics: { name: string }) => void,
		deleteNoteByKey: (noteKey: string) => void
	): void {
		// Parse the origin note (the one user clicked to drag)
		const originParsed = parseNoteKey(this.dragOriginNote);
		if (!originParsed) return;

		const {
			laneIndex: originLaneIndex,
			measure: originMeasure,
			cellOffset: originCellOffset
		} = originParsed;

		// Calculate the movement delta from origin note to target position
		const laneOffsetDelta = targetLaneIndex - originLaneIndex;
		const measureOffsetDelta = targetMeasure - originMeasure;
		const cellOffsetDelta = targetCellOffset - originCellOffset;

		const notesToMove: Array<{
			oldKey: string;
			newKey: string;
			laneIndex: number;
			measure: number;
			cellOffset: number;
			laneId: string;
			originalNoteId: string;
		}> = [];

		// Collect original note IDs for all notes that will be moved
		const originalNoteIds = this.collectOriginalNoteIds();

		// Calculate new positions for all selected notes based on the delta
		this.calculateNewPositions(
			laneOffsetDelta,
			measureOffsetDelta,
			cellOffsetDelta,
			originalNoteIds,
			notesToMove
		);

		// Allow partial movement - move notes that can be moved, leave others in place
		if (notesToMove.length > 0) {
			// Prepare move data for undo functionality before making any changes
			const moveData = this.prepareMoveData(notesToMove);

			// Execute the note moving operations
			const { movedNotes, unmovableNotes } = this.performMove(notesToMove, deleteNoteByKey);

			// Record only the moves that landed: an entry for a failed
			// placement would make undo delete whatever graphic now owns the
			// destination key.
			if (movedNotes.length > 0) {
				const landed = new Set(movedNotes);
				this.recordMoveAction(moveData.filter((data) => landed.has(data.newNoteKey)));
			}

			// Update selection to include both moved and unmoved notes
			this.updateSelectionAfterMove(
				movedNotes,
				unmovableNotes,
				clearSelection,
				selectedNotes,
				highlightSelectedNote
			);
		}
	}

	/**
	 * Collect original note IDs for all notes that will be moved
	 */
	private collectOriginalNoteIds(): Map<string, string> {
		const originalNoteIds = new Map<string, string>();
		this.draggedNotes.forEach((noteKey) => {
			const parsed = parseNoteKey(noteKey);
			if (parsed) {
				const {
					laneIndex: oldLaneIndex,
					measure: oldMeasure,
					cellOffset: oldCellOffset
				} = parsed;
				const oldLaneId = this.editor.getLaneConfigs()[oldLaneIndex].id;

				// Find the original noteID from the data structure. Match the
				// exact stored position like deleteNoteByKey does: duplicate
				// pattern lines can hold chips closer than any tolerance, and a
				// fuzzy match can resolve a different line's chip than the one
				// the delete will remove.
				const notes = this.editor.getNotes();
				if (oldLaneId in notes) {
					const existingNote = notes[oldLaneId].find(
						(note) =>
							note.measure === oldMeasure &&
							note.notes.some((n) => n.position === oldCellOffset)
					);
					if (existingNote) {
						const noteChip = existingNote.notes.find(
							(n) => n.position === oldCellOffset
						);
						if (noteChip) {
							originalNoteIds.set(noteKey, noteChip.noteID);
						}
					}
				}
			}
		});
		return originalNoteIds;
	}

	/**
	 * Calculate and validate new note positions based on movement deltas
	 */
	private calculateNewPositions(
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
	): void {
		const candidates: typeof notesToMove = [];
		// Moves whose placement depends on dragged occupants vacating their
		// cells, keyed by the moving note and the occupants it waits on.
		const draggedDeps = new Map<string, Set<string>>();

		this.draggedNotes.forEach((noteKey) => {
			const parsed = parseNoteKey(noteKey);
			if (parsed) {
				const {
					laneIndex: currentLaneIndex,
					measure: currentMeasure,
					cellOffset: currentCellOffset
				} = parsed;

				// Apply the same delta to each note to maintain relative positions
				const newLaneIndex = currentLaneIndex + laneOffsetDelta;
				let newMeasure = currentMeasure + measureOffsetDelta;
				// Canonicalize + snap float residue before it becomes a note
				// key; raw sums can sit 1-ulp off the intended position (or
				// land just off a barline in e-notation), evading the
				// occupancy check below and breaking split('-') consumers.
				let newCellOffset = snapCellOffsetToBarline(
					canonicalizeCellOffset(currentCellOffset + cellOffsetDelta)
				);

				// Handle measure boundary crossing for cellOffset.
				// If cellOffset >= 1.0, move to next measure(s)
				// If cellOffset < 0.0, move to previous measure(s).
				// Canonicalize after each subtraction: wrapping can leave
				// float residue that no longer matches the stored key.
				while (newCellOffset >= 1.0) {
					newMeasure += 1;
					newCellOffset = canonicalizeCellOffset(newCellOffset - 1.0);
				}
				while (newCellOffset < 0.0) {
					newMeasure -= 1;
					newCellOffset = canonicalizeCellOffset(newCellOffset + 1.0);
				}
				newCellOffset = snapCellOffsetToBarline(newCellOffset);

				// Validate new position
				if (
					newLaneIndex >= 0 &&
					newLaneIndex < this.editor.getLaneConfigs().length &&
					newMeasure >= 0 &&
					newMeasure < this.editor.getMeasureCount() &&
					newCellOffset >= 0 &&
					newCellOffset < 1
				) {
					const newLaneId = this.editor.getLaneConfigs()[newLaneIndex].id;
					const newKey = `note-${newLaneIndex}-${newMeasure}-${newCellOffset}`;
					const existingNote = this.editor.getPanelContainer().getByName(newKey);

					// Only move if target position is empty or its graphic belongs to
					// a note we are moving (covers same-position drops and swaps
					// within the selection). A dragged destination still blocks the
					// move when another pattern line keeps a chip at the same cell:
					// removing the dragged chip redraws the survivor's graphic under
					// the same key, so the incoming chip is refused after its source
					// was already deleted.
					const destIsDragged =
						!!existingNote && this.draggedNotes.has(existingNote.name);
					// The exact-key lookup misses a destination stored within
					// accumulated canonicalization drift of the computed offset
					// (e.g. 4/7 - 3/7 vs 1/7, or 18/254 - 9/254 vs 9/254): the
					// graphic exists under a different key, and the incoming chip
					// would duplicate the hit instead of being refused — the same
					// occupancy hole pasteNotes guards with its drift check.
					// Nearby chips are occupancy too. A selected occupant vacates
					// its cell in the same drag, so it becomes a dependency like
					// an exact-key dragged destination; an unselected occupant or
					// a duplicate line's surviving chip still blocks.
					const driftOccupants = new Set<string>();
					let driftBlocked = false;
					for (const group of this.editor.getNotes()[newLaneId] ?? []) {
						if (group.measure !== newMeasure) continue;
						for (const chip of group.notes) {
							if (chip.position === newCellOffset) continue;
							if (!isSameCellOffset(chip.position, newCellOffset)) continue;
							const occupantKey = `note-${newLaneIndex}-${newMeasure}-${chip.position}`;
							if (
								!this.draggedNotes.has(occupantKey) ||
								this.hasSurvivingChip(newLaneIndex, newMeasure, chip.position)
							) {
								driftBlocked = true;
								break;
							}
							driftOccupants.add(occupantKey);
						}
						if (driftBlocked) break;
					}
					if (
						!driftBlocked &&
						(!existingNote ||
							(destIsDragged &&
								!this.hasSurvivingChip(newLaneIndex, newMeasure, newCellOffset)))
					) {
						candidates.push({
							oldKey: noteKey,
							newKey,
							laneIndex: newLaneIndex,
							measure: newMeasure,
							cellOffset: newCellOffset,
							laneId: newLaneId,
							originalNoteId: originalNoteIds.get(noteKey) || '01'
						});
						const addDraggedDep = (occupantKey: string) => {
							const deps = draggedDeps.get(noteKey);
							if (deps) deps.add(occupantKey);
							else draggedDeps.set(noteKey, new Set([occupantKey]));
						};
						if (destIsDragged) addDraggedDep(existingNote.name);
						driftOccupants.forEach(addDraggedDep);
					}
				}
			}
		});

		// A move onto a dragged occupant only lands when that occupant
		// actually vacates. If its own move was refused (survivor chip,
		// bounds, occupied target), the incoming placement fails after the
		// source was deleted and the chip is lost — so propagate the refusal.
		// Follow each dependency edge once: dependents[occupantKey] holds the
		// sources waiting on that dragged cell, and a refusal cascades down
		// its chain.
		const claimed = new Set<string>();
		const movable = new Map<string, (typeof candidates)[number]>();
		const dependents = new Map<string, string[]>();
		const blocked: string[] = [];
		// Two sources can canonicalize onto one destination key. Only the first
		// can land, so refuse the others before propagating dependencies.
		candidates.forEach((candidate) => {
			if (claimed.has(candidate.newKey)) {
				blocked.push(candidate.oldKey);
				return;
			}
			claimed.add(candidate.newKey);
			movable.set(candidate.oldKey, candidate);
		});
		draggedDeps.forEach((occupants, oldKey) => {
			const candidate = movable.get(oldKey);
			if (!candidate) return;
			const occupantsVacate = [...occupants].every((occupantKey) => movable.has(occupantKey));
			if (!occupantsVacate) {
				blocked.push(oldKey);
				return;
			}
			occupants.forEach((occupantKey) => {
				const waiters = dependents.get(occupantKey);
				if (waiters) {
					waiters.push(oldKey);
				} else {
					dependents.set(occupantKey, [oldKey]);
				}
			});
		});
		while (blocked.length > 0) {
			const oldKey = blocked.pop()!;
			if (!movable.delete(oldKey)) continue;
			dependents.get(oldKey)?.forEach((dep) => blocked.push(dep));
		}

		movable.forEach((candidate) => {
			notesToMove.push(candidate);
		});
	}

	/**
	 * Whether more than one chip sits at a cell across duplicate pattern
	 * lines. The dragged chip removes only one, so a survivor keeps the
	 * cell's graphic alive under the same key.
	 */
	private hasSurvivingChip(laneIndex: number, measure: number, cellOffset: number): boolean {
		const laneId = this.editor.getLaneConfigs()[laneIndex].id;
		let chips = 0;
		for (const group of this.editor.getNotes()[laneId] ?? []) {
			if (group.measure !== measure) continue;
			chips += group.notes.filter((chip) => chip.position === cellOffset).length;
		}
		return chips > 1;
	}

	/**
	 * Prepare undo data for the move operation
	 */
	private prepareMoveData(
		notesToMove: Array<{
			oldKey: string;
			newKey: string;
			laneIndex: number;
			measure: number;
			cellOffset: number;
			laneId: string;
			originalNoteId: string;
		}>
	): MovedNoteData[] {
		const moveData: MovedNoteData[] = [];
		notesToMove.forEach(
			({ oldKey, newKey, laneIndex, measure, cellOffset, laneId, originalNoteId }) => {
				// Parse original position from old key
				const oldParsed = parseNoteKey(oldKey);
				if (oldParsed) {
					const {
						laneIndex: originalLaneIndex,
						measure: originalMeasure,
						cellOffset: originalCellOffset
					} = oldParsed;
					const originalLaneId = this.editor.getLaneConfigs()[originalLaneIndex].id;
					const originalGroup = this.editor
						.getNotes()
						[originalLaneId]?.find(
							(note) =>
								note.measure === originalMeasure &&
								note.notes.some((n) => n.position === originalCellOffset)
						);

					moveData.push({
						originalNoteKey: oldKey,
						originalLaneIndex,
						originalMeasure,
						originalCellOffset,
						originalLaneId,
						originalMeasureLength: originalGroup?.measureLength ?? 1,
						noteId: originalNoteId,
						newNoteKey: newKey,
						newLaneIndex: laneIndex,
						newMeasure: measure,
						newCellOffset: cellOffset,
						newLaneId: laneId
					});
				}
			}
		);
		return moveData;
	}

	/**
	 * Write a chip back beside any duplicate-line survivor when its shared
	 * graphic already owns the source key.
	 */
	private restoreChipData(
		measure: number,
		cellOffset: number,
		laneId: string,
		noteId: string,
		measureLength: number
	): void {
		const groups = (this.editor.getNotes()[laneId] ||= []);
		const target = groups.find(
			(group) =>
				group.measure === measure &&
				!group.notes.some((chip) => chip.position === cellOffset)
		);
		if (target) {
			target.addNote(noteId, cellOffset);
			return;
		}
		const group = new LaneMeasureNote(measure, laneId, [], measureLength);
		group.addNote(noteId, cellOffset);
		groups.push(group);
	}

	/**
	 * Execute the note moving operations
	 */
	private performMove(
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
	): { movedNotes: string[]; unmovableNotes: string[] } {
		// Keep track of notes that were successfully moved for selection update
		const movedNotes: string[] = [];
		const unmovableNotes: string[] = [];

		// Collect notes that cannot be moved
		this.draggedNotes.forEach((noteKey) => {
			const canMove = notesToMove.some(({ oldKey }) => oldKey === noteKey);
			if (!canMove) {
				unmovableNotes.push(noteKey);
			}
		});

		// Capture source placements before deleting them so a failed destination
		// placement can restore its chip instead of losing it outside undo history.
		const sources = new Map<
			string,
			{
				laneIndex: number;
				measure: number;
				cellOffset: number;
				laneId: string;
				measureLength: number;
			}
		>();
		notesToMove.forEach(({ oldKey }) => {
			const parsed = parseNoteKey(oldKey);
			if (!parsed) return;
			const laneId = this.editor.getLaneConfigs()[parsed.laneIndex].id;
			const group = this.editor
				.getNotes()
				[laneId]?.find(
					(note) =>
						note.measure === parsed.measure &&
						note.notes.some((chip) => chip.position === parsed.cellOffset)
				);
			sources.set(oldKey, { ...parsed, laneId, measureLength: group?.measureLength ?? 1 });
		});

		// First, remove old notes that are moving
		notesToMove.forEach(({ oldKey }) => {
			deleteNoteByKey(oldKey);
		});

		// Then, add new notes. A placement that still fails after the source was
		// deleted is restored at its source once every destination has had a
		// chance to vacate; undo entries only describe moves that truly landed.
		const failedPlacements: (typeof notesToMove)[number][] = [];
		notesToMove.forEach(
			({ newKey, laneIndex, measure, cellOffset, laneId, originalNoteId, oldKey }) => {
				const noteAdded = this.addNoteToEditor(
					measure,
					laneIndex,
					cellOffset,
					laneId,
					originalNoteId
				);

				if (noteAdded) {
					movedNotes.push(newKey);
				} else {
					failedPlacements.push({
						oldKey,
						newKey,
						laneIndex,
						measure,
						cellOffset,
						laneId,
						originalNoteId
					});
				}
			}
		);
		for (const failed of failedPlacements) {
			const source = sources.get(failed.oldKey);
			if (!source) continue;
			const restored = this.addNoteToEditor(
				source.measure,
				source.laneIndex,
				source.cellOffset,
				source.laneId,
				failed.originalNoteId,
				source.measureLength
			);
			if (!restored && this.editor.getPanelContainer().getByName(failed.oldKey)) {
				this.restoreChipData(
					source.measure,
					source.cellOffset,
					source.laneId,
					failed.originalNoteId,
					source.measureLength
				);
			}
			unmovableNotes.push(failed.oldKey);
		}

		return { movedNotes, unmovableNotes };
	}

	/**
	 * Update the selection state after moving notes
	 */
	private updateSelectionAfterMove(
		movedNotes: string[],
		unmovableNotes: string[],
		clearSelection: () => void,
		selectedNotes: Set<string>,
		highlightSelectedNote: (noteGraphics: { name: string }) => void
	): void {
		// Update selection to include both moved and unmoved notes
		clearSelection();

		// Add moved notes to selection
		movedNotes.forEach((newKey) => {
			selectedNotes.add(newKey);
			const noteGraphics = this.editor.getPanelContainer().getByName(newKey);
			if (noteGraphics && noteGraphics instanceof Phaser.GameObjects.Graphics) {
				highlightSelectedNote(noteGraphics);
			}
		});

		// Keep unmovable notes in selection at their original positions
		unmovableNotes.forEach((noteKey) => {
			selectedNotes.add(noteKey);
			const noteGraphics = this.editor.getPanelContainer().getByName(noteKey);
			if (noteGraphics && noteGraphics instanceof Phaser.GameObjects.Graphics) {
				highlightSelectedNote(noteGraphics);
			}
		});
	}

	/**
	 * Create drag preview graphics
	 */
	private createDragPreview(): void {
		// Create preview graphics showing where notes will be moved
		this.dragPreviewGraphics = this.editor.add.graphics();
		this.dragPreviewGraphics.setAlpha(0.5);

		// We'll update the preview positions in updateDrag based on cursor movement
		// For now, just initialize it with the current positions
		this.updateDragPreview();
	}

	/**
	 * Add a note to both the display and data structure
	 * This is the shared logic used by both copy and move operations
	 */
	public addNoteToEditor(
		measure: number,
		laneIndex: number,
		cellOffset: number,
		laneId: string,
		noteId: string,
		forceMeasureLength?: number
	): boolean {
		// One canonical stored form so the data position and the note key it
		// produces always agree (drawNote embeds this value in the key).
		cellOffset = canonicalizeCellOffset(cellOffset);
		// Add to display
		const noteAdded = this.editor.drawNote(measure, laneIndex, cellOffset, noteId);
		if (noteAdded) {
			// Add to data structure
			const notes = this.editor.getNotes();
			if (!(laneId in notes)) {
				notes[laneId] = [];
			}

			// Check if a LaneMeasureNote already exists for this measure/lane
			// that does not already hold a chip at this position. A duplicate
			// pattern line may share the position, and overwriting it would
			// silently drop that line's chip (e.g. undoing a cut/delete after
			// another line survived).
			const existingMeasureNote = notes[laneId].find(
				(note) =>
					note.measure === measure &&
					!note.notes.some((chip) => chip.position === cellOffset)
			);

			if (existingMeasureNote) {
				// Add note to existing measure using the notes array
				// Check if the instance has the new method (backward compatibility)
				if (typeof existingMeasureNote.addNote === 'function') {
					existingMeasureNote.addNote(noteId, cellOffset);
				} else {
					// Fallback: manually add to notes array for old instances
					existingMeasureNote.notes = existingMeasureNote.notes.filter(
						(note) => note.position !== cellOffset
					);
					existingMeasureNote.notes.push({ noteID: noteId, position: cellOffset });
					existingMeasureNote.notes.sort((a, b) => a.position - b.position);
				}
			} else {
				// Create a new LaneMeasureNote for this measure
				// Use forced measureLength if provided, otherwise use same as other measures in lane
				const measureLength =
					forceMeasureLength ||
					(notes[laneId].length > 0 ? notes[laneId][0].measureLength : 1);
				// Create with empty notes array and add the note
				const newMeasureNote = new LaneMeasureNote(measure, laneId, [], measureLength);
				newMeasureNote.addNote(noteId, cellOffset);
				notes[laneId].push(newMeasureNote);
			}
		}

		return noteAdded;
	}

	/**
	 * Update drag preview graphics to show where notes will be placed
	 */
	private updateDragPreview(): void {
		if (!this.dragPreviewGraphics) return;

		// Clear previous preview
		this.dragPreviewGraphics.clear();
		this.dragPreviewGraphics.setAlpha(0.5);

		// Get current mouse position
		const pointer = this.editor.input.activePointer;
		const x = pointer.x - this.editor.getOffsetX();
		const absoluteY = pointer.y - this.editor.getOffsetY() - this.editor.getPanelContainer().y;

		const targetLaneIndex = Math.floor(x / this.editor.getCellWidth());
		const targetCellIndex = Math.floor(-absoluteY / this.editor.getCellHeightValue());

		// Validate target position
		if (
			targetLaneIndex >= 0 &&
			targetLaneIndex < this.editor.getLaneConfigs().length &&
			targetCellIndex >= 0 &&
			targetCellIndex < this.editor.getMeasureCount() * this.editor.getCellsPerMeasure()
		) {
			const targetMeasure = Math.floor(targetCellIndex / this.editor.getCellsPerMeasure());
			const targetCellOffset =
				(targetCellIndex % this.editor.getCellsPerMeasure()) /
				this.editor.getCellsPerMeasure();

			// Calculate movement delta from origin note
			const originParsed = parseNoteKey(this.dragOriginNote);
			if (originParsed) {
				const {
					laneIndex: originLaneIndex,
					measure: originMeasure,
					cellOffset: originCellOffset
				} = originParsed;

				const laneOffsetDelta = targetLaneIndex - originLaneIndex;
				const measureOffsetDelta = targetMeasure - originMeasure;
				const cellOffsetDelta = targetCellOffset - originCellOffset;

				// Draw preview for each selected note at their new relative positions
				this.draggedNotes.forEach((noteKey) => {
					const parsed = parseNoteKey(noteKey);
					if (parsed) {
						const {
							laneIndex: currentLaneIndex,
							measure: currentMeasure,
							cellOffset: currentCellOffset
						} = parsed;

						// Calculate new position for this note
						const newLaneIndex = currentLaneIndex + laneOffsetDelta;
						const newMeasure = currentMeasure + measureOffsetDelta;
						const newCellOffset = currentCellOffset + cellOffsetDelta;

						// Only draw preview if the new position is valid
						if (
							newLaneIndex >= 0 &&
							newLaneIndex < this.editor.getLaneConfigs().length &&
							newMeasure >= 0 &&
							newMeasure < this.editor.getMeasureCount() &&
							newCellOffset >= 0 &&
							newCellOffset < 1 &&
							this.dragPreviewGraphics
						) {
							const x =
								this.editor.getOffsetX() +
								this.editor.getCellWidth() * newLaneIndex +
								this.editor.getCellMargin();
							const yOffset = this.editor.getTotalMesaureOffest(newMeasure);
							const cellPosition = Math.floor(
								newCellOffset * this.editor.getCellsPerMeasure()
							);

							let cellsYOffset = 0;
							for (let i = 0; i < cellPosition; i++) {
								cellsYOffset += this.editor.getCellHeightAt(
									newMeasure,
									i % this.editor.getCellsPerMeasure()
								);
							}

							const y =
								this.editor.getOffsetY() -
								(yOffset + cellsYOffset) +
								this.editor.getCellMargin() -
								this.editor.getNoteSize();
							const width =
								this.editor.getCellWidth() - this.editor.getCellMargin() * 2;
							const height =
								this.editor.getNoteSize() - this.editor.getCellMargin() * 2;

							// Draw preview note with different color
							this.dragPreviewGraphics.fillStyle(0xffff00, 0.7); // Yellow with transparency
							this.dragPreviewGraphics.fillRect(x, y, width, height);
							this.dragPreviewGraphics.strokeRect(x, y, width, height);
						}
					}
				});
			}
		}
	}

	/**
	 * Clean up resources when the editor is destroyed
	 */
	destroy(): void {
		this.cleanupDrag();
	}
}
