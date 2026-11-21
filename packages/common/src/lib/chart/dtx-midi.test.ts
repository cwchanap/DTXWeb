import { describe, it, expect } from 'vitest';
import { DTXFile } from './dtx';
import { parseMidi } from '../midi/parser';
import { dtxToMidi, midiToDtx, MIDI_PPQ } from '../midi/convert';

// Shared-format byte builder so these tests exercise the real parseMidi
// converter chain on raw SMF input, the same path the web tools use.
const vlq = (value: number): number[] => {
	const bytes = [value & 0x7f];
	let remaining = value >> 7;
	while (remaining > 0) {
		bytes.unshift((remaining & 0x7f) | 0x80);
		remaining >>= 7;
	}
	return bytes;
};

const buildMidi = (ppq: number, trackEvents: number[]): Uint8Array => {
	const data = new Uint8Array(14 + 8 + trackEvents.length);
	const view = new DataView(data.buffer);
	data.set([0x4d, 0x54, 0x68, 0x64], 0);
	view.setUint32(4, 6, false);
	view.setUint16(10, 1, false);
	view.setUint16(12, ppq, false);
	data.set([0x4d, 0x54, 0x72, 0x6b], 14);
	view.setUint32(18, trackEvents.length, false);
	data.set(trackEvents, 22);
	return data;
};

const evNoteOn = (delta: number, note: number, channel = 9, velocity = 100): number[] => [
	...vlq(delta),
	0x90 | channel,
	note,
	velocity
];
const evNoteOff = (delta: number, note: number, channel = 9): number[] => [
	...vlq(delta),
	0x80 | channel,
	note,
	0
];
const evTempo = (delta: number, bpm: number): number[] => {
	const mpq = Math.round(60000000 / bpm);
	return [...vlq(delta), 0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff];
};
const evMeter = (delta: number, numerator: number, denominatorPower: number): number[] => [
	...vlq(delta),
	0xff,
	0x58,
	0x04,
	numerator,
	denominatorPower,
	24,
	8
];
const evEndOfTrack = [0x00, 0xff, 0x2f, 0x00];

const dtxFromText = (text: string): DTXFile => {
	const dtx = new DTXFile(text);
	dtx.parseFromText(text);
	return dtx;
};

// Lane -> [measure, position] hit pairs from reparsed note groups ('00' rest
// cells dropped), for asserting serialized DTX output round-trips.
const hitsByLane = (dtx: DTXFile): Map<string, [number, number][]> => {
	const byLane = new Map<string, [number, number][]>();
	for (const group of dtx.parseNotes()) {
		for (const n of group.notes) {
			if (n.noteID === '00') continue;
			byLane.set(group.laneID, [
				...(byLane.get(group.laneID) ?? []),
				[group.measure, n.position]
			]);
		}
	}
	return byLane;
};

