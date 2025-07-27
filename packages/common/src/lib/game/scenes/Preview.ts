import Phaser from 'phaser';
import { LaneMeasureNote } from '../../chart/note.js';
import { SoundChip } from '../../chart/dtx.js';
import type { SoundChip as SoundChipType } from '../../chart/dtx.js';
import { BaseGame } from './BaseGame.js';
import { AssetName, type LaneConfig } from '../interface.js';
import { calculateHighResolutionPosition } from '../utils/notePositioning.js';

interface Data {
	measureCount: number;
	notes: Record<string, LaneMeasureNote[]>;
	bpm: number;
	bpmNotes: Record<string, number>;
	startMeasure: number;
}

export class Preview extends BaseGame {
	static key = 'Preview';
	static bgmNoteID = '01';
	static bpmNoteID = '08';
	private playSpeed = 1;
	private bpm = 0;
	private startMeasure = 0;
	protected measureCount = 0;
	protected cellHeight = 50;

	private playingAudio: Phaser.Sound.WebAudioSound[] = [];
	private previewTween: Phaser.Tweens.Tween | null = null;
	protected measureLength: number[] = [];
	protected notes: Record<string, LaneMeasureNote[]> = {};
	protected bpmNotes: Record<string, number> = {};

	// Additional containers for separating elements with different scaling
	protected gridContainer!: Phaser.GameObjects.Container; // For grid lines that will scale
	protected notesContainer!: Phaser.GameObjects.Container; // For notes that won't scale

	constructor() {
		super({ key: Preview.key });
		this.laneConfigs = this.laneConfigs.filter((lane) => lane.playable);
	}

	init(data: Data) {
		this.measureCount = data.measureCount;
		this.notes = data.notes;
		this.bpm = data.bpm;
		this.bpmNotes = data.bpmNotes;
		this.startMeasure = data.startMeasure;
	}

	preload() {
		// Preload assets if any
		console.log('Preload sound');
	}

	create() {
		console.log('Create Preview Scene');

		// Initialize containers that will be used in drawPanel
		this.gridContainer = this.add.container(0, 0);
		this.notesContainer = this.add.container(0, 0);

		this.drawPanel();
		this.drawNotes();

		this.startPreview();
	}

	override drawPanel() {
		// Call super.drawFooter() to set up the footer container
		this.drawFooter();

		// Create panel container
		this.panelContainer = this.add.container(0, 0);
		this.panelContainer.setSize(this.scale.width, this.laneHeight);

		// Set up the container hierarchy
		this.panelContainer.add(this.gridContainer);
		this.panelContainer.add(this.notesContainer);

		// Parse measure lengths
		this.parseMesaureLength();

		// Draw grid lines into the gridContainer
		this.drawGridLines();

		// Set camera bounds and add mask for scrolling
		this.setCameraBounds();

		const mask = this.make.graphics();
		mask.fillStyle(0xffffff);
		mask.fillRect(0, 0, this.scale.width, this.scale.height - this.bottomMargin);
		this.panelContainer.setMask(mask.createGeometryMask());
	}

	// Helper method to draw grid lines into gridContainer
	drawGridLines() {
		// Create separate graphics objects for vertical and horizontal lines
		// This ensures proper rendering with different line styles
		const verticalLines = this.add.graphics();
		const horizontalLines = this.add.graphics();
		const measureLines = this.add.graphics();

		// Set line styles
		verticalLines.lineStyle(1, 0x888888, 1); // Light grey for cells
		horizontalLines.lineStyle(1, 0x888888, 1); // Light grey for cells
		measureLines.lineStyle(2, 0xffffff, 1); // White for measure lines

		// Draw vertical lanes
		let currentX = this.offsetX;
		this.laneConfigs.forEach(() => {
			verticalLines.moveTo(currentX, this.offsetY);
			verticalLines.lineTo(currentX, this.offsetY - this.laneHeight);
			currentX += this.cellWidth;
		});

		// Draw the last vertical line
		verticalLines.moveTo(currentX, this.offsetY);
		verticalLines.lineTo(currentX, this.offsetY - this.laneHeight);

		// Draw horizontal lines for measures
		let y = this.offsetY;
		for (let j = 0; j < this.measureCount; j++) {
			const measureHeight = this.getMeasureHeight(j);

			// Draw the measure line
			measureLines.moveTo(this.offsetX, y);
			measureLines.lineTo(this.offsetX + this.totalWidth, y);

			// Draw cell lines within each measure (subdivisions)
			const cellsPerMeasure = this.cellsPerMeasure;
			const cellHeight = measureHeight / cellsPerMeasure;

			for (let i = 1; i < cellsPerMeasure; i++) {
				const cellY = y - i * cellHeight;
				horizontalLines.moveTo(this.offsetX, cellY);
				horizontalLines.lineTo(this.offsetX + this.totalWidth, cellY);
			}

			// Update y for the next measure
			y -= measureHeight;
		}

		// Stroke all paths and add to gridContainer
		verticalLines.strokePath();
		horizontalLines.strokePath();
		measureLines.strokePath();

		this.gridContainer.add(verticalLines);
		this.gridContainer.add(horizontalLines);
		this.gridContainer.add(measureLines);
	}

