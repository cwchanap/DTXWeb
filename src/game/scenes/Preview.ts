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

    private playingAudio: Phaser.Sound.WebAudioSound[] = [];
    private previewTween: Phaser.Tweens.Tween | null = null;
    protected measureLength: number[] = [];
    protected notes: Record<string, Note[]> = {};

    constructor() {
        super({ key: Preview.key });
    }

    init(data: Data) {
        this.measureCount = data.measureCount;
        this.notes = data.notes;
        this.bpm = data.bpm;
        this.startMeasure = data.startMeasure;

        store.playSpeed.subscribe((value) => {
            this.playSpeed = value;
            this.cellHeight = 25 * this.playSpeed;
        });
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

    create() {
        console.log("Create Preview Scene")

        this.drawPanel();
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

        const duration = (60 * 4 / this.bpm) * 1000; // Convert to milliseconds

        const targetY = - this.getTotalMesaureOffest(this.startMeasure) - this.bottomMargin; // Target Y position for the nearest measure
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

        const secondsPerMeasure = 60 * 4 / this.bpm;

        this.notes[Preview.bgmNoteID].forEach((note) => this.scheduleBGMPlayback(note, secondsPerMeasure, this.startMeasure));

        this.laneConfigs.filter((lane) => lane.playable).forEach((lane) => {
            if (this.notes[lane.id]) {
                this.notes[lane.id].filter(
                    (note) => note.measure >= this.startMeasure
                ).forEach((note) => this.scheduleNotePlayback(note, secondsPerMeasure, this.startMeasure));
            }
        });

        EventBus.emit(EventType.SCENE_READY, this);
        EventBus.on(EventType.STOP_PREVIEW, () => this.cleanUp());
    }

    getCacheKey(soundChip: SoundChip) {
        return `soundchip_${soundChip.file}`;
    }

    override setCameraBounds(laneHeight: number) {
        this.cameras.main.setBounds(
            0,
            -laneHeight - this.bottomMargin,
            this.scale.width,
            laneHeight + this.bottomMargin + this.cameras.main.height
        );
    }

    scheduleBGMPlayback(note: Note, secondsPerMeasure: number, startMeasure: number) {
        const measureLength = this.measureLength[note.measure] || 1;
        const laneMeasureNote = new LaneMeasureNote(note.measure, note.pattern, measureLength);

        laneMeasureNote.notes.forEach((noteChip) => {
            const delay = (this.getTotalMesaureLength(note.measure) - this.getTotalMesaureLength(startMeasure) + noteChip.position) * secondsPerMeasure;
            const seek = (this.getTotalMesaureLength(startMeasure) - this.getTotalMesaureLength(note.measure) - noteChip.position) * secondsPerMeasure;

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