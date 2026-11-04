import type { DTXFile } from '../chart/dtx';
import { LaneMeasureNote } from '../chart/note';
import { laneToStaff } from './drumMapping';
import {
	TICKS_PER_WHOLE,
	DURATION_TABLE,
	type NotationEntry,
	type NotationTuplet,
	type NotationMeasure,
	type NotationChart
} from './model';
import { buildChartTiming, type ChartTiming } from './timing';

const BPM_CHANNEL = '08';
// Channel 03 is the legacy DTX BPM-change channel: noteIDs are direct hex BPM
// values (00-FF), optionally added to #BASEBPM (not parsed here; treated as 0).
const LEGACY_BPM_CHANNEL = '03';

/**
 * Greedily decompose a tick span into plain (non-dotted) VexFlow duration codes,
 * largest-first. Binary-only keeps note/rest duration strings simple ('q', 'qr',
 * '8', '8r', …) and avoids dotted-rest parsing issues in VexFlow.
 */
export const ticksToDurations = (ticks: number): string[] => {
	const out: string[] = [];
	let remaining = ticks;
	while (remaining >= 3) {
		const entry = DURATION_TABLE.find((d) => d.ticks <= remaining);
		if (!entry) break;
		out.push(entry.vexflow);
		remaining -= entry.ticks;
	}
	return out;
};

interface Onset {
	tick: number;
	laneIds: string[];
}

// The written grid can't place two attacks under a 64th (3 ticks) apart, so
// onsets closer than this merge into one rather than producing a span the
// MusicXML writer must reject.
const MIN_ONSET_GAP_TICKS = 3;

/**
 * Measure length multiplier -> integer measure ticks, snapped to a multiple of
 * 3. The MusicXML meter derivation needs a bar length divisible by some
 * power-of-2 meter unit (smallest unit is 3 ticks / 64th), and no power-of-2
 * unit divides a non-multiple-of-3 tick count (e.g. a 0.96 bar = 184.32 ->
 * 184 ticks). Snapping changes the bar length by at most 1.5 ticks.
 */
const toMeasureTicks = (measureLength: number): number =>
	Math.max(
		MIN_ONSET_GAP_TICKS,
		Math.round((measureLength * TICKS_PER_WHOLE) / MIN_ONSET_GAP_TICKS) * MIN_ONSET_GAP_TICKS
	);

// 24 = 16th-note triplet (3 16ths in an eighth span, 8-tick slots); 48/96/192
// = eighth/quarter/half-note triplets. 8-tick slots aren't in DURATION_TABLE,
// so without the 24-group those onsets fall back to 6-tick 32nds with dropped
// 2-tick gaps. The renderer derives baseDurTicks = slotTicks*3/2 = 12 ('16')
// for the VexFlow Tuplet, engraving a proper 16th-note triplet.
const TRIPLET_GROUP_TICKS = [24, 48, 96, 192] as const;

interface TripletCandidate {
	groupTicks: number;
	groupEnd: number;
	slotTicks: number;
	slotStarts: [number, number, number];
	occupiedCount: number;
	observedEnd: boolean;
}

const findNextOnsetTick = (onsets: Onset[], tick: number, measureTicks: number): number =>
	onsets.find((onset) => onset.tick > tick)?.tick ?? measureTicks;

const findTripletCandidate = (
	cursor: number,
	onsets: Onset[],
	onsetByTick: ReadonlyMap<number, Onset>,
	measureTicks: number
): TripletCandidate | undefined => {
	const candidates: TripletCandidate[] = [];

	for (const groupTicks of TRIPLET_GROUP_TICKS) {
		const slotTicks = groupTicks / 3;
		const groupEnd = cursor + groupTicks;
		if (!Number.isInteger(slotTicks) || groupEnd > measureTicks) continue;

		const slotStarts = [cursor, cursor + slotTicks, cursor + slotTicks * 2] as [
			number,
			number,
			number
		];
		const slotStartSet = new Set<number>(slotStarts);
		const hasOffSlotOnset = onsets.some(
			(onset) => onset.tick > cursor && onset.tick < groupEnd && !slotStartSet.has(onset.tick)
		);
		if (hasOffSlotOnset) continue;

		const occupiedSlots = slotStarts.map((tick) => onsetByTick.has(tick));
		const occupiedCount = occupiedSlots.filter(Boolean).length;
		if (occupiedCount < 2) continue;

		const observedEnd = groupEnd === measureTicks || onsetByTick.has(groupEnd);
		if (!occupiedSlots[2] && !observedEnd) continue;

		candidates.push({
			groupTicks,
			groupEnd,
			slotTicks,
			slotStarts,
			occupiedCount,
			observedEnd
		});
	}

	return candidates.sort(
		(a, b) =>
			b.occupiedCount - a.occupiedCount ||
			Number(b.observedEnd) - Number(a.observedEnd) ||
			a.groupTicks - b.groupTicks
	)[0];
};

