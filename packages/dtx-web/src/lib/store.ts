import { writable } from 'svelte/store';
import type { DTXFile, SoundChip, SimFile, LaneMeasureNote } from '@dtx/common';

const activeScene = writable<string | null>(null);
const currentDtxFile = writable<DTXFile | null>(null);
const currentSimfile = writable<SimFile | null>(null);
const currentSoundChip = writable<SoundChip[]>([]);
const playingAudio = writable<HTMLAudioElement | null>(null);
const isPreviewing = writable<boolean>(false);
const playSpeed = writable<number>(1);
const measureCount = writable<number>(10);
const editorNotes = writable<Record<string, LaneMeasureNote[]>>({});
const activeNote = writable<string>('01');
const currentSimfileID = writable<string | null>(null);
const currentDifficulty = writable<string | null>(null);
const keyBindings = writable<Record<string, string>>({});

export default {
	activeScene,
	currentDtxFile,
	currentSimfile,
	currentSoundChip,
	playingAudio,
	isPreviewing,
	playSpeed,
	measureCount,
	editorNotes,
	activeNote,
	currentSimfileID,
	currentDifficulty,
	keyBindings
};
