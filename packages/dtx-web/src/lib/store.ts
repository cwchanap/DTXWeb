import { writable } from 'svelte/store';
import type { DTXFile, SoundChip, SimFile } from '@dtx/common';

const activeScene = writable<string | null>(null);
const currentDtxFile = writable<DTXFile | null>(null);
const currentSimfile = writable<SimFile | null>(null);
const currentSoundChip = writable<SoundChip[]>([]);
const playingAudio = writable<HTMLAudioElement | null>(null);
const isPreviewing = writable<boolean>(false);
const playSpeed = writable<number>(1);
const measureCount = writable<number>(10);

export default {
	activeScene,
	currentDtxFile,
	currentSimfile,
	currentSoundChip,
	playingAudio,
	isPreviewing,
	playSpeed,
	measureCount
};
