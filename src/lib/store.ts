import { writable } from 'svelte/store';
import type { DTXFile } from '@/lib/chart/dtx';

const activeScene = writable<string | null>(null);
const currentDtxFile = writable<DTXFile | null>(null);

export default {
	activeScene,
	currentDtxFile
};
