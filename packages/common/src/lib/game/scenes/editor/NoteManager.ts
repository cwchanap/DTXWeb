import type { Editor } from '../Editor.js';
import { NoteBuffer, type DeletedNoteData, type MovedNoteData } from './NoteBuffer.js';
import { NoteCopy } from './NoteCopy.js';
import { NoteMove } from './NoteMove.js';
import Phaser from 'phaser';
import {
	calculateHighResolutionPosition,
	HIGH_RESOLUTION_CELLS
} from '../../utils/notePositioning.js';

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
	private selectionOverlays: Map<string, Phaser.GameObjects.Graphics> = new Map();

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

	// Performance optimization for selection rectangle
	private lastSelectionUpdateTime = 0;
	private readonly SELECTION_UPDATE_THROTTLE_MS = 16; // ~60fps
	private selectionRect = new Phaser.Geom.Rectangle(0, 0, 0, 0); // Reusable rectangle

	// Event listener references for cleanup
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private mousemoveHandler: ((event: MouseEvent) => void) | null = null;

	// Callback for when notes are modified
	private onNotesModified: (() => void) | null = null;

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
	 * Set callback to be called when notes are modified
	 */
	public setOnNotesModified(callback: () => void): void {
		this.onNotesModified = callback;
	}

	/**
	 * Notify that notes have been modified
	 */
	private notifyNotesModified(): void {
		if (this.onNotesModified) {
			this.onNotesModified();
		}
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
			// Allow keyboard shortcuts to work unless we're in a text input that should handle them
			// (like textareas where Ctrl+C should copy text, not notes)
			const target = event.target as HTMLElement;
			const isTextInput =
				target?.tagName === 'TEXTAREA' ||
				(target?.tagName === 'INPUT' && target.getAttribute('type') === 'text');

			// Skip our shortcuts if user is typing in a text field where copy/paste should work normally
			if (isTextInput) {
				const inputElement = target as HTMLInputElement | HTMLTextAreaElement;
				if (inputElement.selectionStart !== inputElement.selectionEnd) {
					return; // User has text selected, let browser handle copy/paste
				}
			}

			// For all other cases (canvas, number inputs, body, etc.), handle our shortcuts
			if (
				!isTextInput ||
				(isTextInput &&
					(target as HTMLInputElement | HTMLTextAreaElement).selectionStart ===
						(target as HTMLInputElement | HTMLTextAreaElement).selectionEnd)
			) {
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
		const cellsPerMeasure = this.editor.getCellsPerMeasure();

		const laneIndex = Math.floor(x / cellWidth);

		// Use the same grid-snapping logic as Editor note creation and NoteMove.completeDrag
		// Find the measure and position within measure using same calculation as Editor
		const clickY = -absoluteY;
		let currentY = 0;
		let measure = -1;
		let positionInMeasure = 0;

		// Iterate through measures to find which one contains the cursor (same as Editor logic)
		for (let m = 0; m < this.editor.getMeasureCount(); m++) {
			const measureHeight = this.editor.getMeasureHeight(m);
			if (clickY >= currentY && clickY < currentY + measureHeight) {
				measure = m;
				positionInMeasure = (clickY - currentY) / measureHeight;
				break;
			}
			currentY += measureHeight;
		}

		// Snap reference position to 16th note grid (not high-resolution grid)
		// This ensures the reference note is placed at the nearest 16th note grid cell
		const gridPosition = Math.round(positionInMeasure * cellsPerMeasure);
		const cellOffset = gridPosition / cellsPerMeasure;

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
	 * Record a paste action for undo functionality
	 */
	recordPasteAction(
		pastedNotes: Array<{
			noteKey: string;
			laneIndex: number;
			measure: number;
			cellOffset: number;
			laneId: string;
			noteId: string;
		}>
	): void {
		this.noteBuffer.recordAction('paste', pastedNotes);
	}

	/**
	 * Record a cut action for undo functionality
	 */
	recordCutAction(
		cutNotes: Array<{
			noteKey: string;
			laneIndex: number;
			measure: number;
			cellOffset: number;
			laneId: string;
			noteId: string;
			measureLength?: number;
		}>
	): void {
		this.noteBuffer.recordAction('cut', cutNotes);
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
			// Always update the visual rectangle immediately for smooth feedback
			this.updateSelectionRectangle(pointer);

			// Throttle expensive note selection calculations
			const now = Date.now();
			if (now - this.lastSelectionUpdateTime > this.SELECTION_UPDATE_THROTTLE_MS) {
				this.updateSelectedNotes();
				this.lastSelectionUpdateTime = now;
			}
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
			// Final update to catch any notes missed due to throttling
			this.updateSelectedNotes();
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

		// Get the notes data structure for direct manipulation
		const notes = this.editor.getNotes();

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
					// The cellOffset from note key should already be normalized
					const existingNote = notes[laneId].find(
						(note) =>
							note.measure === measure &&
							note.notes.some((n) => n.position === cellOffset)
					);

					if (existingNote) {
						// Find the specific note chip using exact position match
						const noteChip = existingNote.notes.find((n) => n.position === cellOffset);

						if (noteChip) {
							// Store the note data for undo (without object references to avoid stale data)
							const deletedNoteData = {
								noteKey,
								laneIndex,
								measure,
								cellOffset, // Use exact position from note key
								laneId,
								noteId: noteChip.noteID,
								measureLength: existingNote.measureLength
							};
							deletedNotes.push(deletedNoteData);
							notesToDelete.push({ noteKey, deletedNoteData });
						}
					}
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
			}
		});

		// Clear the selection after deletion
		this.selectedNotes.clear();

		// Notify that notes have been modified
		this.notifyNotesModified();
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
				// Remove the specific note from the notes array
				// Check if the instance has the new method (backward compatibility)
				if (typeof measureNote.removeNote === 'function') {
					measureNote.removeNote(deletedNoteData.cellOffset);
				} else {
					// Fallback: manually remove from notes array for old instances
					measureNote.notes = measureNote.notes.filter(
						(note) => note.position !== deletedNoteData.cellOffset
					);
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

		// Remove selection overlay using stored reference
		const overlay = this.selectionOverlays.get(noteKey);
		if (overlay && typeof overlay.destroy === 'function') {
			overlay.destroy();
			this.selectionOverlays.delete(noteKey);
		}
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
						note.notes.some((n) => n.position === cellOffset)
				);

				if (measureNote) {
					// Remove the specific note from the notes array
					// Check if the instance has the new method (backward compatibility)
					if (typeof measureNote.removeNote === 'function') {
						measureNote.removeNote(cellOffset);
					} else {
						// Fallback: manually remove from notes array for old instances
						measureNote.notes = measureNote.notes.filter(
							(note) => note.position !== cellOffset
						);
					}

					// If the measure is now empty, remove the entire LaneMeasureNote
					if (measureNote.notes.length === 0) {
						notes[laneId] = notes[laneId].filter((note) => note !== measureNote);

						// Clean up empty lane entries
						if (notes[laneId].length === 0) {
							delete notes[laneId];
						}
					}
				}
			}
		}
	}

	/**
	 * Clear current selection and remove visual highlighting
	 */
	clearSelection(): void {
		// Remove selection overlays using stored references instead of searching by name
		this.selectionOverlays.forEach((overlay, noteKey) => {
			if (overlay && typeof overlay.destroy === 'function') {
				overlay.destroy();
			}
		});
		this.selectionOverlays.clear();
		this.selectedNotes.clear();
	}

	/**
	 * Highlight a selected note with a border overlay
	 */
	public highlightSelectedNote(noteGraphics: { name: string }): void {
		// Calculate the note bounds to draw the highlight border
		const bounds = this.calculateNoteBounds(noteGraphics.name);

		if (bounds) {
			// Remove existing overlay if it exists
			const existingOverlay = this.selectionOverlays.get(noteGraphics.name);
			if (existingOverlay && typeof existingOverlay.destroy === 'function') {
				existingOverlay.destroy();
			}

			// Create new selection overlay
			const overlay = this.editor.add.graphics();
			overlay.lineStyle(3, 0xffff00, 1);

			// Use the exact same positioning logic as the actual note drawing
			// This ensures the highlight matches the note position exactly
			if (bounds) {
				// Simply use the bounds we already calculated with correct high-resolution positioning
				overlay.strokeRect(
					bounds.x,
					bounds.y - this.editor.getPanelContainer().y,
					bounds.width,
					bounds.height
				);
				const overlayKey = `selection-overlay-${noteGraphics.name}`;
				overlay.setName(overlayKey);
				this.editor.getPanelContainer().add(overlay);

				// Store the overlay reference for fast cleanup
				this.selectionOverlays.set(noteGraphics.name, overlay);
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
		// Reuse rectangle for overlap detection to avoid object creation
		const width = Math.abs(this.selectionRectangle.width);
		const height = Math.abs(this.selectionRectangle.height);
		const x = this.selectionRectangle.x - width / 2;
		const y = this.selectionRectangle.y - height / 2;

		this.selectionRect.setTo(x, y, width, height);

		// Use fast bounds checking without detailed calculations during selection
		const selectedNoteKeys = new Set<string>();

		// Fast early exit: if selection rectangle is too small, skip expensive calculations
		if (width < 5 && height < 5) {
			// Clear selection and exit early for tiny rectangles
			this.clearSelection();
			return;
		}

		const containerList = this.editor.getPanelContainer().list;

		// Optimize: Use fast iteration instead of complex bounds calculations
		for (const child of containerList) {
			if (
				child.name &&
				child.name.startsWith('note-') &&
				child instanceof Phaser.GameObjects.Graphics
			) {
				// Fast bounds check using Phaser's built-in bounds if available
				if (typeof child.getBounds === 'function') {
					const bounds = child.getBounds();
					// Use Phaser's built-in overlap detection for cleaner, more maintainable code
					if (Phaser.Geom.Rectangle.Overlaps(this.selectionRect, bounds)) {
						selectedNoteKeys.add(child.name);
					}
				} else {
					// Fallback to manual bounds calculation only if needed
					const simplifiedBounds = this.calculateSimplifiedNoteBounds(child.name);
					if (
						simplifiedBounds &&
						Phaser.Geom.Rectangle.Overlaps(this.selectionRect, simplifiedBounds)
					) {
						selectedNoteKeys.add(child.name);
					}
				}
			}
		}

		// Only update selection if it actually changed
		const hasChanges =
			selectedNoteKeys.size !== this.selectedNotes.size ||
			[...selectedNoteKeys].some((key) => !this.selectedNotes.has(key));

		if (hasChanges) {
			// Clear previous selection highlighting
			this.clearSelection();

			// Add all selected notes and highlight them
			selectedNoteKeys.forEach((noteKey) => {
				this.selectedNotes.add(noteKey);
				const noteGraphics = this.editor.getPanelContainer().getByName(noteKey);
				if (noteGraphics) {
					this.highlightSelectedNote(noteGraphics);
				}
			});
		}
	}

	/**
	 * Calculate simplified note bounds for performance during selection (without stacking)
	 */
	private calculateSimplifiedNoteBounds(noteKey: string): Phaser.Geom.Rectangle | null {
		// Parse note key to get position info: "note-{laneIndex}-{measure}-{cellOffset}"
		const parts = noteKey.split('-');
		if (parts.length !== 4) return null;

		const laneIndex = parseInt(parts[1]);
		const measure = parseInt(parts[2]);
		const cellOffset = parseFloat(parts[3]);

		// Calculate base X position (no stacking offset for performance)
		const x =
			this.editor.getOffsetX() +
			this.editor.getCellWidth() * laneIndex +
			this.editor.getCellMargin();

		// Calculate Y position using high-resolution positioning
		const yOffset = this.editor.getTotalMesaureOffest(measure);
		const { wholeCells, fractionalCell } = calculateHighResolutionPosition(
			cellOffset,
			this.editor.getCellsPerMeasure()
		);

		// Add offsets for each cell up to the note position
		let cellsYOffset = 0;
		for (let i = 0; i < wholeCells; i++) {
			cellsYOffset += this.editor.getCellHeightValue();
		}

		// Add fractional cell offset
		if (fractionalCell > 0) {
			cellsYOffset += fractionalCell * this.editor.getCellHeightValue();
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
	 * Calculate the bounds of a note based on its key, including visual stacking offset
	 */
	public calculateNoteBounds(noteKey: string): Phaser.Geom.Rectangle | null {
		// Parse note key to get position info: "note-{laneIndex}-{measure}-{cellOffset}"
		const parts = noteKey.split('-');
		if (parts.length !== 4) {
			return null;
		}

		const laneIndex = parseInt(parts[1]);
		const measure = parseInt(parts[2]);
		const rawCellOffset = parseFloat(parts[3]);
		const cellOffset = rawCellOffset;

		// Find nearby notes to determine stacking position (same logic as Editor.drawNote)
		const nearbyNotes = this.findNearbyNotes(measure, laneIndex, cellOffset);
		const stackIndex = nearbyNotes.length;

		// Calculate base X position
		const baseX =
			this.editor.getOffsetX() +
			this.editor.getCellWidth() * laneIndex +
			this.editor.getCellMargin();

		// Apply visual stacking offset
		const stackOffset = stackIndex * 3; // 3px horizontal offset per stacked note
		const x = baseX + stackOffset;

		// Calculate Y position using high-resolution positioning (same as Editor.drawNote)
		const yOffset = this.editor.getTotalMesaureOffest(measure);
		const { wholeCells, fractionalCell } = calculateHighResolutionPosition(
			cellOffset,
			this.editor.getCellsPerMeasure()
		);

		// Add offsets for each cell up to the note position
		let cellsYOffset = 0;
		for (let i = 0; i < wholeCells; i++) {
			cellsYOffset += this.editor.getCellHeightValue();
		}

		// Add fractional cell offset
		if (fractionalCell > 0) {
			cellsYOffset += fractionalCell * this.editor.getCellHeightValue();
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
	 * Find notes that are positioned close to the given position in the same lane and measure
	 * Used for determining visual stacking position in bounds calculation
	 */
	public findNearbyNotes(measure: number, laneIndex: number, cellOffset: number): string[] {
		const nearbyNotes: string[] = [];
		const threshold = (1 / HIGH_RESOLUTION_CELLS) * 2; // Within 2 high-res cells

		// TODO: Revise if this O(n²) approach causing any performance issues
		// Look for existing note graphics in the panel container
		const allNotes = this.editor.getPanelContainer().getAll();

		for (const noteObj of allNotes) {
			const noteName = noteObj.name;
			if (!noteName || !noteName.startsWith('note-')) continue;

			// Parse note key: note-laneIndex-measure-cellOffset
			const parts = noteName.split('-');
			if (parts.length !== 4) continue;

			const noteLaneIndex = parseInt(parts[1]);
			const noteMeasure = parseInt(parts[2]);
			const noteCellOffset = parseFloat(parts[3]);

			// Check if it's in the same lane and measure, and within threshold
			if (
				noteLaneIndex === laneIndex &&
				noteMeasure === measure &&
				Math.abs(noteCellOffset - cellOffset) <= threshold &&
				noteCellOffset !== cellOffset
			) {
				nearbyNotes.push(noteName);
			}
		}

		return nearbyNotes.sort(); // Sort for consistent stacking order
	}

	/**
	 * Get the note that was clicked by the pointer
	 * When multiple notes overlap, returns the topmost (most recently stacked) note
	 */
	private getClickedNote(pointer: Phaser.Input.Pointer): Phaser.GameObjects.Graphics | null {
		const clickedNotes: Array<{ note: Phaser.GameObjects.Graphics; stackIndex: number }> = [];

		const containerList = this.editor.getPanelContainer().list;

		// First pass: Fast hit detection using simplified bounds (no stacking calculation)
		const potentialNotes: Phaser.GameObjects.Graphics[] = [];

		for (const child of containerList) {
			if (
				child.name &&
				child.name.startsWith('note-') &&
				child instanceof Phaser.GameObjects.Graphics
			) {
				// Use simplified bounds calculation (no stacking) for initial hit detection
				const simplifiedBounds = this.calculateSimplifiedNoteBounds(child.name);

				if (simplifiedBounds) {
					// Check if the pointer is within the simplified note bounds
					if (
						pointer.x >= simplifiedBounds.x &&
						pointer.x <= simplifiedBounds.x + simplifiedBounds.width &&
						pointer.y >= simplifiedBounds.y &&
						pointer.y <= simplifiedBounds.y + simplifiedBounds.height
					) {
						potentialNotes.push(child);
					}
				}
			}
		}

		// Second pass: Only calculate precise stacking for notes that were actually hit
		for (const note of potentialNotes) {
			const parts = note.name.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);

				// Now calculate precise bounds with stacking for hit notes only
				const preciseBounds = this.calculateNoteBounds(note.name);
				if (preciseBounds) {
					// Double-check with precise bounds
					if (
						pointer.x >= preciseBounds.x &&
						pointer.x <= preciseBounds.x + preciseBounds.width &&
						pointer.y >= preciseBounds.y &&
						pointer.y <= preciseBounds.y + preciseBounds.height
					) {
						// Calculate stack index for this note
						const nearbyNotes = this.findNearbyNotes(measure, laneIndex, cellOffset);
						const stackIndex = nearbyNotes.length;
						clickedNotes.push({ note, stackIndex });
					}
				}
			}
		}

		// If multiple notes were clicked, return the one with the highest stack index (topmost)
		if (clickedNotes.length > 0) {
			clickedNotes.sort((a, b) => b.stackIndex - a.stackIndex); // Sort by stack index descending
			return clickedNotes[0].note;
		}

		return null;
	}

	/**
	 * Handle undo operation
	 */
	undoLastAction(): void {
		this.noteBuffer.undoLastAction(this.editor);
		// Notify that notes have been modified
		this.notifyNotesModified();
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
		// Keep notes selected after copy so user can see what was copied
		// Note: This means paste will use current selection as paste position
		return result;
	}

	/**
	 * Cut currently selected notes to clipboard (copy + delete originals)
	 */
	cutSelectedNotes(): boolean {
		if (this.selectedNotes.size === 0) {
			return false;
		}

		const result = this.noteCopy.cutNotes(
			this.selectedNotes,
			this.editor,
			(noteKey) => this.deleteNoteByKey(noteKey),
			(cutNotes) => this.recordCutAction(cutNotes)
		);

		if (result) {
			// Clear selection after successful cut (notes are already deleted)
			this.clearSelection();
			// Notify that notes have been modified
			this.notifyNotesModified();
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
			this.editor,
			(pastedNotes) => {
				this.recordPasteAction(pastedNotes);
				// Auto-select pasted notes so user can see what was pasted
				this.selectPastedNotes(pastedNotes);
			}
		);

		if (result) {
			// Notify that notes have been modified
			this.notifyNotesModified();
		}

		return result;
	}

	/**
	 * Selects pasted notes to show user what was pasted
	 */
	private selectPastedNotes(pastedNotes: Array<{ noteKey: string }>): void {
		// Clear current selection and select all pasted notes
		this.clearSelection();
		pastedNotes.forEach((pastedNote) => {
			const noteGraphics = this.editor.getByName(pastedNote.noteKey);
			if (noteGraphics) {
				// Add to selection set and create visual highlight overlay
				this.selectedNotes.add(pastedNote.noteKey);
				this.highlightSelectedNote(noteGraphics);
			}
		});
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
	 * Add a note to both the display and data structure
	 * Delegates to the shared logic in NoteMove
	 */
	addNoteToEditor(
		measure: number,
		laneIndex: number,
		cellOffset: number,
		laneId: string,
		noteId: string
	): boolean {
		const result = this.noteMove.addNoteToEditor(
			measure,
			laneIndex,
			cellOffset,
			laneId,
			noteId
		);
		if (result) {
			// Notify that notes have been modified
			this.notifyNotesModified();
		}
		return result;
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

		// Clean up selection overlays
		this.clearSelection();

		// Clean up other resources
		this.noteMove.destroy();
		if (this.selectionRectangle && typeof this.selectionRectangle.destroy === 'function') {
			this.selectionRectangle.destroy();
		}
		this.selectedNotes.clear();
		this.noteBuffer.clearHistory();
	}
}