export const quantizeMeasure = (
	index: number,
	laneNotes: LaneMeasureNote[],
	measureLength = 1
): NotationMeasure => {
	const measureTicks = toMeasureTicks(measureLength);
	const beatsPerMeasure = Math.max(1, Math.round(measureLength * 4));

	// Collect onsets keyed by tick, accumulating lane ids from playable lanes.
	// laneToStaff returns undefined for non-playable lanes (bpm/bgm), so the
	// `!staff` guard alone filters them out — no separate lane-list check needed.
	const byTick = new Map<number, Set<string>>();
	for (const lane of laneNotes) {
		const staff = laneToStaff(lane.laneID);
		if (!staff) continue;
		for (const note of lane.notes) {
			if (note.noteID === '00') continue;
			// Clamp into the bar: a position that rounds onto the barline lands
			// on the final tick so the end-of-bar adjustment below can fold it
			// into the bar's last representable slot instead of dropping it.
			// buildNotationChart normally relocates these to the next measure
			// first; the clamp is the fallback for the last measure and for
			// direct callers.
			const tick = Math.min(
				Math.max(0, Math.round(note.position * measureTicks)),
				measureTicks - 1
			);
			if (!byTick.has(tick)) byTick.set(tick, new Set());
			byTick.get(tick)!.add(lane.laneID.toUpperCase());
		}
	}

	const rawOnsets: Onset[] = [...byTick.entries()]
		.map(([tick, laneIds]) => ({ tick, laneIds: [...laneIds].sort() }))
		.sort((a, b) => a.tick - b.tick);

	// Merge onsets closer than a 64th into the previous kept onset, unioning
	// lane ids — a flam or a faster-than-1/96 roll becomes one attack carrying
	// all lanes. Comparing against the last KEPT onset (not the previous raw
	// one) keeps an ultra-dense roll at roughly half density instead of
	// collapsing the whole run into a single hit.
	const onsets: Onset[] = [];
	for (const onset of rawOnsets) {
		const last = onsets[onsets.length - 1];
		if (last && onset.tick - last.tick < MIN_ONSET_GAP_TICKS) {
			last.laneIds = [...new Set([...last.laneIds, ...onset.laneIds])].sort();
		} else {
			onsets.push(onset);
		}
	}

	// An onset within a 64th of the barline has no representable span. Pull it
	// back to the last representable slot when that slot is free (at most a
	// 2-tick shift); otherwise merge it into the previous onset.
	const lastOnset = onsets[onsets.length - 1];
	if (lastOnset && measureTicks - lastOnset.tick < MIN_ONSET_GAP_TICKS) {
		const pulled = measureTicks - MIN_ONSET_GAP_TICKS;
		const prev = onsets[onsets.length - 2];
		if (!prev || pulled - prev.tick >= MIN_ONSET_GAP_TICKS) {
			lastOnset.tick = pulled;
		} else {
			prev.laneIds = [...new Set([...prev.laneIds, ...lastOnset.laneIds])].sort();
			onsets.pop();
		}
	}

	const entries: NotationEntry[] = [];
	const pushRests = (startTick: number, spanTicks: number) => {
		let cursor = startTick;
		let remaining = spanTicks;
		while (remaining >= 3) {
			const entry = DURATION_TABLE.find((d) => d.ticks <= remaining);
			if (!entry) break;
			entries.push({ kind: 'rest', startTick: cursor, durTicks: entry.ticks });
			cursor += entry.ticks;
			remaining -= entry.ticks;
		}
		// Off-grid onsets (e.g. position 1/11) leave a 1-2 tick remainder that no
		// binary duration can represent. Fold it into the last rest so the span is
		// fully consumed and sum(durTicks) == spanTicks (== measureTicks overall).
		// When the remainder follows a note (no rest to fold into), drop it: a
		// 1-2 tick rest has no representable VexFlow code and would fall back to a
		// quarter-rest glyph. VexFlow runs setStrict(false) and cursorGeometry uses
		// startTick (not the tick sum), so the dropped sub-3-tick gap is harmless.
		if (remaining > 0) {
			const last = entries[entries.length - 1];
			if (last && last.kind === 'rest' && last.startTick >= startTick) {
				last.durTicks += remaining;
			}
		}
	};

	const tuplets: NotationTuplet[] = [];
	const onsetByTick = new Map<number, Onset>(onsets.map((onset) => [onset.tick, onset]));

	if (onsets.length === 0) {
		// Decompose the empty bar via pushRests so non-4/4 measures render with
		// rests that sum to the whole bar (e.g. 3/4 = 144 ticks -> half + quarter
		// rest). A single-rest push with durTicks=144 would fall through
		// NotationView's TICK_CODE lookup (no exact match) and render as a lone
		// half rest, misrepresenting the bar length. pushRests skips sub-3-tick
		// spans, so fall back to a single rest when it produces nothing — keeping
		// at least one entry for VexFlow to render.
		pushRests(0, measureTicks);
		if (entries.length === 0) {
			entries.push({ kind: 'rest', startTick: 0, durTicks: measureTicks });
		}
		return { index, measureTicks, beatsPerMeasure, entries, tuplets };
	}

	let cursor = 0;
	while (cursor < measureTicks) {
		const triplet = findTripletCandidate(cursor, onsets, onsetByTick, measureTicks);
		if (triplet) {
			const startIndex = entries.length;
			for (const slotStart of triplet.slotStarts) {
				const onset = onsetByTick.get(slotStart);
				if (onset) {
					entries.push({
						kind: 'note',
						startTick: slotStart,
						durTicks: triplet.slotTicks,
						laneIds: onset.laneIds
					});
				} else {
					entries.push({
						kind: 'rest',
						startTick: slotStart,
						durTicks: triplet.slotTicks
					});
				}
			}
			tuplets.push({
				startIndex,
				count: 3,
				slotTicks: triplet.slotTicks
			});
			cursor = triplet.groupEnd;
			continue;
		}

		const onset = onsetByTick.get(cursor);
		if (onset) {
			const nextTick = findNextOnsetTick(onsets, cursor, measureTicks);
			const span = nextTick - cursor;
			const codes = ticksToDurations(span);
			const noteDur = codes.length
				? DURATION_TABLE.find((d) => d.vexflow === codes[0])!.ticks
				: span;
			entries.push({
				kind: 'note',
				startTick: cursor,
				durTicks: noteDur,
				laneIds: onset.laneIds
			});
			if (span - noteDur > 0) pushRests(cursor + noteDur, span - noteDur);
			cursor = nextTick;
			continue;
		}

		const nextTick = findNextOnsetTick(onsets, cursor, measureTicks);
		pushRests(cursor, nextTick - cursor);
		cursor = nextTick;
	}

	return { index, measureTicks, beatsPerMeasure, entries, tuplets };
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
 * Channel 02 bar-length changes are honored: a decimal multiplier of 4/4
 * (e.g. 0.75 = 3/4) is applied to the measure and persists (sticky) until
 * the next channel 02 line, matching DTX semantics.
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

	// Build the per-measure length array from channel 02 bar-length changes.
	// DTX semantics: a change is sticky — it applies to its measure and every
	// subsequent measure until another channel 02 line overrides it.
	const measureLengthChanges = dtx.parseMeasureLengths();
	const sortedChanges = [...measureLengthChanges.entries()].sort((a, b) => a[0] - b[0]);
	const measureLengths = new Array(measureCount);
	let currentLength = 1;
	let changeIdx = 0;
	for (let m = 0; m < measureCount; m++) {
		while (changeIdx < sortedChanges.length && sortedChanges[changeIdx][0] <= m) {
			currentLength = sortedChanges[changeIdx][1];
			changeIdx++;
		}
		measureLengths[m] = currentLength;
	}

	// Group notes by measure once (O(n)) instead of re-filtering the whole list
	// for each measure (O(n*m)). Sparse charts with many empty measures would
	// otherwise re-scan every note per measure.
	const notesByMeasure = new Map<number, LaneMeasureNote[]>();
	for (const note of flat) {
		const bucket = notesByMeasure.get(note.measure);
		if (bucket) bucket.push(note);
		else notesByMeasure.set(note.measure, [note]);
	}

	// Notes that round onto or past the barline (position >= ~1-0.5/measureTicks)
	// never produce an entry — the quantize cursor never reaches measureTicks —
	// so without relocation they vanish from the preview and the export while
	// still playing. A barline-rounded attack sounds at the next downbeat, so
	// relocate it to tick 0 of the next measure. The final measure has no next
	// bar; its leftovers stay put and quantizeMeasure clamps them into the bar.
	const notationLanesByMeasure = new Map<number, LaneMeasureNote[]>();
	const pushLane = (m: number, lane: LaneMeasureNote) => {
		const list = notationLanesByMeasure.get(m);
		if (list) list.push(lane);
		else notationLanesByMeasure.set(m, [lane]);
	};
	for (const [m, lanes] of notesByMeasure) {
		const measureTicks = toMeasureTicks(measureLengths[m]);
		for (const lm of lanes) {
			if (!laneToStaff(lm.laneID)) continue;
			const kept: LaneMeasureNote['notes'] = [];
			const spilled: LaneMeasureNote['notes'] = [];
			for (const note of lm.notes) {
				const spills =
					Math.round(note.position * measureTicks) >= measureTicks &&
					m + 1 < measureCount;
				(spills ? spilled : kept).push(note);
			}
			if (kept.length) pushLane(m, new LaneMeasureNote(m, lm.laneID, kept, lm.measureLength));
			if (spilled.length) {
				pushLane(
					m + 1,
					new LaneMeasureNote(
						m + 1,
						lm.laneID,
						spilled.map((note) => ({ ...note, position: 0 })),
						measureLengths[m + 1]
					)
				);
			}
		}
	}

	const measures: NotationMeasure[] = [];
	for (let m = 0; m < measureCount; m++) {
		measures.push(quantizeMeasure(m, notationLanesByMeasure.get(m) ?? [], measureLengths[m]));
	}

	// Channel 08 (#BPMzz references) and channel 03 (legacy direct-hex BPM) both
	// carry tempo changes. The timing code looks up `bpmValueMap[change.noteID]`,
	// which works for channel 08's #BPMzz keys. Channel 03 noteIDs are hex BPM
	// values that can collide with #BPMzz keys (e.g. '0A' = hex 10 vs #BPM0A), so
	// convert them to synthetic prefixed keys and populate bpmValueMap entries.
	const legacyBpmChanges: LaneMeasureNote[] = [];
	for (const lm of notesByLane[LEGACY_BPM_CHANNEL] ?? []) {
		const convertedNotes = lm.notes
			.filter((n) => n.noteID !== '00')
			.map((n) => {
				const syntheticId = `03:${n.noteID}`;
				bpmValueMap[syntheticId] = parseInt(n.noteID, 16);
				return { noteID: syntheticId, position: n.position };
			});
		if (convertedNotes.length > 0) {
			legacyBpmChanges.push(new LaneMeasureNote(lm.measure, BPM_CHANNEL, convertedNotes));
		}
	}

	const timing = buildChartTiming({
		bpm: dtx.bpm || 120,
		bpmValueMap,
		bpmChanges: [...(notesByLane[BPM_CHANNEL] ?? []), ...legacyBpmChanges],
		measureLengths,
		measureCount
	});

	return {
		chart: { measures, tempoEvents: [...timing.tempoEvents] },
		timing,
		notesByLane,
		measureCount
	};
};
