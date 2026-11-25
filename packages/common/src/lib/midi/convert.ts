import type { DTXFile, DtxExportControls } from '../chart/dtx';
import { LaneMeasureNote } from '../chart/note';
import { GM_IMPORT_LANE, laneToStaff } from '../notation/drumMapping';
import { buildTimingInput } from '../notation/quantize';
import { normalizeTempoEvents } from '../notation/timing';
import type { ParsedMidi } from './parser';

export const MIDI_PPQ = 480;
const DRUM_CHANNEL = 9;
// BGM (01) and control lanes never produce MIDI notes or drum cells.
const NON_DRUM_LANES = new Set(['01', '02', '03', '08']);
// DTX measure headers are three digits, so conversions may emit at most
// measures 0-999. '00' is the rest cell, leaving '01'-'ZZ' = 1295 BPM ids.
const MAX_DTX_MEASURES = 1000;
const MAX_BPM_ID = parseInt('ZZ', 36); // 1295
// SMF delta-times are 1-4 byte VLQs; the shared parser reads at most four,
// so a single gap can span at most 0x0FFFFFFF ticks.
const MAX_DELTA_TICKS = 0x0fffffff;

const encodeVlq = (value: number): number[] => {
	const bytes = [value & 0x7f];
	let remaining = Math.floor(value / 128);
	while (remaining > 0) {
		bytes.unshift((remaining & 0x7f) | 0x80);
		remaining = Math.floor(remaining / 128);
	}
	return bytes;
};

/**
 * Map a DTX bar-length multiplier (of 4/4) to a MIDI time signature.
 * Numerators are `multiplier * denominator`; the smallest power-of-two
 * denominator (quarter and below) that yields an integer wins. Returns
 * undefined for lengths like 0.96 that no power-of-two meter expresses.
 */
const meterFor = (measureLength: number): { numerator: number; dd: number } | undefined => {
	for (let dd = 2; dd <= 7; dd++) {
		const numerator = measureLength * 2 ** dd;
		const rounded = Math.round(numerator);
		if (Math.abs(numerator - rounded) < 1e-9 && rounded >= 1 && rounded <= 255) {
			return { numerator: rounded, dd };
		}
	}
	return undefined;
};

export interface DtxToMidiResult {
	/** SMF format-0 bytes, 480 PPQ or higher when a short bar needs it. */
	data: Uint8Array<ArrayBuffer>;
	/** Nonfatal diagnostics (unmapped lanes, approximated meters). */
	warnings: string[];
}

interface PendingEvent {
	tick: number;
	/** Sort tier: tempo/meter first, note-off before same-pitch note-on. */
	order: number;
	seq: number;
	bytes: number[];
}

/**
 * Convert a parsed DTX chart to a format-0 SMF.
 * Note ticks come from cumulative `4 * PPQ * measureLength` bar starts plus
 * each note's bar fraction; tempo/meter come from `buildTimingInput`, so the
 * export shares the notation path's channel-02/03/08 semantics exactly.
 * PPQ stays 480 unless the shortest bar would leave fewer than 192 ticks —
 * each 1/192 DTX slot must land on a distinct tick or adjacent hits merge.
 */
