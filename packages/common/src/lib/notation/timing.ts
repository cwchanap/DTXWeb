import type { LaneMeasureNote } from '../chart/note';
import type { NotationTempoEvent } from './model';

export interface TimingInput {
	bpm: number;
	/** noteID (2-char) -> bpm value, from DTXFile.parseBPMChanges(). */
	bpmValueMap: Record<string, number>;
	/** Channel '08' notes (bpm changes), as returned grouped by lane. */
	bpmChanges: LaneMeasureNote[];
	/** Per-measure length multiplier (1 = 4/4; from channel 02 bar-length changes). */
	measureLengths: number[];
	measureCount: number;
}

export interface ChartTiming {
	/** Normalized effective tempo sequence: the single source of truth for both
	 *  forward (positionToTime) and inverse (timeToPosition) timing. */
	tempoEvents: NotationTempoEvent[];
	measureStartSeconds: number[];
	totalDuration: number;
	positionToTime(measure: number, fraction: number): number;
	timeToPosition(t: number): { measure: number; fraction: number };
}

const BEATS_PER_WHOLE = 4;

interface OrderedTempoChange extends NotationTempoEvent {
	order: number;
}

/**
 * Normalize the base bpm and all channel-08 bpm changes into a single ordered
 * "effective tempo" sequence: one event per position where the sounding bpm
 * changes. Invalid/unresolved/non-positive changes are dropped (the prior
 * effective tempo carries through); exact-position ties keep the last change
 * in input order; consecutive events with the same bpm collapse into one.
 */
export const normalizeTempoEvents = (input: TimingInput): NotationTempoEvent[] => {
	const initialBpm = Number.isFinite(input.bpm) && input.bpm > 0 ? input.bpm : 120;
	const changes: OrderedTempoChange[] = [];
	let order = 0;

	for (const laneMeasure of input.bpmChanges) {
		for (const note of laneMeasure.notes) {
			if (note.noteID === '00') continue;
			const bpm = input.bpmValueMap[note.noteID];
			if (!Number.isFinite(bpm) || bpm <= 0) continue;
			if (laneMeasure.measure < 0 || laneMeasure.measure >= input.measureCount) continue;
			if (note.position < 0 || note.position > 1) continue;

			changes.push({
				measure: laneMeasure.measure,
				fraction: note.position,
				bpm,
				order: order++
			});
		}
	}

	changes.sort((a, b) => a.measure - b.measure || a.fraction - b.fraction || a.order - b.order);

	const events: NotationTempoEvent[] = [{ measure: 0, fraction: 0, bpm: initialBpm }];
	for (const change of changes) {
		const previous = events[events.length - 1];
		const samePosition =
			previous.measure === change.measure && previous.fraction === change.fraction;

		if (samePosition) {
			previous.bpm = change.bpm;
			continue;
		}
		if (previous.bpm === change.bpm) continue;
		events.push({ measure: change.measure, fraction: change.fraction, bpm: change.bpm });
	}

	return events.filter((event, index) => index === 0 || event.bpm !== events[index - 1].bpm);
};

/** Seconds elapsed across `fraction` (0..1) of a measure, honoring bpm changes within it. */
const secondsIntoMeasure = (
	measure: number,
	fraction: number,
	measureLength: number,
	startBpm: number,
	tempoEvents: NotationTempoEvent[]
): { seconds: number; endBpm: number } => {
	const perFraction = (bpm: number, frac: number) =>
		(60 / bpm) * BEATS_PER_WHOLE * frac * measureLength;
	const changes = tempoEvents.filter(
		(event) => event.measure === measure && event.fraction <= fraction
	);

	let seconds = 0;
	let bpm = startBpm;
	let last = 0;
	for (const change of changes) {
		seconds += perFraction(bpm, change.fraction - last);
		bpm = change.bpm;
		last = change.fraction;
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
	measureLength: number,
	startBpm: number,
	tempoEvents: NotationTempoEvent[]
): number => {
	if (targetSeconds <= 0) return 0;
	const perFractionUnit = (bpm: number) => (60 / bpm) * BEATS_PER_WHOLE * measureLength;

	// All bpm-change boundaries inside this measure, ascending. A change at
	// position 0 (downbeat) is included so the inverse matches secondsIntoMeasure,
	// which also applies position-0 changes: it becomes a zero-width first segment
	// that only swaps `bpm` to the new value before the real segments run.
	const bounds = tempoEvents
		.filter((event) => event.measure === measure && event.fraction >= 0 && event.fraction < 1)
		.map((event) => ({ position: event.fraction, bpm: event.bpm }));

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
	const tempoEvents = normalizeTempoEvents(input);
	const initialBpm = tempoEvents[0]?.bpm ?? 120;
	const measureStartSeconds: number[] = [];
	const measureBpmAtStart: number[] = [];
	let elapsed = 0;
	let bpm = initialBpm;
	for (let m = 0; m < input.measureCount; m++) {
		measureStartSeconds[m] = elapsed;
		measureBpmAtStart[m] = bpm;
		const measureLength = input.measureLengths[m] ?? 1;
		const { seconds, endBpm } = secondsIntoMeasure(m, 1, measureLength, bpm, tempoEvents);
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
		const startBpm = measureBpmAtStart[measure] ?? initialBpm;
		const measureLength = input.measureLengths[measure] ?? 1;
		return (
			base +
			secondsIntoMeasure(measure, fraction, measureLength, startBpm, tempoEvents).seconds
		);
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
		const startBpm = measureBpmAtStart[measure] ?? initialBpm;
		const measureLength = input.measureLengths[measure] ?? 1;
		const fraction = Math.min(
			1,
			Math.max(
				0,
				fractionAtSeconds(
					measure,
					t - measureStartSeconds[measure],
					measureLength,
					startBpm,
					tempoEvents
				)
			)
		);
		return { measure, fraction };
	};

	return { tempoEvents, measureStartSeconds, totalDuration, positionToTime, timeToPosition };
};
