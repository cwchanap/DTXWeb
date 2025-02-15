import { Scene, Input, Sound } from 'phaser';
import { EventBus } from '../EventBus';
import EventType from '../EventType';
import { get } from 'svelte/store';
import store from '@/lib/store';
import { XAaudioContext } from '@/lib/browser/audioDecoder';
import { LaneMeasureNote } from '@/lib/chart/note';
import type { SoundChip } from '@/lib/chart/dtx';
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
            Object.entries(soundChips).forEach(([key, soundChip]) => {
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
            Object.entries(soundChips).forEach(([key, soundChip]) => {
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

        this.previewTween = this.tweens.add({
            targets: this.panelContainer,
            y: totalDistance,
            duration: this.getTimeElapsed(this.measureCount) * 1000,
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

        for (let i = 0; i <= measure; i++) {
            const measureLength = this.measureLength[i] || 1;
            const bpmNotes =
                this.notes[Preview.bpmNoteID]?.filter((note) => note.measure === i) || [];
            if (bpmNotes.length === 0) {
                // No BPM changes in this measure, use the current BPM for the whole measure
                elapsedTime += (60 / currentBPM) * 4 * measureLength;
            } else {
                // Calculate time for each segment within the measure
                let lastPosition = 0;
                bpmNotes.forEach((note) => {
                    const pattern = note.pattern;
                    const segmentCount = pattern.length / 2;
                    for (let j = 0; j < segmentCount; j++) {
                        const noteId = pattern.substring(j * 2, j * 2 + 2);
                        if (noteId !== '00') {
                            const position = j / segmentCount;
                            elapsedTime +=
                                (60 / currentBPM) * 4 * (position - lastPosition) * measureLength;
                            currentBPM = this.bpmNotes[noteId];
                            lastPosition = position;
                        }
                    }
                });
                // Add the remaining time in the measure after the last BPM change
                elapsedTime += (60 / currentBPM) * 4 * (1 - lastPosition) * measureLength;
            }
        }
        // Add the time offset for the current noteChip position within the measure
        elapsedTime +=
            (60 / currentBPM) * 4 * noteChipPosition * (this.measureLength[measure] || 1);

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
            const delay =
                this.getTimeElapsed(note.measure - 1, noteChip.position) -
                this.getTimeElapsed(startMeasure - 1);
            const seek =
                this.getTimeElapsed(startMeasure - 1) -
                this.getTimeElapsed(note.measure - 1, noteChip.position);

            this.time.delayedCall(delay * 1000, () => {
                const soundChip = get(store.currentSoundChip).find(
                    (chip) => chip.id === parseInt(noteChip.noteID, 36)
                );
                if (soundChip) {
                    const audio = this.sound.get(this.getCacheKey(soundChip));
                    this.playingAudio.push(audio as Phaser.Sound.WebAudioSound);
                    audio.play({
                        // delay: (note.measure >= startMeasure) ? delay : 0,
                        seek: note.measure >= startMeasure ? 0 : seek
                    });
                }
            });
        });
    }

    scheduleNotePlayback(note: Note, secondsPerMeasure: number, startMeasure: number) {
        const measureLength = this.measureLength[note.measure] || 1;
        const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);
        laneMeasureNote.notes.forEach((noteChip) => {
            const delay =
                this.getTimeElapsed(note.measure - 1, noteChip.position) -
                this.getTimeElapsed(startMeasure - 1);
            // const platformAdjustment = navigator.userAgent.includes('Windows') ? 200 : 0;
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
        });
    }

    getCellHeight(measure: number, cell: number): number {
        // For given measure and cell, calculate the height of the cell based on the BPM
        let height = 0;
        const referenceBPM = 120;
        // Find the last BPM change before the current measure
        const bpmNote = this.notes[Preview.bpmNoteID]?.findLast((note) => note.measure <= measure);

        if (!bpmNote) {
            // No BPM changes in this measure, use the current BPM for the whole measure
            return this.cellHeight;
        }
        // Calculate height for each segment within the measure

        const pattern = bpmNote.pattern;
        const segmentCount = pattern.length / 2;
        let lastNoteId = undefined;
        for (let j = 0; j < segmentCount; j++) {
            const noteId = pattern.substring(j * 2, j * 2 + 2);
            if (
                (bpmNote.measure === measure && (j * 16) / segmentCount <= cell) ||
                bpmNote.measure < measure
            ) {
                if (noteId !== '00') {
                    lastNoteId = noteId;
                }
            }
        }

        if (!lastNoteId) {
            return this.cellHeight;
        }
        const bpm = this.bpmNotes[lastNoteId];
        height = (this.cellHeight / bpm) * referenceBPM;

        return height;
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