describe('DTXFile to MIDI via shared dtxToMidi', () => {
	it('emits a format-0 SMF at 480 PPQ the shared parser accepts', () => {
		const dtx = dtxFromText(['#TITLE: Test', '#BPM: 120', '#00013: 01'].join('\r\n'));

		const { data } = dtxToMidi(dtx);
		const parsed = parseMidi(data);

		expect(parsed.format).toBe(0);
		expect(parsed.trackCount).toBe(1);
		expect(parsed.ticksPerQuarter).toBe(MIDI_PPQ);
		expect(parsed.tempoEvents).toEqual([{ tick: 0, microsecondsPerQuarter: 500000 }]);
	});

	it('maps playable lanes to their canonical GM notes on drum channel 9', () => {
		const dtx = dtxFromText(
			[
				'#BPM: 120',
				'#00013: 01', // Bass -> GM 36
				'#00012: 01', // Snare -> GM 38
				'#00011: 01' // Closed Hi-Hat -> GM 42
			].join('\r\n')
		);

		const { data } = dtxToMidi(dtx);
		const notes = parseMidi(data).tracks[0].notes;

		expect(notes.map((n) => [n.note, n.channel])).toEqual([
			[36, 9],
			[38, 9],
			[42, 9]
		]);
	});

	it('never emits notes for the BGM or control lanes', () => {
		const dtx = dtxFromText(
			[
				'#BPM: 120',
				'#BPM01: 140', // defined so the channel-08 ref resolves to a real tempo
				'#00001: 0101', // BGM lane
				'#00003: 78', // legacy direct-hex BPM lane (0x78 = 120 — dedupes away)
				'#00008: 01', // tempo-reference lane
				'#00013: 01'
			].join('\r\n')
		);

		const { data } = dtxToMidi(dtx);
		const notes = parseMidi(data).tracks[0].notes;

		// Only the lane-13 hit survives; control lanes produce no MIDI notes.
		expect(notes).toHaveLength(1);
		expect(notes[0].note).toBe(36);
	});

	it('keeps simultaneous hits on separate lanes at one tick', () => {
		const dtx = dtxFromText(
			['#BPM: 120', '#00011: 01', '#00012: 01', '#00013: 01'].join('\r\n')
		);

		const { data } = dtxToMidi(dtx);
		const notes = parseMidi(data).tracks[0].notes;

		expect(notes.map((n) => n.startTime)).toEqual([0, 0, 0]);
		expect(notes.map((n) => n.note)).toEqual([42, 38, 36]);
	});

	it('raises PPQ so a short bar keeps adjacent 1/192 hits on distinct ticks', () => {
		// A 1/16 bar holds only 120 ticks at 480 PPQ: slots 1 and 2 of the
		// 192-slot grid would both round to tick 1 and merge on reimport.
		const cells = new Array(192).fill('00');
		cells[1] = '01';
		cells[2] = '01';
		const dtx = dtxFromText(
			['#BPM: 120', '#00002: 0.0625', `#00012: ${cells.join('')}`].join('\r\n')
		);

		const { data, warnings } = dtxToMidi(dtx);
		const parsed = parseMidi(data);

		// 48/0.0625 = 768 PPQ -> the 1/16 bar holds exactly 192 ticks.
		expect(parsed.ticksPerQuarter).toBe(768);
		expect(warnings).toEqual([]);
		expect(parsed.tracks[0].notes.map((n) => n.startTime)).toEqual([1, 2]);

		// The raised division reimports with both hits intact.
		const roundTrip = midiToDtx(parsed);
		expect(roundTrip.collisions).toBe(0);
		expect(roundTrip.notes['12'][0].notes.map((n) => n.position)).toEqual([1 / 192, 2 / 192]);
	});

	it('rounds the division to a multiple of 32 so meter changes land on integer bar ticks', () => {
		// 7/128 bars need ceil(48/(7/128)) = 878 PPQ for the slot grid, but a
		// 7/128 bar then spans 192.0625 ticks: the next meter change would
		// round onto tick 192 and reimport as a mid-bar change. Rounding up
		// to 896 (a multiple of 32) gives every supported meter whole ticks.
		const dtx = dtxFromText(
			[
				'#BPM: 120',
				'#00002: 0.0546875',
				'#00102: 1',
				'#00202: 1',
				'#00302: 1',
				'#00012: 01',
				'#00112: 01',
				'#00212: 01',
				'#00312: 01'
			].join('\r\n')
		);

		const { data } = dtxToMidi(dtx);
		const parsed = parseMidi(data);

		expect(parsed.ticksPerQuarter).toBe(896);
		// 4 * 896 * 7/128 = 196 ticks for the short bar, then 4/4 bars.
		expect(parsed.meterEvents).toEqual([
			{ tick: 0, numerator: 7, denominator: 128 },
			{ tick: 196, numerator: 4, denominator: 4 }
		]);
		expect(parsed.tracks[0].notes.map((n) => n.startTime)).toEqual([0, 196, 392, 588]);
		expect(parsed.tracks[0].notes.every((n) => n.duration === 224)).toBe(true);

		// The exported file reimports without a mid-bar meter rejection.
		expect(() => midiToDtx(parsed)).not.toThrow();
	});

	it('serializes #BPMxx tempo changes and decimal bar lengths as SMF events', () => {
		const dtx = dtxFromText(
			[
				'#BPM: 180',
				'#BPM01: 240',
				'#00013: 0100', // m0 pos 0
				'#00102: 0.75', // m1 is 3/4
				'#00108: 01', // tempo ref m1 pos 0
				'#00116: 01' // crash m1 pos 0
			].join('\r\n')
		);

		const { data } = dtxToMidi(dtx);
		const parsed = parseMidi(data);

		expect(parsed.tempoEvents).toEqual([
			{ tick: 0, microsecondsPerQuarter: Math.round(60000000 / 180) },
			{ tick: 1920, microsecondsPerQuarter: Math.round(60000000 / 240) }
		]);
		expect(parsed.meterEvents).toEqual([
			{ tick: 0, numerator: 4, denominator: 4 },
			{ tick: 1920, numerator: 3, denominator: 4 }
		]);
		expect(parsed.tracks[0].notes.map((n) => [n.startTime, n.note])).toEqual([
			[0, 36],
			[1920, 49]
		]);
	});

	it('places notes at cumulative bar ticks across a large measure gap', () => {
		// Measure 10 starts 19200 ticks in — its delta needs a multi-byte VLQ,
		// which only a correct encoder produces.
		const dtx = dtxFromText(['#BPM: 120', '#00013: 01', '#01013: 01'].join('\r\n'));

		const { data } = dtxToMidi(dtx);
		const notes = parseMidi(data).tracks[0].notes;

		expect(notes.map((n) => n.startTime)).toEqual([0, 19200]);
	});

	it('honours lane note overrides for the editable GM mapping', () => {
		const dtx = dtxFromText(['#BPM: 120', '#00013: 01'].join('\r\n'));

		const { data } = dtxToMidi(dtx, { '13': 41 });
		const notes = parseMidi(data).tracks[0].notes;

		expect(notes).toHaveLength(1);
		expect(notes[0].note).toBe(41);
	});
});

