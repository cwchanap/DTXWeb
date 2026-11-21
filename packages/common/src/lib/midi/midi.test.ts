import { describe, it, expect } from 'vitest';
import { parseMidi } from './parser';
import { dtxToMidi, midiToDtx } from './convert';
import { DTXFile } from '../chart/dtx';
import { buildChartTiming } from '../notation/timing';
import { buildTimingInput } from '../notation/quantize';

/**
 * Shared SMF byte-builder for tests. Events are appended per track as raw
 * byte arrays; each `ev*` helper returns bytes including the delta-time VLQ.
 */
const vlq = (value: number): number[] => {
	const bytes = [value & 0x7f];
	let remaining = value >> 7;
	while (remaining > 0) {
		bytes.unshift((remaining & 0x7f) | 0x80);
		remaining >>= 7;
	}
	return bytes;
};

const buildMidi = (ppq: number, tracks: number[][], format = 0): Uint8Array => {
	const header = new Uint8Array(14);
	const view = new DataView(header.buffer);
	header.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
	view.setUint32(4, 6, false);
	view.setUint16(8, format, false);
	view.setUint16(10, tracks.length, false);
	view.setUint16(12, ppq, false);

	const chunks = tracks.map((events) => {
		const chunk = new Uint8Array(8 + events.length);
		const cv = new DataView(chunk.buffer);
		chunk.set([0x4d, 0x54, 0x72, 0x6b], 0); // MTrk
		cv.setUint32(4, events.length, false);
		chunk.set(events, 8);
		return chunk;
	});

	const total = header.length + chunks.reduce((n, c) => n + c.length, 0);
	const file = new Uint8Array(total);
	let offset = 0;
	file.set(header, offset);
	offset += header.length;
	for (const chunk of chunks) {
		file.set(chunk, offset);
		offset += chunk.length;
	}
	return file;
};

