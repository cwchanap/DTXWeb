import { LaneMeasureNote, normalizePosition } from '@dtx/common';
import type { Editor } from '../Editor';
import { NoteBuffer, type DeletedNoteData } from './NoteBuffer';
import Phaser from 'phaser';

/**
 * Manages all note-related operations in the DTX editor including:
 * - Note selection (single and multi-select)
 * - Note dragging and moving
 * - Note deletion
 * - Undo/redo functionality
 */
export class NoteManager {
	private editor: Editor;
	private noteBuffer = new NoteBuffer();

	// Selection state
	public selectedNotes: Set<string> = new Set();
	public isSelecting = false;
	public selectionStartX = 0;
	public selectionStartY = 0;
	public selectionRectangle!: Phaser.GameObjects.Rectangle;

	// Drag state
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private draggedNotes: Set<string> = new Set();
	private dragOriginNote: string = '';
	private dragPreviewGraphics: Phaser.GameObjects.Graphics | null = null;

	constructor(editor: Editor) {
		this.editor = editor;
	}

	/**
	 * Initialize the selection rectangle graphics after the scene is created
	 */
	public initialize() {
		this.initializeSelectionRectangle();
	}

	/**
	 * Initialize the selection rectangle graphics
	 */
	private initializeSelectionRectangle() {
		this.selectionRectangle = this.editor.add.rectangle(0, 0, 0, 0, 0x1d7196, 0.3);
		this.selectionRectangle.setStrokeStyle(2, 0x1d7196, 1);
		this.selectionRectangle.setVisible(false);
	}

	/**
	 * Record a delete action for undo functionality
	 */
	recordDeleteAction(deletedNotes: DeletedNoteData[]): void {
		this.noteBuffer.recordAction('delete', deletedNotes);
	}

	/**
	 * Handle pointer down events for note operations
	 */
	handlePointerDown(pointer: Phaser.Input.Pointer): boolean {
		if (this.editor.getIsEditing()) {
			return false; // Don't handle note operations in edit mode
		}

		// Check if user clicked on an existing note for single selection
		const clickedNote = this.getClickedNote(pointer);

		if (clickedNote) {
			// Check if the clicked note is already selected
			if (this.selectedNotes.has(clickedNote.name)) {
				// Start drag operation if clicking on selected note
				this.startDrag(pointer, clickedNote.name);
				return true;
			} else {
				// Single note selection
				this.clearSelection();
				this.selectedNotes.add(clickedNote.name);
				this.highlightSelectedNote(clickedNote);
				return true;
			}
		}

		// Start drag selection if no note was clicked
		this.startSelection(pointer);
		return true;
	}

	/**
	 * Handle pointer move events for note operations
	 */
	handlePointerMove(pointer: Phaser.Input.Pointer): void {
		if (this.isDragging) {
			this.updateDrag();
		} else if (this.isSelecting) {
			this.updateSelectionRectangle(pointer);
			this.updateSelectedNotes();
		}
	}

	/**
	 * Handle pointer up events for note operations
	 */
	handlePointerUp(): void {
		if (this.isDragging) {
			this.completeDrag();
		} else if (this.isSelecting) {
			this.isSelecting = false;
			this.selectionRectangle.setVisible(false);
			// Keep selected notes highlighted for future actions
		}
	}

