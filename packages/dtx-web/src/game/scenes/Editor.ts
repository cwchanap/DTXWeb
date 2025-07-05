import { Input } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { BaseGame } from './BaseGame';
import { Preview } from './Preview';
import { get } from 'svelte/store';
import store from '$lib/store';
import type { LaneConfig } from '../interface';
import { LaneMeasureNote } from '@dtx/common';
import type { DeletedNoteData } from './editor/NoteBuffer';
import { NoteManager } from './editor/NoteManager';

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private noteManager: NoteManager;
	private contextMenuHandler: ((e: Event) => void) | null = null;
	private currentLaneIndex = -1;
	public notes: Record<string, LaneMeasureNote[]> = {};
	protected bpmNotes: Record<string, number> = {};
	protected measureLength: number[] = [];

	constructor(protected measureCount: number = 10) {
		super({ key: Editor.key });
		this.noteManager = new NoteManager(this);
	}

	init(data: Data) {
		this.measureCount = data.measureCount || this.measureCount;
	}

	create() {
		console.log('Create Editor Scene');

		// Disable browser context menu on the game canvas
		this.disableBrowserContextMenu();

		// Initialize NoteManager after scene is created
		this.noteManager.initialize();

		this.drawPanel();
		this.drawNotes();

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
			// Try to handle with NoteManager first (for selection/drag operations)
			const handled = this.noteManager.handlePointerDown(pointer);
			if (handled) {
				return;
			}

			// Handle note creation/deletion in editing mode
			if (!this.isEditing) {
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
				// Calculate the position within the measure and normalize it
				const rawCellOffset = (cellIndex % this.cellsPerMeasure) / this.cellsPerMeasure;
				const cellOffset = this.normalizePosition(rawCellOffset);

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
										originalPattern: existingLaneMeasureNote.pattern,
										measureLength: existingLaneMeasureNote.measureLength
									};
								}
							}
						}

						// Record undo action before deleting
						if (deletedNoteData) {
							this.noteManager.recordDeleteAction([deletedNoteData]);
						}

						// Remove the note graphics from the display
						const noteGraphics = this.panelContainer.getByName(noteKey);
						if (noteGraphics) {
							noteGraphics.destroy();
						}

						// Remove the note text from the display
						const textKey = `text-${laneIndex}-${measure}-${cellOffset}`;
						const noteText = this.panelContainer.getByName(textKey);
						if (noteText) {
							noteText.destroy();
						}

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
					const noteAdded = this.drawNote(measure, laneIndex, cellOffset, '01');
					if (noteAdded) {
						const laneId = this.laneConfigs[laneIndex].id;
						if (!(laneId in this.notes)) {
							this.notes[laneId] = [];
						}

						// Check if a LaneMeasureNote already exists for this measure/lane
						const existingMeasureNote = this.notes[laneId].find(
							(note) => note.measure === measure
						);

						if (existingMeasureNote) {
							// Add note to existing measure
							console.log(
								`[Editor] Adding note to existing measure: lane=${laneId}, measure=${measure}, pattern before: ${existingMeasureNote.pattern}`
							);
							const patternLength = this.cellsPerMeasure;
							const notePosition = Math.round(cellOffset * patternLength);
							const startIndex = notePosition * 2;
							let pattern = existingMeasureNote.pattern;

							// Place the note in the existing pattern
							pattern =
								pattern.substring(0, startIndex) +
								'01' +
								pattern.substring(startIndex + 2);

							existingMeasureNote.pattern = pattern;
							existingMeasureNote.parseNote(); // Reparse to update notes array
							console.log(
								`[Editor] Pattern after: ${existingMeasureNote.pattern}, notes count: ${existingMeasureNote.notes.length}`
							);
						} else {
							// Create a new LaneMeasureNote for this measure
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
			}
		});

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			// Handle note operations (drag/selection) first
			this.noteManager.handlePointerMove(pointer);

			// Handle cursor updates in editing mode
			if (this.isEditing) {
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
			this.noteManager.handlePointerUp();
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
				this.noteManager.deleteSelectedNotes();
			}
		});

		this.input.keyboard?.on('keydown-DELETE', () => {
			if (!this.isEditing) {
				this.noteManager.deleteSelectedNotes();
			}
		});

		// Handle Ctrl+Z for undo (works on both Mac and PC)
		this.input.keyboard?.on('keydown-Z', (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && !this.isEditing) {
				this.noteManager.undoLastAction();
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
		this.noteManager.destroy();

		// Clear undo history when restarting
		this.noteManager.clearUndoHistory();

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

	/**
	 * Clear selection - delegate to NoteManager
	 */
	clearSelection(): void {
		this.noteManager.clearSelection();
	}

	/**
	 * Get selected notes - delegate to NoteManager
	 */
	get selectedNotes(): Set<string> {
		return this.noteManager.selectedNotes;
	}

	// Getter methods for NoteManager access
	getIsEditing(): boolean {
		return this.isEditing;
	}

	getLaneConfigs(): LaneConfig[] {
		return this.laneConfigs;
	}

	getNotes(): Record<string, LaneMeasureNote[]> {
		return this.notes;
	}

	getPanelContainer(): Phaser.GameObjects.Container {
		return this.panelContainer;
	}

	getOffsetX(): number {
		return this.offsetX;
	}

	getOffsetY(): number {
		return this.offsetY;
	}

	getCellWidth(): number {
		return this.cellWidth;
	}

	getCellHeightValue(): number {
		return this.cellHeight;
	}

	// Wrapper method to access the inherited getCellHeight with parameters
	getCellHeightAt(measure: number, cell: number): number {
		return this.getCellHeight(measure, cell);
	}

	getCellMargin(): number {
		return this.cellMargin;
	}

	getCellsPerMeasure(): number {
		return this.cellsPerMeasure;
	}

	getNoteSize(): number {
		return this.noteSize;
	}

	getMeasureCount(): number {
		return this.measureCount;
	}

	// Compatibility getters for tests - delegate to NoteManager
	get isSelecting(): boolean {
		return this.noteManager?.isSelecting ?? false;
	}

	set isSelecting(value: boolean) {
		if (this.noteManager) {
			this.noteManager.isSelecting = value;
		}
	}

	get selectionStartX(): number {
		return this.noteManager?.selectionStartX ?? 0;
	}

	set selectionStartX(value: number) {
		if (this.noteManager) {
			this.noteManager.selectionStartX = value;
		}
	}

	get selectionStartY(): number {
		return this.noteManager?.selectionStartY ?? 0;
	}

	set selectionStartY(value: number) {
		if (this.noteManager) {
			this.noteManager.selectionStartY = value;
		}
	}

	get selectionRectangle(): Phaser.GameObjects.Rectangle | undefined {
		return this.noteManager?.selectionRectangle;
	}

	public getByName(name: string): { name: string } | null {
		return this.panelContainer.getByName(name);
	}
}
