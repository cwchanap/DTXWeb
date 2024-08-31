import { Scene, Input, Sound } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import store from '@/lib/store';
import { XAaudioContext } from '@/lib/browser/audioDecoder';
import { LaneMeasureNote } from '@/lib/chart/note';
import type { SoundChip } from '@/lib/chart/dtx';

interface LaneConfig {
	name: string;
	noteColor: number;
	id: string;
	playable: boolean;
}

interface Note {
	measure: number;
	laneID: string;
	pattern: string;
	laneMeasureNote?: LaneMeasureNote;
}

interface Data {
	measureCount?: number;
}

export class Editor extends Scene {
	private laneConfigs: LaneConfig[] = [
		{ name: 'BPM', noteColor: 0x000000, id: '08', playable: false },
		{ name: 'LC', noteColor: 0xa20814, id: '1A', playable: true },
		{ name: 'HH', noteColor: 0x0d1cde, id: '18', playable: true },
		{ name: 'HHC', noteColor: 0x0d1cde, id: '11', playable: true },
		{ name: 'LP', noteColor: 0xde0db8, id: '1B', playable: true },
		{ name: 'LB', noteColor: 0x567dcb, id: '1C', playable: true },
		{ name: 'SN', noteColor: 0xefec1b, id: '12', playable: true },
		{ name: 'HT', noteColor: 0x45ef1b, id: '14', playable: true },
		{ name: 'BD', noteColor: 0x567dcb, id: '13', playable: true },
		{ name: 'LT', noteColor: 0xef1b2b, id: '15', playable: true },
		{ name: 'FT', noteColor: 0xfa7e0a, id: '17', playable: true },
		{ name: 'CY', noteColor: 0x1424c4, id: '16', playable: true },
		{ name: 'RD', noteColor: 0x14bfc4, id: '19', playable: true },
		{ name: 'BGM', noteColor: 0x222222, id: '01', playable: false }
	];

	private cellsPerMeasure = 16;
	private cellWidth = 50;
	private cellHeight = 25;
	private bottomMargin = 40;
	private cellMargin = 2;
	public static key = 'Editor';

	private isEditing = false;
	private isDragging = false;
	private isPreviewing = false;
	private notes: Record<string, Note[]> = {};
	private previewTween: Phaser.Tweens.Tween | null = null;
	private measureLength: number[] = [];
	private playingAudio: Phaser.Sound.WebAudioSound[] = [];

	constructor(private measureCount: number = 10) {
		super({ key: Editor.key });
	}

	init(data: Data) {
		this.measureCount = data.measureCount || this.measureCount;
	}

	preload() {
		// Preload assets if any
		console.log("Preload sound")
		// Load the BGM audio file
		const simfile = get(store.currentSimfile);

		// Load sound chip samples
		const soundChips = get(store.currentSoundChip);

		if (soundChips) {
			const addedKey = new Set();
			Object.entries(soundChips).forEach(([key, soundChip]) => {
				if (!soundChip.file) return;
				const soundFile = simfile?.files.find((f) => f.name.toLowerCase() === soundChip.file?.toLowerCase());
				if (!soundFile) return;

				const cacheKey = this.getCacheKey(soundChip);
				this.cache.audio.remove(cacheKey);

				if (addedKey.has(cacheKey)) return;
				addedKey.add(cacheKey);
				if (soundChip.file.toLowerCase().endsWith('.xa')) {
					// For XA files, we'll load them with custom audio context
					this.load.audio({
						key: cacheKey,
						url: [URL.createObjectURL(soundFile)],
						context: XAaudioContext
					});
				} else {
					// For other formats, load as usual
					this.load.audio(cacheKey, URL.createObjectURL(soundFile));
				}
			});
		}
	}

	get totalWidth() {
		return this.laneConfigs.reduce((acc) => acc + this.cellWidth, 0);
	}

	get offsetX() {
		return (this.scale.width - this.totalWidth) / 2;
	}

	get offsetY() {
		return this.scale.height - this.bottomMargin;
	}

