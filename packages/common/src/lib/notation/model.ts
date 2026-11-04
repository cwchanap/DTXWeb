/** Ticks in a whole note. 192 = LCM of common binary + triplet subdivisions. */
export const TICKS_PER_WHOLE = 192;

/**
 * Representable binary single durations, largest first. `vexflow` is the
 * duration code the preview renderer uses; `musicxml` is the <type> name the
 * MusicXML exporter writes. Triplet groups are detected separately and use
 * these binary bases inside tuplet groups.
 */
export const DURATION_TABLE = [
	{ ticks: 192, vexflow: 'w', musicxml: 'whole' },
	{ ticks: 96, vexflow: 'h', musicxml: 'half' },
	{ ticks: 48, vexflow: 'q', musicxml: 'quarter' },
	{ ticks: 24, vexflow: '8', musicxml: 'eighth' },
	{ ticks: 12, vexflow: '16', musicxml: '16th' },
	{ ticks: 6, vexflow: '32', musicxml: '32nd' },
	{ ticks: 3, vexflow: '64', musicxml: '64th' }
] as const;

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
