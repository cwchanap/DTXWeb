/** Ticks in a whole note. 192 = LCM of common binary + triplet subdivisions. */
export const TICKS_PER_WHOLE = 192;

export interface NotationNoteEntry {
	kind: 'note';
	startTick: number;
	durTicks: number;
	/** Distinct, sorted playable DTX lane ids at this onset (e.g. ['11', '13']). */
	laneIds: string[];
}

export interface NotationRestEntry {
	kind: 'rest';
	startTick: number;
	durTicks: number;
}

export type NotationEntry = NotationNoteEntry | NotationRestEntry;

export interface NotationTuplet {
	startIndex: number;
	count: number;
	slotTicks: number;
}

export interface NotationMeasure {
	index: number;
	measureTicks: number;
	beatsPerMeasure: number;
	entries: NotationEntry[];
	tuplets: NotationTuplet[];
}

export interface NotationTempoEvent {
	measure: number;
	fraction: number;
	bpm: number;
}

export interface NotationChart {
	measures: NotationMeasure[];
	tempoEvents: NotationTempoEvent[];
}