export const dtxToMidi = (
	dtx: DTXFile,
	laneNoteMap: Record<string, number> = {}
): DtxToMidiResult => {
	const parsedNotes = dtx.parseNotes();
	const timing = buildTimingInput(dtx, parsedNotes);
	const { measureLengths, measureCount } = timing;

	const events: PendingEvent[] = [];
	let seq = 0;
	const warnings: string[] = [];
	const warned = new Set<string>();

	// Resolve each lane-measure's MIDI note once: the emission loop and the
	// division floor both need to know which same-note onsets actually emit.
	const emissionGroups: { lm: LaneMeasureNote; noteNumber: number }[] = [];
	const onsetFractions = new Map<string, { measure: number; fractions: number[] }>();
	for (const lm of parsedNotes) {
		const lane = lm.laneID.toUpperCase();
		if (NON_DRUM_LANES.has(lane)) continue;
		if (lm.measure < 0 || lm.measure >= measureCount) continue;
		// A non-positive measureLength would produce non-finite ticks.
		if (!Number.isFinite(lm.measureLength) || lm.measureLength <= 0) continue;
		const noteNumber = laneNoteMap[lane] ?? laneNoteMap[lm.laneID] ?? laneToStaff(lane)?.midi;
		if (noteNumber === undefined) {
			const key = `lane-${lane}`;
			if (!warned.has(key)) {
				warned.add(key);
				warnings.push(`lane ${lane} has no GM note; ${lm.notes.length} hit(s) skipped`);
			}
			continue;
		}
		// Overrides can carry non-note values; 128+ or NaN would emit a byte
		// the parser itself rejects (or a silent note 0).
		if (!Number.isInteger(noteNumber) || noteNumber < 0 || noteNumber > 127) {
			const key = `note-${lane}`;
			if (!warned.has(key)) {
				warned.add(key);
				warnings.push(`lane ${lane} maps to invalid MIDI note ${noteNumber}; hits skipped`);
			}
			continue;
		}
		const defaultImportLane = GM_IMPORT_LANE[noteNumber];
		if (lane === '1C' && defaultImportLane !== '1C' && !warned.has('left-bass-reimport')) {
			warned.add('left-bass-reimport');
			warnings.push(
				defaultImportLane
					? `lane 1C exports as GM note ${noteNumber}, which imports as lane ${defaultImportLane} by default; use a mapping override to re-import left-bass hits`
					: `lane 1C exports as GM note ${noteNumber}, which has no default import lane; use a mapping override to re-import left-bass hits`
			);
		}
		emissionGroups.push({ lm, noteNumber });
		const groupKey = `${noteNumber}|${lm.measure}`;
		const group = onsetFractions.get(groupKey) ?? { measure: lm.measure, fractions: [] };
		for (const note of lm.notes) {
			if (note.noteID !== '00') group.fractions.push(note.position / lm.measureLength);
		}
		onsetFractions.set(groupKey, group);
	}

	// Two things decide the division: every bar still needs 192 ticks for
	// the DTX slot grid, and every emitted same-note onset needs its own
	// tick — widened 384/768-cell patterns space hits finer than 1/192.
	// Each group's tightest spacing sets its own floor (ticks scale with
	// the bar length), with barline sentinels covering hits a hair off the
	// measure edge. PPQ is forced to a multiple of 32 so every supported
	// meter (power-of-two denominators through 2^7) still spans whole
	// ticks — a fractional bar boundary reimports as a mid-bar meter
	// change. SMF division is 15 bits, so an absurdly tight grid still
	// merges — capped at 0x7fe0, the largest multiple of 32 under the
	// limit, and reported.
	let minBarLength = Infinity;
	for (let m = 0; m < measureCount; m++) {
		minBarLength = Math.min(minBarLength, measureLengths[m] ?? 1);
	}
	let onsetPpq = 0;
	let mergedSamePitch = 0;
	for (const { measure, fractions } of onsetFractions.values()) {
		const barLength = measureLengths[measure] ?? 1;
		const sorted = [...fractions].sort((a, b) => a - b);
		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i] === sorted[i - 1]) mergedSamePitch++;
		}
		const distinct = [...new Set(fractions), 0, 1].sort((a, b) => a - b);
		for (let i = 1; i < distinct.length; i++) {
			const gap = distinct[i] - distinct[i - 1];
			if (gap > 0) {
				onsetPpq = Math.max(onsetPpq, 1 / (4 * Math.max(barLength, 1e-9) * gap));
			}
		}
	}
	if (mergedSamePitch > 0) {
		warnings.push(
			`${mergedSamePitch} hit(s) share the same MIDI note and tick with another hit and may merge on reimport`
		);
	}
	const ppq = Math.min(
		0x7fe0,
		Math.max(
			MIDI_PPQ,
			Math.ceil(Math.max(48 / Math.max(minBarLength, 1e-9), onsetPpq) / 32) * 32
		)
	);
	// Integer ticks only — encodeVlq truncates deltas, so a fractional release
	// length would shave a sub-tick off every note-off after it.
	const noteDurationTicks = Math.round(ppq / 4);

	// Cumulative bar starts in MIDI ticks.
	const measureStart: number[] = new Array(measureCount);
	let acc = 0;
	for (let m = 0; m < measureCount; m++) {
		measureStart[m] = acc;
		acc += 4 * ppq * (measureLengths[m] ?? 1);
	}
	const tickInMeasure = (measure: number, fraction: number): number =>
		measureStart[measure] + fraction * 4 * ppq * (measureLengths[measure] ?? 1);

	if (4 * ppq * minBarLength < 192) {
		warnings.push(
			'the shortest bar cannot hold all 192 DTX slots at the MIDI PPQ limit; adjacent hits may merge'
		);
	}
	if (onsetPpq > ppq) {
		warnings.push(
			'some hits are spaced closer than the MIDI PPQ limit separates; distinct onsets may merge'
		);
	}

	// Tempo events from the normalized timing seam (base BPM at tick 0 plus
	// every effective change); the first event lands on tick 0 by construction.
	for (const event of normalizeTempoEvents(timing)) {
		const mpq = Math.round(60000000 / event.bpm);
		// MPQ is a 24-bit field; anything larger would silently wrap into a
		// different, valid-looking tempo (~6.2 BPM for a 1 BPM source).
		if (mpq < 1 || mpq > 0xffffff) {
			throw new Error(`tempo ${event.bpm} BPM is outside the 24-bit MIDI range`);
		}
		events.push({
			tick: Math.round(tickInMeasure(event.measure, event.fraction)),
			order: 0,
			seq: seq++,
			bytes: [0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff]
		});
	}

	// Meter events only where the bar length changes; unrepresentable
	// multipliers keep note timing (which uses the true multiplier) and warn.
	let previousLength = 0;
	// Once an unrepresentable length is skipped the importer can no longer
	// rebuild the true bar grid, so any later change's true-grid tick lands
	// mid-bar on the rebuilt grid and makes the file unimportable. Suppress
	// the rest; notes keep absolute ticks either way.
	let meterSuppressed = false;
	for (let m = 0; m < measureCount; m++) {
		const length = measureLengths[m] ?? 1;
		if (length === previousLength) continue;
		previousLength = length;
		const meter = meterFor(length);
		if (!meter) {
			meterSuppressed = true;
			const key = `meter-${length}`;
			if (!warned.has(key)) {
				warned.add(key);
				warnings.push(
					`bar length ${length} is not a representable MIDI meter; note timing kept, meter omitted`
				);
			}
			continue;
		}
		if (meterSuppressed) {
			if (!warned.has('meter-suppressed')) {
				warned.add('meter-suppressed');
				warnings.push(
					'meter changes after an unrepresentable bar length are omitted; note timing kept'
				);
			}
			continue;
		}
		events.push({
			tick: Math.round(measureStart[m]),
			order: 0,
			seq: seq++,
			bytes: [0xff, 0x58, 0x04, meter.numerator, meter.dd, 24, 8]
		});
	}

	for (const { lm, noteNumber } of emissionGroups) {
		for (const note of lm.notes) {
			if (note.noteID === '00') continue;
			const tick = Math.round(tickInMeasure(lm.measure, note.position / lm.measureLength));
			events.push(
				{
					tick,
					order: 2,
					seq: seq++,
					bytes: [0x90 | DRUM_CHANNEL, noteNumber, 100]
				},
				{
					tick: tick + noteDurationTicks,
					order: 1,
					seq: seq++,
					bytes: [0x80 | DRUM_CHANNEL, noteNumber, 0]
				}
			);
		}
	}

	// Sort by absolute tick; same-tick controls (tempo/meter) first, then
	// note-offs, then note-ons so a re-hit never precedes its release. seq
	// keeps equal keys in insertion order.
	events.sort((a, b) => a.tick - b.tick || a.order - b.order || a.seq - b.seq);

	const trackBytes: number[] = [];
	let previousTick = 0;
	for (const event of events) {
		const delta = event.tick - previousTick;
		// Non-finite ticks (huge channel-02 multipliers accumulate into bar
		// starts) would hang encodeVlq forever; deltas past the 4-byte VLQ
		// range produce bytes our own parser rejects. Reject both explicitly.
		if (!Number.isFinite(delta) || delta < 0 || delta > MAX_DELTA_TICKS) {
			throw new Error(`event at tick ${event.tick} is outside the representable MIDI range`);
		}
		trackBytes.push(...encodeVlq(delta), ...event.bytes);
		previousTick = event.tick;
	}
	trackBytes.push(0x00, 0xff, 0x2f, 0x00); // end of track

	const data = new Uint8Array(14 + 8 + trackBytes.length);
	const view = new DataView(data.buffer);
	data.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
	view.setUint32(4, 6, false);
	view.setUint16(8, 0, false); // format 0
	view.setUint16(10, 1, false); // one track
	view.setUint16(12, ppq, false);
	data.set([0x4d, 0x54, 0x72, 0x6b], 14); // MTrk
	view.setUint32(18, trackBytes.length, false);
	data.set(trackBytes, 22);

	return { data, warnings };
};

