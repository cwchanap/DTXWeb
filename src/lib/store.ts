import { writable } from 'svelte/store';
import type { DTXFile } from '@/lib/chart/dtx';
import type { SoundChip } from '@/lib/chart/dtx';
import type { SimFile } from './chart/simFile';

const activeScene = writable<string | null>(null);
const currentDtxFile = writable<DTXFile | null>(null);
const currentSimfile = writable<SimFile | null>(null);
const currentSoundChip = writable<SoundChip[]>([]);
const playingAudio = writable<HTMLAudioElement | null>(null);
const isPreviewing = writable<boolean>(false);
const playSpeed = writable<number>(1);


export default {
	activeScene,
	currentDtxFile,
	currentSimfile,
	currentSoundChip,
	playingAudio,
	isPreviewing,
	playSpeed
};
