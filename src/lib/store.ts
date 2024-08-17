import { writable } from 'svelte/store';
import type { DTXFile } from '@/lib/chart/dtx';
import type { SoundChip } from '@/lib/chart/dtx';

const activeScene = writable<string | null>(null);
const currentDtxFile = writable<DTXFile | null>(null);
const currentSoundChip = writable<SoundChip[]>([]);

export default {
	activeScene,
	currentDtxFile,
	currentSoundChip
};