	startPreview() {
		// Update camera zoom based on current play speed
		this.updateCameraZoom();

		// Create a new preview tween starting from the beginning (0 progress)
		this.createPreviewTween();
	}

	getTimeElapsed(measure: number, noteChipPosition: number = 0) {
		let elapsedTime = 0;
		let currentBPM = this.bpm;

		// Calculate time for completed measures (up to but not including the current measure)
		for (let i = 0; i < measure; i++) {
			const measureLength = this.measureLength[i] || 1;
			const bpmNotes =
				this.notes[Preview.bpmNoteID]?.filter((note) => note.measure === i) || [];
			if (bpmNotes.length === 0) {
				// No BPM changes in this measure, use the current BPM for the whole measure
				elapsedTime += (60 / currentBPM) * 4 * measureLength;
			} else {
				// Calculate time for each segment within the measure
				let lastPosition = 0;
				bpmNotes.forEach((bpmNote) => {
					// Set the measureLength for the note
					if (bpmNote.measureLength === 1) {
						bpmNote.measureLength = measureLength;
					}
					bpmNote.notes.forEach((note: { noteID: string; position: number }) => {
						const position = note.position;
						elapsedTime +=
							(60 / currentBPM) * 4 * (position - lastPosition) * measureLength;
						currentBPM = this.bpmNotes[note.noteID];
						lastPosition = position;
					});
				});
				// Add the remaining time in the measure after the last BPM change
				elapsedTime += (60 / currentBPM) * 4 * (1 - lastPosition) * measureLength;
			}
		}

		// Calculate time within the current measure up to the noteChipPosition
		if (noteChipPosition > 0) {
			const measureLength = this.measureLength[measure] || 1;
			const bpmNotes =
				this.notes[Preview.bpmNoteID]?.filter((note) => note.measure === measure) || [];

			if (bpmNotes.length === 0) {
				// No BPM changes in this measure
				elapsedTime += (60 / currentBPM) * 4 * noteChipPosition;
			} else {
				// Calculate time for each segment within the measure up to noteChipPosition
				let lastPosition = 0;
				bpmNotes.forEach((bpmNote) => {
					// Set the measureLength for the note
					if (bpmNote.measureLength === 1) {
						bpmNote.measureLength = measureLength;
					}
					bpmNote.notes.forEach((note: { noteID: string; position: number }) => {
						const position = note.position;
						if (position > noteChipPosition) {
							// Past the noteChipPosition, stop calculating
							return;
						}
						const noteId = note.noteID;
						if (noteId !== '00') {
							elapsedTime += (60 / currentBPM) * 4 * (position - lastPosition);
							currentBPM = this.bpmNotes[noteId];
							lastPosition = position;
						}
					});
				});

				// Add time from last BPM change to noteChipPosition
				if (noteChipPosition > lastPosition) {
					elapsedTime += (60 / currentBPM) * 4 * (noteChipPosition - lastPosition);
				}
			}
		}

		return elapsedTime;
	}

	override setCameraBounds() {
		this.cameras.main.setBounds(
			0,
			-this.laneHeight - this.bottomMargin,
			this.scale.width,
			this.laneHeight + this.bottomMargin + this.cameras.main.height
		);

		// Initialize camera zoom
		this.updateCameraZoom();
	}

	/**
	 * Creates a tween animation for preview scrolling
	 * @param startY - The starting Y position of the panel
	 */
	createPreviewTween(startY: number | undefined = undefined) {
		// Calculate target distances
		const cameraScaleOffset = this.cameras.main.height * (this.playSpeed - 1);
		const targetY = this.getTotalMesaureOffest(this.startMeasure) * this.playSpeed;
		const totalDistance =
			this.getTotalMesaureOffest(this.measureCount) * this.playSpeed - cameraScaleOffset;

		// Calculate total duration based on BPM
		const totalDuration =
			(this.getTimeElapsed(this.measureCount) - this.getTimeElapsed(this.startMeasure)) *
			1000;

		// Clean up existing tween if any
		if (this.previewTween) {
			this.previewTween.stop();
			this.previewTween.destroy();
			this.previewTween = null;
		}

		// Set the panel position if different from current
		this.panelContainer.setPosition(0, startY || targetY - cameraScaleOffset);

		// Create a new tween
		this.previewTween = this.tweens.add({
			targets: this.panelContainer,
			y: totalDistance,
			duration: totalDuration,
			ease: 'Linear',
			repeat: -1,
			repeatDelay: 0,
			holdDelayedCalls: false,
			yoyo: false
		});

		return this.previewTween;
	}

