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
// Drum hits get a fixed 16th-note release; ordering rules keep re-triggers clean.
const NOTE_DURATION_TICKS = MIDI_PPQ / 4;
// DTX measure headers are three digits, so conversions may emit at most
// measures 0-999. '00' is the rest cell, leaving '01'-'ZZ' = 1295 BPM ids.
const MAX_DTX_MEASURES = 1000;
const MAX_BPM_ID = parseInt('ZZ', 36); // 1295

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
	/** SMF format-0 bytes, 480 PPQ. */
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
 * Convert a parsed DTX chart to a format-0 SMF at 480 PPQ.
 * Note ticks come from cumulative `4 * PPQ * measureLength` bar starts plus
 * each note's bar fraction; tempo/meter come from `buildTimingInput`, so the
 * export shares the notation path's channel-02/03/08 semantics exactly.
 */
export const dtxToMidi = (
	dtx: DTXFile,
	laneNoteMap: Record<string, number> = {}
): DtxToMidiResult => {
	const timing = buildTimingInput(dtx);
	const { measureLengths, measureCount } = timing;

	// Cumulative bar starts in MIDI ticks.
	const measureStart: number[] = new Array(measureCount);
	let acc = 0;
	for (let m = 0; m < measureCount; m++) {
		measureStart[m] = acc;
		acc += 4 * MIDI_PPQ * (measureLengths[m] ?? 1);
	}
	const tickInMeasure = (measure: number, fraction: number): number =>
		measureStart[measure] + fraction * 4 * MIDI_PPQ * (measureLengths[measure] ?? 1);

	const events: PendingEvent[] = [];
	let seq = 0;
	const warnings: string[] = [];
	const warned = new Set<string>();

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
	for (let m = 0; m < measureCount; m++) {
		const length = measureLengths[m] ?? 1;
		if (length === previousLength) continue;
		previousLength = length;
		const meter = meterFor(length);
		if (!meter) {
			const key = `meter-${length}`;
			if (!warned.has(key)) {
				warned.add(key);
				warnings.push(
					`bar length ${length} is not a representable MIDI meter; note timing kept, meter omitted`
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

	for (const lm of dtx.parseNotes()) {
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
					tick: tick + NOTE_DURATION_TICKS,
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
		trackBytes.push(...encodeVlq(event.tick - previousTick), ...event.bytes);
		previousTick = event.tick;
	}
	trackBytes.push(0x00, 0xff, 0x2f, 0x00); // end of track

	const data = new Uint8Array(14 + 8 + trackBytes.length);
	const view = new DataView(data.buffer);
	data.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
	view.setUint32(4, 6, false);
	view.setUint16(8, 0, false); // format 0
	view.setUint16(10, 1, false); // one track
	view.setUint16(12, MIDI_PPQ, false);
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
	const ppq = midi.ticksPerQuarter;
	const warnings: string[] = [];

	// Meter changes sorted by tick; a change applies from its bar onward. A
	// zero/invalid multiplier would make a zero-length bar (bars could never
	// advance) — the file is not convertible.
	const meterChanges: { tick: number; length: number }[] = [];
	for (const event of midi.meterEvents) {
		const length = event.numerator / event.denominator;
		if (!Number.isFinite(length) || length <= 0) {
			throw new Error(
				`Unsupported MIDI meter ${event.numerator}/${event.denominator} at tick ${event.tick}`
			);
		}
		const last = meterChanges[meterChanges.length - 1];
		if (last && last.tick === event.tick) {
			last.length = length; // same tick: last wins
		} else {
			meterChanges.push({ tick: event.tick, length });
		}
	}
	let meterIndex = 0;
	let currentLength = 1;
	if (meterChanges[0]?.tick === 0) {
		currentLength = meterChanges[0].length;
		meterIndex = 1;
	}

	const lastNoteTick = midi.tracks.reduce(
		(max, t) => t.notes.reduce((m, n) => Math.max(m, n.startTime), max),
		0
	);
	const endTick = Math.max(
		lastNoteTick,
		midi.tempoEvents[midi.tempoEvents.length - 1]?.tick ?? 0,
		meterChanges[meterChanges.length - 1]?.tick ?? 0
	);

	// DTX measure headers are three digits (#NNNxx), so output is bounded to
	// measure indices 0-999. A hostile tick (e.g. 0x0fffffff at PPQ 1) would
	// otherwise allocate tens of millions of bars before conversion ends.
	// Reject early using the fewest bars possible (every bar at the largest
	// meter); the in-loop bound below still catches files where smaller
	// meters later push the real count over the limit.
	const maxBarLength = Math.max(
		currentLength,
		...meterChanges.slice(meterIndex).map((c) => c.length)
	);
	if (endTick / (4 * ppq * maxBarLength) > MAX_DTX_MEASURES) {
		throw new Error(`MIDI conversion exceeds the ${MAX_DTX_MEASURES}-measure DTX range`);
	}

	// Bar starts; a meter event off a computed boundary is a mid-bar change.
	const barStarts = [0];
	const barLengths: number[] = [];
	while (barStarts[barStarts.length - 1] <= endTick || meterIndex < meterChanges.length) {
		if (barLengths.length >= MAX_DTX_MEASURES) {
			throw new Error(`MIDI conversion exceeds the ${MAX_DTX_MEASURES}-measure DTX range`);
		}
		const start = barStarts[barStarts.length - 1];
		while (meterIndex < meterChanges.length && meterChanges[meterIndex].tick <= start) {
			if (meterChanges[meterIndex].tick < start) {
				throw new Error(
					`Unsupported mid-bar meter change at tick ${meterChanges[meterIndex].tick}`
				);
			}
			currentLength = meterChanges[meterIndex].length;
			meterIndex++;
		}
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

	const laneOf = { ...GM_IMPORT_LANE, ...options.noteToLane };
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
			if (event.channel !== DRUM_CHANNEL) {
				skippedChannels++;
				continue;
			}
			const lane = laneOf[event.note];
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

	// Tempo: first event -> base #BPM (or override); later effective changes ->
	// #BPMxx defs + channel-08 refs quantized like drum hits.
	const bpmOf = (mpq: number) => Math.round((60000000 / mpq) * 1000) / 1000;
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

	const bpmChanges: Record<string, number> = {};
	const bpmIds = new Map<number, string>();
	let idCounter = 0;
	let effectiveBpm = bpm;
	for (const event of tempoEvents.slice(firstAtStart ? 1 : 0)) {
		if (event.bpm === effectiveBpm) continue;
		effectiveBpm = event.bpm;
		// Repeated BPM values share one #BPMxx def; ids past 'ZZ' would
		// produce a three-char cell the writer cannot serialize.
		let id = bpmIds.get(event.bpm);
		if (id === undefined) {
			if (++idCounter > MAX_BPM_ID) {
				throw new Error(
					`MIDI has more than ${MAX_BPM_ID} distinct BPM changes; the two-character DTX id space is exhausted`
				);
			}
			id = idCounter.toString(36).toUpperCase().padStart(2, '0');
			bpmIds.set(event.bpm, id);
		}
		bpmChanges[id] = event.bpm;
		const { measure, position } = quantize(event.tick);
		const groupKey = `08|${measure}`;
		let group = groupBy.get(groupKey);
		if (!group) {
			group = new LaneMeasureNote(measure, '08', [], 1);
			groupBy.set(groupKey, group);
			(notes['08'] ||= []).push(group);
		}
		// A second tempo ref landing on one cell overwrites in place (last wins,
		// matching tempo normalization); it is not a drum collision.
		const existing = group.notes.findIndex((n) => n.position === position);
		if (existing === -1) group.notes.push({ noteID: id, position });
		else group.notes[existing].noteID = id;
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
