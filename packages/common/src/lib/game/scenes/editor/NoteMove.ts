import { LaneMeasureNote } from '../../../chart/note.js';
import type { Editor } from '../Editor';
import { type MovedNoteData } from './NoteBuffer';
import Phaser from 'phaser';
import { HIGH_RESOLUTION_CELLS } from '../../utils/notePositioning';

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
		const originParts = this.dragOriginNote.split('-');
		if (originParts.length !== 4) return;

		const originLaneIndex = parseInt(originParts[1]);
		const originMeasure = parseInt(originParts[2]);
		const originCellOffset = parseFloat(originParts[3]);

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

			// Record the move action for undo functionality
			if (moveData.length > 0) {
				this.recordMoveAction(moveData);
			}

			// Execute the note moving operations
			const { movedNotes, unmovableNotes } = this.performMove(notesToMove, deleteNoteByKey);

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
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const oldLaneIndex = parseInt(parts[1]);
				const oldMeasure = parseInt(parts[2]);
				const oldCellOffset = parseFloat(parts[3]);
				const oldLaneId = this.editor.getLaneConfigs()[oldLaneIndex].id;

				// Find the original noteID from the data structure
				const notes = this.editor.getNotes();
				if (oldLaneId in notes) {
					const existingNote = notes[oldLaneId].find(
						(note) =>
							note.measure === oldMeasure &&
							note.notes.some((n) => Math.abs(n.position - oldCellOffset) < 0.001)
					);
					if (existingNote) {
						const noteChip = existingNote.notes.find(
							(n) => Math.abs(n.position - oldCellOffset) < 0.001
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
		this.draggedNotes.forEach((noteKey) => {
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const currentLaneIndex = parseInt(parts[1]);
				const currentMeasure = parseInt(parts[2]);
				const currentCellOffset = parseFloat(parts[3]);

				// Apply the same delta to each note to maintain relative positions
				const newLaneIndex = currentLaneIndex + laneOffsetDelta;
				let newMeasure = currentMeasure + measureOffsetDelta;
				let newCellOffset = currentCellOffset + cellOffsetDelta;

				// Handle measure boundary crossing for cellOffset
				// If cellOffset >= 1.0, move to next measure(s)
				// If cellOffset < 0.0, move to previous measure(s)
				while (newCellOffset >= 1.0) {
					newCellOffset -= 1.0;
					newMeasure += 1;
				}
				while (newCellOffset < 0.0) {
					newCellOffset += 1.0;
					newMeasure -= 1;
				}

				// Validate new position
				if (
					newLaneIndex >= 0 &&
					newLaneIndex < this.editor.getLaneConfigs().length &&
					newMeasure >= 0 &&
					newMeasure < this.editor.getMeasureCount() &&
					newCellOffset >= 0 &&
					newCellOffset < 1
				) {
					const newKey = `note-${newLaneIndex}-${newMeasure}-${newCellOffset}`;
					const existingNote = this.editor.getPanelContainer().getByName(newKey);

					// Only move if target position is empty or we're moving to same position
					// Also check if the existing note is one of the notes we're moving (to allow swapping within selection)
					if (
						!existingNote ||
						newKey === noteKey ||
						this.draggedNotes.has(existingNote.name)
					) {
						notesToMove.push({
							oldKey: noteKey,
							newKey,
							laneIndex: newLaneIndex,
							measure: newMeasure,
							cellOffset: newCellOffset,
							laneId: this.editor.getLaneConfigs()[newLaneIndex].id,
							originalNoteId: originalNoteIds.get(noteKey) || '01'
						});
					}
				}
			}
		});
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
				const oldParts = oldKey.split('-');
				if (oldParts.length === 4) {
					const originalLaneIndex = parseInt(oldParts[1]);
					const originalMeasure = parseInt(oldParts[2]);
					const originalCellOffset = parseFloat(oldParts[3]);
					const originalLaneId = this.editor.getLaneConfigs()[originalLaneIndex].id;

					// No need to capture original pattern data since we work with notes arrays directly

					moveData.push({
						originalNoteKey: oldKey,
						originalLaneIndex,
						originalMeasure,
						originalCellOffset,
						originalLaneId,
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

		// First, remove old notes that are moving
		notesToMove.forEach(({ oldKey }) => {
			deleteNoteByKey(oldKey);
		});

		// Then, add new notes
		notesToMove.forEach(
			({ newKey, laneIndex, measure, cellOffset, laneId, originalNoteId }) => {
				const noteAdded = this.addNoteToEditor(
					measure,
					laneIndex,
					cellOffset,
					laneId,
					originalNoteId
				);

				if (noteAdded) {
					movedNotes.push(newKey);
				}
			}
		);

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
		// Add to display
		const noteAdded = this.editor.drawNote(measure, laneIndex, cellOffset, noteId);
		if (noteAdded) {
			// Add to data structure
			const notes = this.editor.getNotes();
			if (!(laneId in notes)) {
				notes[laneId] = [];
			}

			// Check if a LaneMeasureNote already exists for this measure/lane
			const existingMeasureNote = notes[laneId].find((note) => note.measure === measure);

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
			const originParts = this.dragOriginNote.split('-');
			if (originParts.length === 4) {
				const originLaneIndex = parseInt(originParts[1]);
				const originMeasure = parseInt(originParts[2]);
				const originCellOffset = parseFloat(originParts[3]);

				const laneOffsetDelta = targetLaneIndex - originLaneIndex;
				const measureOffsetDelta = targetMeasure - originMeasure;
				const cellOffsetDelta = targetCellOffset - originCellOffset;

				// Draw preview for each selected note at their new relative positions
				this.draggedNotes.forEach((noteKey) => {
					const parts = noteKey.split('-');
					if (parts.length === 4) {
						const currentLaneIndex = parseInt(parts[1]);
						const currentMeasure = parseInt(parts[2]);
						const currentCellOffset = parseFloat(parts[3]);

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