describe('MIDI to DTXFile via shared parseMidi + midiToDtx', () => {
	it('parses a minimal SMF and produces DTX text that reparses to the same hits', () => {
		const bytes = buildMidi(480, [
			...evTempo(0, 120),
			...evNoteOn(0, 36),
			...evNoteOff(120, 36),
			...evNoteOn(360, 38),
			...evNoteOff(120, 38),
			...evEndOfTrack
		]);

		const conversion = midiToDtx(parseMidi(bytes));
		const out = new DTXFile();
		out.bpm = conversion.bpm;
		const text = out.toDtxText(conversion.notes, conversion.controls);

		expect(text).toContain('#BPM: 120');

		// 36 -> lane 13 m0 p0; 38 at tick 480 -> lane 12 m0 p0.25
		const byLane = hitsByLane(dtxFromText(text));
		expect(byLane.get('13')).toEqual([[0, 0]]);
		expect(byLane.get('12')).toEqual([[0, 0.25]]);
	});

	it('folds GM import aliases into the canonical lanes', () => {
		const bytes = buildMidi(480, [
			...evNoteOn(0, 35), // acoustic bass drum alias -> 13 @tick 0
			...evNoteOff(120, 35),
			...evNoteOn(360, 36), // bass drum -> 13 @tick 480
			...evNoteOff(120, 36),
			...evNoteOn(360, 40), // electric snare alias -> 12 @tick 960
			...evNoteOff(120, 40),
			...evEndOfTrack
		]);

		const { notes } = midiToDtx(parseMidi(bytes));

		// 35 and 36 land one quarter apart inside lane 13; 40 joins lane 12.
		expect(notes['13'].flatMap((g) => g.notes.map((n) => [g.measure, n.position]))).toEqual([
			[0, 0],
			[0, 0.25]
		]);
		expect(notes['12'].flatMap((g) => g.notes.map((n) => [g.measure, n.position]))).toEqual([
			[0, 0.5]
		]);
	});

	it('ignores non-drum channels and counts unmapped GM notes as a warning', () => {
		const bytes = buildMidi(480, [
			...evNoteOn(0, 60, 0), // channel 0 — not drums
			...evNoteOff(120, 60, 0),
			...evNoteOn(0, 99), // channel 9 but unmapped
			...evNoteOff(120, 99),
			...evEndOfTrack
		]);

		const { notes, unmappedNotes, warnings } = midiToDtx(parseMidi(bytes));

		expect(notes['13']).toBeUndefined();
		expect(unmappedNotes).toBe(1);
		expect(warnings.length).toBeGreaterThan(0);
	});

	it('turns a later tempo change into a #BPMxx definition plus channel-08 ref', () => {
		const bytes = buildMidi(480, [
			...evTempo(0, 120),
			...evTempo(1920, 180), // on the bar-1 boundary
			...evNoteOn(1920, 36),
			...evNoteOff(120, 36),
			...evEndOfTrack
		]);

		const conversion = midiToDtx(parseMidi(bytes));
		expect(conversion.bpm).toBe(120);
		expect(Object.values(conversion.controls.bpmChanges ?? {})).toContain(180);

		const out = new DTXFile();
		out.bpm = conversion.bpm;
		const reparsed = dtxFromText(out.toDtxText(conversion.notes, conversion.controls));
		expect(reparsed.bpm).toBe(120);
		expect(Object.values(reparsed.parseBPMChanges())).toContain(180);
	});

	it('represents a mid-song 3/4 section through channel-02 bar lengths', () => {
		const bytes = buildMidi(480, [
			...evMeter(0, 4, 2), // 4/4 @0
			...evNoteOn(1440, 45), // @1440 — late in the 4/4 bar -> m0 pos 0.75
			...evNoteOff(120, 45), // @1560
			...evMeter(360, 3, 2), // @1920 — 3/4 on the bar-1 boundary
			...evNoteOn(480, 49), // @2400 — inside the 3/4 bar -> m1 pos 1/3
			...evNoteOff(120, 49),
			...evEndOfTrack
		]);

		const { notes, controls } = midiToDtx(parseMidi(bytes));

		expect(controls.measureLengths?.get(1)).toBe(0.75);
		// Lane 15 (low tom family) keeps the late-bar hit at m0 pos 0.75.
		expect(notes['15'].flatMap((g) => g.notes.map((n) => [g.measure, n.position]))).toEqual([
			[0, 0.75]
		]);
		// Lane 16 crash lands inside bar 1 at a 3/4-relative position.
		expect(notes['16'].flatMap((g) => g.notes.map((n) => [g.measure, n.position]))).toEqual([
			[1, 1 / 3]
		]);
	});

	it('rejects malformed SMF input with a descriptive error', () => {
		expect(() => parseMidi(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toThrow(
			'Invalid MIDI file'
		);

		const badTrack = buildMidi(480, [
			...evNoteOn(0, 36),
			...evNoteOff(120, 36),
			...evEndOfTrack
		]);
		badTrack[14] = 0x42; // corrupt the MTrk magic
		expect(() => parseMidi(badTrack)).toThrow('Invalid MIDI file');
	});
});

describe('DTX to MIDI to DTX round trip', () => {
	it('preserves notes, tempo changes and decimal meters through both converters', () => {
		const source = dtxFromText(
			[
				'#TITLE: Round Trip',
				'#ARTIST: Tester',
				'#BPM: 150',
				'#BPMAA: 180',
				'#00013: 0101', // bass m0 p0, p0.5
				'#00011: 0001', // hihat m0 p0.5
				'#00112: 0100', // snare m1 p0
				'#00108: 0000AA00', // tempo 180 at m1 p0.5
				'#00202: 0.75', // m2 is 3/4
				'#00216: 01' // crash m2 p0
			].join('\r\n')
		);

		const { data } = dtxToMidi(source);
		const parsed = parseMidi(data);

		// m2 starts at 3840 (two 4/4 bars) and lasts 1440 ticks.
		expect(parsed.meterEvents).toEqual([
			{ tick: 0, numerator: 4, denominator: 4 },
			{ tick: 3840, numerator: 3, denominator: 4 }
		]);
		expect(parsed.tempoEvents).toEqual([
			{ tick: 0, microsecondsPerQuarter: Math.round(60000000 / 150) },
			{ tick: 2880, microsecondsPerQuarter: Math.round(60000000 / 180) }
		]);

		const conversion = midiToDtx(parsed);
		expect(conversion.bpm).toBe(150);

		const out = new DTXFile();
		out.bpm = conversion.bpm;
		const reparsed = dtxFromText(out.toDtxText(conversion.notes, conversion.controls));

		expect(reparsed.bpm).toBe(150);
		expect(Object.values(reparsed.parseBPMChanges())).toContain(180);
		expect(reparsed.parseMeasureLengths().get(2)).toBe(0.75);

		const positions = hitsByLane(reparsed);
		expect(positions.get('13')).toEqual([
			[0, 0],
			[0, 0.5]
		]);
		expect(positions.get('11')).toEqual([[0, 0.5]]);
		expect(positions.get('12')).toEqual([[1, 0]]);
		expect(positions.get('16')).toEqual([[2, 0]]);
	});
});