	create() {
		console.log("Create Scene")
		this.parseMesaureLength();
		// Constants for grid dimensions
		const laneHeight = this.getTotalMesaureOffest(this.measureCount);

		const graphics = this.add.graphics();
		graphics.lineStyle(1, 0x888888, 1); // Light grey for cells
		graphics.lineStyle(2, 0xffffff, 1); // White for measure lines

		// Draw vertical lanes
		let currentX = this.offsetX;
		this.laneConfigs.forEach((laneConfig, index) => {
			graphics.moveTo(currentX, this.offsetY);
			graphics.lineTo(currentX, this.offsetY - laneHeight);
			currentX += this.cellWidth;
		});

		// Draw the last vertical line
		graphics.moveTo(currentX, this.offsetY);
		graphics.lineTo(currentX, this.offsetY - laneHeight);

		// Lane indicators
		currentX = this.offsetX;
		this.laneConfigs.forEach((laneConfig, index) => {
			this.add
				.text(currentX + this.cellWidth / 2, this.offsetY + 20, laneConfig.name, {
					fontSize: '16px',
					color: '#ffffff'
				})
				.setOrigin(0.5);
			currentX += this.cellWidth;
		});

		// Draw horizontal lines for cells and measures
		let y = this.offsetY;
		for (let j = 0; j <= this.measureCount; j++) {
			this.drawMeasure(j, y, graphics);
			y -= this.cellHeight * this.cellsPerMeasure * (this.measureLength[j] || 1);
		}

		graphics.strokePath();

		// Enable input events
		this.input.on('pointerdown', (pointer: Input.Pointer) => {
			if (this.isPreviewing || !this.isEditing) return;
			const x = pointer.x - this.offsetX;
			const y = pointer.worldY - this.offsetY;

			// Calculate the clicked cell
			const laneIndex = Math.floor(x / this.cellWidth);
			const cellIndex = Math.floor(-y / this.cellHeight);

			// Validate the click is within the grid bounds
			if (
				laneIndex >= 0 &&
				laneIndex < this.laneConfigs.length &&
				cellIndex >= 0 &&
				cellIndex < this.measureCount * this.cellsPerMeasure
			) {
				// Draw the note in the clicked cell
				this.drawNote(laneIndex, cellIndex, '00');
				const measure = Math.floor(cellIndex / this.cellsPerMeasure);
				if (!(measure in this.notes)) {
					this.notes[measure] = [];
				}
				this.notes[measure].push({
					measure: measure,
					laneID: this.laneConfigs[laneIndex].id,
					pattern: '00'
				});
			}
		});

		// Make the scene scrollable
		this.cameras.main.setBounds(
			0,
			-laneHeight + this.cameras.main.height - this.bottomMargin,
			this.scale.width,
			laneHeight + this.bottomMargin
		);
		this.cameras.main.setScroll(0, 0);

		// Enable drag scrolling
		let startY = 0;
		let startScrollY = 0;
		this.drawNotes();

		const soundChips = get(store.currentSoundChip);
		const simfile = get(store.currentSimfile);
		if (soundChips) {
			Object.entries(soundChips).forEach(([key, soundChip]) => {
				const cacheKey = this.getCacheKey(soundChip);
				const soundFile = simfile?.files.find((f) => f.name.toLowerCase() === soundChip.file?.toLowerCase());
				if (!soundFile) return;
				this.sound.add(cacheKey) as Sound.WebAudioSound;
			});
		}

		this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
			if (this.isEditing) return;
			this.isDragging = true;
			startY = pointer.y;
			startScrollY = this.cameras.main.scrollY;
		});

		this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
			if (this.isDragging) {
				const deltaY = 3 * (pointer.y - startY);
				this.cameras.main.scrollY = startScrollY - deltaY;
			}
		});

		this.input.on('pointerup', () => {
			this.isDragging = false;
		});

		this.input.on(
			'wheel',
			(
				pointer: Phaser.Input.Pointer,
				gameObjects: any,
				deltaX: number,
				deltaY: number,
				deltaZ: number
			) => {
				this.cameras.main.scrollY += deltaY * 0.1;
			}
		);

		this.input.keyboard?.on('keydown-Q', (event: KeyboardEvent) => {
			this.isEditing = !this.isEditing;
		});

		EventBus.emit(EventType.SCENE_READY, this);
		EventBus.on(EventType.MEASURE_UPDATE, (measureCount: number) => {
			this.measureCount = measureCount;
			this.restart({ measureCount });
		});
		EventBus.on(EventType.NOTE_IMPORT, (notes: Note[]) => {
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
			this.restart({ measureCount: this.measureCount });
		});

		EventBus.on(EventType.MEASURE_GOTO, (measure: number) => {
			const y = measure * this.cellHeight * this.cellsPerMeasure;
			this.cameras.main.scrollY = -y - this.bottomMargin;
		});

		EventBus.on(EventType.START_PREVIEW, (bpm: number) => {
			this.isPreviewing = true;
			const currentMeasure = Math.floor(-this.cameras.main.scrollY / (this.cellHeight * this.cellsPerMeasure));
			this.startPreviewPan(bpm, currentMeasure);
			this.scheduleAudioPlayback(bpm, currentMeasure);
		});

		EventBus.on(EventType.STOP_PREVIEW, () => {
			this.isPreviewing = false;
			this.stopPreviewPan();
		});
	}

	getCacheKey(soundChip: SoundChip) {
		return `soundchip_${soundChip.file}`;
	}

	getTotalMesaureLength(measure: number) {
		if (this.measureLength.length === 0) return measure;
		return this.measureLength.slice(0, measure).reduce((acc, length) => acc + length, 0);
	}

	getTotalMesaureOffest(measure: number) {
		return this.getTotalMesaureLength(measure) * this.cellHeight * this.cellsPerMeasure;
	}

	parseMesaureLength() {
		if (!this.notes['02']) return;

		let currentMeasureLength = 1;
		for (let i = 0; i < this.measureCount; i++) {
			const note = this.notes['02'].find((note) => note.measure === i)
			if (note) {
				currentMeasureLength = parseFloat(note.pattern);
			}
			this.measureLength[i] = currentMeasureLength;
		}
	}

	drawNotes() {
		for (const [measure, notes] of Object.entries(this.notes)) {
			notes.forEach((note) => {
				const laneIndex = this.laneConfigs.findIndex((lane) => lane.id === note.laneID);

				if (laneIndex === -1) return;
				const measureLength = this.measureLength[note.measure] || 1;
				const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);

				laneMeasureNote.notes.forEach((noteChip) => {
					this.drawNote(note.measure, laneIndex, noteChip.position, noteChip.noteID);
				});
			});
		}
	}

	drawMeasure(measure: number, yStart: number, graphics: Phaser.GameObjects.Graphics) {
		const cellsPerMeasure = this.cellsPerMeasure * (this.measureLength[measure] || 1);

		// Draw the measure line
		graphics.lineStyle(6, 0xffffff, 1);
		graphics.moveTo(this.offsetX, yStart);
		graphics.lineTo(this.offsetX + this.totalWidth, yStart);

		for (let i = 0; i < cellsPerMeasure; i++) {
			graphics.lineStyle((i * 4 % cellsPerMeasure == 0) ? 4 : 2, 0x888888, 0.5);
			graphics.moveTo(this.offsetX, yStart);
			graphics.lineTo(this.offsetX + this.totalWidth, yStart);
			yStart -= this.cellHeight;
		}

		this.add
			.text(
				this.offsetX + this.totalWidth / 2,
				yStart + (this.cellsPerMeasure * this.cellHeight) / 2,
				`${measure}`,
				{
					fontSize: '96px',
					color: '#ffffff'
				}
			)
			.setOrigin(0.5)
			.setAlpha(0.5);
	}

	drawNote(
		measure: number,
		laneIndex: number,
		cellOffset: number,
		noteId: string
	) {
		const x = this.offsetX + this.cellWidth * laneIndex + this.cellMargin;
		const y =
			this.offsetY -
			(this.getTotalMesaureOffest(measure) + (cellOffset) * this.cellHeight * this.cellsPerMeasure) +
			this.cellMargin -
			this.cellHeight;
		const width = this.cellWidth - this.cellMargin * 2;
		const height = this.cellHeight - this.cellMargin * 2;

		const noteKey = `note-${laneIndex}-${measure}-${cellOffset}`;
		const existingNote = this.children.getByName(noteKey);

		if (existingNote) {
			// If the note already exists, remove it
			this.children.getAll('name', noteKey).forEach((note) => {
				note.destroy();
			});
		} else {
			// Otherwise, create a new note
			const graphics = this.add.graphics();
			graphics.fillStyle(this.laneConfigs[laneIndex].noteColor, 1); // Red color for the note
			graphics.fillRect(x, y, width, height);
			graphics.setName(noteKey);

			// draw text with note Id at the center of the note
			const text = this.add.text(x + width / 2, y + height / 2, noteId, {
				fontSize: '16px',
				color: '#ffffff',
				align: 'center',
			});
			text.setOrigin(0.5, 0.5)
			text.setName(noteKey);
		}
	}

	startPreviewPan(bpm: number, currentMeasure: number) {
		const duration = (60 * 4 / bpm) * 1000; // Convert to milliseconds

		const targetY = - this.getTotalMesaureOffest(currentMeasure) - this.bottomMargin; // Target Y position for the nearest measure
		const totalDistance = this.getTotalMesaureOffest(this.measureCount) - targetY;

		this.cameras.main.scrollY = targetY;
		this.previewTween = this.tweens.add({
			targets: this.cameras.main,
			scrollY: -totalDistance,
			duration: duration * this.measureCount,
			ease: 'Linear',
			repeat: -1,
			yoyo: false,
			onComplete: () => {
				this.cameras.main.scrollY = 0;
			},
		});
	}

	stopPreviewPan() {
		if (this.previewTween) {
			this.previewTween.stop();
			this.previewTween = null;
		}

		this.time.removeAllEvents()
		this.playingAudio.forEach((audio) => {
			audio.stop();
		});
		this.playingAudio = [];
	}

	scheduleNotePlayback(note: Note, secondsPerMeasure: number, startMeasure: number) {
		const measureLength = this.measureLength[note.measure] || 1;
		const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);

		laneMeasureNote.notes.forEach((noteChip) => {
			const delay = (this.getTotalMesaureLength(note.measure) - this.getTotalMesaureLength(startMeasure) + noteChip.position) * secondsPerMeasure * 1000;
			this.time.delayedCall(delay, () => {
				const soundChip = get(store.currentSoundChip).find((chip) => chip.id === parseInt(noteChip.noteID, 36));
				if (soundChip) {
					const audio = this.sound.get(this.getCacheKey(soundChip));
					this.playingAudio.push(audio as Phaser.Sound.WebAudioSound);
					audio.play();
				}
			});
		});
	}

	scheduleBGMPlayback(note: Note, secondsPerMeasure: number, startMeasure: number) {
		const measureLength = this.measureLength[note.measure] || 1;
		const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);

		laneMeasureNote.notes.forEach((noteChip) => {
			const delay = (this.getTotalMesaureLength(note.measure) - this.getTotalMesaureOffest(startMeasure) + noteChip.position) * secondsPerMeasure;
			const seek = (this.getTotalMesaureLength(startMeasure) - this.getTotalMesaureOffest(note.measure) - noteChip.position) * secondsPerMeasure;

			const soundChip = get(store.currentSoundChip).find((chip) => chip.id === parseInt(noteChip.noteID, 36));
			if (soundChip) {
				const audio = this.sound.get(this.getCacheKey(soundChip));
				this.playingAudio.push(audio as Phaser.Sound.WebAudioSound);
				audio.play({
					delay: (note.measure >= startMeasure) ? delay : 0,
					seek: (note.measure >= startMeasure) ? 0 : seek
				});
			}
		});
	}

	scheduleAudioPlayback(bpm: number, currentMeasure: number) {
		const secondsPerMeasure = 60 * 4 / bpm;

		this.notes['01'].forEach((note) => this.scheduleBGMPlayback(note, secondsPerMeasure, currentMeasure));

		this.laneConfigs.filter((lane) => lane.playable).forEach((lane) => {
			if (this.notes[lane.id]) {
				this.notes[lane.id].filter(
					(note) => note.measure >= currentMeasure
				).forEach((note) => this.scheduleNotePlayback(note, secondsPerMeasure, currentMeasure));
			}
		});
	}

	update() {
		// Update logic if needed
	}

	restart(data: Data = {}) {
		console.log("Restart Scene, data", data)
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
		this.scene.restart(data);
	}
}