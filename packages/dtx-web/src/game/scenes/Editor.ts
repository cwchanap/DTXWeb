import { Input } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { BaseGame } from './BaseGame';
import { Preview } from './Preview';
import { get } from 'svelte/store';
import store from '$lib/store';
import type { LaneConfig } from '../interface';
import { LaneMeasureNote } from '$lib/chart/note';

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private isSelecting = false;
	private selectionStartX = 0;
	private selectionStartY = 0;
	private selectionRectangle!: Phaser.GameObjects.Rectangle;
	private selectedNotes: Set<string> = new Set();
	private contextMenuHandler: ((e: Event) => void) | null = null;
	private currentLaneIndex = -1;
	protected notes: Record<string, LaneMeasureNote[]> = {};
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
				// Start selection instead of scrolling
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
						// Remove the note from the display
						this.panelContainer.getAll('name', noteKey).forEach((note) => {
							note.destroy();
						});
						// Remove the note from this.notes
						const laneId = this.laneConfigs[laneIndex].id;
						if (measure in this.notes) {
							// Find and remove the note with matching measure, laneID, and position
							this.notes[measure] = this.notes[measure].filter(
								(note) =>
									!(
										note.laneID === laneId &&
										note.notes.some(
											(n) => Math.abs(n.position - cellOffset) < 0.001
										)
									)
							);
						}
					}
				} else {
					// Left-click: Add a note (existing behavior)
					// Draw the note in the clicked cell with correct parameters
					// The drawNote method expects (measure, laneIndex, cellOffset, noteId)
					const noteAdded = this.drawNote(measure, laneIndex, cellOffset, '00');
					if (noteAdded) {
						if (!(measure in this.notes)) {
							this.notes[measure] = [];
						}
						this.notes[measure].push(
							new LaneMeasureNote(measure, this.laneConfigs[laneIndex].id, '00')
						);
					}
				}
			}
		});

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			if (this.isSelecting && !this.isEditing) {
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
			if (this.isSelecting) {
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

	private clearSelection() {
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

	private highlightSelectedNote(noteGraphics: Phaser.GameObjects.Graphics) {
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
