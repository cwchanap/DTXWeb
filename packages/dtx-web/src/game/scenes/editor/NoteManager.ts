import { normalizePosition } from '@dtx/common';
import type { Editor } from '../Editor';
import { NoteBuffer, type DeletedNoteData, type MovedNoteData } from './NoteBuffer';
import { NoteCopy } from './NoteCopy';
import { NoteMove } from './NoteMove';
import Phaser from 'phaser';

/**
 * Manages all note-related operations in the DTX editor including:
 * - Note selection (single and multi-select)
 * - Note deletion
 * - Undo/redo functionality
 * - Copy/paste operations
 */
export class NoteManager {
	private editor: Editor;
	private noteBuffer = new NoteBuffer();
	private noteMove: NoteMove;
	private noteCopy: NoteCopy;

	// Selection state
	public selectedNotes: Set<string> = new Set();

	// Debounce for keyboard shortcuts
	private lastKeyboardAction = 0;
	private KEYBOARD_DEBOUNCE_MS = 200;

	// Track current mouse position for cursor-based pasting
	private lastMouseX = 0;
	private lastMouseY = 0;
	public isSelecting = false;
	public selectionStartX = 0;
	public selectionStartY = 0;
	public selectionRectangle!: Phaser.GameObjects.Rectangle;

	// Event listener references for cleanup
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private mousemoveHandler: ((event: MouseEvent) => void) | null = null;

	constructor(editor: Editor) {
		this.editor = editor;
		this.noteMove = new NoteMove(editor, (movedNotes) => this.recordMoveAction(movedNotes));
		this.noteCopy = new NoteCopy(this.noteMove, (noteKeys) => this.findReferenceNote(noteKeys));
		this.noteBuffer.setNoteMove(this.noteMove);
	}

