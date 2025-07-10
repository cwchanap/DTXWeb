import { Sound } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import store from '$lib/store';
import { XAaudioContext } from '$lib/browser/audioDecoder';
import type { LaneMeasureNote, SoundChip } from '@dtx/common';
import { BaseGame } from './BaseGame';
import { AssetName, type LaneConfig } from '../interface';
import { getAssetPath } from '../utils';

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

		store.playSpeed.subscribe((value) => {
			const oldPlaySpeed = this.playSpeed;
			this.playSpeed = value;

			// Update camera zoom based on play speed
			if (this.cameras && this.cameras.main) {
				this.updateCameraZoom();
			}

			// Update tween if it exists
			if (this.previewTween) {
				// Use our consolidated method to recreate the tween with current position and progress
				const cameraScaleOffset = this.cameras.main.height * (oldPlaySpeed - 1);
				this.createPreviewTween(
					((this.panelContainer.y + cameraScaleOffset) / oldPlaySpeed) * value
				);
			}
		});
	}

	preload() {
		// Preload assets if any
		console.log('Preload sound');
		// Load sound chip samples
		const soundChips = get(store.currentSoundChip);

		if (soundChips) {
			const addedKey = new Set();
			soundChips.forEach((soundChip) => {
				if (!soundChip.fileName || !soundChip.file) return;

				const cacheKey = this.getCacheKey(soundChip);
				this.cache.audio.remove(cacheKey);

				if (addedKey.has(cacheKey)) return;
				addedKey.add(cacheKey);
				if (soundChip.fileName.toLowerCase().endsWith('.xa')) {
					// For XA files, we'll load them with custom audio context
					this.load.audio({
						key: cacheKey,
						url: [URL.createObjectURL(soundChip.file)],
						context: XAaudioContext
					});
				} else {
					// For other formats, load as usual
					this.load.audio(cacheKey, URL.createObjectURL(soundChip.file));
				}
			});
		}

		this.load.spritesheet(AssetName.LANE_ICONS, getAssetPath(AssetName.LANE_ICONS), {
			frameWidth: 96,
			frameHeight: 96
		});

		// Load the drum chips spritesheet as a regular image
		this.load.image(AssetName.DRUM_CHIPS, getAssetPath(AssetName.DRUM_CHIPS));
	}

	create() {
		console.log('Create Preview Scene');

		// Create animations for each note type
		this.createNoteAnimations();

		// Initialize containers that will be used in drawPanel
		this.gridContainer = this.add.container(0, 0);
		this.notesContainer = this.add.container(0, 0);

		this.drawPanel();
		this.drawNotes();

		const soundChips = get(store.currentSoundChip);

		if (soundChips) {
			soundChips.forEach((soundChip) => {
				if (!soundChip.fileName || !soundChip.file) return;
				const cacheKey = this.getCacheKey(soundChip);
				this.sound.add(cacheKey) as Sound.WebAudioSound;
			});
		}

		this.startPreview();

		EventBus.emit(EventType.SCENE_READY, this);
		EventBus.on(EventType.STOP_PREVIEW, () => this.cleanUp());
		EventBus.on(EventType.RESUME_PREVIEW, (data: { startMeasure: number }) => {
			this.startMeasure = data.startMeasure;
			this.startPreview();
		});
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

		const secondsPerMeasure = (60 * 4) / this.bpm;

		this.notes[Preview.bgmNoteID].forEach((note) =>
			this.scheduleBGMPlayback(note, secondsPerMeasure, this.startMeasure)
		);

		this.laneConfigs
			.filter((lane) => lane.playable)
			.forEach((lane) => {
				if (this.notes[lane.id]) {
					this.notes[lane.id]
						.filter((note) => note.measure >= this.startMeasure)
						.forEach((note) =>
							this.scheduleNotePlayback(note, secondsPerMeasure, this.startMeasure)
						);
				}
			});
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

	getCacheKey(soundChip: SoundChip) {
		return `soundchip_${soundChip.fileName.toLowerCase()}`;
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

	scheduleBGMPlayback(note: LaneMeasureNote, secondsPerMeasure: number, startMeasure: number) {
		// Set the measureLength for the note if it's not already set
		if (note.measureLength === 1) {
			note.measureLength = this.measureLength[note.measure] || 1;
		}

		note.notes.forEach((noteChip: { noteID: string; position: number }) => {
			// Calculate the absolute time of this note from the beginning
			const noteAbsoluteTime = this.getTimeElapsed(note.measure, noteChip.position);

			// Calculate the absolute time of the start measure
			const startTime = this.getTimeElapsed(startMeasure);

			// The delay is the difference between when the note should play and when we start
			const delay = noteAbsoluteTime - startTime;

			// Calculate seek if we're starting after this note should have played
			const seek = delay < 0 ? -delay : 0;

			// BGM notes need to play even if they're before the start point (with seek)
			this.time.delayedCall(Math.max(0, delay) * 1000, () => {
				const soundChip = get(store.currentSoundChip).find(
					(chip) => chip.id === parseInt(noteChip.noteID, 36)
				);
				if (soundChip) {
					const audio = this.sound.get(this.getCacheKey(soundChip));
					this.playingAudio.push(audio as Phaser.Sound.WebAudioSound);
					audio.play({
						seek: seek
					});
				}
			});
		});
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

	scheduleNotePlayback(note: LaneMeasureNote, secondsPerMeasure: number, startMeasure: number) {
		// Set the measureLength for the note if it's not already set
		if (note.measureLength === 1) {
			note.measureLength = this.measureLength[note.measure] || 1;
		}

		note.notes.forEach((noteChip: { noteID: string; position: number }) => {
			// Calculate the absolute time of this note from the beginning
			const noteAbsoluteTime = this.getTimeElapsed(note.measure, noteChip.position);

			// Calculate the absolute time of the start measure
			const startTime = this.getTimeElapsed(startMeasure);

			// The delay is the difference between when the note should play and when we start
			const delay = noteAbsoluteTime - startTime;

			// Only schedule notes that will play after the start time
			if (delay >= 0) {
				this.time.delayedCall(delay * 1000, () => {
					const soundChip = get(store.currentSoundChip).find(
						(chip) => chip.id === parseInt(noteChip.noteID, 36)
					);
					if (soundChip && soundChip.file) {
						const audio = this.sound.get(this.getCacheKey(soundChip));
						this.playingAudio.push(audio as Phaser.Sound.WebAudioSound);
						audio.play();
					}
				});
			}
		});
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
		const iconFrameIndex = laneConfig.iconFrameIndex;

		if (iconFrameIndex !== undefined) {
			const icon = this.add.sprite(
				currentX + this.cellWidth / 2,
				this.offsetY + 30,
				AssetName.LANE_ICONS,
				laneConfig.iconFrameIndex
			);

			// Scale the icon to fit the lane width
			const scale = Math.min(this.cellWidth / icon.width, 0.45); // 0.45 is to make it a bit smaller than the lane
			icon.setScale(scale);

			// Center the icon in the lane
			icon.setOrigin(0.5);

			// Add to the footer container
			this.footerContainer.add(icon);
		}
	}

	createNoteAnimations() {
		// Create custom frames for the spritesheet since each note has different width
		const texture = this.textures.get(AssetName.DRUM_CHIPS);
		const frameHeight = 64; // Height of each note graphic
		const totalRows = 11; // Number of rows in the spritesheet (0-10)

		// For this spritesheet, we need to handle it differently
		// The spritesheet has 12 columns (one for each note type)
		// Each column has 11 frames (0-10)
		// The columns are arranged in order of the note types
		// We need to map each note type to its column index

		// Define the order of note types in the spritesheet (from left to right)
		const noteOrder = [
			'13', // Right BassDrum
			'19', // RideCymbal
			'12', // Snare
			'14', // HighTom
			'15', // LowTom
			'17', // FloorTom
			'16', // Right Cymbal
			'11', // HiHatClose
			'1C', // LeftBassDrum
			'1A', // LeftCymbal
			'18', // HiHatOpen
			'1B' // LeftPedal
		];

		// Calculate the x position for each note type in the spritesheet
		const columnPositions: Record<string, number> = {};
		let currentX = 0;

		// Calculate the x position for each note type based on its order in the spritesheet
		noteOrder.forEach((noteId) => {
			const laneConfig = this.laneConfigs.find((lc) => lc.id === noteId);
			if (laneConfig && laneConfig.width) {
				columnPositions[noteId] = currentX;
				currentX += laneConfig.width;
			}
		});

		// Create animations for each note type with playable lanes
		this.laneConfigs.forEach((laneConfig) => {
			if (!laneConfig.playable || !laneConfig.width) return;

			const laneId = laneConfig.id;
			const frameWidth = laneConfig.width;
			const xPosition = columnPositions[laneId];

			// Create frames for this note type
			for (let row = 0; row < totalRows; row++) {
				texture.add(
					`${laneId}_${row}`, // Frame name: e.g., "11_0" for HiHatClose frame 0
					0, // Source image index
					xPosition, // x position in the spritesheet based on column
					row * frameHeight, // y position based on row
					frameWidth, // Width of this note type
					frameHeight // Height is fixed
				);
			}

			// Create base animation (animation 1) - frames 2-9
			this.anims.create({
				key: `note-${laneId}-base`,
				frames: [
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_2` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_3` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_4` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_5` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_6` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_7` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_8` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_9` }
				],
				frameRate: 12,
				repeat: -1
			});

			// Create overlay animation (animation 2) - frames 0, 1, 10
			this.anims.create({
				key: `note-${laneId}-overlay`,
				frames: [
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_0` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_1` },
					{ key: AssetName.DRUM_CHIPS, frame: `${laneId}_10` }
				],
				frameRate: 8,
				repeat: -1
			});
		});
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
		const laneId = laneConfig.id;

		// In Preview mode, only show animated notes for playable lanes with defined width
		if (!laneConfig.playable || !laneConfig.width) {
			// Skip drawing non-playable or non-animated notes
			return false;
		}

		const x = this.offsetX + this.cellWidth * laneIndex + this.cellWidth / 2;

		// Calculate Y position based on measure offset and cell position
		const yOffset = this.getTotalMesaureOffest(measure);

		// Calculate the position within the measure
		const cellPosition = Math.floor(cellOffset * this.cellsPerMeasure);

		// Add offsets for each cell up to the note position
		let cellsYOffset = 0;
		for (let i = 0; i < cellPosition; i++) {
			cellsYOffset += this.getCellHeight(measure, i % this.cellsPerMeasure);
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
			// Create a container for the note sprites
			const container = this.add.container(x, y);
			container.setName(noteKey);

			// Calculate scale based on the cell width and note width
			const scale = Math.min((this.cellWidth - this.cellMargin * 2) / laneConfig.width, 1);

			// Create base animation sprite
			const baseSprite = this.add.sprite(0, 0, AssetName.DRUM_CHIPS);
			baseSprite.setOrigin(0.5, 0.5);
			baseSprite.setScale(scale);
			baseSprite.play(`note-${laneId}-base`);
			container.add(baseSprite);

			// Create overlay animation sprite
			const overlaySprite = this.add.sprite(0, 0, AssetName.DRUM_CHIPS);
			overlaySprite.setOrigin(0.5, 0.5);
			overlaySprite.setScale(scale);
			overlaySprite.play(`note-${laneId}-overlay`);
			container.add(overlaySprite);

			// Add the container to the notes container instead of panel container
			this.notesContainer.add(container);
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
