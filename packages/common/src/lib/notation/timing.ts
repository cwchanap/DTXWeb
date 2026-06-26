import type { LaneMeasureNote } from '../chart/note';

export interface TimingInput {
	bpm: number;
	/** noteID (2-char) -> bpm value, from DTXFile.parseBPMChanges(). */
	bpmValueMap: Record<string, number>;
	/** Channel '08' notes (bpm changes), as returned grouped by lane. */
	bpmChanges: LaneMeasureNote[];
	/** Per-measure length multiplier (v1: all 1). */
	measureLengths: number[];
	measureCount: number;
}

export interface ChartTiming {
	measureStartSeconds: number[];
	totalDuration: number;
	positionToTime(measure: number, fraction: number): number;
	timeToPosition(t: number): { measure: number; fraction: number };
}

const BEATS_PER_WHOLE = 4;

/** Seconds elapsed across `fraction` (0..1) of a measure, honoring bpm changes within it. */
const secondsIntoMeasure = (
	measure: number,
	fraction: number,
	input: TimingInput,
	startBpm: number
): { seconds: number; endBpm: number } => {
	const measureLength = input.measureLengths[measure] ?? 1;
	const perFraction = (bpm: number, frac: number) =>
		(60 / bpm) * BEATS_PER_WHOLE * frac * measureLength;

	const changes = input.bpmChanges
		.filter((n) => n.measure === measure)
		.flatMap((n) => n.notes)
		.filter((n) => n.noteID !== '00' && n.position <= fraction)
		.sort((a, b) => a.position - b.position);

	let seconds = 0;
	let bpm = startBpm;
	let last = 0;
	for (const change of changes) {
		seconds += perFraction(bpm, change.position - last);
		bpm = input.bpmValueMap[change.noteID] ?? bpm;
		last = change.position;
	}
	seconds += perFraction(bpm, fraction - last);
	return { seconds, endBpm: bpm };
};

export const buildChartTiming = (input: TimingInput): ChartTiming => {
	const measureStartSeconds: number[] = [];
	const measureBpmAtStart: number[] = [];
	let elapsed = 0;
	let bpm = input.bpm;
	for (let m = 0; m < input.measureCount; m++) {
		measureStartSeconds[m] = elapsed;
		measureBpmAtStart[m] = bpm;
		const { seconds, endBpm } = secondsIntoMeasure(m, 1, input, bpm);
		elapsed += seconds;
		bpm = endBpm;
	}
	const totalDuration = elapsed;

	const positionToTime = (measure: number, fraction: number): number => {
		const base = measureStartSeconds[measure] ?? totalDuration;
		const startBpm = measureBpmAtStart[measure] ?? input.bpm;
		return base + secondsIntoMeasure(measure, fraction, input, startBpm).seconds;
	};

	const measureDuration = (measure: number): number =>
		(measureStartSeconds[measure + 1] ?? totalDuration) - (measureStartSeconds[measure] ?? 0);

	const timeToPosition = (t: number): { measure: number; fraction: number } => {
		if (t <= 0) return { measure: 0, fraction: 0 };
		if (t >= totalDuration)
			return { measure: Math.max(0, input.measureCount - 1), fraction: 1 };
		let measure = 0;
		for (let m = 0; m < input.measureCount; m++) {
			if (t >= measureStartSeconds[m]) measure = m;
			else break;
		}
		const dur = measureDuration(measure) || 1;
		const fraction = Math.min(1, Math.max(0, (t - measureStartSeconds[measure]) / dur));
		return { measure, fraction };
	};

	return { measureStartSeconds, totalDuration, positionToTime, timeToPosition };
};