	/**
	 * Delete all currently selected notes
	 */
	deleteSelectedNotes(): void {
		if (this.selectedNotes.size === 0) return;

		// Collect all notes that will be deleted for undo functionality
		const deletedNotes: DeletedNoteData[] = [];
		const notesToDelete: { noteKey: string; deletedNoteData: DeletedNoteData | null }[] = [];

		// Create a snapshot of all LaneMeasureNote patterns before any modifications
		// This ensures we have clean original data for undo operations
		const notes = this.editor.getNotes();
		const patternSnapshots = new Map<string, Map<number, string>>();
		Object.entries(notes).forEach(([laneId, laneMeasureNotes]) => {
			const measureMap = new Map<number, string>();
			laneMeasureNotes.forEach((note) => {
				measureMap.set(note.measure, note.pattern);
			});
			patternSnapshots.set(laneId, measureMap);
		});

		this.selectedNotes.forEach((noteKey) => {
			// Parse the note key to get the position info: "note-{laneIndex}-{measure}-{cellOffset}"
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const rawCellOffset = parseFloat(parts[3]);
				const cellOffset = rawCellOffset;
				const laneId = this.editor.getLaneConfigs()[laneIndex].id;

				// Find the note data before deleting it
				if (laneId in notes) {
					// Normalize the cellOffset to match how positions are stored in the data structure
					const normalizedCellOffset = normalizePosition(
						cellOffset,
						this.editor.getCellsPerMeasure()
					);

					const existingNote = notes[laneId].find(
						(note) =>
							note.measure === measure &&
							note.notes.some(
								(n) => Math.abs(n.position - normalizedCellOffset) < 0.001
							)
					);

					if (existingNote) {
						// Find the specific note chip using normalized position
						const noteChip = existingNote.notes.find(
							(n) => Math.abs(n.position - normalizedCellOffset) < 0.001
						);

						if (noteChip) {
							// Get the original pattern from our clean snapshot
							const originalPattern =
								patternSnapshots.get(laneId)?.get(measure) || existingNote.pattern;

							// Store the note data for undo (without object references to avoid stale data)
							const deletedNoteData = {
								noteKey,
								laneIndex,
								measure,
								cellOffset: normalizedCellOffset, // Use normalized position for consistency
								laneId,
								noteId: noteChip.noteID,
								originalPattern: originalPattern, // Use clean snapshot
								measureLength: existingNote.measureLength
							};
							deletedNotes.push(deletedNoteData);
							notesToDelete.push({ noteKey, deletedNoteData });
						} else {
							notesToDelete.push({ noteKey, deletedNoteData: null });
						}
					} else {
						// This is an orphaned visual note - it exists in the UI but not in the data structure
						// We should still delete it visually, but we can't restore it during undo
						notesToDelete.push({ noteKey, deletedNoteData: null });
					}
				} else {
					notesToDelete.push({ noteKey, deletedNoteData: null });
				}
			}
		});

		// Record undo action before deleting
		if (deletedNotes.length > 0) {
			this.noteBuffer.recordAction('delete', deletedNotes);
		}

		// Delete each note using the captured data to avoid race conditions
		notesToDelete.forEach(({ noteKey, deletedNoteData }) => {
			if (deletedNoteData) {
				// Use the captured data to delete the note directly
				this.deleteNoteByKeyWithData(noteKey, deletedNoteData);
			} else {
				// If no data was captured, only delete visually
				this.deleteNoteVisually(noteKey);
			}
		});

