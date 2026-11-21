import { PLAYABLE_DRUM_LANES, laneToStaff } from '@dtx/common';

// Editable lane -> GM note seed, built from the shared drum map so the
// playable 11-1C lanes carry their canonical GM notes (not the stale
// 01-0C aliases).
export const DEFAULT_LANE_NOTE_MAP: Record<string, number> = Object.fromEntries(
	PLAYABLE_DRUM_LANES.map((lane) => [lane, laneToStaff(lane)?.midi ?? 0])
);

export const isValidDtxFile = (file: File): boolean =>
	file.name.toLowerCase().endsWith('.dtx') || file.name.toLowerCase().endsWith('.txt');

export const generateMidiFilename = (filename: string): string =>
	`${filename.replace(/\.[^/.]+$/, '')}.mid`;

export const formatFileSizeKB = (bytes: number): string => (bytes / 1024).toFixed(1);
