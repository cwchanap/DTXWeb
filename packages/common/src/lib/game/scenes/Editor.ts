import Phaser from 'phaser';
import { BaseGame } from './BaseGame.js';
import type { LaneConfig } from '../interface.js';
import { LaneMeasureNote } from '../../chart/note.js';
import {
	calculateHighResolutionPosition,
	HIGH_RESOLUTION_CELLS
} from '../utils/notePositioning.js';

interface Data {
	measureCount?: number;
}

export class Editor extends BaseGame {
	public static key = 'Editor';

	private isEditing = false;
	private currentLaneIndex = -1;
	private isDirty = false;
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
									measureNote.notes = measureNote.notes.filter(
										(note) => note.position !== cellOffset
									);

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
								this.setDirty(true);
							}
						}
					} else {
						// Left-click: Add a note
						const laneId = this.laneConfigs[laneIndex].id;
						const activeNote = '01'; // Default note
						this.addNoteToEditor(measure, laneIndex, cellOffset, laneId, activeNote);
					}
				}
			}
		});

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
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

		const x = baseX;
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

		// Create visual note
		const graphics = this.add.graphics();

		// Add 2px border to all notes for better definition
		graphics.lineStyle(2, 0xffffff, 0.7);

		// Set fill color
		graphics.fillStyle(laneConfig.noteColor, 1.0);

		graphics.fillRect(x, y, noteWidth, noteHeight);
		graphics.strokeRect(x, y, noteWidth, noteHeight);

		graphics.setName(noteKey);
		this.panelContainer.add(graphics);

		// Add text label
		const text = this.add
			.text(x + noteWidth / 2, y + noteHeight / 2, noteId, {
				fontSize: '16px',
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
	}

	restart(data: Data = {}) {
		this.input.off('pointerdown');
		this.input.off('pointermove');
		this.input.off('wheel');
		this.input.keyboard?.off('keydown-Q');

		// Reset cursor to default when restarting
		this.input.setDefaultCursor('default');
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
	 * Add a note to the editor
	 */
	private addNoteToEditor(
		measure: number,
		laneIndex: number,
		cellOffset: number,
		laneId: string,
		noteId: string
	): void {
		// Normalize the position
		const normalizedCellOffset = this.normalizePosition(cellOffset);

		// Check if note already exists at this position
		const noteKey = `note-${laneIndex}-${measure}-${normalizedCellOffset}`;
		const existingNote = this.panelContainer.getByName(noteKey);
		if (existingNote) {
			return; // Don't add duplicate notes
		}

		// Create the note data structure
		if (!(laneId in this.notes)) {
			this.notes[laneId] = [];
		}

		// Find existing measure note or create new one
		let measureNote = this.notes[laneId].find((note) => note.measure === measure);
		if (!measureNote) {
			measureNote = new LaneMeasureNote(
				measure,
				laneId,
				[],
				this.measureLength[measure] || 1
			);
			this.notes[laneId].push(measureNote);
		}

		// Add the note chip
		measureNote.addNote(noteId, normalizedCellOffset);

		// Draw the note visually
		this.drawNote(measure, laneIndex, normalizedCellOffset, noteId);

		this.setDirty(true);
	}

	// Getter methods for external access
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

	public getByName(name: string): { name: string } | null {
		return this.panelContainer.getByName(name);
	}
}
