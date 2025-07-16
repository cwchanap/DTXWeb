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
import {
	calculateHighResolutionPosition,
	HIGH_RESOLUTION_CELLS
} from '../utils/notePositioning.js';
import { TempChartStorage } from '$lib/services/tempChartStorage';

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private noteManager: NoteManager;
	private contextMenuHandler: ((e: Event) => void) | null = null;
	private currentLaneIndex = -1;
	private activeNoteSubscription: (() => void) | null = null;
	private keyBindingsSubscription: (() => void) | null = null;
	private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
	private isDirty = false;
	private autoSaveTimeout: number | null = null;
	private readonly AUTO_SAVE_DELAY_MS = 2000; // Debounce auto-save by 2 seconds
	private keyBindings: Record<string, string> = {}; // key -> noteId mapping
	public notes: Record<string, LaneMeasureNote[]> = {};
	protected bpmNotes: Record<string, number> = {};
	protected measureLength: number[] = [];

	constructor(protected measureCount: number = 10) {
		super({ key: Editor.key });
		this.noteManager = new NoteManager(this);
		// Set up callback for NoteManager to notify when notes are modified
		this.noteManager.setOnNotesModified(() => {
			this.setDirty(true);
			this.debouncedAutoSave();
		});
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

		// Try to auto-load temporary data before drawing
		this.autoLoadChart();

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

			// Calculate the clicked lane
			const laneIndex = Math.floor(x / this.cellWidth);

			// Validate the click is within the lane bounds
			if (laneIndex >= 0 && laneIndex < this.laneConfigs.length) {
				// Calculate which measure was clicked using high-resolution positioning
				// We need to negate absoluteY because the grid is drawn from bottom to top
				const clickY = -absoluteY;

				// Find the measure and position within measure
				let currentY = 0;
				let measure = -1;
				let positionInMeasure = 0;

				// Iterate through measures to find which one contains the click
				for (let m = 0; m < this.measureCount; m++) {
					const measureHeight = this.getMeasureHeight(m);
					if (clickY >= currentY && clickY < currentY + measureHeight) {
						measure = m;
						positionInMeasure = (clickY - currentY) / measureHeight;
						break;
					}
					currentY += measureHeight;
				}

				// Validate the click is within a valid measure
				if (measure >= 0 && measure < this.measureCount) {
					// Use high-resolution grid to calculate precise position
					// Use Math.round instead of Math.floor to match the selection logic
					const highResPosition = Math.round(positionInMeasure * HIGH_RESOLUTION_CELLS);
					const cellOffset = highResPosition / HIGH_RESOLUTION_CELLS;

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
										this.notes[laneId] = this.notes[laneId].filter(
											(note) => note !== measureNote
										);
									}
								}

								// Clean up empty lane entries
								if (this.notes[laneId].length === 0) {
									delete this.notes[laneId];
								}
								this.syncNotesToStore();
								// Note: dirty state and auto-save handled by NoteManager callback
							}
						}
					} else {
						// Left-click: Add a note using the shared addNoteToEditor method
						const laneId = this.laneConfigs[laneIndex].id;
						const activeNote = get(store.activeNote);
						this.noteManager.addNoteToEditor(
							measure,
							laneIndex,
							cellOffset,
							laneId,
							activeNote
						);
						this.syncNotesToStore();
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

		// Set up global key binding listener
		this.setupKeyBindingListener();

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
				this.syncNotesToStore();
				this.setDirty(false); // Clear dirty state after importing notes
				// this.debouncedAutoSave(); // Save the imported state
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

			// If editor is dirty or preview scene doesn't exist, rebuild it
			if (this.isDirty || !this.scene.isPaused(Preview.key)) {
				// Stop existing preview if it exists
				if (this.scene.isPaused(Preview.key)) {
					this.scene.stop(Preview.key);
				}

				// Launch new preview with updated notes
				this.scene.launch(Preview.key, {
					bpm: bpm,
					bpmNotes: this.bpmNotes,
					notes: this.notes,
					measureCount: this.measureCount,
					startMeasure: currentMeasure
				});

				// Note: Keep dirty state - preview doesn't save the changes
			} else {
				// Resume existing preview if no changes
				this.scene.setVisible(true, Preview.key);
				this.scene.resume(Preview.key);
				EventBus.emit(EventType.RESUME_PREVIEW, {
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

		// Listen for active note changes to update cursor
		this.activeNoteSubscription = store.activeNote.subscribe(() => {
			if (this.isEditing) {
				this.updateCursorForEditingMode();
			}
		});

		// Listen for key bindings changes
		this.keyBindingsSubscription = store.keyBindings.subscribe((bindings) => {
			// Create reverse mapping: key -> noteId
			this.keyBindings = {};
			Object.entries(bindings).forEach(([noteId, key]) => {
				this.keyBindings[key] = noteId;
			});
		});

		// Set up beforeunload warning for unsaved changes
		this.setupBeforeUnloadWarning();
	}

	update() {
		// Update logic if needed
	}

	/**
	 * Override normalizePosition to use high-resolution grid for Editor
	 * This prevents 24th, 32nd, 48th, and 64th notes from being rounded to 16th note positions
	 */
	protected normalizePosition(cellOffset: number): number {
		// Use high-resolution grid (192 cells) instead of the standard 16-cell grid
		// This preserves the exact positioning of higher interval notes
		const highResPosition = Math.round(cellOffset * HIGH_RESOLUTION_CELLS);
		return highResPosition / HIGH_RESOLUTION_CELLS;
	}

	/**
	 * Override drawNote to provide visual stacking for overlapping notes
	 * This makes it obvious when multiple notes are positioned close together
	 */
	drawNote(measure: number, laneIndex: number, cellOffset: number, noteId: string): boolean {
		// Normalize the position to prevent floating point precision issues
		const normalizedCellOffset = this.normalizePosition(cellOffset);

		const laneConfig = this.laneConfigs[laneIndex];
		if (!laneConfig) return false;

		// Find nearby notes in the same lane and measure to determine stacking
		const nearbyNotes = this.noteManager.findNearbyNotes(
			measure,
			laneIndex,
			normalizedCellOffset
		);
		const stackIndex = nearbyNotes.length; // Current note's position in the stack

		// Calculate base position
		const baseX = this.offsetX + this.cellWidth * laneIndex + this.cellMargin;

		// Calculate Y position using high-resolution positioning (same as BaseGame)
		const yOffset = this.getTotalMesaureOffest(measure);
		const { wholeCells, fractionalCell } = calculateHighResolutionPosition(
			normalizedCellOffset,
			this.cellsPerMeasure
		);

		let cellsYOffset = 0;
		for (let i = 0; i < wholeCells; i++) {
			cellsYOffset += this.getCellHeight(measure, i % this.cellsPerMeasure);
		}

		if (fractionalCell > 0) {
			cellsYOffset +=
				fractionalCell * this.getCellHeight(measure, wholeCells % this.cellsPerMeasure);
		}

		const baseY = this.offsetY - (yOffset + cellsYOffset) + this.cellMargin - this.noteSize;

		// Apply visual stacking
		const stackOffset = stackIndex * 3; // 3px horizontal offset per stacked note
		const x = baseX + stackOffset;
		const y = baseY;

		// Note dimensions
		const noteWidth = this.cellWidth - this.cellMargin * 2;
		const noteHeight = this.noteSize - this.cellMargin * 2;

		const noteKey = `note-${laneIndex}-${measure}-${normalizedCellOffset}`;
		const existingNote = this.panelContainer.getByName(noteKey);

		if (existingNote) {
			// If note already exists, don't create duplicate
			return false;
		}

		// Create visual note with enhanced styling for overlapped notes
		const graphics = this.add.graphics();

		// Add 2px border to all notes for better definition
		graphics.lineStyle(2, 0xffffff, stackIndex > 0 ? 0.9 : 0.7); // Brighter border for stacked notes

		// Set fill color with enhanced visual indicators for stacked notes
		if (stackIndex > 0) {
			graphics.fillStyle(laneConfig.noteColor, 0.9); // Slightly transparent for stacked notes
		} else {
			graphics.fillStyle(laneConfig.noteColor, 1.0); // Full opacity for single notes
		}

		graphics.fillRect(x, y, noteWidth, noteHeight);
		graphics.strokeRect(x, y, noteWidth, noteHeight); // Apply border to all notes

		graphics.setName(noteKey);
		this.panelContainer.add(graphics);

		// Add text label
		const text = this.add
			.text(x + noteWidth / 2, y + noteHeight / 2, noteId, {
				fontSize: stackIndex > 0 ? '14px' : '16px', // Smaller font for stacked notes
				color: '#ffffff',
				stroke: '#000000',
				strokeThickness: 1
			})
			.setOrigin(0.5);

		const textKey = `text-${laneIndex}-${measure}-${normalizedCellOffset}`;
		text.setName(textKey);
		this.panelContainer.add(text);

		return true;
	}

	shutdown() {
		// Reset cursor to default when shutting down
		this.input.setDefaultCursor('default');
		// Clean up context menu event listener when scene shuts down
		this.enableBrowserContextMenu();
		// Clean up beforeunload warning
		this.removeBeforeUnloadWarning();
		// Clean up auto-save timeout
		if (this.autoSaveTimeout !== null) {
			clearTimeout(this.autoSaveTimeout);
			this.autoSaveTimeout = null;
		}
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

		// Clean up active note subscription
		if (this.activeNoteSubscription) {
			this.activeNoteSubscription();
			this.activeNoteSubscription = null;
		}

		// Clean up key bindings subscription
		if (this.keyBindingsSubscription) {
			this.keyBindingsSubscription();
			this.keyBindingsSubscription = null;
		}

		// Clean up drag state
		this.noteManager.destroy();

		// Clear undo history when restarting
		this.noteManager.clearUndoHistory();

		// Reset cursor to default when restarting
		this.input.setDefaultCursor('default');
		// Re-enable browser context menu when restarting
		this.enableBrowserContextMenu();
		// Clean up beforeunload warning (will be re-setup in create)
		this.removeBeforeUnloadWarning();
		// Clean up auto-save timeout
		if (this.autoSaveTimeout !== null) {
			clearTimeout(this.autoSaveTimeout);
			this.autoSaveTimeout = null;
		}
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

			// Get the active note ID and draw it on the cursor
			const activeNote = get(store.activeNote);
			if (activeNote) {
				// Set up text styling to match the actual note text in editor (16px, centered)
				ctx.fillStyle = 'white';
				ctx.font = '16px sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';

				// Add text shadow for better visibility
				ctx.strokeStyle = 'black';
				ctx.lineWidth = 1;
				ctx.strokeText(activeNote, noteWidth / 2, noteHeight / 2);

				// Draw the text
				ctx.fillStyle = 'white';
				ctx.fillText(activeNote, noteWidth / 2, noteHeight / 2);
			}

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
	 * Set up global key binding listener for triggering active note changes
	 */
	private setupKeyBindingListener(): void {
		// Use document-level keydown listener to catch key presses
		document.addEventListener('keydown', (event: KeyboardEvent) => {
			// Only handle when editing mode is on and no modifier keys are pressed
			if (!this.isEditing || event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}

			// Ignore if typing in input fields
			const target = event.target as HTMLElement;
			if (
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable
			) {
				return;
			}

			const key = event.key.toLowerCase();
			const noteId = this.keyBindings[key];

			if (noteId) {
				event.preventDefault();
				// Set the active note to the bound note
				store.activeNote.set(noteId);

				// Update cursor to reflect new active note
				this.updateCursorForEditingMode();
			}
		});
	}

	/**
	 * Set up beforeunload warning to alert users about unsaved changes
	 */
	private setupBeforeUnloadWarning(): void {
		this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
			if (this.isDirty) {
				e.preventDefault();
				// Standard message for most browsers
				const message = 'You have unsaved changes. Are you sure you want to leave?';
				e.returnValue = message;
				return message;
			}
		};
		window.addEventListener('beforeunload', this.beforeUnloadHandler);
	}

	/**
	 * Remove beforeunload warning
	 */
	private removeBeforeUnloadWarning(): void {
		if (this.beforeUnloadHandler) {
			window.removeEventListener('beforeunload', this.beforeUnloadHandler);
			this.beforeUnloadHandler = null;
		}
	}

	/**
	 * Mark the editor as dirty (has unsaved changes)
	 */
	public setDirty(dirty: boolean = true): void {
		this.isDirty = dirty;
	}

	/**
	 * Check if the editor has unsaved changes
	 */
	public getDirty(): boolean {
		return this.isDirty;
	}

	/**
	 * Debounced auto-save to avoid performance issues during rapid editing
	 */
	private debouncedAutoSave(): void {
		// Clear existing timeout
		if (this.autoSaveTimeout !== null) {
			clearTimeout(this.autoSaveTimeout);
		}

		// Set new timeout
		this.autoSaveTimeout = window.setTimeout(() => {
			this.autoSaveChart();
			this.autoSaveTimeout = null;
		}, this.AUTO_SAVE_DELAY_MS);
	}

	/**
	 * Auto-save current chart data to localStorage
	 */
	private autoSaveChart(): void {
		try {
			const simfileID = get(store.currentSimfileID);
			const difficulty = get(store.currentDifficulty);
			TempChartStorage.save(
				simfileID,
				difficulty,
				this.notes,
				this.bpmNotes,
				this.measureCount
			);
		} catch (error) {
			console.warn('Failed to auto-save chart:', error);
		}
	}

	/**
	 * Auto-load chart data from localStorage if available
	 */
	private autoLoadChart(): boolean {
		try {
			const simfileID = get(store.currentSimfileID);
			const difficulty = get(store.currentDifficulty);
			const tempData = TempChartStorage.load(simfileID, difficulty);

			if (tempData) {
				console.log(
					'Loading temporary chart data for',
					`${simfileID || 'temp'}${difficulty ? `_${difficulty}` : ''}`
				);
				this.notes = tempData.notes;
				this.bpmNotes = tempData.bpmNotes;
				this.measureCount = tempData.measureCount;

				// Update store values
				store.measureCount.set(this.measureCount);
				this.syncNotesToStore();

				// Don't mark as dirty on load - only when user makes actual changes
				// The dirty state will be set when they start editing

				return true;
			}
		} catch (error) {
			console.warn('Failed to auto-load chart:', error);
		}

		return false;
	}

	/**
	 * Clear temporary storage (call this after successful save/export)
	 */
	public clearTempStorage(): void {
		try {
			const simfileID = get(store.currentSimfileID);
			const difficulty = get(store.currentDifficulty);
			TempChartStorage.remove(simfileID, difficulty);
			this.setDirty(false);
			console.log(
				'Cleared temporary chart data for',
				`${simfileID || 'temp'}${difficulty ? `_${difficulty}` : ''}`
			);
		} catch (error) {
			console.warn('Failed to clear temporary storage:', error);
		}
	}

	/**
	 * Clear selection - delegate to NoteManager
	 */
	clearSelection(): void {
		this.noteManager.clearSelection();
	}

	/**
	 * Delete note by key - delegate to NoteManager
	 */
	deleteNoteByKey(noteKey: string): void {
		this.noteManager.deleteNoteByKey(noteKey);
	}

	/**
	 * Highlight selected note - delegate to NoteManager
	 */
	highlightSelectedNote(noteGraphics: { name: string }): void {
		this.noteManager.highlightSelectedNote(noteGraphics);
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

	/**
	 * Sync current notes to the Svelte store for export
	 */
	private syncNotesToStore(): void {
		store.editorNotes.set(this.notes);
	}
}
