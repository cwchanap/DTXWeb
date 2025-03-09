import { Sound } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import store from '$lib/store';
import { XAaudioContext } from '$lib/browser/audioDecoder';
import { LaneMeasureNote } from '$lib/chart/note';
import type { SoundChip } from '$lib/chart/dtx';
import { BaseGame, type Note } from './BaseGame';

interface Data {
	measureCount: number;
	notes: Record<string, Note[]>;
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
	protected notes: Record<string, Note[]> = {};
	protected bpmNotes: Record<string, number> = {};

	constructor() {
		super({ key: Preview.key });
	}

	init(data: Data) {
		this.measureCount = data.measureCount;
		this.notes = data.notes;
		this.bpm = data.bpm;
		this.bpmNotes = data.bpmNotes;
		this.startMeasure = data.startMeasure;

		store.playSpeed.subscribe((value) => {
			this.playSpeed = value;
			this.cellHeight *= this.playSpeed;
		});
	}

	preload() {
		// Preload assets if any
		console.log('Preload sound');
		// Load the BGM audio file
		const simfile = get(store.currentSimfile);

		// Load sound chip samples
		const soundChips = get(store.currentSoundChip);

		if (soundChips) {
			const addedKey = new Set();
			Object.entries(soundChips).forEach(([, soundChip]) => {
				if (!soundChip.file) return;
				const soundFile = simfile?.files.find(
					(f) => f.name.toLowerCase() === soundChip.file?.toLowerCase()
				);
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

	create() {
		console.log('Create Preview Scene');

		this.drawPanel();
		this.drawNotes();

		const soundChips = get(store.currentSoundChip);
		const simfile = get(store.currentSimfile);

		if (soundChips) {
			Object.entries(soundChips).forEach(([, soundChip]) => {
				const cacheKey = this.getCacheKey(soundChip);
				const soundFile = simfile?.files.find(
					(f) => f.name.toLowerCase() === soundChip.file?.toLowerCase()
				);
				if (!soundFile) return;
				this.sound.add(cacheKey) as Sound.WebAudioSound;
			});
		}

		const targetY = this.getTotalMesaureOffest(this.startMeasure) + this.bottomMargin; // Target Y position for the nearest measure
		const totalDistance = this.getTotalMesaureOffest(this.measureCount) + targetY;

		this.panelContainer.setPosition(0, targetY, totalDistance);

		// Calculate duration based on BPM changes
		const totalDuration = this.getTimeElapsed(this.measureCount) * 1000;

		this.previewTween = this.tweens.add({
			targets: this.panelContainer,
			y: totalDistance,
			duration: totalDuration,
			ease: 'Linear',
			repeat: -1,
			yoyo: false,
			onComplete: () => {
				this.panelContainer.setPosition(0, 0);
			}
		});

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

		EventBus.emit(EventType.SCENE_READY, this);
		EventBus.on(EventType.STOP_PREVIEW, () => this.cleanUp());
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
					//Use LaneMeasureNote to get the position of the note
					const laneMeasureNote = new LaneMeasureNote(
						bpmNote.measure,
						bpmNote.pattern,
						measureLength
					);
					laneMeasureNote.notes.forEach((note) => {
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
					const laneMeasureNote = new LaneMeasureNote(
						bpmNote.measure,
						bpmNote.pattern,
						measureLength
					);
					laneMeasureNote.notes.forEach((note) => {
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
		return `soundchip_${soundChip.file}`;
	}

	override setCameraBounds() {
		this.cameras.main.setBounds(
			0,
			-this.laneHeight - this.bottomMargin,
			this.scale.width,
			this.laneHeight + this.bottomMargin + this.cameras.main.height
		);
	}

	scheduleBGMPlayback(note: Note, secondsPerMeasure: number, startMeasure: number) {
		const measureLength = this.measureLength[note.measure] || 1;
		const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);

		laneMeasureNote.notes.forEach((noteChip) => {
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

	scheduleNotePlayback(note: Note, secondsPerMeasure: number, startMeasure: number) {
		const measureLength = this.measureLength[note.measure] || 1;
		const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);
		laneMeasureNote.notes.forEach((noteChip) => {
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
					if (soundChip) {
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
			const pattern = lastBpmNote.pattern;
			const segmentCount = pattern.length / 2;

			for (let j = 0; j < segmentCount; j++) {
				const noteId = pattern.substring(j * 2, j * 2 + 2);
				if (noteId !== '00') {
					currentBPM = this.bpmNotes[noteId];
				}
			}
		} else if (lastBpmNote.measure === measure) {
			// BPM change in the current measure
			const pattern = lastBpmNote.pattern;
			const segmentCount = pattern.length / 2;

			// Find the last BPM change before or at our cell position
			for (let j = 0; j < segmentCount; j++) {
				const cellPosition = Math.floor((j * this.cellsPerMeasure) / segmentCount);
				if (cellPosition > cell) {
					break; // This BPM change is after our current cell
				}

				const noteId = pattern.substring(j * 2, j * 2 + 2);
				if (noteId !== '00') {
					currentBPM = this.bpmNotes[noteId];
				}
			}
		}

		// Calculate the adjusted cell height based on the BPM
		// Slower BPM = taller cells, faster BPM = shorter cells
		return (this.cellHeight / currentBPM) * referenceBPM;
	}

	cleanUp() {
		if (this.previewTween) {
			this.previewTween.stop();
			this.previewTween = null;
		}

		this.playingAudio.forEach((audio) => {
			audio.stop();
		});
		this.playingAudio = [];
	}
}
