/** Ticks in a whole note. 192 = LCM of common binary + triplet subdivisions. */
export const TICKS_PER_WHOLE = 192;

export interface NotationNoteEntry {
	kind: 'note';
	startTick: number;
	durTicks: number;
	/** VexFlow keys for the chord at this onset (e.g. ['f/4', 'g/5/x2']). */
	keys: string[];
}

export interface NotationRestEntry {
	kind: 'rest';
	startTick: number;
	durTicks: number;
}

export type NotationEntry = NotationNoteEntry | NotationRestEntry;

export interface NotationMeasure {
	index: number;
	measureTicks: number;
	beatsPerMeasure: number;
	entries: NotationEntry[];
}

export interface NotationChart {
	measures: NotationMeasure[];
}
