import { Input } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { BaseGame } from './BaseGame';
import { Preview } from './Preview';
import { get } from 'svelte/store';
import store from '$lib/store';
import type { LaneConfig } from '../interface';
import { LaneMeasureNote } from '@dtx/common';
import { NoteBuffer, type DeletedNoteData } from './editor/NoteBuffer';

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private isSelecting = false;
	private isDragging = false;
	private dragStartX = 0;
	private dragStartY = 0;
	private draggedNotes: Set<string> = new Set();
	private dragOriginNote: string = ''; // The note that user clicked to start dragging
	private dragPreviewGraphics: Phaser.GameObjects.Graphics | null = null;
	private selectionStartX = 0;
	private selectionStartY = 0;
	private selectionRectangle!: Phaser.GameObjects.Rectangle;
	public selectedNotes: Set<string> = new Set();
	private contextMenuHandler: ((e: Event) => void) | null = null;
	private currentLaneIndex = -1;
	private noteBuffer = new NoteBuffer();
	public notes: Record<string, LaneMeasureNote[]> = {};
	protected bpmNotes: Record<string, number> = {};
	protected measureLength: number[] = [];

	constructor(protected measureCount: number = 10) {
		super({ key: Editor.key });
	}

	init(data: Data) {
		this.measureCount = data.measureCount || this.measureCount;
	}

	create() {
		console.log('Create Editor Scene');

		// Disable browser context menu on the game canvas
		this.disableBrowserContextMenu();

		this.drawPanel();
		this.drawNotes();

		// Initialize selection rectangle (initially hidden)
		this.selectionRectangle = this.add.rectangle(0, 0, 0, 0, 0x1d7196, 0.3);
		this.selectionRectangle.setStrokeStyle(2, 0x1d7196, 1);
		this.selectionRectangle.setVisible(false);

		// Helper function for clamping Y position (still needed for wheel scrolling)
		const clampY = (newY: number) => {
			return Phaser.Math.Clamp(
				newY,
				0,
				this.laneHeight - this.cameras.main.height + this.bottomMargin + this.cellMargin
			);
		};

		// Enable input events
		this.input.on('pointerdown', (pointer: Input.Pointer) => {
			if (!this.isEditing) {
				// Check if user clicked on an existing note for single selection
				const clickedNote = this.getClickedNote(pointer);

				if (clickedNote) {
					// Check if the clicked note is already selected
					if (this.selectedNotes.has(clickedNote.name)) {
						// Start drag operation if clicking on selected note
						this.startDrag(pointer, clickedNote.name);
						return;
					} else {
						// Single note selection
						this.clearSelection();
						this.selectedNotes.add(clickedNote.name);
						this.highlightSelectedNote(clickedNote);
						return;
					}
				}

				// Start drag selection if no note was clicked
				this.isSelecting = true;
				this.selectionStartX = pointer.x;
				this.selectionStartY = pointer.y;

				// Clear previous selection
				this.clearSelection();

				// Position and show selection rectangle
				this.selectionRectangle.setPosition(pointer.x, pointer.y);
				this.selectionRectangle.setSize(0, 0);
				this.selectionRectangle.setVisible(true);
				return;
			}

			const x = pointer.x - this.offsetX;

			// Calculate the absolute Y position by accounting for the container's position (scrolling)
			// The panelContainer.y is positive when scrolled up, so we need to minus it to get the absolute position
			const absoluteY = pointer.y - this.offsetY - this.panelContainer.y;

			// Calculate the clicked cell
			const laneIndex = Math.floor(x / this.cellWidth);
			// We need to negate absoluteY because the grid is drawn from bottom to top
			const cellIndex = Math.floor(-absoluteY / this.cellHeight);

			// Validate the click is within the grid bounds
			if (
				laneIndex >= 0 &&
				laneIndex < this.laneConfigs.length &&
				cellIndex >= 0 &&
				cellIndex < this.measureCount * this.cellsPerMeasure
			) {
				// Calculate the measure from the cell index
				const measure = Math.floor(cellIndex / this.cellsPerMeasure);
				// Calculate the position within the measure
				const cellOffset = (cellIndex % this.cellsPerMeasure) / this.cellsPerMeasure;

				// Check if it's a right-click (pointer.rightButtonDown())
				if (pointer.rightButtonDown()) {
					// Check if there's a note at this position
					const noteKey = `note-${laneIndex}-${measure}-${cellOffset}`;
					const existingNote = this.panelContainer.getByName(noteKey);
					if (existingNote) {
						const laneId = this.laneConfigs[laneIndex].id;

						// Find the note data before deleting it for undo functionality
						let deletedNoteData: DeletedNoteData | null = null;
						if (laneId in this.notes) {
							const existingLaneMeasureNote = this.notes[laneId].find(
								(note) =>
									note.measure === measure &&
									note.notes.some(
										(n) => Math.abs(n.position - cellOffset) < 0.001
									)
							);

							if (existingLaneMeasureNote) {
								const noteChip = existingLaneMeasureNote.notes.find(
									(n) => Math.abs(n.position - cellOffset) < 0.001
								);

								if (noteChip) {
									deletedNoteData = {
										noteKey,
										laneIndex,
										measure,
										cellOffset,
										laneId,
										noteId: noteChip.noteID,
										laneMeasureNote: existingLaneMeasureNote
									};
								}
							}
						}

						// Record undo action before deleting
						if (deletedNoteData) {
							this.noteBuffer.recordAction('delete', [deletedNoteData]);
						}

						// Remove the note from the display
						this.panelContainer.getAll('name', noteKey).forEach((note) => {
							note.destroy();
						});

						// Remove the note from this.notes
						if (laneId in this.notes) {
							// Find the LaneMeasureNote that contains this note
							const measureNote = this.notes[laneId].find(
								(note) =>
									note.measure === measure &&
									note.notes.some(
										(n) => Math.abs(n.position - cellOffset) < 0.001
									)
							);

							if (measureNote) {
								// Remove the specific note from the pattern
								const patternLength = this.cellsPerMeasure;
								const notePosition = Math.round(cellOffset * patternLength);
								const startIndex = notePosition * 2;

								// Replace the note with '00'
								let pattern = measureNote.pattern;
								pattern =
									pattern.substring(0, startIndex) +
									'00' +
									pattern.substring(startIndex + 2);
								measureNote.pattern = pattern;
								measureNote.parseNote(); // Reparse to update notes array

								// If the measure is now empty, remove the entire LaneMeasureNote
								if (measureNote.notes.length === 0) {
									this.notes[laneId] = this.notes[laneId].filter(
										(note) => note !== measureNote
									);
								}
							}

							// Clean up empty lane entries
							if (this.notes[laneId].length === 0) {
								delete this.notes[laneId];
							}
						}
					}
				} else {
					// Left-click: Add a note (existing behavior)
					// Draw the note in the clicked cell with correct parameters
					// The drawNote method expects (measure, laneIndex, cellOffset, noteId)
					const noteAdded = this.drawNote(measure, laneIndex, cellOffset, '00');
					if (noteAdded) {
						const laneId = this.laneConfigs[laneIndex].id;
						if (!(laneId in this.notes)) {
							this.notes[laneId] = [];
						}

						// Create a pattern that represents a single note at the position
						const patternLength = this.cellsPerMeasure;
						const notePosition = Math.round(cellOffset * patternLength);
						let pattern = '00'.repeat(patternLength);

						// Place a note ('01' instead of '00') at the correct position
						const startIndex = notePosition * 2;
						pattern =
							pattern.substring(0, startIndex) +
							'01' +
							pattern.substring(startIndex + 2);

						this.notes[laneId].push(new LaneMeasureNote(measure, laneId, pattern));
					}
				}
			}
		});

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			if (this.isDragging && !this.isEditing) {
				// Update drag position and preview
				this.updateDrag();
			} else if (this.isSelecting && !this.isEditing) {
				// Update selection rectangle size and position
				this.updateSelectionRectangle(pointer);
				// Find and highlight selected notes
				this.updateSelectedNotes();
			} else if (this.isEditing) {
				// Update cursor color based on hovered lane
				const x = pointer.x - this.offsetX;
				const laneIndex = Math.floor(x / this.cellWidth);

				// Only update if we're hovering over a valid lane and it's different from current
				if (
					laneIndex >= 0 &&
					laneIndex < this.laneConfigs.length &&
					laneIndex !== this.currentLaneIndex
				) {
					this.updateCursorForLane(laneIndex);
				}
			}
		});

		this.input.on('pointerup', () => {
			if (this.isDragging) {
				// Complete drag operation
				this.completeDrag();
			} else if (this.isSelecting) {
				// Finalize selection
				this.isSelecting = false;
				this.selectionRectangle.setVisible(false);
				// Keep selected notes highlighted for future actions
			}
		});

		this.input.on(
			'wheel',
			(
				pointer: Phaser.Input.Pointer,
				_gameObjects: Phaser.GameObjects.GameObject[],
				_deltaX: number,
				deltaY: number
			) => {
				if (pointer.y < this.scale.height - this.bottomMargin) {
					const newY = this.panelContainer.y - deltaY * 0.5;
					this.panelContainer.y = clampY(newY);
				}
			}
		);

		this.input.keyboard?.on('keydown-Q', () => {
			this.isEditing = !this.isEditing;
			this.updateCursorForEditingMode();
		});

		// Handle delete key for Mac (Backspace) and PC (Delete)
		this.input.keyboard?.on('keydown-BACKSPACE', () => {
			if (!this.isEditing) {
				this.deleteSelectedNotes();
			}
		});

		this.input.keyboard?.on('keydown-DELETE', () => {
			if (!this.isEditing) {
				this.deleteSelectedNotes();
			}
		});

		// Handle Ctrl+Z for undo (works on both Mac and PC)
		this.input.keyboard?.on('keydown-Z', (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && !this.isEditing) {
				this.noteBuffer.undoLastAction(this);
			}
		});

		EventBus.emit(EventType.SCENE_READY, this);
		EventBus.on(EventType.MEASURE_UPDATE, (measureCount: number) => {
			this.measureCount = get(store.measureCount);
			this.restart({ measureCount });
		});
		EventBus.on(
			EventType.NOTE_IMPORT,
			(notes: LaneMeasureNote[], bpmNotes: Record<string, number>) => {
				this.notes = {};
				this.sound.removeAll();
				notes.forEach((note) => {
					if (!(note.laneID in this.notes)) {
						this.notes[note.laneID] = [];
					}
					this.notes[note.laneID].push(note);
				});
				this.parseMesaureLength();
				const maxMeasure = notes.reduce((max, note) => Math.max(max, note.measure), 0);
				if (maxMeasure > this.measureCount) {
					this.measureCount = maxMeasure + 1;
				}
				store.measureCount.set(this.measureCount);
				this.bpmNotes = bpmNotes;
				this.restart({ measureCount: this.measureCount });
			}
		);

		EventBus.on(EventType.MEASURE_GOTO, (measure: number) => {
			this.panelContainer.y = clampY(this.getTotalMesaureOffest(measure));
		});

		EventBus.on(EventType.START_PREVIEW, (bpm: number) => {
			const currentMeasure = Math.floor(
				this.panelContainer.y / (this.cellHeight * this.cellsPerMeasure)
			);
			this.scene.pause();
			this.scene.setVisible(false);

			if (this.scene.isPaused(Preview.key)) {
				this.scene.setVisible(true, Preview.key);
				this.scene.resume(Preview.key);
				EventBus.emit(EventType.RESUME_PREVIEW, {
					startMeasure: currentMeasure
				});
			} else {
				this.scene.launch(Preview.key, {
					bpm: bpm,
					bpmNotes: this.bpmNotes,
					notes: this.notes,
					measureCount: this.measureCount,
					startMeasure: currentMeasure
				});
			}
		});

		EventBus.on(EventType.STOP_PREVIEW, () => {
			this.scene.pause(Preview.key);
			this.scene.setVisible(false, Preview.key);
			this.scene.resume();
			this.scene.setVisible(true);
		});
	}

	update() {
		// Update logic if needed
	}

	shutdown() {
		// Reset cursor to default when shutting down
		this.input.setDefaultCursor('default');
		// Clean up context menu event listener when scene shuts down
		this.enableBrowserContextMenu();
	}

	restart(data: Data = {}) {
		console.log('Restart Scene, data', data);
		EventBus.off(EventType.MEASURE_UPDATE);
		EventBus.off(EventType.NOTE_IMPORT);
		EventBus.off(EventType.MEASURE_GOTO);
		EventBus.off(EventType.START_PREVIEW);
		EventBus.off(EventType.STOP_PREVIEW);
		this.input.off('pointerdown');
		this.input.off('pointermove');
		this.input.off('pointerup');
		this.input.off('wheel');
		this.input.keyboard?.off('keydown-Q');
		this.input.keyboard?.off('keydown-BACKSPACE');
		this.input.keyboard?.off('keydown-DELETE');
		this.input.keyboard?.off('keydown-Z');

		// Clean up drag state
		this.cleanupDrag();

		// Clear undo history when restarting
		this.noteBuffer.clearHistory();

		// Reset cursor to default when restarting
		this.input.setDefaultCursor('default');
		// Re-enable browser context menu when restarting
		this.enableBrowserContextMenu();
		this.scene.restart(data);
	}

	drawFooterLane(laneConfig: LaneConfig, currentX: number) {
		const text = this.add
			.text(currentX + this.cellWidth / 2, this.offsetY + 20, laneConfig.name, {
				fontSize: '16px',
				color: '#ffffff'
			})
			.setOrigin(0.5);
		this.footerContainer.add(text);
	}

	private disableBrowserContextMenu() {
		// Get the game canvas element
		const gameContainer = document.getElementById('game-container');
		if (gameContainer) {
			// Create the context menu handler
			this.contextMenuHandler = (e: Event) => {
				e.preventDefault();
				return false;
			};

			// Add event listener to prevent context menu
			gameContainer.addEventListener('contextmenu', this.contextMenuHandler);
		}
	}

	private enableBrowserContextMenu() {
		// Get the game canvas element
		const gameContainer = document.getElementById('game-container');
		if (gameContainer && this.contextMenuHandler) {
			// Remove the event listener
			gameContainer.removeEventListener('contextmenu', this.contextMenuHandler);
			this.contextMenuHandler = null;
		}
	}

	private createNoteCursor(laneIndex: number): string {
		try {
			// Use the same dimensions as the actual notes
			const noteWidth = this.cellWidth - this.cellMargin * 2; // 46 pixels
			const noteHeight = this.noteSize - this.cellMargin * 2; // 21 pixels

			// Create a canvas to draw the note cursor
			const canvas = document.createElement('canvas');
			canvas.width = noteWidth;
			canvas.height = noteHeight;
			const ctx = canvas.getContext('2d');

			if (!ctx) return 'default';

			// Get the note color for this lane
			const noteColor = this.laneConfigs[laneIndex]?.noteColor || 0xffffff;

			// Convert hex color to RGB
			const r = (noteColor >> 16) & 255;
			const g = (noteColor >> 8) & 255;
			const b = noteColor & 255;

			// Draw a rectangle that matches the exact note appearance
			ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
			ctx.fillRect(0, 0, noteWidth, noteHeight);

			// Add a white border to make it more visible
			ctx.strokeStyle = 'white';
			ctx.lineWidth = 1;
			ctx.strokeRect(0, 0, noteWidth, noteHeight);

			// Convert canvas to data URL
			const dataUrl = canvas.toDataURL();
			// Center the cursor hotspot
			return `url(${dataUrl}) ${noteWidth / 2} ${noteHeight / 2}, auto`;
		} catch (error) {
			// Fallback for test environments or browsers without canvas support
			console.warn('Canvas not supported, using default cursor');
			return 'crosshair';
		}
	}

	private updateCursorForEditingMode() {
		if (this.isEditing) {
			// Set cursor based on current lane or default note cursor
			const laneIndex = this.currentLaneIndex >= 0 ? this.currentLaneIndex : 0;
			const noteCursor = this.createNoteCursor(laneIndex);
			this.input.setDefaultCursor(noteCursor);
		} else {
			// Reset to default cursor when not editing
			this.input.setDefaultCursor('default');
		}
	}

	private updateCursorForLane(laneIndex: number) {
		if (this.isEditing && laneIndex >= 0 && laneIndex < this.laneConfigs.length) {
			this.currentLaneIndex = laneIndex;
			const noteCursor = this.createNoteCursor(laneIndex);
			this.input.setDefaultCursor(noteCursor);
		}
	}

	public clearSelection() {
		// Clear visual highlighting of previously selected notes
		this.selectedNotes.forEach((noteKey) => {
			const noteGraphics = this.panelContainer.getByName(noteKey);
			if (noteGraphics && noteGraphics instanceof Phaser.GameObjects.Graphics) {
				// Reset to original color by redrawing the note
				const parts = noteKey.split('-');
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);

				if (laneIndex >= 0 && laneIndex < this.laneConfigs.length) {
					// Calculate original note position
					const x = this.offsetX + this.cellWidth * laneIndex + this.cellMargin;
					const yOffset = this.getTotalMesaureOffest(measure);
					const cellPosition = Math.floor(cellOffset * this.cellsPerMeasure);

					let cellsYOffset = 0;
					for (let i = 0; i < cellPosition; i++) {
						cellsYOffset += this.getCellHeight(measure, i % this.cellsPerMeasure);
					}

					const y =
						this.offsetY - (yOffset + cellsYOffset) + this.cellMargin - this.noteSize;
					const width = this.cellWidth - this.cellMargin * 2;
					const height = this.noteSize - this.cellMargin * 2;

					// Clear and redraw the note
					noteGraphics.clear();
					noteGraphics.fillStyle(this.laneConfigs[laneIndex].noteColor, 1);
					noteGraphics.fillRect(x, y, width, height);
				}
			}
		});
		this.selectedNotes.clear();
	}

	public highlightSelectedNote(noteGraphics: { name: string }) {
		if (noteGraphics instanceof Phaser.GameObjects.Graphics) {
			// Calculate the note bounds to draw the highlight border
			const bounds = this.calculateNoteBounds(noteGraphics.name);
			if (bounds) {
				// Draw a yellow border around the note
				noteGraphics.lineStyle(3, 0xffff00, 1);
				// Use the original note position (without panelContainer adjustment for drawing)
				const originalBounds = this.calculateNoteBounds(noteGraphics.name);
				if (originalBounds) {
					const adjustedY = originalBounds.y - this.panelContainer.y;
					noteGraphics.strokeRect(
						originalBounds.x,
						adjustedY,
						originalBounds.width,
						originalBounds.height
					);
				}
			}
		}
	}

	public getByName(name: string): { name: string } | null {
		return this.panelContainer.getByName(name);
	}

	// Public getter for cellsPerMeasure to allow NoteBuffer to access it
	get getCellsPerMeasure(): number {
		return this.cellsPerMeasure;
	}

	private updateSelectionRectangle(pointer: Phaser.Input.Pointer) {
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

	private updateSelectedNotes() {
		// Clear previous selection highlighting
		this.clearSelection();

		// Create a rectangle for overlap detection
		const width = Math.abs(this.selectionRectangle.width);
		const height = Math.abs(this.selectionRectangle.height);
		const x = this.selectionRectangle.x - width / 2;
		const y = this.selectionRectangle.y - height / 2;

		const selectionRect = new Phaser.Geom.Rectangle(x, y, width, height);

		// Find all notes that overlap with the selection rectangle
		this.panelContainer.list.forEach((child) => {
			if (
				child.name &&
				child.name.startsWith('note-') &&
				child instanceof Phaser.GameObjects.Graphics
			) {
				// Calculate note bounds manually based on how notes are drawn
				const noteBounds = this.calculateNoteBounds(child.name);

				// Check if the note overlaps with the selection rectangle
				if (noteBounds && Phaser.Geom.Rectangle.Overlaps(selectionRect, noteBounds)) {
					// Add to selection
					this.selectedNotes.add(child.name);

					// Highlight the selected note
					this.highlightSelectedNote(child);
				}
			}
		});
	}

	private calculateNoteBounds(noteKey: string): Phaser.Geom.Rectangle | null {
		// Parse note key to get position info: "note-{laneIndex}-{measure}-{cellOffset}"
		const parts = noteKey.split('-');
		if (parts.length !== 4) return null;

		const laneIndex = parseInt(parts[1]);
		const measure = parseInt(parts[2]);
		const cellOffset = parseFloat(parts[3]);

		// Calculate note position using the same logic as drawNote
		const x = this.offsetX + this.cellWidth * laneIndex + this.cellMargin;
		const yOffset = this.getTotalMesaureOffest(measure);
		const cellPosition = Math.floor(cellOffset * this.cellsPerMeasure);

		let cellsYOffset = 0;
		for (let i = 0; i < cellPosition; i++) {
			cellsYOffset += this.getCellHeight(measure, i % this.cellsPerMeasure);
		}

		const y = this.offsetY - (yOffset + cellsYOffset) + this.cellMargin - this.noteSize;
		const width = this.cellWidth - this.cellMargin * 2;
		const height = this.noteSize - this.cellMargin * 2;

		// Account for panelContainer position (scrolling)
		const adjustedY = y + this.panelContainer.y;

		return new Phaser.Geom.Rectangle(x, adjustedY, width, height);
	}

	private getClickedNote(pointer: Phaser.Input.Pointer): Phaser.GameObjects.Graphics | null {
		// Check all notes to see if the pointer clicked on one
		let clickedNote: Phaser.GameObjects.Graphics | null = null;

		this.panelContainer.list.forEach((child) => {
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

	private deleteSelectedNotes() {
		if (this.selectedNotes.size === 0) return;

		// Collect all notes that will be deleted for undo functionality
		const deletedNotes: DeletedNoteData[] = [];

		this.selectedNotes.forEach((noteKey) => {
			// Parse the note key to get the position info: "note-{laneIndex}-{measure}-{cellOffset}"
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);
				const laneId = this.laneConfigs[laneIndex].id;

				// Find the note data before deleting it
				if (laneId in this.notes) {
					const existingNote = this.notes[laneId].find(
						(note) =>
							note.measure === measure &&
							note.notes.some((n) => Math.abs(n.position - cellOffset) < 0.001)
					);

					if (existingNote) {
						// Find the specific note chip
						const noteChip = existingNote.notes.find(
							(n) => Math.abs(n.position - cellOffset) < 0.001
						);

						if (noteChip) {
							// Store the note data for undo
							deletedNotes.push({
								noteKey,
								laneIndex,
								measure,
								cellOffset,
								laneId,
								noteId: noteChip.noteID,
								laneMeasureNote: existingNote
							});
						}
					}
				}
			}
		});

		// Record undo action before deleting
		if (deletedNotes.length > 0) {
			this.noteBuffer.recordAction('delete', deletedNotes);
		}

		// Delete each selected note
		this.selectedNotes.forEach((noteKey) => {
			// Remove the note from the display
			this.panelContainer.getAll('name', noteKey).forEach((note) => {
				note.destroy();
			});

			// Parse the note key to get the position info
			const parts = noteKey.split('-');
			if (parts.length === 4) {
				const laneIndex = parseInt(parts[1]);
				const measure = parseInt(parts[2]);
				const cellOffset = parseFloat(parts[3]);
				const laneId = this.laneConfigs[laneIndex].id;

				// Remove the specific note from this.notes
				if (laneId in this.notes) {
					// Find the LaneMeasureNote that contains this note
					const measureNote = this.notes[laneId].find(
						(note) =>
							note.measure === measure &&
							note.notes.some((n) => Math.abs(n.position - cellOffset) < 0.001)
					);

					if (measureNote) {
						// Remove the specific note from the pattern
						const patternLength = this.cellsPerMeasure;
						const notePosition = Math.round(cellOffset * patternLength);
						const startIndex = notePosition * 2;

						// Replace the note with '00'
						let pattern = measureNote.pattern;
						pattern =
							pattern.substring(0, startIndex) +
							'00' +
							pattern.substring(startIndex + 2);
						measureNote.pattern = pattern;
						measureNote.parseNote(); // Reparse to update notes array

						// If the measure is now empty, remove the entire LaneMeasureNote
						if (measureNote.notes.length === 0) {
							this.notes[laneId] = this.notes[laneId].filter(
								(note) => note !== measureNote
							);
						}
					}

					// Clean up empty lane entries
					if (this.notes[laneId].length === 0) {
						delete this.notes[laneId];
					}
				}
			}
		});

		// Clear the selection after deletion
		this.selectedNotes.clear();
	}

	private startDrag(pointer: Phaser.Input.Pointer, originNoteKey: string) {
		this.isDragging = true;
		this.dragStartX = pointer.x;
		this.dragStartY = pointer.y;
		this.dragOriginNote = originNoteKey;

		// Copy selected notes to dragged notes
		this.draggedNotes = new Set(this.selectedNotes);

		// Create drag preview graphics
		this.createDragPreview();
	}

	private updateDrag() {
		if (!this.isDragging || !this.dragPreviewGraphics) return;

		// Update the drag preview to show all notes moving together
		this.updateDragPreview();
	}

	private completeDrag() {
		if (!this.isDragging) return;

		// Get current mouse position
		const pointer = this.input.activePointer;
		const x = pointer.x - this.offsetX;
		const absoluteY = pointer.y - this.offsetY - this.panelContainer.y;

		const targetLaneIndex = Math.floor(x / this.cellWidth);
		const targetCellIndex = Math.floor(-absoluteY / this.cellHeight);

		// Validate target position
		if (
			targetLaneIndex >= 0 &&
			targetLaneIndex < this.laneConfigs.length &&
			targetCellIndex >= 0 &&
			targetCellIndex < this.measureCount * this.cellsPerMeasure
		) {
			const targetMeasure = Math.floor(targetCellIndex / this.cellsPerMeasure);
			const targetCellOffset =
				(targetCellIndex % this.cellsPerMeasure) / this.cellsPerMeasure;

			// Move each dragged note
			this.moveNotesToPosition(targetLaneIndex, targetMeasure, targetCellOffset);
		}

		// Clean up drag state
		this.cleanupDrag();
	}

	private moveNotesToPosition(
		targetLaneIndex: number,
		targetMeasure: number,
		targetCellOffset: number
	) {
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
				const oldLaneId = this.laneConfigs[oldLaneIndex].id;

				// Find the original noteID from the data structure
				if (oldLaneId in this.notes) {
					const existingNote = this.notes[oldLaneId].find(
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
					newLaneIndex < this.laneConfigs.length &&
					newMeasure >= 0 &&
					newMeasure < this.measureCount &&
					newCellOffset >= 0 &&
					newCellOffset < 1
				) {
					const newKey = `note-${newLaneIndex}-${newMeasure}-${newCellOffset}`;
					const existingNote = this.panelContainer.getByName(newKey);

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
							laneId: this.laneConfigs[newLaneIndex].id,
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
				// Remove from display
				this.panelContainer.getAll('name', oldKey).forEach((note) => {
					note.destroy();
				});

				// Parse old key to get position info
				const parts = oldKey.split('-');
				const oldLaneIndex = parseInt(parts[1]);
				const oldMeasure = parseInt(parts[2]);
				const oldCellOffset = parseFloat(parts[3]);
				const oldLaneId = this.laneConfigs[oldLaneIndex].id;

				// Remove from data structure
				if (oldLaneId in this.notes) {
					this.notes[oldLaneId] = this.notes[oldLaneId].filter(
						(note) =>
							!(
								note.measure === oldMeasure &&
								note.notes.some((n) => Math.abs(n.position - oldCellOffset) < 0.001)
							)
					);

					if (this.notes[oldLaneId].length === 0) {
						delete this.notes[oldLaneId];
					}
				}
			});

			// Then, add new notes
			notesToMove.forEach(
				({ newKey, laneIndex, measure, cellOffset, laneId, originalNoteId }) => {
					// Add to display
					const noteAdded = this.drawNote(measure, laneIndex, cellOffset, originalNoteId);

					if (noteAdded) {
						// Add to data - use the correct lane-based data structure
						if (!(laneId in this.notes)) {
							this.notes[laneId] = [];
						}

						// Create a pattern that represents a single note at the position
						const patternLength = this.cellsPerMeasure;
						const notePosition = Math.round(cellOffset * patternLength);
						let pattern = '00'.repeat(patternLength);

						// Place the original noteId at the correct position
						const startIndex = notePosition * 2;
						pattern =
							pattern.substring(0, startIndex) +
							originalNoteId +
							pattern.substring(startIndex + 2);

						this.notes[laneId].push(new LaneMeasureNote(measure, laneId, pattern));
						movedNotes.push(newKey);
					}
				}
			);

			// Update selection to include both moved and unmoved notes
			this.clearSelection();

			// Add moved notes to selection
			movedNotes.forEach((newKey) => {
				this.selectedNotes.add(newKey);
				const noteGraphics = this.panelContainer.getByName(newKey);
				if (noteGraphics && noteGraphics instanceof Phaser.GameObjects.Graphics) {
					this.highlightSelectedNote(noteGraphics);
				}
			});

			// Keep unmovable notes in selection at their original positions
			unmovableNotes.forEach((noteKey) => {
				this.selectedNotes.add(noteKey);
				const noteGraphics = this.panelContainer.getByName(noteKey);
				if (noteGraphics && noteGraphics instanceof Phaser.GameObjects.Graphics) {
					this.highlightSelectedNote(noteGraphics);
				}
			});
		}
	}

	private createDragPreview() {
		// Create preview graphics showing where notes will be moved
		this.dragPreviewGraphics = this.add.graphics();
		this.dragPreviewGraphics.setAlpha(0.5);

		// We'll update the preview positions in updateDrag based on cursor movement
		// For now, just initialize it with the current positions
		this.updateDragPreview();
	}

	private updateDragPreview() {
		if (!this.dragPreviewGraphics) return;

		// Clear previous preview
		this.dragPreviewGraphics.clear();
		this.dragPreviewGraphics.setAlpha(0.5);

		// Get current mouse position
		const pointer = this.input.activePointer;
		const x = pointer.x - this.offsetX;
		const absoluteY = pointer.y - this.offsetY - this.panelContainer.y;

		const targetLaneIndex = Math.floor(x / this.cellWidth);
		const targetCellIndex = Math.floor(-absoluteY / this.cellHeight);

		// Validate target position
		if (
			targetLaneIndex >= 0 &&
			targetLaneIndex < this.laneConfigs.length &&
			targetCellIndex >= 0 &&
			targetCellIndex < this.measureCount * this.cellsPerMeasure
		) {
			const targetMeasure = Math.floor(targetCellIndex / this.cellsPerMeasure);
			const targetCellOffset =
				(targetCellIndex % this.cellsPerMeasure) / this.cellsPerMeasure;

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
							newLaneIndex < this.laneConfigs.length &&
							newMeasure >= 0 &&
							newMeasure < this.measureCount &&
							newCellOffset >= 0 &&
							newCellOffset < 1 &&
							this.dragPreviewGraphics
						) {
							const x =
								this.offsetX + this.cellWidth * newLaneIndex + this.cellMargin;
							const yOffset = this.getTotalMesaureOffest(newMeasure);
							const cellPosition = Math.floor(newCellOffset * this.cellsPerMeasure);

							let cellsYOffset = 0;
							for (let i = 0; i < cellPosition; i++) {
								cellsYOffset += this.getCellHeight(
									newMeasure,
									i % this.cellsPerMeasure
								);
							}

							const y =
								this.offsetY -
								(yOffset + cellsYOffset) +
								this.cellMargin -
								this.noteSize;
							const width = this.cellWidth - this.cellMargin * 2;
							const height = this.noteSize - this.cellMargin * 2;

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

	private cleanupDrag() {
		this.isDragging = false;
		this.draggedNotes.clear();
		this.dragOriginNote = '';

		if (this.dragPreviewGraphics) {
			this.dragPreviewGraphics.destroy();
			this.dragPreviewGraphics = null;
		}
	}
}
