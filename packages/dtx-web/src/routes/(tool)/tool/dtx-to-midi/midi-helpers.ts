import type { LaneMeasureNote } from '@dtx/common';

export const DEFAULT_LANE_NOTE_MAP: Record<string, number> = {
	'01': 36, // Bass Drum
	'02': 38, // Snare
	'03': 42, // Closed Hi-Hat
	'04': 46, // Open Hi-Hat
	'05': 49, // Crash Cymbal
	'06': 51, // Ride Cymbal
	'07': 45, // Low Tom
	'08': 47, // Mid Tom
	'09': 50, // High Tom
	'0A': 44, // Pedal Hi-Hat
	'0B': 57, // Crash 2
	'0C': 59 // Ride 2
};

export const isValidDtxFile = (file: File): boolean =>
	file.name.toLowerCase().endsWith('.dtx') || file.name.toLowerCase().endsWith('.txt');

export const generateMidiFilename = (filename: string): string =>
	`${filename.replace(/\.[^/.]+$/, '')}.mid`;

export const formatFileSizeKB = (bytes: number): string => (bytes / 1024).toFixed(1);

export const groupNotesByLane = (notes: LaneMeasureNote[]): Record<string, LaneMeasureNote[]> => {
	const notesByLane: Record<string, LaneMeasureNote[]> = {};
	notes.forEach((note) => {
		if (!notesByLane[note.laneID]) {
			notesByLane[note.laneID] = [];
		}
		notesByLane[note.laneID].push(note);
	});
	return notesByLane;
};
