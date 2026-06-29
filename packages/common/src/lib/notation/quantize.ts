import type { DTXFile } from '../chart/dtx';
import type { LaneMeasureNote } from '../chart/note';
import { laneToStaff } from './drumMapping';
import {
	TICKS_PER_WHOLE,
	type NotationEntry,
	type NotationMeasure,
	type NotationChart
} from './model';
import { buildChartTiming, type ChartTiming } from './timing';

const BPM_CHANNEL = '08';

/** Representable single durations, largest first: [ticks, vexflowCode]. */
const DURATION_TABLE: ReadonlyArray<readonly [number, string]> = [
	[192, 'w'],
	[96, 'h'],
	[48, 'q'],
	[24, '8'],
	[12, '16'],
	[6, '32'],
	[3, '64']
];

/**
 * Greedily decompose a tick span into plain (non-dotted) VexFlow duration codes,
 * largest-first. Binary-only keeps note/rest duration strings simple ('q', 'qr',
 * '8', '8r', …) and avoids dotted-rest parsing issues in VexFlow.
 */
export const ticksToDurations = (ticks: number): string[] => {
	const out: string[] = [];
	let remaining = ticks;
	while (remaining >= 3) {
		const entry = DURATION_TABLE.find(([t]) => t <= remaining);
		if (!entry) break;
		out.push(entry[1]);
		remaining -= entry[0];
	}
	return out;
};

interface Onset {
	tick: number;
	keys: string[];
}

export const quantizeMeasure = (
	index: number,
	laneNotes: LaneMeasureNote[],
	measureLength = 1
): NotationMeasure => {
	const measureTicks = Math.round(measureLength * TICKS_PER_WHOLE);
	const beatsPerMeasure = Math.max(1, Math.round(measureLength * 4));

	// Collect onsets keyed by tick, accumulating chord keys from playable lanes.
	// laneToStaff returns undefined for non-playable lanes (bpm/bgm), so the
	// `!staff` guard alone filters them out — no separate lane-list check needed.
	const byTick = new Map<number, Set<string>>();
	for (const lane of laneNotes) {
		const staff = laneToStaff(lane.laneID);
		if (!staff) continue;
		for (const note of lane.notes) {
			if (note.noteID === '00') continue;
			const tick = Math.round(note.position * measureTicks);
			if (!byTick.has(tick)) byTick.set(tick, new Set());
			byTick.get(tick)!.add(staff.key);
		}
	}

	const onsets: Onset[] = [...byTick.entries()]
		.map(([tick, keys]) => ({ tick, keys: [...keys] }))
		.sort((a, b) => a.tick - b.tick);

	const entries: NotationEntry[] = [];
	const pushRests = (startTick: number, spanTicks: number) => {
		let cursor = startTick;
		let remaining = spanTicks;
		while (remaining >= 3) {
			const entry = DURATION_TABLE.find(([t]) => t <= remaining);
			if (!entry) break;
			entries.push({ kind: 'rest', startTick: cursor, durTicks: entry[0] });
			cursor += entry[0];
			remaining -= entry[0];
		}
		// Off-grid onsets (e.g. position 1/11) leave a 1-2 tick remainder that no
		// binary duration can represent. Fold it into the last rest so the span is
		// fully consumed and sum(durTicks) == spanTicks (== measureTicks overall).
		if (remaining > 0) {
			const last = entries[entries.length - 1];
			if (last && last.kind === 'rest' && last.startTick >= startTick) {
				last.durTicks += remaining;
			} else {
				entries.push({ kind: 'rest', startTick: cursor, durTicks: remaining });
			}
		}
	};

	if (onsets.length === 0) {
		entries.push({ kind: 'rest', startTick: 0, durTicks: measureTicks });
		return { index, measureTicks, beatsPerMeasure, entries };
	}

	// Leading rest before first onset.
	if (onsets[0].tick > 0) pushRests(0, onsets[0].tick);

	onsets.forEach((onset, i) => {
		const nextTick = i + 1 < onsets.length ? onsets[i + 1].tick : measureTicks;
		const span = nextTick - onset.tick;
		const codes = ticksToDurations(span);
		// The note takes the largest leading duration; the remainder becomes rests.
		const noteDur = codes.length ? DURATION_TABLE.find(([, c]) => c === codes[0])![0] : span;
		entries.push({ kind: 'note', startTick: onset.tick, durTicks: noteDur, keys: onset.keys });
		if (span - noteDur > 0) pushRests(onset.tick + noteDur, span - noteDur);
	});

	return { index, measureTicks, beatsPerMeasure, entries };
};

export const groupNotesByLane = (notes: LaneMeasureNote[]): Record<string, LaneMeasureNote[]> => {
	const grouped: Record<string, LaneMeasureNote[]> = {};
	for (const note of notes) {
		(grouped[note.laneID] ||= []).push(note);
	}
	return grouped;
};

/**
 * Build the full notation chart + timing from a parsed DTXFile.
 * v1: every measure is 4/4 (measureLength = 1); channel '02' is not honored.
 */
export const buildNotationChart = (
	dtx: DTXFile
): {
	chart: NotationChart;
	timing: ChartTiming;
	notesByLane: Record<string, LaneMeasureNote[]>;
	measureCount: number;
} => {
	const flat = dtx.parseNotes();
	const notesByLane = groupNotesByLane(flat);
	const bpmValueMap = dtx.parseBPMChanges();

	const measureCount = flat.reduce((max, n) => Math.max(max, n.measure), 0) + 1;
	const measureLengths = new Array(measureCount).fill(1);

	// Group notes by measure once (O(n)) instead of re-filtering the whole list
	// for each measure (O(n*m)). Sparse charts with many empty measures would
	// otherwise re-scan every note per measure.
	const notesByMeasure = new Map<number, LaneMeasureNote[]>();
	for (const note of flat) {
		const bucket = notesByMeasure.get(note.measure);
		if (bucket) bucket.push(note);
		else notesByMeasure.set(note.measure, [note]);
	}

	const measures: NotationMeasure[] = [];
	for (let m = 0; m < measureCount; m++) {
		measures.push(quantizeMeasure(m, notesByMeasure.get(m) ?? [], 1));
	}

	const timing = buildChartTiming({
		bpm: dtx.bpm || 120,
		bpmValueMap,
		bpmChanges: notesByLane[BPM_CHANNEL] ?? [],
		measureLengths,
		measureCount
	});

	return { chart: { measures }, timing, notesByLane, measureCount };
};
