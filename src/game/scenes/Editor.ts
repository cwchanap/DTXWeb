import { Scene, Input, Sound } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import store from '@/lib/store';
import { XAaudioContext } from '@/lib/browser/audioDecoder';
import { LaneMeasureNote } from '@/lib/chart/note';

interface LaneConfig {
	name: string;
	noteColor: number;
	id: string;
}

interface Note {
	measure: number;
	laneID: string;
	pattern: string;
}

interface Data {
	measureCount?: number;
}

export class Editor extends Scene {
	private laneConfigs: LaneConfig[] = [
		{ name: 'BPM', noteColor: 0x000000, id: '08' },
		{ name: 'LC', noteColor: 0xa20814, id: '1A' },
		{ name: 'HH', noteColor: 0x0d1cde, id: '18' },
		{ name: 'HHC', noteColor: 0x0d1cde, id: '11' },
		{ name: 'LP', noteColor: 0xde0db8, id: '1B' },
		{ name: 'LB', noteColor: 0x567dcb, id: '1C' },
		{ name: 'SN', noteColor: 0xefec1b, id: '12' },
		{ name: 'HT', noteColor: 0x45ef1b, id: '14' },
		{ name: 'BD', noteColor: 0x567dcb, id: '13' },
		{ name: 'LT', noteColor: 0xef1b2b, id: '15' },
		{ name: 'FT', noteColor: 0xfa7e0a, id: '17' },
		{ name: 'CY', noteColor: 0x1424c4, id: '16' },
		{ name: 'RD', noteColor: 0x14bfc4, id: '19' },
		{ name: 'BGM', noteColor: 0x222222, id: '01' }
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
	private audioTimeouts: Phaser.Time.TimerEvent[] = [];
	private soundChips: Record<string, Sound.WebAudioSound> = {};
	private measureLength: number[] = [];

	constructor(private measureCount: number = 10) {
		super({ key: Editor.key });
	}

	init(data: Data) {
		this.measureCount = data.measureCount || this.measureCount;
	}

	preload() {
		// Preload assets if any

		// Load the BGM audio file
		const simfile = get(store.currentSimfile);

		// Load sound chip samples
		const soundChips = get(store.currentSoundChip);
		if (soundChips) {
			const addedKey = new Set();
			Object.entries(soundChips).forEach(([key, soundChip]) => {
				if (!soundChip.file) return;
				const soundFile = simfile?.files.find((f) => f.name === soundChip.file);
				if (!soundFile) return;

				const cacheKey = `soundchip_${soundChip.file}`;

				if (addedKey.has(cacheKey)) return;
				addedKey.add(cacheKey);

				if (soundChip.file.endsWith('.xa')) {
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
		const measureHeight = this.cellHeight * this.cellsPerMeasure;
		const laneHeight = this.measureCount * measureHeight;

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
				const cacheKey = `soundchip_${soundChip.file}`;
				const soundFile = simfile?.files.find((f) => f.name === soundChip.file);
				if (!soundFile) return;
				this.soundChips[key] = this.sound.add(cacheKey) as Sound.WebAudioSound;
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
			this.startPreviewPan(bpm);
		});

		EventBus.on(EventType.STOP_PREVIEW, () => {
			this.isPreviewing = false;
			this.stopPreviewPan();
		});
	}

	getTotalMesaureOffest(measure: number) {
		return this.measureLength.slice(0, measure).reduce((acc, length) => acc + length, 0) * this.cellHeight * this.cellsPerMeasure;
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
					// const cellIndex = (note.measure + noteChip.position) * this.cellsPerMeasure;

					this.drawNote(note.measure, laneIndex, noteChip.position, noteChip.noteID);
				});
			});
		}
	}

	drawMeasure(measure: number, yStart: number, graphics: Phaser.GameObjects.Graphics) {
		const cellsPerMeasure = this.cellsPerMeasure * (this.measureLength[measure] || 1);

		// Draw the measure line
		graphics.lineStyle(5, 0xffffff, 1);
		graphics.moveTo(this.offsetX, yStart);
		graphics.lineTo(this.offsetX + this.totalWidth, yStart);

		graphics.lineStyle(2, 0x888888, 0.5);
		for (let i = 0; i < cellsPerMeasure; i++) {
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

	startPreviewPan(bpm: number) {
		const simfile = get(store.currentSimfile);
		const bgm = simfile?.files.find((f) => f.name === 'bgm.ogg');
		const soundChips = get(store.currentSoundChip);

		const duration = (60 * 4 / bpm) * 1000; // Convert to milliseconds
		const totalDistance = this.measureCount * this.cellHeight * this.cellsPerMeasure;

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
	}

	scheduleAudioPlayback(bpm: number) {
		const secondsPerBeat = 60 / bpm;

		// Schedule BGM
		const bgm = this.sound.get('bgm.ogg');

		// Example: Play a sound chip sample after 2 measures
		// const sampleKey = Object.keys(this.soundChips)[0]; // Just an example, use the appropriate key
		// if (this.soundChips[sampleKey]) {
		// 	const event = this.time.delayedCall(2 * 4 * secondsPerBeat * 1000, () => {
		// 		this.soundChips[sampleKey].play();
		// 	});
		// 	this.audioEvents.push(event);
		// }

		// You can add more scheduled playbacks here
		// For example, to play a sound at measure 3, beat 2:
		// const measureBeat = 3 * 4 + 2; // 3 measures * 4 beats + 2 beats
		// const event = this.time.delayedCall(measureBeat * secondsPerBeat * 1000, () => {
		//     this.soundChips['another_sample'].play();
		// });
		// this.audioEvents.push(event);
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