export interface MidiToDtxOptions {
	/** GM note -> DTX lane, merged over {@link GM_IMPORT_LANE}; falsy lanes unmap. */
	noteToLane?: Record<number, string>;
	/** Override for the detected initial tempo (base #BPM). */
	bpm?: number;
}

export interface MidiToDtxResult {
	/** Drum lanes plus channel-08 tempo refs, ready for toDtxText(). */
	notes: Record<string, LaneMeasureNote[]>;
	/** #BPMxx definitions and channel-02 decimal lengths for toDtxText(). */
	controls: DtxExportControls;
	/** Base #BPM: the initial MIDI tempo, or options.bpm. */
	bpm: number;
	/** Same-lane hits that quantized onto one 1/192 cell (kept first, rest dropped). */
	collisions: number;
	/** Drum-channel note-ons with no lane mapping. */
	unmappedNotes: number;
	warnings: string[];
}

/**
 * Convert a parsed MIDI file to DTX notes + serializer controls.
 * Bar boundaries follow the file's meter changes (4/4 default); positions
 * quantize to 1/192 of each bar and every LaneMeasureNote keeps
 * measureLength = 1, so toPattern/onset invariants hold. Mid-bar meter
 * changes are rejected rather than silently shifting later hits.
 */
export const midiToDtx = (midi: ParsedMidi, options: MidiToDtxOptions = {}): MidiToDtxResult => {
	if (midi.format === 2 && midi.tracks.length > 1) {
		throw new Error(
			'Multi-track format 2 MIDI files contain independent sequences and cannot be merged into one DTX chart'
		);
	}
	const ppq = midi.ticksPerQuarter;
	const warnings: string[] = [];

	// Meter changes sorted by tick; a change applies from its bar onward. A
	// zero/invalid multiplier would make a zero-length bar (bars could never
	// advance) — the file is not convertible.
	const merged: { tick: number; length: number; signature: string }[] = [];
	for (const event of midi.meterEvents) {
		// SMF's fourth time-signature byte is the notated 32nds per MIDI
		// quarter (8 by default); a nondefault ratio rescales the real bar
		// length, so it belongs in the meter math.
		const length = (event.numerator / event.denominator) * (8 / event.notated32ndsPerQuarter);
		if (!Number.isFinite(length) || length <= 0) {
			throw new Error(
				`Unsupported MIDI meter ${event.numerator}/${event.denominator} at tick ${event.tick}`
			);
		}
		const signature = `${event.numerator}/${event.denominator}/${event.notated32ndsPerQuarter}`;
		const last = merged[merged.length - 1];
		if (last && last.tick === event.tick) {
			last.length = length; // same tick: last wins
			last.signature = signature;
		} else {
			merged.push({ tick: event.tick, length, signature });
		}
	}
	// An event repeating the effective signature changes nothing; filtering
	// by signature (not bar length) keeps equal-length changes like 6/8 ->
	// 3/4 reachable by the mid-bar boundary check instead of hiding them.
	const meterChanges: { tick: number; length: number }[] = [];
	let effectiveSignature = '4/4/8';
	for (const change of merged) {
		if (change.signature === effectiveSignature) continue;
		meterChanges.push({ tick: change.tick, length: change.length });
		effectiveSignature = change.signature;
	}
	let meterIndex = 0;
	let currentLength = 1;
	if (meterChanges[0]?.tick === 0) {
		currentLength = meterChanges[0].length;
		meterIndex = 1;
	}

	const laneOf = { ...GM_IMPORT_LANE, ...options.noteToLane };
	const isLaneMapped = (note: number): boolean => {
		const lane = laneOf[note]?.toUpperCase();
		return Boolean(lane && laneToStaff(lane));
	};
	// Drum-only MIDI exports are not consistently written to channel 10. The
	// pre-shared importer mapped notes on every channel, so treat all channels
	// as drum input when channel 10 has no nonzero-velocity note-ons at all;
	// when channel 10 does have note-ons (even unmapped percussion), keep the
	// stricter filter so melodic channels are not turned into drum hits.
	const hasDrumChannelNote = midi.tracks.some((track) =>
		track.events.some(
			(event) =>
				event.type === 'channel' &&
				event.command === 0x90 &&
				event.note !== undefined &&
				Boolean(event.velocity) &&
				event.channel === DRUM_CHANNEL
		)
	);
	const useAllChannels = !hasDrumChannelNote;
	const isConvertibleNote = (channel: number, note: number): boolean =>
		(useAllChannels || channel === DRUM_CHANNEL) && isLaneMapped(note);

	// Tempo: first event -> base #BPM (or override); later effective changes ->
	// #BPMxx defs + channel-08 refs quantized like drum hits. Resolve same-tick
	// and repeated effective values before the measure bound: a no-op tempo
	// meta event does not extend the playable chart.
	const bpmOf = (mpq: number): number => {
		const rounded = Math.round((60000000 / mpq) * 1000) / 1000;
		// Keep 3-decimal rounding only when it round-trips to the source MPQ
		// (recovering exact integer tempos like 140/180). Otherwise two
		// distinct slow tempos can collapse onto the same rounded BPM.
		return rounded > 0 && Math.round(60000000 / rounded) === mpq ? rounded : 60000000 / mpq;
	};
	const tempoEvents: { tick: number; bpm: number }[] = [];
	for (const event of midi.tempoEvents) {
		const last = tempoEvents[tempoEvents.length - 1];
		if (last && last.tick === event.tick) last.bpm = bpmOf(event.microsecondsPerQuarter);
		else tempoEvents.push({ tick: event.tick, bpm: bpmOf(event.microsecondsPerQuarter) });
	}
	// Only a tempo event AT tick 0 sets the base; a first event later in the
	// file is a real tempo change and the file's start defaults to 120.
	const firstAtStart = tempoEvents[0]?.tick === 0;
	const bpm = options.bpm ?? (firstAtStart ? tempoEvents[0].bpm : 120);
	const effectiveTempoEvents: typeof tempoEvents = [];
	let effectiveBpm = bpm;
	for (const event of tempoEvents.slice(firstAtStart ? 1 : 0)) {
		if (event.bpm === effectiveBpm) continue;
		effectiveBpm = event.bpm;
		effectiveTempoEvents.push(event);
	}

	const lastNoteTick = midi.tracks.reduce(
		(max, t) =>
			t.notes.reduce(
				(m, n) => (isConvertibleNote(n.channel, n.note) ? Math.max(m, n.startTime) : m),
				max
			),
		0
	);
	const endTick = Math.max(
		lastNoteTick,
		effectiveTempoEvents[effectiveTempoEvents.length - 1]?.tick ?? 0,
		meterChanges[meterChanges.length - 1]?.tick ?? 0
	);

	// DTX measure headers are three digits (#NNNxx), so output is bounded to
	// measure indices 0-999. A hostile tick (e.g. 0x0fffffff at PPQ 1) would
	// otherwise allocate tens of millions of bars before conversion ends.
	// Reject early using the fewest bars possible (every bar at the largest
	// meter); the in-loop bound below still catches files where smaller
	// meters later push the real count over the limit.
	const maxBarLength = meterChanges
		.slice(meterIndex)
		.reduce((max, change) => Math.max(max, change.length), currentLength);
	if (endTick / (4 * ppq * maxBarLength) > MAX_DTX_MEASURES) {
		throw new Error(`MIDI conversion exceeds the ${MAX_DTX_MEASURES}-measure DTX range`);
	}

	// Bar starts; a meter event off a computed boundary is a mid-bar change.
	// Fractional meter spans (e.g. 5/8 at 12 notated 32nds/quarter) accumulate
	// float error, so compare with tick tolerance and snap a matched barline
	// to the event's exact tick instead of rejecting a valid change.
	const TICK_EPSILON = 1e-6;
	const barStarts = [0];
	const barLengths: number[] = [];
	while (barStarts[barStarts.length - 1] <= endTick || meterIndex < meterChanges.length) {
		if (barLengths.length >= MAX_DTX_MEASURES) {
			throw new Error(`MIDI conversion exceeds the ${MAX_DTX_MEASURES}-measure DTX range`);
		}
		let start = barStarts[barStarts.length - 1];
		while (
			meterIndex < meterChanges.length &&
			meterChanges[meterIndex].tick <= start + TICK_EPSILON
		) {
			if (meterChanges[meterIndex].tick < start - TICK_EPSILON) {
				throw new Error(
					`Unsupported mid-bar meter change at tick ${meterChanges[meterIndex].tick}`
				);
			}
			currentLength = meterChanges[meterIndex].length;
			start = meterChanges[meterIndex].tick;
			meterIndex++;
		}
		barStarts[barStarts.length - 1] = start;
		barLengths.push(currentLength);
		const next = start + 4 * ppq * currentLength;
		// A degenerate meter (numerator/huge denominator) must still advance.
		if (next <= start) {
			throw new Error('Unsupported meter produces a non-advancing bar');
		}
		barStarts.push(next);
	}
	const measureCount = barStarts.length - 1;

	// Bar index containing a tick = last bar start <= tick (ticks stay inside
	// generated bars because generation covers endTick).
	const barAt = (tick: number): number => {
		let lo = 0;
		let hi = measureCount - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (barStarts[mid] <= tick) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};

	// Quantize a tick to {measure, fraction on the 1/192 grid in [0,1)}.
	// A tick rounding onto the barline rolls into the next bar's slot 0.
	const quantize = (tick: number): { measure: number; position: number } => {
		const measure = barAt(tick);
		const span = barStarts[measure + 1] - barStarts[measure];
		const slot = Math.round(((tick - barStarts[measure]) / span) * 192);
		if (slot >= 192) {
			if (measure + 1 >= MAX_DTX_MEASURES) {
				throw new Error(
					`MIDI conversion exceeds the ${MAX_DTX_MEASURES}-measure DTX range`
				);
			}
			return { measure: measure + 1, position: 0 };
		}
		return { measure, position: slot / 192 };
	};

	const notes: Record<string, LaneMeasureNote[]> = {};
	const groupBy = new Map<string, LaneMeasureNote>();
	const occupied = new Set<string>();
	let collisions = 0;
	let unmappedNotes = 0;
	let skippedChannels = 0;

	for (const track of midi.tracks) {
		for (const event of track.events) {
			if (
				event.type !== 'channel' ||
				event.command !== 0x90 ||
				event.note === undefined ||
				!event.velocity
			) {
				continue;
			}
			if (!useAllChannels && event.channel !== DRUM_CHANNEL) {
				skippedChannels++;
				continue;
			}
			// Overrides may arrive lowercase; laneToStaff accepts any case but
			// the collision/group keys and serialized lane ids below are
			// case-sensitive — a lowercase '1c' would duplicate lane '1C'.
			const lane = laneOf[event.note]?.toUpperCase();
			if (!lane || !laneToStaff(lane)) {
				unmappedNotes++;
				continue;
			}
			const { measure, position } = quantize(event.absoluteTime);
			const slotKey = `${lane}|${measure}|${position}`;
			if (occupied.has(slotKey)) {
				collisions++;
				continue;
			}
			occupied.add(slotKey);

			const groupKey = `${lane}|${measure}`;
			let group = groupBy.get(groupKey);
			if (!group) {
				group = new LaneMeasureNote(measure, lane, [], 1);
				groupBy.set(groupKey, group);
				(notes[lane] ||= []).push(group);
			}
			group.notes.push({ noteID: '01', position });
		}
	}
	if (skippedChannels > 0) {
		warnings.push(`${skippedChannels} note(s) on non-drum channels ignored`);
	}

	const bpmChanges: Record<string, number> = {};
	const bpmIds = new Map<number, string>();
	let idCounter = 0;
	let tempoCollisions = 0;
	// Resolve cell collisions (last wins per 1/192 cell) before allocating
	// #BPMxx IDs so overwritten intermediate values do not exhaust the 2-char
	// ID space.
	const resolvedTempoCells = new Map<
		string,
		{ measure: number; position: number; bpm: number; drift: number; tick: number }
	>();
	for (const event of effectiveTempoEvents) {
		let { measure, position } = quantize(event.tick);
		// Keep positive-tick tempo changes out of cell 0 so they cannot
		// overwrite the base #BPM (or user BPM override) at t = 0.
		if (event.tick > 0 && measure === 0 && position === 0) {
			position = 1 / 192;
		}
		// DTX tempo refs can only sit on the 1/192 grid; each off-grid snap
		// shifts playback time, and shifts compound across segments.
		const snappedTick =
			barStarts[measure] +
			position * ((barStarts[measure + 1] ?? barStarts[measure]) - barStarts[measure]);
		// event.tick is integral; sub-hundredth-tick drift is reconstruction
		// float dust (position * barTicks), not a real snap.
		const drift = Math.abs(snappedTick - event.tick);
		const cellKey = `${measure}|${position}`;
		const existingCell = resolvedTempoCells.get(cellKey);
		if (existingCell) {
			tempoCollisions++;
			existingCell.bpm = event.bpm;
			existingCell.drift = drift;
			existingCell.tick = snappedTick;
		} else {
			resolvedTempoCells.set(cellKey, {
				measure,
				position,
				bpm: event.bpm,
				drift,
				tick: snappedTick
			});
		}
	}
	// Ticks each tempo is active, used to keep a long-held tempo close to its
	// original BPM when the id space forces it to share a definition.
	const activeTicks = new Map<number, number>();
	const cellsByTick = [...resolvedTempoCells.values()].sort((a, b) => a.tick - b.tick);
	for (let i = 0; i < cellsByTick.length; i++) {
		const cell = cellsByTick[i];
		const nextTick = cellsByTick[i + 1]?.tick ?? endTick;
		activeTicks.set(
			cell.bpm,
			(activeTicks.get(cell.bpm) ?? 0) + Math.max(0, nextTick - cell.tick)
		);
	}
	// A dense tempo ramp can carry more distinct MPQs than the two-character
	// #BPMxx id space. Partition the sorted tempos into at most MAX_BPM_ID
	// contiguous groups while minimising the widest group, so a steady tempo
	// away from the ramp keeps its exact BPM instead of being rounded to the
	// ramp's coarsest scale. A group spanning 1 BPM or more is audible, so a
	// file that needs one is unrepresentable.
	const uniqueTempos = [
		...new Set([...resolvedTempoCells.values()].map((cell) => cell.bpm))
	].sort((a, b) => a - b);
	if (uniqueTempos.length > MAX_BPM_ID) {
		const spanOf = (start: number, end: number): number =>
			uniqueTempos[end] - uniqueTempos[start];
		// Fewest groups a span limit allows: pack each group until the next
		// value would widen it past the limit.
		const groupsAt = (span: number): number => {
			let groups = 1;
			let start = 0;
			for (let i = 1; i < uniqueTempos.length; i++) {
				if (uniqueTempos[i] - uniqueTempos[start] > span) {
					groups++;
					start = i;
				}
			}
			return groups;
		};
		let lo = 0;
		let hi = spanOf(0, uniqueTempos.length - 1);
		for (let i = 0; i < 64; i++) {
			const mid = (lo + hi) / 2;
			if (groupsAt(mid) <= MAX_BPM_ID) hi = mid;
			else lo = mid;
		}
		if (hi >= 1) {
			throw new Error(
				`MIDI has more than ${MAX_BPM_ID} distinct BPM changes; the two-character DTX id space is exhausted`
			);
		}
		const groups: { start: number; end: number }[] = [];
		let start = 0;
		for (let i = 1; i <= uniqueTempos.length; i++) {
			if (i === uniqueTempos.length || uniqueTempos[i] - uniqueTempos[start] > hi) {
				groups.push({ start, end: i - 1 });
				start = i;
			}
		}
		// A span limit can pack several values per group when gaps tie; split
		// the widest groups until every available id is used.
		while (groups.length < MAX_BPM_ID) {
			let widest = 0;
			for (let i = 1; i < groups.length; i++) {
				if (
					spanOf(groups[i].start, groups[i].end) >
					spanOf(groups[widest].start, groups[widest].end)
				) {
					widest = i;
				}
			}
			const group = groups[widest];
			if (group.start === group.end) break;
			// Split where the two halves' widest spans cross.
			let a = group.start + 1;
			let b = group.end;
			while (a < b) {
				const mid = (a + b) >> 1;
				if (
					uniqueTempos[mid - 1] - uniqueTempos[group.start] <
					uniqueTempos[group.end] - uniqueTempos[mid]
				) {
					a = mid + 1;
				} else {
					b = mid;
				}
			}
			let split = a;
			let bestSpan = Math.max(spanOf(group.start, a - 1), spanOf(a, group.end));
			if (a - 1 > group.start) {
				const previousSpan = Math.max(spanOf(group.start, a - 2), spanOf(a - 1, group.end));
				if (previousSpan < bestSpan) {
					bestSpan = previousSpan;
					split = a - 1;
				}
			}
			groups.splice(
				widest,
				1,
				{ start: group.start, end: split - 1 },
				{ start: split, end: group.end }
			);
		}
		const mergedTempos = new Map<number, number>();
		let maxTempoError = 0;
		let maxClusterSpan = 0;
		for (const group of groups) {
			// Harmonic mean weighted by active ticks keeps the group's total
			// playback time, so a tempo held for most of a group dominates.
			let groupTicks = 0;
			let groupTime = 0;
			for (let i = group.start; i <= group.end; i++) {
				const ticks = activeTicks.get(uniqueTempos[i]) ?? 0;
				groupTicks += ticks;
				groupTime += ticks / uniqueTempos[i];
			}
			const representative =
				groupTime > 0
					? groupTicks / groupTime
					: (uniqueTempos[group.start] + uniqueTempos[group.end]) / 2;
			maxClusterSpan = Math.max(maxClusterSpan, spanOf(group.start, group.end));
			for (let i = group.start; i <= group.end; i++) {
				mergedTempos.set(uniqueTempos[i], representative);
				maxTempoError = Math.max(maxTempoError, Math.abs(representative - uniqueTempos[i]));
			}
		}
		for (const cell of resolvedTempoCells.values()) {
			cell.bpm = mergedTempos.get(cell.bpm) ?? cell.bpm;
		}
		warnings.push(
			`MIDI has more than ${MAX_BPM_ID} distinct tempo changes; tempo values within ${Number(maxClusterSpan.toPrecision(3))} BPM were merged (up to ${Number(maxTempoError.toPrecision(3))} BPM) to fit the DTX #BPM id space`
		);
	}
	let tempoSnapped = 0;
	let maxTempoDrift = 0;
	for (const { measure, position, bpm: cellBpm, drift } of resolvedTempoCells.values()) {
		if (drift > 0.01) {
			tempoSnapped++;
			maxTempoDrift = Math.max(maxTempoDrift, drift);
		}
		// Repeated BPM values share one #BPMxx def; ids past 'ZZ' would
		// produce a three-char cell the writer cannot serialize.
		let id = bpmIds.get(cellBpm);
		if (id === undefined) {
			if (++idCounter > MAX_BPM_ID) {
				throw new Error(
					`MIDI has more than ${MAX_BPM_ID} distinct BPM changes; the two-character DTX id space is exhausted`
				);
			}
			id = idCounter.toString(36).toUpperCase().padStart(2, '0');
			bpmIds.set(cellBpm, id);
		}
		bpmChanges[id] = cellBpm;
		const groupKey = `08|${measure}`;
		let group = groupBy.get(groupKey);
		if (!group) {
			group = new LaneMeasureNote(measure, '08', [], 1);
			groupBy.set(groupKey, group);
			(notes['08'] ||= []).push(group);
		}
		group.notes.push({ noteID: id, position });
	}
	if (tempoCollisions > 0) {
		warnings.push(
			`${tempoCollisions} tempo change(s) merged onto the same 1/192 DTX cell (later tempo kept)`
		);
	}
	if (tempoSnapped > 0) {
		warnings.push(
			`${tempoSnapped} tempo change(s) snapped to the 1/192 DTX grid; timing shifts up to ${Math.ceil(maxTempoDrift)} tick(s)`
		);
	}

	// Channel-02 decimals only where the sticky bar length actually changes.
	const measureLengths = new Map<number, number>();
	for (let m = 0; m < measureCount; m++) {
		const length = barLengths[m];
		if (m === 0 ? length !== 1 : length !== barLengths[m - 1]) {
			measureLengths.set(m, length);
		}
	}

	for (const lane of Object.values(notes)) {
		lane.sort((a, b) => a.measure - b.measure);
		for (const lm of lane) lm.notes.sort((a, b) => a.position - b.position);
	}

	return {
		notes,
		controls: { bpmChanges, measureLengths },
		bpm,
		collisions,
		unmappedNotes,
		warnings
	};
};
