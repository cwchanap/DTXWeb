import Phaser from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { BaseGame } from './BaseGame';
import { Preview } from './Preview';
import { get } from 'svelte/store';
import store from '../../store';
import type { LaneConfig } from '../interface';
import { LaneMeasureNote } from '../../chart/note';
import type { DeletedNoteData } from './editor/NoteBuffer';
import { NoteManager } from './editor/NoteManager';
import { calculateHighResolutionPosition, HIGH_RESOLUTION_CELLS } from '../utils/notePositioning';
// Note: TempChartStorage and SoundLibrary services are implemented
// differently in dtx-web and dtx-desktop, so they're not imported here

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private noteManager: NoteManager;
	private contextMenuHandler: ((e: Event) => void) | null = null;
	private keyBindingHandler: ((e: KeyboardEvent) => void) | null = null;
	private currentLaneIndex = -1;
	private activeNoteSubscription: (() => void) | null = null;
	private keyBindingsSubscription: (() => void) | null = null;
	private dtxFileSubscription: (() => void) | null = null;
	private soundChipSubscription: (() => void) | null = null;
	private isDirty = false; // Track if editor has changes for preview rebuilding
	private autoSaveTimeout: Phaser.Time.TimerEvent | null = null;
	private readonly AUTO_SAVE_DELAY_MS = 2000; // Debounce auto-save by 2 seconds
	private keyBindings: Record<string, string> = {}; // key -> noteId mapping
	private isInitializing = false; // Flag to prevent auto-save during initialization
	private isLoaded = false; // Flag to track if scene has finished loading and drawing
	private soundFileHashCache: Map<File, string> = new Map(); // Cache file hashes to avoid recomputing
	private onGridSpacingUpdate?: (cellsPerMeasure: number) => void;
	private onCellHeightUpdate?: (height: number) => void;

	// Store references to grid line graphics for direct access
	private cellLinesGraphics: Phaser.GameObjects.Graphics | null = null;
	private beatLinesGraphics: Phaser.GameObjects.Graphics | null = null;
	private measureLinesGraphics: Phaser.GameObjects.Graphics | null = null;
	private verticalLinesGraphics: Phaser.GameObjects.Graphics | null = null;

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
		// Set initialization flag to prevent auto-save during setup
		this.isInitializing = true;

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
		this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
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
					// Snap to current grid spacing for note placement
					// Use Math.floor to ensure clicks stay within the current grid cell
					// This allows placement at 8th, 12th, 16th, 24th, 48th, or 64th note intervals
					const gridPosition = Math.floor(positionInMeasure * this.cellsPerMeasure);
					const rawCellOffset = gridPosition / this.cellsPerMeasure;

					// Normalize the position for storage compatibility with high-resolution system
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
		this.onGridSpacingUpdate = (cellsPerMeasure: number) => {
			this.updateGridSpacing(cellsPerMeasure);
		};
		this.onCellHeightUpdate = (height: number) => {
			this.updateCellHeight(height);
		};
		EventBus.on(EventType.GRID_SPACING_UPDATE, this.onGridSpacingUpdate);
		EventBus.on(EventType.CELL_HEIGHT_UPDATE, this.onCellHeightUpdate);
		EventBus.on(
			EventType.NOTE_IMPORT,
			async (notes: LaneMeasureNote[], bpmNotes: Record<string, number>) => {
				// Mark as not loaded at the start of import process
				this.isLoaded = false;
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
				await this.autoSaveChart(); // Save immediately instead of debounced
				this.setDirty(false); // Clear dirty state after importing notes
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

			// If preview scene doesn't exist, create it
			if (!this.scene.isActive(Preview.key) && !this.scene.isPaused(Preview.key)) {
				// Launch new preview
				this.scene.launch(Preview.key, {
					bpm: bpm,
					bpmNotes: this.bpmNotes,
					notes: this.notes,
					measureCount: this.measureCount,
					startMeasure: currentMeasure
				});

				// Clear dirty state after successful preview creation
				this.setDirty(false);
			} else if (this.isDirty) {
				// Update existing scene data without recreating
				const previewScene = this.scene.get(Preview.key) as Preview;
				if (previewScene) {
					// Update scene data
					previewScene.updateData({
						bpm: bpm,
						bpmNotes: this.bpmNotes,
						notes: this.notes,
						measureCount: this.measureCount,
						startMeasure: currentMeasure
					});
					this.scene.setVisible(true, Preview.key);
					this.scene.resume(Preview.key);

					// Clear dirty state after successful preview update
					this.setDirty(false);
				} else {
					// Fallback to recreation if scene not found
					this.scene.launch(Preview.key, {
						bpm: bpm,
						bpmNotes: this.bpmNotes,
						notes: this.notes,
						measureCount: this.measureCount,
						startMeasure: currentMeasure
					});

					// Clear dirty state after successful preview creation
					this.setDirty(false);
				}
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
			// Pause the preview scene to keep it alive for resume
			if (this.scene.isActive(Preview.key)) {
				this.scene.pause(Preview.key);
				this.scene.setVisible(false, Preview.key);
			}
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

		// Listen for DTX file metadata changes (MainTab changes)
		this.dtxFileSubscription = store.currentDtxFile.subscribe((dtxFile) => {
			if (dtxFile && !this.isInitializing) {
				// Set dirty and trigger auto-save when metadata changes
				// Only after initialization to avoid marking as dirty during load
				this.setDirty(true);
				this.debouncedAutoSave();
			}
		});

		// Listen for sound chip changes (SoundTab changes)
		this.soundChipSubscription = store.currentSoundChip.subscribe((soundChips) => {
			if (soundChips && !this.isInitializing) {
				// Set dirty and trigger auto-save when sound chips change
				// Only after initialization to avoid marking as dirty during load
				this.setDirty(true);
				this.debouncedAutoSave();
			}
		});

		// Initialization complete - enable auto-save for future changes
		this.isInitializing = false;

		// All drawing operations are synchronous, so scene is loaded when create() completes
		this.markAsLoaded();
	}

	update() {
		// Update logic if needed
	}

	/**
	 * Update the grid spacing (cells per measure) for more precise note placement
	 * @param cellsPerMeasure - Number of cells per measure (4=quarter notes, 8=eighth notes, 16=sixteenth notes, 32=thirty-second notes, etc.)
	 */
	public updateGridSpacing(cellsPerMeasure: number): void {
		// Validate input
		if (cellsPerMeasure <= 0 || !Number.isInteger(cellsPerMeasure)) {
			console.warn('Invalid cellsPerMeasure value:', cellsPerMeasure);
			return;
		}

		this.cellsPerMeasure = cellsPerMeasure;

		// Redraw only the grid lines to show new spacing density
		this.redrawGridLines();
	}

	/**
	 * Update the base cell height (pixel size) for visual zoom
	 * @param height - Height in pixels for each cell
	 */
	public updateCellHeight(height: number): void {
		// Validate input
		if (height <= 0 || height > 100) {
			console.warn('Invalid cell height value:', height);
			return;
		}

		this.cellHeight = height;

		// Need to completely redraw the scene since cell height affects all measurements
		this.redrawScene();
	}

	/**
	 * Redraw the entire scene (used when cell height changes affect all measurements)
	 */
	private redrawScene(): void {
		// Clear existing visual elements
		this.panelContainer.removeAll(true);
		this.footerContainer.removeAll(true);

		// Reset graphics references since they're destroyed
		this.cellLinesGraphics = null;
		this.beatLinesGraphics = null;
		this.measureLinesGraphics = null;
		this.verticalLinesGraphics = null;

		// Redraw panel and notes with new settings
		this.drawPanel();
		this.drawNotes();

		// Mark as dirty since visual changes affect gameplay
		this.setDirty(true);
		this.debouncedAutoSave();
	}

	/**
	 * Redraw only the horizontal grid lines with new spacing, preserving existing notes
	 */
	private redrawGridLines(): void {
		// Remove existing horizontal grid line graphics using stored references
		if (this.cellLinesGraphics) {
			this.panelContainer.remove(this.cellLinesGraphics);
			this.cellLinesGraphics.destroy();
			this.cellLinesGraphics = null;
		}

		if (this.beatLinesGraphics) {
			this.panelContainer.remove(this.beatLinesGraphics);
			this.beatLinesGraphics.destroy();
			this.beatLinesGraphics = null;
		}

		if (this.measureLinesGraphics) {
			this.panelContainer.remove(this.measureLinesGraphics);
			this.measureLinesGraphics.destroy();
			this.measureLinesGraphics = null;
		}

		// Recreate horizontal grid lines with new spacing
		this.drawHorizontalGridLines();

		// Mark as dirty since grid spacing affects gameplay
		this.setDirty(true);
		this.debouncedAutoSave();
	}

	/**
	 * Draw horizontal grid lines (cell, beat, and measure lines) with current grid spacing
	 */
	private drawHorizontalGridLines(): void {
		// Create graphics objects for different line thicknesses
		this.cellLinesGraphics = this.add.graphics();
		this.beatLinesGraphics = this.add.graphics();
		this.measureLinesGraphics = this.add.graphics();

		// Set line styles for each graphics object
		this.cellLinesGraphics.lineStyle(2, 0x888888, 0.5); // Light grey for cells
		this.beatLinesGraphics.lineStyle(4, 0x888888, 0.5); // Light grey for beat divisions
		this.measureLinesGraphics.lineStyle(6, 0xffffff, 0.5); // White for measure lines

		// Draw horizontal lines for cells and measures
		let y = this.offsetY;
		for (let j = 0; j < this.measureCount; j++) {
			const measureHeight = this.drawMeasure(
				j,
				y,
				this.cellLinesGraphics,
				this.beatLinesGraphics,
				this.measureLinesGraphics
			);
			y -= measureHeight;
		}

		// Stroke all graphics objects
		this.cellLinesGraphics.strokePath();
		this.beatLinesGraphics.strokePath();
		this.measureLinesGraphics.strokePath();

		// Add to panel container at the beginning (behind notes and text)
		// This ensures grid lines appear behind existing notes
		this.panelContainer.addAt(this.cellLinesGraphics, 0);
		this.panelContainer.addAt(this.beatLinesGraphics, 0);
		this.panelContainer.addAt(this.measureLinesGraphics, 0);
	}

	drawPanel() {
		this.drawFooter();
		this.panelContainer = this.add.container(0, 0);
		const scrollableHeight = this.laneHeight + this.bottomMargin;
		this.panelContainer.setSize(this.scale.width, scrollableHeight);

		this.parseMesaureLength();

		// Create separate graphics objects for different line thicknesses
		this.verticalLinesGraphics = this.add.graphics();
		this.cellLinesGraphics = this.add.graphics();
		this.beatLinesGraphics = this.add.graphics();
		this.measureLinesGraphics = this.add.graphics();

		// Set line styles for each graphics object
		this.verticalLinesGraphics.lineStyle(1, 0x888888, 1); // Light grey for vertical lanes
		this.cellLinesGraphics.lineStyle(2, 0x888888, 0.5); // Light grey for cells
		this.beatLinesGraphics.lineStyle(4, 0x888888, 0.5); // Light grey for beat divisions
		this.measureLinesGraphics.lineStyle(6, 0xffffff, 0.5); // White for measure lines

		// Draw vertical lanes
		let currentX = this.offsetX;
		this.laneConfigs.forEach(() => {
			this.verticalLinesGraphics!.moveTo(currentX, this.offsetY);
			this.verticalLinesGraphics!.lineTo(currentX, this.offsetY - this.laneHeight);
			currentX += this.cellWidth;
		});

		// Draw the last vertical line
		this.verticalLinesGraphics.moveTo(currentX, this.offsetY);
		this.verticalLinesGraphics.lineTo(currentX, this.offsetY - this.laneHeight);

		// Draw horizontal lines for cells and measures
		let y = this.offsetY;
		for (let j = 0; j < this.measureCount; j++) {
			const measureHeight = this.drawMeasure(
				j,
				y,
				this.cellLinesGraphics,
				this.beatLinesGraphics,
				this.measureLinesGraphics
			);
			y -= measureHeight;
		}

		// Stroke all graphics objects
		this.verticalLinesGraphics.strokePath();
		this.cellLinesGraphics.strokePath();
		this.beatLinesGraphics.strokePath();
		this.measureLinesGraphics.strokePath();

		// Add all graphics to the panel container
		this.panelContainer.add(this.verticalLinesGraphics);
		this.panelContainer.add(this.cellLinesGraphics);
		this.panelContainer.add(this.beatLinesGraphics);
		this.panelContainer.add(this.measureLinesGraphics);

		this.setCameraBounds();

		const mask = this.make.graphics();
		mask.fillStyle(0xffffff);
		mask.fillRect(0, 0, this.scale.width, this.scale.height - this.bottomMargin);
		this.panelContainer.setMask(mask.createGeometryMask());
	}

	/**
	 * Override getCellHeight to maintain constant measure height regardless of grid spacing
	 * This ensures that changing from 16th to 24th notes doesn't change the total measure size
	 */
	getCellHeight(_measure: number, _cell: number): number {
		// mark parameters as intentionally unused while keeping signature compatible
		void _measure;
		void _cell;
		// Calculate base measure height using default 16 cells per measure
		const baseCellsPerMeasure = 16;
		const baseCellHeight = this.cellHeight; // Use current dynamic cell height
		const baseMeasureHeight = baseCellsPerMeasure * baseCellHeight; // 16 * cellHeight

		// Adjust cell height to maintain constant measure height
		// For 24 cells: 400/24 ≈ 16.67px per cell
		// For 8 cells: 400/8 = 50px per cell
		return baseMeasureHeight / this.cellsPerMeasure;
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
		// Clean up key binding listener to prevent memory leaks
		this.removeKeyBindingListener();
		// Clean up auto-save timeout
		if (this.autoSaveTimeout !== null) {
			this.autoSaveTimeout.destroy();
			this.autoSaveTimeout = null;
		}
	}

	restart(data: Data = {}) {
		// Reset loading state
		this.isLoaded = false;
		// Clear hash cache to avoid stale File references
		this.soundFileHashCache.clear();
		EventBus.off(EventType.MEASURE_UPDATE);
		EventBus.off(EventType.GRID_SPACING_UPDATE);
		EventBus.off(EventType.CELL_HEIGHT_UPDATE);
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

		// Clean up EventBus listeners
		if (this.onGridSpacingUpdate) {
			EventBus.off(EventType.GRID_SPACING_UPDATE, this.onGridSpacingUpdate);
		}
		if (this.onCellHeightUpdate) {
			EventBus.off(EventType.CELL_HEIGHT_UPDATE, this.onCellHeightUpdate);
		}

		// Clean up key bindings subscription
		if (this.keyBindingsSubscription) {
			this.keyBindingsSubscription();
			this.keyBindingsSubscription = null;
		}

		// Clean up DTX file subscription
		if (this.dtxFileSubscription) {
			this.dtxFileSubscription();
			this.dtxFileSubscription = null;
		}

		// Clean up sound chip subscription
		if (this.soundChipSubscription) {
			this.soundChipSubscription();
			this.soundChipSubscription = null;
		}

		// Clean up drag state
		this.noteManager.destroy();

		// Clear undo history when restarting
		this.noteManager.clearUndoHistory();

		// Reset cursor to default when restarting
		this.input.setDefaultCursor('default');
		// Re-enable browser context menu when restarting
		this.enableBrowserContextMenu();
		// Clean up key binding listener to prevent memory leaks
		this.removeKeyBindingListener();
		// Clean up auto-save timeout
		if (this.autoSaveTimeout !== null) {
			this.autoSaveTimeout.destroy();
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
		// Store the handler function so it can be removed later
		this.keyBindingHandler = (event: KeyboardEvent) => {
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
		};

		// Use document-level keydown listener to catch key presses
		document.addEventListener('keydown', this.keyBindingHandler);
	}

	/**
	 * Remove the global key binding listener to prevent memory leaks
	 */
	private removeKeyBindingListener(): void {
		if (this.keyBindingHandler) {
			document.removeEventListener('keydown', this.keyBindingHandler);
			this.keyBindingHandler = null;
		}
	}

	/**
	 * Mark the editor as dirty (has changes that require preview rebuild)
	 */
	public setDirty(dirty: boolean = true): void {
		this.isDirty = dirty;
	}

	/**
	 * Check if the editor has changes that require preview rebuild
	 */
	public getDirty(): boolean {
		return this.isDirty;
	}

	/**
	 * Check if the editor has finished loading and drawing
	 */
	public getIsLoaded(): boolean {
		return this.isLoaded;
	}

	/**
	 * Mark the editor as fully loaded and emit the event
	 */
	private markAsLoaded(): void {
		if (!this.isLoaded) {
			this.isLoaded = true;
			EventBus.emit(EventType.EDITOR_LOADED, this);
		}
	}

	/**
	 * Debounced auto-save to avoid performance issues during rapid editing
	 */
	private debouncedAutoSave(): void {
		// Clear existing timeout
		if (this.autoSaveTimeout !== null) {
			this.autoSaveTimeout.destroy();
		}

		// Set new timeout using Phaser's time management
		this.autoSaveTimeout = this.time.delayedCall(this.AUTO_SAVE_DELAY_MS, async () => {
			await this.autoSaveChart();
			this.autoSaveTimeout = null;
		});
	}

	/**
	 * Auto-save current chart data to localStorage
	 * NOTE: This method requires TempChartStorage and SoundLibrary services
	 * that are implemented differently in dtx-web and dtx-desktop.
	 * Override this method in your specific implementation.
	 */
	public async autoSaveChart(): Promise<void> {
		// Default implementation does nothing
		// Override in dtx-web and dtx-desktop implementations
	}

	/**
	 * Auto-load chart data from localStorage if available
	 * NOTE: This method requires TempChartStorage and SoundLibrary services.
	 * Override this method in your specific implementation.
	 */
	private autoLoadChart(): boolean {
		// Default implementation does nothing
		// Override in dtx-web and dtx-desktop implementations
		return false;
	}

	/**
	 * Clear temporary storage (call this after successful save/export)
	 * NOTE: This method requires TempChartStorage service.
	 * Override this method in your specific implementation.
	 */
	public clearTempStorage(): void {
		// Default implementation just clears dirty state
		this.setDirty(false);
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

	/**
	 * Get current grid spacing (cells per measure)
	 */
	getGridSpacing(): number {
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