const evNoteOn = (delta: number, note: number, velocity = 100, channel = 9): number[] => [
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
const evTrackName = (name: string): number[] => {
	const bytes = Array.from(new TextEncoder().encode(name));
	return [...vlq(0), 0xff, 0x03, ...vlq(bytes.length), ...bytes];
};
const evEndOfTrack = [0x00, 0xff, 0x2f, 0x00];

const noteOnTicks = (bytes: Uint8Array) => {
	const parsed = parseMidi(bytes);
	return parsed.tracks.flatMap((track) =>
		track.events
			.filter(
				(e) =>
					e.type === 'channel' &&
					e.command === 0x90 &&
					e.velocity !== undefined &&
					e.velocity > 0
			)
			.map((e) => ({ tick: e.absoluteTime, note: e.note, channel: e.channel }))
	);
};

const tempoEventsOf = (bytes: Uint8Array) => parseMidi(bytes).tempoEvents;
const meterEventsOf = (bytes: Uint8Array) => parseMidi(bytes).meterEvents;

describe('parseMidi', () => {
	it('parses a format-0 file with notes, tempo, meter and track metadata', () => {
		const bytes = buildMidi(480, [
			[
				...evTrackName('Drums'),
				...evTempo(0, 120),
				...evMeter(0, 4, 2),
				...vlq(0),
				0xc9,
				10, // program change ch9 -> instrument 10
				...evNoteOn(0, 36, 100),
				...evNoteOff(120, 36),
				...evNoteOn(360, 38, 90),
				// velocity-zero note-on acts as note-off
				...vlq(60),
				0x99,
				38,
				0,
				...evEndOfTrack
			]
		]);

		const midi = parseMidi(bytes);
		expect(midi.format).toBe(0);
		expect(midi.trackCount).toBe(1);
		expect(midi.ticksPerQuarter).toBe(480);
		expect(midi.totalNotes).toBe(2);
		expect(midi.tempo).toBe(120);
		expect(midi.tempoEvents).toEqual([{ tick: 0, microsecondsPerQuarter: 500000 }]);
		expect(midi.meterEvents).toEqual([{ tick: 0, numerator: 4, denominator: 4 }]);
		expect(midi.duration).toBeGreaterThan(0);

		const track = midi.tracks[0];
		expect(track.name).toBe('Drums');
		expect(track.instruments.has(10)).toBe(true);
		expect(track.channels.has(9)).toBe(true);
		expect(track.notes).toEqual([
			{ channel: 9, note: 36, velocity: 100, startTime: 0, duration: 120 },
			{ channel: 9, note: 38, velocity: 90, startTime: 480, duration: 60 }
		]);
	});

	it('resolves running status and one-byte channel messages', () => {
		const bytes = buildMidi(480, [
			[
				...evNoteOn(0, 36, 100), // status 0x99
				// running status: delta 60 then two data bytes, no status byte
				...vlq(60),
				38,
				90,
				// channel pressure 0xD9 carries ONE data byte
				...vlq(0),
				0xd9,
				40,
				// program change 0xC9 carries ONE data byte
				...vlq(0),
				0xc9,
				7,
				...evNoteOff(30, 36),
				...evNoteOff(0, 38),
				...evEndOfTrack
			]
		]);

		const midi = parseMidi(bytes);
		expect(midi.totalNotes).toBe(2);
		expect(midi.tracks[0].notes[1]).toEqual({
			channel: 9,
			note: 38,
			velocity: 90,
			startTime: 60,
			duration: 30
		});
		expect(midi.tracks[0].instruments.has(7)).toBe(true);
	});

	it('skips sysex blocks safely', () => {
		const bytes = buildMidi(480, [
			[
				...evNoteOn(0, 36, 100),
				// F0 sysex with VLQ length
				...vlq(10),
				0xf0,
				...vlq(4),
				0x7e,
				0x7f,
				0x09,
				0x01,
				// F7 continuation with VLQ length
				...vlq(0),
				0xf7,
				...vlq(2),
				0x12,
				0x34,
				...evNoteOff(50, 36),
				...evEndOfTrack
			]
		]);

		const midi = parseMidi(bytes);
		expect(midi.totalNotes).toBe(1);
		expect(midi.tracks[0].notes[0].duration).toBe(60);
		expect(midi.tracks[0].events.some((e) => e.type === 'sysex')).toBe(true);
	});

	it('merges tempo events across format-1 tracks sorted by tick', () => {
		const bytes = buildMidi(
			480,
			[
				[...evTempo(0, 120), ...evTempo(960, 90), ...evEndOfTrack],
				[...evNoteOn(0, 36, 100), ...evNoteOff(120, 36), ...evEndOfTrack]
			],
			1
		);

		const midi = parseMidi(bytes);
		expect(midi.format).toBe(1);
		expect(midi.tracks).toHaveLength(2);
		expect(midi.tempoEvents.map((e) => e.tick)).toEqual([0, 960]);
		// Display tempo follows the preview convention: last tempo event.
		expect(midi.tempo).toBe(90);
	});

	it('supports non-480 PPQ divisions', () => {
		const bytes = buildMidi(
			960,
			[[...evNoteOn(0, 36, 100), ...evNoteOff(240, 36), ...evEndOfTrack]],
			0
		);
		expect(parseMidi(bytes).ticksPerQuarter).toBe(960);
	});

	it('skips extended header bytes when header length exceeds 6', () => {
		const inner = buildMidi(480, [[...evEndOfTrack]]);
		const padded = new Uint8Array(inner.length + 2);
		padded.set(inner.slice(0, 4), 0);
		new DataView(padded.buffer).setUint32(4, 8, false);
		padded.set(inner.slice(8, 14), 8);
		padded.set(inner.slice(14), 16); // two filler bytes between header and MTrk
		expect(parseMidi(padded).trackCount).toBe(1);
	});

	describe('rejects malformed input', () => {
		const cases: Array<[string, Uint8Array]> = [
			['missing MThd', new Uint8Array([0x00, 0x01, 0x02, 0x03])],
			[
				'truncated header',
				new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00])
			],
			[
				'header length under 6',
				(() => {
					const bytes = buildMidi(480, [[...evEndOfTrack]]);
					new DataView(bytes.buffer).setUint32(4, 4, false);
					return bytes;
				})()
			],
			[
				'format 2',
				(() => {
					const bytes = buildMidi(480, [[...evEndOfTrack]], 2);
					return bytes;
				})()
			],
			[
				'SMPTE division',
				(() => {
					const bytes = buildMidi(480, [[...evEndOfTrack]]);
					new DataView(bytes.buffer).setUint16(12, 0xe728, false);
					return bytes;
				})()
			],
			[
				'track length beyond file',
				(() => {
					const bytes = buildMidi(480, [[...evEndOfTrack]]);
					new DataView(bytes.buffer).setUint32(18, 500, false);
					return bytes;
				})()
			],
			[
				'missing MTrk',
				(() => {
					const bytes = buildMidi(480, [[...evEndOfTrack]]);
					bytes[14] = 0x58; // 'X'
					return bytes;
				})()
			],
			[
				'running status without a status byte',
				buildMidi(480, [[...vlq(0), 0x24, 0x40, ...evEndOfTrack]])
			],
			['unterminated VLQ at track end', buildMidi(480, [[...evNoteOn(0, 36, 100), 0x81]])],
			[
				'status byte where note data expected',
				buildMidi(480, [[...vlq(0), 0x99, 0x90, 0x40, ...evEndOfTrack]])
			],
			[
				'meta event length beyond track end',
				buildMidi(480, [[...vlq(0), 0xff, 0x01, 0x7f, 0x41]])
			]
		];

		for (const [name, bytes] of cases) {
			it(`rejects: ${name}`, () => {
				expect(() => parseMidi(bytes)).toThrow();
			});
		}
	});
});