	/**
	 * Initialize the selection rectangle graphics after the scene is created
	 */
	public initialize() {
		this.initializeSelectionRectangle();
		this.initializeKeyboardEvents();
		this.initializeMouseTracking();
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
	 * Initialize keyboard event handlers for copy/paste operations
	 */
	private initializeKeyboardEvents() {
		// Only set up keyboard events in non-test environments
		if (typeof window === 'undefined' || typeof document === 'undefined') {
			return;
		}

		// Always use global keyboard events for system-level shortcuts
		// This is more reliable for Ctrl/Cmd combinations
		this.keydownHandler = (event: KeyboardEvent) => {
			// Only handle shortcuts if the game canvas or editor is focused
			const target = event.target as HTMLElement;
			const isGameCanvas = target?.tagName === 'CANVAS' || target?.closest('canvas');
			const isEditorFocused =
				document.activeElement?.tagName === 'CANVAS' ||
				document.activeElement === document.body;

			if (isGameCanvas || isEditorFocused) {
				// Debounce keyboard shortcuts to prevent key repeat issues
				const now = Date.now();
				if (now - this.lastKeyboardAction < this.KEYBOARD_DEBOUNCE_MS) {
					return;
				}

				// Check for Ctrl+C or Cmd+C (copy)
				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
					event.preventDefault();
					event.stopPropagation();
					this.lastKeyboardAction = now;
					this.copySelectedNotes();
					return false;
				}

				// Check for Ctrl+X or Cmd+X (cut)
				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
					event.preventDefault();
					event.stopPropagation();
					this.lastKeyboardAction = now;
					this.cutSelectedNotes();
					return false;
				}

				// Check for Ctrl+V or Cmd+V (paste)
				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
					event.preventDefault();
					event.stopPropagation();
					this.lastKeyboardAction = now;
					this.pasteNotes();
					return false;
				}
			}
		};

		// Add global event listener
		document.addEventListener('keydown', this.keydownHandler, true); // Use capture phase

		// Also try Phaser keyboard as fallback
		if (this.editor.input?.keyboard) {
			this.editor.input.keyboard.on('keydown', this.keydownHandler);
		}
	}

	/**
	 * Initialize mouse position tracking for cursor-based pasting
	 */
	private initializeMouseTracking() {
		// Only set up mouse tracking in non-test environments
		if (typeof window === 'undefined' || typeof document === 'undefined') {
			return;
		}

		// Track mouse movement globally to maintain cursor position
		this.mousemoveHandler = (event: MouseEvent) => {
			// Try multiple ways to get the canvas element
			let canvas: HTMLCanvasElement | null = this.editor.game?.canvas || null;
			if (!canvas) {
				// Fallback: try to find canvas in the DOM
				canvas = document.querySelector('canvas');
			}

			if (canvas) {
				const rect = canvas.getBoundingClientRect();
				// Convert screen coordinates to canvas-relative coordinates
				this.lastMouseX = event.clientX - rect.left;
				this.lastMouseY = event.clientY - rect.top;
			}
		};

		document.addEventListener('mousemove', this.mousemoveHandler);
	}

	/**
	 * Get current cursor position in game coordinates
	 */
	private getCurrentCursorPosition() {
		// Try to get current pointer position from Phaser input system first
		let mouseX = this.lastMouseX;
		let mouseY = this.lastMouseY;

		// Fallback to Phaser's active pointer if available
		if (this.editor.input?.activePointer) {
			mouseX =
				this.editor.input.activePointer.x !== undefined
					? this.editor.input.activePointer.x
					: mouseX;
			mouseY =
				this.editor.input.activePointer.y !== undefined
					? this.editor.input.activePointer.y
					: mouseY;
		}

		// Use the EXACT same calculation as Editor's pointerdown handler
		const offsetX = this.editor.getOffsetX();
		const offsetY = this.editor.getOffsetY();
		const panelContainer = this.editor.getPanelContainer();

		// Calculate positions using the same logic as Editor click detection
		const x = mouseX - offsetX;
		const absoluteY = mouseY - offsetY - panelContainer.y;

		// Calculate lane index and cell index (note: Y is negated)
		const cellWidth = this.editor.getCellWidth();
		const cellHeight = this.editor.getCellHeightValue();
		const cellsPerMeasure = this.editor.getCellsPerMeasure();

		const laneIndex = Math.floor(x / cellWidth);
		const cellIndex = Math.floor(-absoluteY / cellHeight);
		const measure = Math.floor(cellIndex / cellsPerMeasure);
		const rawCellOffset = (cellIndex % cellsPerMeasure) / cellsPerMeasure;
		const cellOffset = normalizePosition(rawCellOffset, cellsPerMeasure);

		return {
			laneIndex: Math.max(0, laneIndex),
			measure: Math.max(0, measure),
			cellOffset: Math.max(0, Math.min(1, cellOffset))
		};
	}

	/**
	 * Record a delete action for undo functionality
	 */
	recordDeleteAction(deletedNotes: DeletedNoteData[]): void {
		this.noteBuffer.recordAction('delete', deletedNotes);
	}

	/**
	 * Record a move action for undo functionality
	 */
	recordMoveAction(movedNotes: MovedNoteData[]): void {
		this.noteBuffer.recordAction('move', movedNotes);
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
				this.noteMove.startDrag(pointer, clickedNote.name, this.selectedNotes);
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
		if (this.noteMove.isCurrentlyDragging) {
			this.noteMove.updateDrag();
		} else if (this.isSelecting) {
			this.updateSelectionRectangle(pointer);
			this.updateSelectedNotes();
		}
	}

	/**
	 * Handle pointer up events for note operations
	 */
	handlePointerUp(): void {
		if (this.noteMove.isCurrentlyDragging) {
			this.noteMove.completeDrag(
				this.selectedNotes,
				() => this.clearSelection(),
				(noteGraphics) => this.highlightSelectedNote(noteGraphics),
				(noteKey) => this.deleteNoteByKey(noteKey)
			);
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
		this.cleanupNoteVisuals(noteKey);

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
	 * Helper method to clean up visual elements for a note
	 */
	private cleanupNoteVisuals(noteKey: string): void {
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
	 * Delete a note visually only (when data capture failed or note is orphaned)
	 */
	private deleteNoteVisually(noteKey: string): void {
		this.cleanupNoteVisuals(noteKey);
	}

	/**
	 * Delete a single note by its key
	 */
	public deleteNoteByKey(noteKey: string): void {
		this.cleanupNoteVisuals(noteKey);

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
	public highlightSelectedNote(noteGraphics: { name: string }): void {
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
	 * Handle undo operation
	 */
	undoLastAction(): void {
		this.noteBuffer.undoLastAction(this.editor);
	}

	/**
	 * Find the reference note from a set of note keys using priority:
	 * 1) smallest measure, 2) smallest cellOffset, 3) rightmost lane (highest lane index)
	 */
	public findReferenceNote(
		noteKeys: Set<string>
	): { laneIndex: number; measure: number; cellOffset: number } | null {
		if (noteKeys.size === 0) {
			return null;
		}

		let referenceLaneIndex = Number.MIN_SAFE_INTEGER;
		let referenceMeasure = Number.MAX_SAFE_INTEGER;
		let referenceCellOffset = Number.MAX_SAFE_INTEGER;

		noteKeys.forEach((noteKey) => {
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);

				// Priority: 1) smallest measure, 2) smallest cellOffset, 3) rightmost lane (highest lane index)
				if (
					measure < referenceMeasure ||
					(measure === referenceMeasure && cellOffset < referenceCellOffset) ||
					(measure === referenceMeasure &&
						cellOffset === referenceCellOffset &&
						laneIndex > referenceLaneIndex)
				) {
					referenceLaneIndex = laneIndex;
					referenceMeasure = measure;
					referenceCellOffset = cellOffset;
				}
			}
		});

		// Return null if no valid reference was found
		if (referenceMeasure === Number.MAX_SAFE_INTEGER) {
			return null;
		}

		return {
			laneIndex: referenceLaneIndex,
			measure: referenceMeasure,
			cellOffset: referenceCellOffset
		};
	}

	/**
	 * Copy currently selected notes to clipboard
	 */
	copySelectedNotes(): boolean {
		const result = this.noteCopy.copyNotes(this.selectedNotes, this.editor);
		if (result) {
			// Clear selection after successful copy to avoid paste conflicts
			this.clearSelection();
		}
		return result;
	}

	/**
	 * Cut currently selected notes to clipboard (copy + delete originals)
	 */
	cutSelectedNotes(): boolean {
		if (this.selectedNotes.size === 0) {
			return false;
		}

		const result = this.noteCopy.cutNotes(this.selectedNotes, this.editor, (noteKey) =>
			this.deleteNoteByKey(noteKey)
		);

		if (result) {
			// Clear selection after successful cut (notes are already deleted)
			this.clearSelection();
		}
		return result;
	}

	/**
	 * Paste copied notes at the current cursor position or at the lowest selected note position
	 */
	pasteNotes(): boolean {
		// Determine paste position
		let pasteLaneIndex = 0;
		let pasteMeasure = 0;
		let pasteCellOffset = 0;

		if (this.selectedNotes.size > 0) {
			// Use the shared reference note finding logic
			const referenceNote = this.findReferenceNote(this.selectedNotes);
			if (referenceNote) {
				pasteLaneIndex = referenceNote.laneIndex;
				pasteMeasure = referenceNote.measure;
				pasteCellOffset = referenceNote.cellOffset;
			}
		} else {
			// Default paste position - use actual cursor position
			const cursorPosition = this.getCurrentCursorPosition();

			pasteLaneIndex = cursorPosition.laneIndex;
			pasteMeasure = cursorPosition.measure;
			pasteCellOffset = cursorPosition.cellOffset;
		}
		const result = this.noteCopy.pasteNotes(
			pasteLaneIndex,
			pasteMeasure,
			pasteCellOffset,
			this.editor
		);

		if (result) {
			// Clear current selection and potentially select pasted notes
			// For now, just clear selection to avoid complexity
			this.clearSelection();
		}

		return result;
	}

	/**
	 * Check if there are notes in the clipboard
	 */
	hasClipboard(): boolean {
		return this.noteCopy.hasClipboard();
	}

	/**
	 * Clear the note clipboard
	 */
	clearClipboard(): void {
		this.noteCopy.clearClipboard();
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
		// Clean up event listeners
		if (this.keydownHandler && typeof document !== 'undefined') {
			document.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = null;
		}

		if (this.mousemoveHandler && typeof document !== 'undefined') {
			document.removeEventListener('mousemove', this.mousemoveHandler);
			this.mousemoveHandler = null;
		}

		// Clean up other resources
		this.noteMove.destroy();
		if (this.selectionRectangle && typeof this.selectionRectangle.destroy === 'function') {
			this.selectionRectangle.destroy();
		}
		this.selectedNotes.clear();
		this.noteBuffer.clearHistory();
	}
}