		// Clear the selection after deletion
		this.selectedNotes.clear();
	}

	/**
	 * Delete a note using captured data to avoid race conditions
	 */
	private deleteNoteByKeyWithData(noteKey: string, deletedNoteData: DeletedNoteData): void {
		// Remove the note graphics from the display
		const noteGraphics = this.editor.getPanelContainer().getByName(noteKey);
		if (noteGraphics) {
			noteGraphics.destroy();
		}

		// Remove the note text from the display
		const keyParts = noteKey.split('-');
		if (keyParts.length === 4) {
			const textKey = `text-${keyParts[1]}-${keyParts[2]}-${keyParts[3]}`;
			const noteText = this.editor.getPanelContainer().getByName(textKey);
			if (noteText) {
				noteText.destroy();
			}
		}

		// Remove selection overlay if it exists
		const overlayKey = `selection-overlay-${noteKey}`;
		const overlay = this.editor.getPanelContainer().getByName(overlayKey);
		if (overlay) {
			overlay.destroy();
		}

		// Find and update the LaneMeasureNote in the current data structure
		const notes = this.editor.getNotes();
		if (deletedNoteData.laneId in notes) {
			const measureNote = notes[deletedNoteData.laneId].find(
				(note) => note.measure === deletedNoteData.measure
			);

			if (measureNote) {
				// Remove the specific note from the pattern
				const patternLength = this.editor.getCellsPerMeasure();
				const expectedNotePosition = Math.round(deletedNoteData.cellOffset * patternLength);
				const expectedStartIndex = expectedNotePosition * 2;
				const expectedPatternStringLength = patternLength * 2; // Each position takes 2 characters

				// Ensure we have a full-length pattern to work with
				let pattern = measureNote.pattern;
				if (pattern.length < expectedPatternStringLength) {
					pattern = pattern.padEnd(expectedPatternStringLength, '0');
				}

				// Search for the note to delete
				let actualStartIndex = -1;

				// First, try the expected position
				if (expectedStartIndex >= 0 && expectedStartIndex < pattern.length - 1) {
					const noteAtExpectedPosition = pattern.substring(
						expectedStartIndex,
						expectedStartIndex + 2
					);

					if (noteAtExpectedPosition === deletedNoteData.noteId) {
						// Note found at expected position, use it
						actualStartIndex = expectedStartIndex;
					}
				}

				// If not found at expected position, search for it in the pattern
				if (actualStartIndex === -1) {
					const searchIndex = pattern.indexOf(deletedNoteData.noteId);
					if (searchIndex >= 0 && searchIndex % 2 === 0) {
						actualStartIndex = searchIndex;
					}
				}

				// If we found the note, delete it
				if (actualStartIndex >= 0) {
					// Replace the note with '00'
					pattern =
						pattern.substring(0, actualStartIndex) +
						'00' +
						pattern.substring(actualStartIndex + 2);

					measureNote.pattern = pattern;
					measureNote.parseNote(); // Reparse to update notes array
				} else {
					return; // Note already deleted or not found
				}

				// If the measure is now empty, remove the entire LaneMeasureNote
				if (measureNote.notes.length === 0) {
					notes[deletedNoteData.laneId] = notes[deletedNoteData.laneId].filter(
						(note) => note !== measureNote
					);

					// Clean up empty lane entries
					if (notes[deletedNoteData.laneId].length === 0) {
						delete notes[deletedNoteData.laneId];
					}
				}
			}
		}
	}

	/**
	 * Delete a note visually only (when data capture failed or note is orphaned)
	 */
	private deleteNoteVisually(noteKey: string): void {
		// Remove the note graphics from the display
		const noteGraphics = this.editor.getPanelContainer().getByName(noteKey);
		if (noteGraphics) {
			noteGraphics.destroy();
		}

		// Remove the note text from the display
		const keyParts = noteKey.split('-');
		if (keyParts.length === 4) {
			const textKey = `text-${keyParts[1]}-${keyParts[2]}-${keyParts[3]}`;
			const noteText = this.editor.getPanelContainer().getByName(textKey);
			if (noteText) {
				noteText.destroy();
			}
		}

		// Remove selection overlay if it exists
		const overlayKey = `selection-overlay-${noteKey}`;
		const overlay = this.editor.getPanelContainer().getByName(overlayKey);
		if (overlay) {
			overlay.destroy();
		}
	}

	/**
	 * Delete a single note by its key
	 */
	private deleteNoteByKey(noteKey: string): void {
		// Remove the note graphics from the display
		const noteGraphics = this.editor.getPanelContainer().getByName(noteKey);
		if (noteGraphics) {
			noteGraphics.destroy();
		}

		// Remove the note text from the display
		const keyParts = noteKey.split('-');
		if (keyParts.length === 4) {
			const textKey = `text-${keyParts[1]}-${keyParts[2]}-${keyParts[3]}`;
			const noteText = this.editor.getPanelContainer().getByName(textKey);
			if (noteText) {
				noteText.destroy();
			}
		}

		// Remove selection overlay if it exists
		const overlayKey = `selection-overlay-${noteKey}`;
		const overlay = this.editor.getPanelContainer().getByName(overlayKey);
		if (overlay) {
			overlay.destroy();
		}

		// Parse the note key to get the position info
		const parts = noteKey.split('-');
		if (parts.length === 4) {
			const laneIndex = parseInt(parts[1]);
			const measure = parseInt(parts[2]);
			const rawCellOffset = parseFloat(parts[3]);
			// Use the raw position for now to debug
			const cellOffset = rawCellOffset;
			const laneId = this.editor.getLaneConfigs()[laneIndex].id;

			// Remove the specific note from this.notes
			const notes = this.editor.getNotes();
			if (laneId in notes) {
				// Find the LaneMeasureNote that contains this note
				const measureNote = notes[laneId].find(
					(note) =>
						note.measure === measure &&
						note.notes.some((n) => Math.abs(n.position - cellOffset) < 0.001)
				);

				if (measureNote) {
					// Remove the specific note from the pattern
					const patternLength = this.editor.getCellsPerMeasure();
					const notePosition = Math.round(cellOffset * patternLength);
					const startIndex = notePosition * 2;

					// Replace the note with '00'
					let pattern = measureNote.pattern;
					pattern =
						pattern.substring(0, startIndex) + '00' + pattern.substring(startIndex + 2);
					measureNote.pattern = pattern;
					measureNote.parseNote(); // Reparse to update notes array

					// If the measure is now empty, remove the entire LaneMeasureNote
					if (measureNote.notes.length === 0) {
						notes[laneId] = notes[laneId].filter((note) => note !== measureNote);
					}
				}

				// Clean up empty lane entries
				if (notes[laneId].length === 0) {
					delete notes[laneId];
				}
			}
		}
	}

	/**
	 * Clear current selection and remove visual highlighting
	 */
	clearSelection(): void {
		// Remove selection overlays for previously selected notes
		this.selectedNotes.forEach((noteKey) => {
			const overlayKey = `selection-overlay-${noteKey}`;
			const overlay = this.editor.getPanelContainer().getByName(overlayKey);
			if (overlay) {
				overlay.destroy();
			}
		});
		this.selectedNotes.clear();
	}

	/**
	 * Highlight a selected note with a border overlay
	 */
	private highlightSelectedNote(noteGraphics: { name: string }): void {
		// Calculate the note bounds to draw the highlight border
		const bounds = this.calculateNoteBounds(noteGraphics.name);

		if (bounds) {
			// Create a separate graphics object for the selection overlay
			const overlayKey = `selection-overlay-${noteGraphics.name}`;
			const existingOverlay = this.editor.getPanelContainer().getByName(overlayKey);

			// Remove existing overlay if it exists
			if (existingOverlay) {
				existingOverlay.destroy();
			}

			// Create new selection overlay
			const overlay = this.editor.add.graphics();
			overlay.lineStyle(3, 0xffff00, 1);

			// Calculate the note position in container space (same as how notes are drawn)
			const parts = noteGraphics.name.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);

				// Use the same positioning logic as BaseGame.drawNote
				const x =
					this.editor.getOffsetX() +
					this.editor.getCellWidth() * laneIndex +
					this.editor.getCellMargin();
				const yOffset = this.editor.getTotalMesaureOffest(measure);
				const cellPosition = Math.floor(cellOffset * this.editor.getCellsPerMeasure());

				let cellsYOffset = 0;
				for (let i = 0; i < cellPosition; i++) {
					cellsYOffset += this.editor.getCellHeightAt(
						measure,
						i % this.editor.getCellsPerMeasure()
					);
				}

				const y =
					this.editor.getOffsetY() -
					(yOffset + cellsYOffset) +
					this.editor.getCellMargin() -
					this.editor.getNoteSize();
				const width = this.editor.getCellWidth() - this.editor.getCellMargin() * 2;
				const height = this.editor.getNoteSize() - this.editor.getCellMargin() * 2;

				overlay.strokeRect(x, y, width, height);
				overlay.setName(overlayKey);
				this.editor.getPanelContainer().add(overlay);
			}
		}
	}

	/**
	 * Start selection rectangle operation
	 */
	private startSelection(pointer: Phaser.Input.Pointer): void {
		this.isSelecting = true;
		this.selectionStartX = pointer.x;
		this.selectionStartY = pointer.y;

		// Clear previous selection
		this.clearSelection();

		// Position and show selection rectangle
		this.selectionRectangle.setPosition(pointer.x, pointer.y);
		this.selectionRectangle.setSize(0, 0);
		this.selectionRectangle.setVisible(true);
	}

	/**
	 * Update selection rectangle size and position
	 */
	private updateSelectionRectangle(pointer: Phaser.Input.Pointer): void {
		// Calculate the width and height from start position to current position
		const width = pointer.x - this.selectionStartX;
		const height = pointer.y - this.selectionStartY;

		// Update the rectangle size
		this.selectionRectangle.setSize(Math.abs(width), Math.abs(height));

		// Update position to handle reverse dragging
		const x = width < 0 ? pointer.x : this.selectionStartX;
		const y = height < 0 ? pointer.y : this.selectionStartY;
		this.selectionRectangle.setPosition(x + Math.abs(width) / 2, y + Math.abs(height) / 2);
	}

	/**
	 * Update which notes are selected based on selection rectangle
	 */
	private updateSelectedNotes(): void {
		// Clear previous selection highlighting
		this.clearSelection();

		// Create a rectangle for overlap detection
		const width = Math.abs(this.selectionRectangle.width);
		const height = Math.abs(this.selectionRectangle.height);
		const x = this.selectionRectangle.x - width / 2;
		const y = this.selectionRectangle.y - height / 2;

		const selectionRect = new Phaser.Geom.Rectangle(x, y, width, height);

		// Find all note graphics that overlap with the selection rectangle
		const selectedNoteKeys = new Set<string>();
		this.editor.getPanelContainer().list.forEach((child) => {
			if (
				child.name &&
				child.name.startsWith('note-') &&
				child instanceof Phaser.GameObjects.Graphics
			) {
				// Calculate note bounds manually based on how notes are drawn
				const noteBounds = this.calculateNoteBounds(child.name);

				// Check if the note overlaps with the selection rectangle
				if (noteBounds && Phaser.Geom.Rectangle.Overlaps(selectionRect, noteBounds)) {
					selectedNoteKeys.add(child.name);
				}
			}
		});

		// Add all selected notes and highlight them
		selectedNoteKeys.forEach((noteKey) => {
			this.selectedNotes.add(noteKey);
			const noteGraphics = this.editor.getPanelContainer().getByName(noteKey);
			if (noteGraphics) {
				this.highlightSelectedNote(noteGraphics);
			}
		});
	}

	/**
	 * Calculate the bounds of a note based on its key
	 */
	public calculateNoteBounds(noteKey: string): Phaser.Geom.Rectangle | null {
		// Parse note key to get position info: "note-{laneIndex}-{measure}-{cellOffset}"
		const parts = noteKey.split('-');
		if (parts.length !== 4) return null;

		const laneIndex = parseInt(parts[1]);
		const measure = parseInt(parts[2]);
		const rawCellOffset = parseFloat(parts[3]);
		// Use the raw position for now to debug
		const cellOffset = rawCellOffset;

		// Use the exact same logic as BaseGame.drawNote method
		const x =
			this.editor.getOffsetX() +
			this.editor.getCellWidth() * laneIndex +
			this.editor.getCellMargin();

		// Calculate Y position based on measure offset and cell position
		const yOffset = this.editor.getTotalMesaureOffest(measure);

		// Calculate the position within the measure
		const cellPosition = Math.floor(cellOffset * this.editor.getCellsPerMeasure());

		// Add offsets for each cell up to the note position
		let cellsYOffset = 0;
		for (let i = 0; i < cellPosition; i++) {
			cellsYOffset += this.editor.getCellHeightAt(
				measure,
				i % this.editor.getCellsPerMeasure()
			);
		}

		const y =
			this.editor.getOffsetY() -
			(yOffset + cellsYOffset) +
			this.editor.getCellMargin() -
			this.editor.getNoteSize();

		const width = this.editor.getCellWidth() - this.editor.getCellMargin() * 2;
		const height = this.editor.getNoteSize() - this.editor.getCellMargin() * 2;

		// Account for panelContainer position (scrolling)
		const adjustedY = y + this.editor.getPanelContainer().y;

		return new Phaser.Geom.Rectangle(x, adjustedY, width, height);
	}

	/**
	 * Get the note that was clicked by the pointer
	 */
	private getClickedNote(pointer: Phaser.Input.Pointer): Phaser.GameObjects.Graphics | null {
		// Check all notes to see if the pointer clicked on one
		let clickedNote: Phaser.GameObjects.Graphics | null = null;

		this.editor.getPanelContainer().list.forEach((child) => {
			if (
				child.name &&
				child.name.startsWith('note-') &&
				child instanceof Phaser.GameObjects.Graphics
			) {
				// Calculate note bounds
				const noteBounds = this.calculateNoteBounds(child.name);

				if (noteBounds) {
					// Check if the pointer is within the note bounds
					if (
						pointer.x >= noteBounds.x &&
						pointer.x <= noteBounds.x + noteBounds.width &&
						pointer.y >= noteBounds.y &&
						pointer.y <= noteBounds.y + noteBounds.height
					) {
						clickedNote = child;
					}
				}
			}
		});

		return clickedNote;
	}

	/**
	 * Start drag operation
	 */
	private startDrag(pointer: Phaser.Input.Pointer, originNoteKey: string): void {
		this.isDragging = true;
		this.dragStartX = pointer.x;
		this.dragStartY = pointer.y;
		this.dragOriginNote = originNoteKey;

		// Copy selected notes to dragged notes
		this.draggedNotes = new Set(this.selectedNotes);

		// Create drag preview graphics
		this.createDragPreview();
	}

	/**
	 * Update drag operation
	 */
	private updateDrag(): void {
		if (!this.isDragging || !this.dragPreviewGraphics) return;

		// Update the drag preview to show all notes moving together
		this.updateDragPreview();
	}

	/**
	 * Complete drag operation and move notes to new positions
	 */
	private completeDrag(): void {
		if (!this.isDragging) return;

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

			// Move each dragged note
			this.moveNotesToPosition(targetLaneIndex, targetMeasure, targetCellOffset);
		}

		// Clean up drag state
		this.cleanupDrag();
	}

	/**
	 * Move notes to specified position maintaining relative positions
	 */
	private moveNotesToPosition(
		targetLaneIndex: number,
		targetMeasure: number,
		targetCellOffset: number
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

		// First, collect original noteIDs for all notes that will be moved
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

		// Calculate new positions for all selected notes based on the delta
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

		// Allow partial movement - move notes that can be moved, leave others in place
		if (notesToMove.length > 0) {
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
				this.deleteNoteByKey(oldKey);
			});

			// Then, add new notes
			notesToMove.forEach(
				({ newKey, laneIndex, measure, cellOffset, laneId, originalNoteId }) => {
					// Add to display
					const noteAdded = this.editor.drawNote(
						measure,
						laneIndex,
						cellOffset,
						originalNoteId
					);

					if (noteAdded) {
						// Add to data - use the correct lane-based data structure
						const notes = this.editor.getNotes();
						if (!(laneId in notes)) {
							notes[laneId] = [];
						}

						// Check if a LaneMeasureNote already exists for this measure/lane
						const existingMeasureNote = notes[laneId].find(
							(note) => note.measure === measure
						);

						if (existingMeasureNote) {
							// Add note to existing measure
							const patternLength = this.editor.getCellsPerMeasure();
							const notePosition = Math.round(cellOffset * patternLength);
							const startIndex = notePosition * 2;
							let pattern = existingMeasureNote.pattern;

							// Place the note in the existing pattern
							pattern =
								pattern.substring(0, startIndex) +
								originalNoteId +
								pattern.substring(startIndex + 2);

							existingMeasureNote.pattern = pattern;
							existingMeasureNote.parseNote(); // Reparse to update notes array
						} else {
							// Create a new LaneMeasureNote for this measure
							const patternLength = this.editor.getCellsPerMeasure();
							const notePosition = Math.round(cellOffset * patternLength);
							let pattern = '00'.repeat(patternLength);

							// Place the original noteId at the correct position
							const startIndex = notePosition * 2;
							pattern =
								pattern.substring(0, startIndex) +
								originalNoteId +
								pattern.substring(startIndex + 2);

							notes[laneId].push(new LaneMeasureNote(measure, laneId, pattern));
						}
						movedNotes.push(newKey);
					}
				}
			);

			// Update selection to include both moved and unmoved notes
			this.clearSelection();

			// Add moved notes to selection
			movedNotes.forEach((newKey) => {
				this.selectedNotes.add(newKey);
				const noteGraphics = this.editor.getPanelContainer().getByName(newKey);
				if (noteGraphics && noteGraphics instanceof Phaser.GameObjects.Graphics) {
					this.highlightSelectedNote(noteGraphics);
				}
			});

			// Keep unmovable notes in selection at their original positions
			unmovableNotes.forEach((noteKey) => {
				this.selectedNotes.add(noteKey);
				const noteGraphics = this.editor.getPanelContainer().getByName(noteKey);
				if (noteGraphics && noteGraphics instanceof Phaser.GameObjects.Graphics) {
					this.highlightSelectedNote(noteGraphics);
				}
			});
		}
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
				this.selectedNotes.forEach((noteKey) => {
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
	 * Clean up drag state and graphics
	 */
	private cleanupDrag(): void {
		this.isDragging = false;
		this.draggedNotes.clear();
		this.dragOriginNote = '';

		if (this.dragPreviewGraphics) {
			this.dragPreviewGraphics.destroy();
			this.dragPreviewGraphics = null;
		}
	}

	/**
	 * Handle undo operation
	 */
	undoLastAction(): void {
		this.noteBuffer.undoLastAction(this.editor);
	}

	/**
	 * Clear undo history
	 */
	clearUndoHistory(): void {
		this.noteBuffer.clearHistory();
	}

	/**
	 * Clean up resources when the editor is destroyed
	 */
	destroy(): void {
		this.cleanupDrag();
		if (this.selectionRectangle && typeof this.selectionRectangle.destroy === 'function') {
			this.selectionRectangle.destroy();
		}
		this.selectedNotes.clear();
		this.noteBuffer.clearHistory();
	}
}