describe('dtxToMidi', () => {
	const dtxFromText = (text: string) => {
		const dtx = new DTXFile(text);
		dtx.parseFromText(text);
		return dtx;
	};

	it('emits GM channel-9 notes, tempo and meter at cumulative bar ticks', () => {
		const dtx = dtxFromText(
			[
				'#TITLE: T',
				'#BPM: 180',
				'#00013: 01000100', // kick at m0 pos 0 and 0.5 -> ticks 0, 960
				'#00112: 01', // snare m1 pos 0 -> 1920
				'#00111: 0001', // hihat m1 pos 0.5 -> 2880
				'#BPM01: 240',
				'#00108: 0001', // tempo ref m1 pos 0.5 -> 2880
				'#00202: 0.75', // m2 is 3/4
				'#00216: 01' // crash m2 pos 0 -> 3840
			].join('\r\n')
		);

		const { data, warnings } = dtxToMidi(dtx);
		expect(warnings).toEqual([]);

		const ons = noteOnTicks(data);
		expect(ons).toEqual([
			{ tick: 0, note: 36, channel: 9 },
			{ tick: 960, note: 36, channel: 9 },
			{ tick: 1920, note: 38, channel: 9 },
			{ tick: 2880, note: 42, channel: 9 },
			{ tick: 3840, note: 49, channel: 9 }
		]);

		expect(tempoEventsOf(data)).toEqual([
			{ tick: 0, microsecondsPerQuarter: Math.round(60000000 / 180) },
			{ tick: 2880, microsecondsPerQuarter: 250000 }
		]);

		expect(meterEventsOf(data)).toEqual([
			{ tick: 0, numerator: 4, denominator: 4 },
			{ tick: 3840, numerator: 3, denominator: 4 }
		]);

		// Absolute times never decrease, so every encoded delta was nonnegative.
		const times = parseMidi(data).tracks[0].events.map((e) => e.absoluteTime);
		expect([...times].sort((a, b) => a - b)).toEqual(times);
	});

	it('maps every playable lane 11-1C to its own GM note', () => {
		const lines = ['#BPM: 120'];
		const lanes = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '1A', '1B', '1C'];
		lanes.forEach((lane, i) => lines.push(`#0${String(i).padStart(2, '0')}${lane}: 01`));
		const { data } = dtxToMidi(dtxFromText(lines.join('\r\n')));

		const notes = noteOnTicks(data)
			.map((e) => e.note ?? -1)
			.sort((a, b) => a - b);
		expect(notes).toEqual([35, 36, 38, 42, 43, 44, 46, 48, 49, 50, 51, 57]);
	});

	it('keeps hit ticks for unrepresentable meters and warns nonfatally', () => {
		const dtx = dtxFromText(
			['#BPM: 120', '#00002: 0.96', '#00013: 0101', '#00112: 01'].join('\r\n')
		);
		const { data, warnings } = dtxToMidi(dtx);

		// m0 bar = 4*480*0.96 = 1843.2 ticks; pos 0.5 -> 921.6 -> 922
		const ons = noteOnTicks(data);
		expect(ons.map((e) => e.tick)).toEqual([0, 922, 1843]);
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings[0]).toContain('0.96');
	});

	it('honours laneNoteMap overrides and warns about unknown lanes', () => {
		const dtx = dtxFromText(
			['#BPM: 120', '#00013: 01', '#0001C: 01', '#00051: 01', '#00001: 01'].join('\r\n')
		);
		const { data, warnings } = dtxToMidi(dtx, { '13': 35 });

		const ons = noteOnTicks(data);
		// '13' overridden to 35; '1C' keeps its own GM note 35 too. Lane '51' is
		// unknown -> warned; lane '01' is BGM (not a drum lane) -> skipped silently.
		expect(ons).toHaveLength(2);
		expect(ons.every((e) => e.note === 35)).toBe(true);
		expect(warnings.some((w) => w.includes('51'))).toBe(true);
	});
});