	getCellHeight(measure: number, cell: number): number {
		// For given measure and cell, calculate the height of the cell based on the BPM
		const referenceBPM = 120;

		// Find all BPM notes that apply to this measure
		const measureBpmNotes = this.notes[Preview.bpmNoteID]
			?.filter((note) => note.measure <= measure)
			.sort((a, b) => {
				// Sort by measure (ascending)
				if (a.measure !== b.measure) return a.measure - b.measure;
				// For notes in the same measure, we'll handle them later
				return 0;
			});

		if (!measureBpmNotes || measureBpmNotes.length === 0) {
			// No BPM changes, use the default BPM
			return (this.cellHeight / this.bpm) * referenceBPM;
		}

		// Find the most recent BPM change before or at our current cell position
		const lastBpmNote = measureBpmNotes[measureBpmNotes.length - 1];
		let currentBPM = this.bpm; // Default to the initial BPM

		if (lastBpmNote.measure < measure) {
			// BPM change in a previous measure, need to find the last BPM in that measure
			const bpmNotes = lastBpmNote.notes;

			// Find the last BPM change in the notes array
			for (const note of bpmNotes) {
				if (note.noteID !== '00') {
					currentBPM = this.bpmNotes[note.noteID];
				}
			}
		} else if (lastBpmNote.measure === measure) {
			// BPM change in the current measure
			const bpmNotes = lastBpmNote.notes;

			// Find the last BPM change before or at our cell position
			for (const note of bpmNotes) {
				const cellPosition = Math.floor(note.position * this.cellsPerMeasure);
				if (cellPosition > cell) {
					break; // This BPM change is after our current cell
				}

				if (note.noteID !== '00') {
					currentBPM = this.bpmNotes[note.noteID];
				}
			}
		}

		// Calculate the adjusted cell height based on the BPM
		// Slower BPM = taller cells, faster BPM = shorter cells
		return (this.cellHeight / currentBPM) * referenceBPM;
	}

	drawFooterLane(laneConfig: LaneConfig, currentX: number) {
		const text = this.add
			.text(currentX + this.cellWidth / 2, this.offsetY + 20, laneConfig.name, {
				fontSize: '14px',
				color: '#ffffff'
			})
			.setOrigin(0.5);
		this.footerContainer.add(text);
	}

	updateCameraZoom() {
		// Apply scale to grid container only
		if (this.gridContainer) {
			this.gridContainer.setScale(1, this.playSpeed);
		}

		// Ensure notes container maintains normal scale
		if (this.notesContainer) {
			this.notesContainer.setScale(1, this.playSpeed);
			this.notesContainer
				.getAll()
				.forEach((obj) =>
					(obj as Phaser.GameObjects.Graphics).setScale(1, 1 / this.playSpeed)
				);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	override drawNote(measure: number, laneIndex: number, cellOffset: number, noteId: string) {
		const laneConfig = this.laneConfigs[laneIndex];
		if (!laneConfig) return false;

		const x = this.offsetX + this.cellWidth * laneIndex + this.cellWidth / 2;

		// Calculate Y position based on measure offset and cell position
		const yOffset = this.getTotalMesaureOffest(measure);

		// Calculate the position within the measure using high-resolution grid
		const { wholeCells, fractionalCell } = calculateHighResolutionPosition(
			cellOffset,
			this.cellsPerMeasure
		);

		// Add offsets for each cell up to the note position
		let cellsYOffset = 0;

		for (let i = 0; i < wholeCells; i++) {
			cellsYOffset += this.getCellHeight(measure, i % this.cellsPerMeasure);
		}

		// Add fractional cell offset
		if (fractionalCell > 0) {
			cellsYOffset +=
				fractionalCell * this.getCellHeight(measure, wholeCells % this.cellsPerMeasure);
		}

		const y = this.offsetY - (yOffset + cellsYOffset);

		const noteKey = `note-${laneIndex}-${measure}-${cellOffset}`;
		const existingNote = this.children.getByName(noteKey);

		if (existingNote) {
			// If the note already exists, remove it
			this.children.getAll('name', noteKey).forEach((note) => {
				note.destroy();
			});
			return false;
		} else {
			// Create a simple colored rectangle for preview
			const graphics = this.add.graphics();
			graphics.fillStyle(laneConfig.noteColor, 1);
			graphics.fillRect(
				x - this.cellWidth / 4,
				y - this.noteSize / 2,
				this.cellWidth / 2,
				this.noteSize
			);
			graphics.setName(noteKey);

			// Add to the notes container instead of panel container
			this.notesContainer.add(graphics);
			return true;
		}
	}

	cleanUp() {
		if (this.previewTween) {
			this.previewTween.stop();
			this.previewTween.destroy();
			this.previewTween = null;
		}

		this.playingAudio.forEach((audio) => {
			audio.stop();
		});
		this.playingAudio = [];

		// Reset all container scales
		if (this.gridContainer) this.gridContainer.setScale(1);
		if (this.notesContainer) this.notesContainer.setScale(1);

		// Reset camera zoom
		if (this.cameras && this.cameras.main) {
			this.cameras.main.setZoom(1);
		}

		this.time.removeAllEvents();
	}
}
