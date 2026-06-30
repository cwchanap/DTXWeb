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

/**
 * Inverse of secondsIntoMeasure: find the fraction f in [0,1] such that the
 * seconds elapsed from the measure start equal `targetSeconds`. Walks the same
 * piecewise bpm segments so a mid-measure channel-08 tempo change inverts
 * exactly (a linear elapsed/duration ratio would be wrong here).
 */
const fractionAtSeconds = (
	measure: number,
	targetSeconds: number,
	input: TimingInput,
	startBpm: number
): number => {
	if (targetSeconds <= 0) return 0;
	const measureLength = input.measureLengths[measure] ?? 1;
	const perFractionUnit = (bpm: number) => (60 / bpm) * BEATS_PER_WHOLE * measureLength;

	// All bpm-change boundaries inside this measure, ascending. A change at
	// position 0 (downbeat) is included so the inverse matches secondsIntoMeasure,
	// which also applies position-0 changes: it becomes a zero-width first segment
	// that only swaps `bpm` to the new value before the real segments run.
	const bounds = input.bpmChanges
		.filter((n) => n.measure === measure)
		.flatMap((n) => n.notes)
		.filter((n) => n.noteID !== '00' && n.position >= 0 && n.position < 1)
		.map((n) => ({ position: n.position, bpm: input.bpmValueMap[n.noteID] ?? startBpm }))
		.sort((a, b) => a.position - b.position);

	let bpm = startBpm;
	let last = 0;
	let acc = 0;
	const interpolate = (endPos: number) => {
		const unit = perFractionUnit(bpm);
		if (unit <= 0) return endPos;
		return Math.min(endPos, last + (targetSeconds - acc) / unit);
	};
	for (const bound of bounds) {
		const segSeconds = perFractionUnit(bpm) * (bound.position - last);
		if (acc + segSeconds >= targetSeconds) return interpolate(bound.position);
		acc += segSeconds;
		bpm = bound.bpm;
		last = bound.position;
	}
	// Final segment [last, 1] at the current bpm.
	const segSeconds = perFractionUnit(bpm) * (1 - last);
	if (acc + segSeconds >= targetSeconds) return interpolate(1);
	return 1;
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
		const base = measureStartSeconds[measure];
		// Out-of-range measure (e.g. a stale cursor past the chart end, or measure
		// 99 on a 1-measure chart): clamp to the end regardless of fraction.
		// Without this guard, secondsIntoMeasure would add a fraction of a
		// (fallback-length) measure on top of totalDuration, yielding a time past
		// the chart end and breaking the seek<->cursor round-trip.
		if (base === undefined) return totalDuration;
		const startBpm = measureBpmAtStart[measure] ?? input.bpm;
		return base + secondsIntoMeasure(measure, fraction, input, startBpm).seconds;
	};

	const timeToPosition = (t: number): { measure: number; fraction: number } => {
		if (t <= 0) return { measure: 0, fraction: 0 };
		if (t >= totalDuration)
			return { measure: Math.max(0, input.measureCount - 1), fraction: 1 };
		let measure = 0;
		for (let m = 0; m < input.measureCount; m++) {
			if (t >= measureStartSeconds[m]) measure = m;
			else break;
		}
		// Invert secondsIntoMeasure piecewise so a mid-measure bpm change (channel
		// 08) round-trips exactly. A linear (t-start)/duration ratio diverges from
		// positionToTime whenever the tempo changes inside the measure.
		const startBpm = measureBpmAtStart[measure] ?? input.bpm;
		const fraction = Math.min(
			1,
			Math.max(
				0,
				fractionAtSeconds(measure, t - measureStartSeconds[measure], input, startBpm)
			)
		);
		return { measure, fraction };
	};

	return { measureStartSeconds, totalDuration, positionToTime, timeToPosition };
};