describe('midiToDtx', () => {
	it('quantizes channel-9 notes to 1/192 of the bar via GM aliases', () => {
		// 480 PPQ, 4/4: bar = 1920 ticks, slot = 10 ticks.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evNoteOn(0, 36),
					...evNoteOff(60, 36),
					...evNoteOn(420, 38), // tick 480 -> slot 48 -> pos 0.25
					...evNoteOff(60, 38),
					...evNoteOn(423, 42), // tick 963 -> slot 96 -> pos 0.5
					...evNoteOff(60, 42),
					...evEndOfTrack
				]
			])
		);

		const result = midiToDtx(midi);
		expect(result.bpm).toBe(120);
		expect(result.collisions).toBe(0);
		expect(result.unmappedNotes).toBe(0);
		expect(result.notes['13'][0].notes).toEqual([{ noteID: '01', position: 0 }]);
		expect(result.notes['12'][0].notes).toEqual([{ noteID: '01', position: 0.25 }]);
		expect(result.notes['11'][0].notes).toEqual([{ noteID: '01', position: 0.5 }]);
		// Design invariant: grouped drum lanes always use measureLength 1.
		expect(result.notes['13'][0].measureLength).toBe(1);
	});

	it('derives bars from meter changes, storing meter only in the channel-02 map', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evMeter(0, 4, 2),
					...evNoteOn(0, 36),
					...evNoteOff(60, 36),
					...evMeter(1920 - 60, 3, 2), // 3/4 from bar 1 (tick 1920)
					// tick 3000 in bar 1 (start 1920, len 1440) -> pos 0.75
					...evNoteOn(3000 - 1920, 38),
					...evNoteOff(60, 38),
					...evEndOfTrack
				]
			])
		);

		const result = midiToDtx(midi);
		expect(result.controls.measureLengths?.get(1)).toBe(0.75);
		expect(result.controls.measureLengths?.has(0)).toBe(false);

		const snare = result.notes['12'][0];
		expect(snare.measure).toBe(1);
		expect(snare.measureLength).toBe(1); // never 0.75 — fraction is of the bar
		expect(snare.notes).toEqual([{ noteID: '01', position: 0.75 }]);
	});

	it('rejects unsupported mid-bar meter changes', () => {
		const midi = parseMidi(
			buildMidi(480, [[...evMeter(0, 4, 2), ...evMeter(960, 3, 2), ...evEndOfTrack]])
		);
		expect(() => midiToDtx(midi)).toThrow(/meter/i);
	});

	it('counts same-lane same-slot collisions without aborting', () => {
		// slot = 10 ticks at 480 PPQ 4/4: ticks 480 and 483 both land on slot 48.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evNoteOn(480, 38),
					...evNoteOff(0, 38),
					...evNoteOn(3, 38),
					...evNoteOff(0, 38),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.collisions).toBe(1);
		expect(result.notes['12'][0].notes).toEqual([{ noteID: '01', position: 0.25 }]);
	});

	it('counts unmapped drum notes and ignores non-drum channels', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evNoteOn(0, 100), // GM note with no lane
					...evNoteOff(60, 100),
					...evNoteOn(0, 60, 100, 0), // melody channel -> not a drum candidate
					...evNoteOff(60, 60, 0),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.unmappedNotes).toBe(1);
		expect(Object.keys(result.notes)).toHaveLength(0);
	});

	it('emits base BPM, #BPMxx defs and channel-08 refs consumable by toDtxText', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evTempo(0, 120),
					...evNoteOn(0, 36),
					...evNoteOff(60, 36),
					...evTempo(1920 - 60, 240), // tempo 240 at bar 1
					...evEndOfTrack
				]
			])
		);

		const result = midiToDtx(midi);
		expect(result.bpm).toBe(120);
		expect(result.controls.bpmChanges).toEqual({ '01': 240 });
		expect(result.notes['08'][0].measure).toBe(1);
		expect(result.notes['08'][0].notes).toEqual([{ noteID: '01', position: 0 }]);

		const dtx = new DTXFile();
		dtx.bpm = result.bpm;
		const text = dtx.toDtxText(result.notes, result.controls);
		expect(text).toContain('#BPM: 120');
		expect(text).toContain('#BPM01: 240');
		expect(text).toContain('#00108:');
	});

	it('treats a first tempo event past tick 0 as a change, not the base', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evNoteOn(0, 36),
					...evNoteOff(60, 36),
					...evTempo(1860, 90), // tempo 90 mid bar 0
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.bpm).toBe(120); // default before the first tempo event
		expect(result.controls.bpmChanges).toEqual({ '01': 90 });
	});

	it('rejects a zero-numerator meter instead of hanging', () => {
		const midi = parseMidi(
			buildMidi(480, [[...vlq(0), 0xff, 0x58, 0x04, 0x00, 0x02, 24, 8, ...evEndOfTrack]])
		);
		expect(() => midiToDtx(midi)).toThrow(/meter/i);
	});

	it('applies a bpm override to the initial tempo only', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evTempo(0, 120),
					...evTempo(1920, 240),
					...evNoteOn(0, 36),
					...evNoteOff(60, 36),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi, { bpm: 90 });
		expect(result.bpm).toBe(90);
		expect(result.controls.bpmChanges).toEqual({ '01': 240 });
	});

	it('honours noteToLane overrides over GM_IMPORT_LANE', () => {
		const midi = parseMidi(
			buildMidi(480, [[...evNoteOn(0, 35), ...evNoteOff(60, 35), ...evEndOfTrack]])
		);
		// Default: GM 35 -> '13'. Override: -> '1C' (left bass).
		expect(midiToDtx(midi).notes['13']).toBeDefined();
		const overridden = midiToDtx(midi, { noteToLane: { 35: '1C' } });
		expect(overridden.notes['1C']).toBeDefined();
		expect(overridden.notes['13']).toBeUndefined();
	});
});

describe('round trips', () => {
	const dtxFromText = (text: string) => {
		const dtx = new DTXFile(text);
		dtx.parseFromText(text);
		return dtx;
	};

	it('preserves on-grid hits, tempo and 3/4 meter exactly DTX->MIDI->DTX', () => {
		const source = dtxFromText(
			[
				'#TITLE: RT',
				'#BPM: 180',
				'#00013: 01000100',
				'#00112: 01',
				'#BPM01: 240',
				'#00108: 0001',
				'#00202: 0.75',
				'#00216: 0100' // crash m2 pos 0 -> tick 3840
			].join('\r\n')
		);

		const { data } = dtxToMidi(source);
		const back = midiToDtx(parseMidi(data));

		expect(back.notes['13'][0].notes).toEqual([
			{ noteID: '01', position: 0 },
			{ noteID: '01', position: 0.5 }
		]);
		expect(back.notes['12'][0].measure).toBe(1);
		expect(back.notes['12'][0].notes).toEqual([{ noteID: '01', position: 0 }]);
		expect(back.notes['16'][0].measure).toBe(2);
		expect(back.notes['16'][0].notes).toEqual([{ noteID: '01', position: 0 }]);

		expect(back.bpm).toBe(180);
		expect(back.controls.bpmChanges).toEqual({ '01': 240 });
		expect(back.controls.measureLengths?.get(2)).toBe(0.75);

		const out = new DTXFile();
		out.bpm = back.bpm;
		const text = out.toDtxText(back.notes, back.controls);
		expect(text).toContain('#BPM: 180');
		expect(text).toContain('#BPM01: 240');
		expect(text).toContain('#00202: 0.75');
		expect(text).not.toContain('#00202: 01');
	});

	it('keeps off-grid non-480-PPQ hits within half a 1/192 slot and time-accurate', () => {
		// 960 PPQ, 4/4: bar = 3840 ticks, 1/192 slot = 20 ticks, half slot = 10.
		const ppq = 960;
		const barTicks = 4 * ppq;
		const halfSlot = barTicks / 192 / 2;
		const bpmA = 140;
		const bpmB = 100;

		// Humanized onsets: 3, 487, 500 (design example), 3843 (bar 1), 9600 (bar 2).
		const hits = [
			{ note: 36, tick: 3 },
			{ note: 38, tick: 487 },
			{ note: 38, tick: 500 },
			{ note: 36, tick: 3843 },
			{ note: 38, tick: 9600 }
		];
		// Durations must stay under the smallest onset gap (13 ticks) so a
		// note-off never follows the next note-on.
		const track: number[] = [...evTempo(0, bpmA)];
		let cursor = 0;
		for (const hit of hits) {
			if (hit.tick > 7680 && cursor <= 7680) {
				track.push(...evTempo(7680 - cursor, bpmB)); // tempo change at bar 2 start
				cursor = 7680;
			}
			track.push(...evNoteOn(hit.tick - cursor, hit.note));
			track.push(...evNoteOff(10, hit.note));
			cursor = hit.tick + 10;
		}
		track.push(...evEndOfTrack);

		const midi = parseMidi(buildMidi(ppq, [track]));
		const result = midiToDtx(midi);

		expect(result.collisions).toBe(0);
		expect(result.unmappedNotes).toBe(0);

		const recovered: { measure: number; position: number }[] = [];
		for (const group of Object.values(result.notes)) {
			for (const lm of group) {
				if (lm.laneID === '08') continue;
				for (const n of lm.notes) {
					recovered.push({ measure: lm.measure, position: n.position });
				}
			}
		}
		expect(recovered).toHaveLength(5);
		recovered.sort((a, b) => a.measure - b.measure || a.position - b.position);

		// Every onset stays within half a slot of its original tick.
		const slotOf = recovered.map((r) => r.measure * barTicks + r.position * barTicks);
		hits.map((h) => h.tick)
			.sort((a, b) => a - b)
			.forEach((tick, i) => {
				expect(Math.abs(slotOf[i] - tick)).toBeLessThanOrEqual(halfSlot);
			});

		// Time domain: positionToTime must track real MIDI seconds through the
		// tempo change, within half a slot.
		const out = new DTXFile();
		out.bpm = result.bpm;
		const text = out.toDtxText(result.notes, result.controls);
		const reparsed = new DTXFile(text);
		reparsed.parseFromText(text);
		const timing = buildChartTiming(buildTimingInput(reparsed));

		const secondsPerTick = (tick: number) =>
			tick <= 7680
				? (tick * (60 / bpmA)) / ppq
				: (7680 * (60 / bpmA)) / ppq + ((tick - 7680) * (60 / bpmB)) / ppq;
		const halfSlotSeconds = (halfSlot * (60 / Math.min(bpmA, bpmB))) / ppq;

		hits.forEach((hit, i) => {
			const r = recovered[i];
			const actual = timing.positionToTime(r.measure, r.position);
			expect(Math.abs(actual - secondsPerTick(hit.tick))).toBeLessThanOrEqual(
				halfSlotSeconds
			);
		});
	});
});
