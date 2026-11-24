import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
const evMeter = (
	delta: number,
	numerator: number,
	denominatorPower: number,
	notated32nds = 8
): number[] => [...vlq(delta), 0xff, 0x58, 0x04, numerator, denominatorPower, 24, notated32nds];
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
		expect(midi.meterEvents).toEqual([
			{ tick: 0, numerator: 4, denominator: 4, notated32ndsPerQuarter: 8 }
		]);
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

	it('retains every attack when same-pitch note-ons overlap', () => {
		// A re-attack before the release must not erase the pending note; each
		// note-off pairs with the earliest still-open attack (FIFO).
		const bytes = buildMidi(480, [
			[
				...evNoteOn(0, 38),
				...evNoteOn(10, 38), // second attack while the first is open
				...evNoteOff(10, 38), // closes the first attack
				...evNoteOff(10, 38), // closes the second
				...evNoteOff(0, 36), // unmatched off: ignored
				...evEndOfTrack
			]
		]);

		const midi = parseMidi(bytes);
		expect(midi.totalNotes).toBe(2);
		expect(midi.tracks[0].notes).toEqual([
			{ channel: 9, note: 38, velocity: 100, startTime: 0, duration: 20 },
			{ channel: 9, note: 38, velocity: 100, startTime: 10, duration: 20 }
		]);
	});

	it('pairs masses of overlapping same-pitch attacks FIFO', () => {
		// 20k overlapping note-ons then 20k releases. FIFO pairing gives every
		// note the same duration (COUNT); LIFO or dropped attacks would not.
		// This is the workload that made Array.shift() pairing quadratic.
		const COUNT = 20_000;
		const track: number[] = [...evNoteOn(0, 38)];
		for (let i = 1; i < COUNT; i++) track.push(...evNoteOn(1, 38));
		for (let i = 0; i < COUNT; i++) track.push(...evNoteOff(1, 38));
		track.push(...evEndOfTrack);

		const midi = parseMidi(buildMidi(480, [track]));
		expect(midi.totalNotes).toBe(COUNT);
		const notes = midi.tracks[0].notes;
		expect(notes.map((n) => n.startTime)).toEqual(Array.from({ length: COUNT }, (_, i) => i));
		expect(notes.every((n) => n.duration === COUNT)).toBe(true);
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

	it('skips unknown SMF chunks before MTrk without counting them as tracks', () => {
		const inner = buildMidi(480, [[...evNoteOn(0, 36), ...evNoteOff(60, 36), ...evEndOfTrack]]);
		const customChunk = new Uint8Array([
			0x58, 0x45, 0x58, 0x54, 0x00, 0x00, 0x00, 0x02, 0xaa, 0xbb
		]); // 'XEXT' len 2
		const withCustom = new Uint8Array(14 + customChunk.length + (inner.length - 14));
		withCustom.set(inner.slice(0, 14), 0);
		withCustom.set(customChunk, 14);
		withCustom.set(inner.slice(14), 14 + customChunk.length);

		const midi = parseMidi(withCustom);
		expect(midi.tracks).toHaveLength(1);
		expect(midi.totalNotes).toBe(1);
	});

	it('rejects MIDI files with more MTrk chunks than declared in the header', () => {
		const twoTrack = buildMidi(
			480,
			[
				[...evNoteOn(0, 36), ...evNoteOff(60, 36), ...evEndOfTrack],
				[...evNoteOn(0, 38), ...evNoteOff(60, 38), ...evEndOfTrack]
			],
			1
		);
		// Patch header trackCount from 2 down to 1
		new DataView(twoTrack.buffer).setUint16(10, 1, false);

		expect(() => parseMidi(twoTrack)).toThrow(/extra MTrk/i);
	});

	it('reads the known prefix of extended tempo and time-signature meta events', () => {
		const bytes = buildMidi(480, [
			[
				// 4-byte tempo payload (3 standard + 1 extension byte)
				...vlq(0),
				0xff,
				0x51,
				0x04,
				0x07,
				0xa1,
				0x20,
				0x99,
				// 5-byte time signature payload (4 standard + 1 extension byte)
				...vlq(0),
				0xff,
				0x58,
				0x05,
				0x03,
				0x02,
				24,
				8,
				0x77,
				...evNoteOn(0, 36),
				...evNoteOff(60, 36),
				...evEndOfTrack
			]
		]);

		const midi = parseMidi(bytes);
		expect(midi.tempoEvents).toEqual([{ tick: 0, microsecondsPerQuarter: 500000 }]);
		expect(midi.meterEvents).toEqual([
			{ tick: 0, numerator: 3, denominator: 4, notated32ndsPerQuarter: 8 }
		]);
		expect(midi.totalNotes).toBe(1);
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
				'format 0 with 0 tracks',
				(() => {
					const bytes = buildMidi(480, [], 0);
					return bytes;
				})()
			],
			[
				'format 0 with 2 tracks',
				(() => {
					const bytes = buildMidi(480, [[...evEndOfTrack], [...evEndOfTrack]], 0);
					return bytes;
				})()
			],
			[
				'format 1 with 0 tracks',
				(() => {
					const bytes = buildMidi(480, [], 1);
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
			],
			[
				'MTrk length with the high bit set',
				(() => {
					const bytes = buildMidi(480, [[...evEndOfTrack]]);
					new DataView(bytes.buffer).setUint32(18, 0x80000000);
					return bytes;
				})()
			],
			[
				'tempo meta event shorter than 3 bytes',
				buildMidi(480, [[...vlq(0), 0xff, 0x51, 0x02, 0x07, 0xa1, ...evEndOfTrack]])
			],
			[
				'tempo of zero microseconds per quarter',
				buildMidi(480, [[...vlq(0), 0xff, 0x51, 0x03, 0x00, 0x00, 0x00, ...evEndOfTrack]])
			],
			[
				'time signature meta event shorter than 4 bytes',
				buildMidi(480, [[...vlq(0), 0xff, 0x58, 0x02, 0x03, 0x02, ...evEndOfTrack]])
			],
			[
				'missing end-of-track meta event',
				buildMidi(480, [[...evNoteOn(0, 36), ...evNoteOff(60, 36)]])
			],
			['events after end-of-track', buildMidi(480, [[...evEndOfTrack, ...evNoteOn(0, 36)]])],
			[
				'non-empty end-of-track payload',
				buildMidi(480, [[...vlq(0), 0xff, 0x2f, 0x01, 0x00]])
			]
		];

		for (const [name, bytes] of cases) {
			it(`rejects: ${name}`, () => {
				expect(() => parseMidi(bytes)).toThrow();
			});
		}

		it('reports a track that ends right after a delta-time as invalid input', () => {
			const bytes = buildMidi(480, [[...vlq(10)]]);

			expect(() => parseMidi(bytes)).toThrow('Invalid MIDI file: unexpected end of track');
		});
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
			{ tick: 0, numerator: 4, denominator: 4, notated32ndsPerQuarter: 8 },
			{ tick: 3840, numerator: 3, denominator: 4, notated32ndsPerQuarter: 8 }
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
		expect(warnings.some((w) => w.includes('same MIDI note and tick'))).toBe(true);
	});

	it('warns and skips lane overrides outside the 0-127 MIDI note range', () => {
		const dtx = dtxFromText(
			['#BPM: 120', '#00011: 01', '#00012: 01', '#00013: 01'].join('\r\n')
		);
		const { data, warnings } = dtxToMidi(dtx, { '11': 200, '12': Number.NaN });

		expect(warnings).toHaveLength(2);
		expect(warnings.every((w) => w.includes('invalid MIDI note'))).toBe(true);
		// The file must still parse; only the valid lane emits a note.
		expect(noteOnTicks(data)).toEqual([{ tick: 0, note: 36, channel: 9 }]);
	});

	it('rejects tempos that cannot fit the 24-bit MPQ field instead of wrapping', () => {
		// 1 BPM -> MPQ 60,000,000 > 0xffffff; truncating would emit ~6.2 BPM.
		const dtx = dtxFromText(['#BPM: 1', '#00013: 01'].join('\r\n'));
		expect(() => dtxToMidi(dtx)).toThrow(/tempo/i);
	});

	it('rejects bar lengths whose cumulative ticks exceed the 4-byte SMF delta range', () => {
		// m0 = 1e8 whole notes -> measure 1 starts at 1.92e11 ticks; the delta
		// to the first m1 event needs a >4-byte VLQ the parser itself refuses.
		const dtx = dtxFromText(['#BPM: 120', '#00002: 100000000', '#00113: 01'].join('\r\n'));
		expect(() => dtxToMidi(dtx)).toThrow(/tick|range/i);
	});

	it(
		'rejects non-finite ticks from overflowing bar lengths instead of hanging',
		{ timeout: 5000 },
		() => {
			// m0 = 1e308 whole notes -> measure 1 starts at +Infinity; encoding
			// its delta previously ran encodeVlq(Infinity), a loop that never
			// advances (a bounded reproduction timed out).
			const dtx = dtxFromText(['#BPM: 120', '#00002: 1e308', '#00113: 01'].join('\r\n'));
			expect(() => dtxToMidi(dtx)).toThrow(/tick|range/i);
		}
	);
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

	it('ignores meter events that repeat the effective signature', () => {
		// Some exporters re-emit the time signature every bar; a redundant
		// 4/4 mid-bar is a no-op, not a mid-bar change.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evMeter(0, 4, 2),
					...evMeter(960, 4, 2),
					...evNoteOn(0, 38),
					...evNoteOff(60, 38),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.notes['12'][0].notes).toEqual([{ noteID: '01', position: 0.5 }]);
		expect(result.controls.measureLengths?.size ?? 0).toBe(0);
	});

	it('scales bar length by the notated-32nds byte and accepts boundary changes', () => {
		// SMF time-signature byte 4 is notated 32nds per MIDI quarter (8 by
		// default). 6/8 with 12 per quarter spans (6/8)*(8/12) = 1/2 of 4/4:
		// a 960-tick bar at 480 PPQ, not 1440. The 4/4 change at tick 960 is
		// a valid boundary transition that must not be rejected as mid-bar.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evMeter(0, 6, 3, 12),
					...evNoteOn(0, 36), // tick 0 -> bar 0 pos 0
					...evNoteOff(60, 36),
					...evNoteOn(420, 38), // tick 480 -> bar 0 pos 480/960 = 0.5
					...evNoteOff(60, 38),
					...evMeter(420, 4, 2), // tick 960 = bar 1 boundary
					...evNoteOn(480, 42), // tick 1440 -> bar 1 pos 480/1920 = 0.25
					...evNoteOff(60, 42),
					...evEndOfTrack
				]
			])
		);

		expect(midi.meterEvents[0]).toEqual({
			tick: 0,
			numerator: 6,
			denominator: 8,
			notated32ndsPerQuarter: 12
		});

		const result = midiToDtx(midi);
		expect(result.controls.measureLengths?.get(0)).toBe(0.5);
		expect(result.controls.measureLengths?.get(1)).toBe(1);
		expect(result.notes['13'][0].notes).toEqual([{ noteID: '01', position: 0 }]);
		expect(result.notes['12'][0].notes).toEqual([{ noteID: '01', position: 0.5 }]);
		expect(result.notes['11'][0].measure).toBe(1);
		expect(result.notes['11'][0].notes).toEqual([{ noteID: '01', position: 0.25 }]);
	});

	it('accepts a meter change on a boundary accumulated from fractional spans', () => {
		// 5/8 with 12 notated 32nds per quarter spans (5/8)*(8/12) = 5/12 of
		// 4/4 — 800 ticks at 480 PPQ, but 4*480*5/12 accumulates a hair under
		// 2400. The 4/4 change at tick 2400 is exactly on the third barline
		// and must be applied, not rejected as mid-bar.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evMeter(0, 5, 3, 12),
					...evMeter(2400, 4, 2),
					...evNoteOn(0, 36), // tick 2400 -> bar 3 pos 0
					...evNoteOff(60, 36),
					...evEndOfTrack
				]
			])
		);

		const result = midiToDtx(midi);
		expect(result.controls.measureLengths?.get(0)).toBeCloseTo(5 / 12);
		// 4/4 resumes at the measure-3 barline; unchanged bars are omitted.
		expect(result.controls.measureLengths?.get(1)).toBeUndefined();
		expect(result.controls.measureLengths?.get(3)).toBe(1);
		expect(result.notes['13'][0].measure).toBe(3);
		expect(result.notes['13'][0].notes).toEqual([{ noteID: '01', position: 0 }]);
	});

	it('treats equal-length signatures as real changes: off-boundary 6/8 -> 3/4 throws', () => {
		// 6/8 and 3/4 share a 0.75 bar length but are different meters; a
		// signature-keyed repeat filter keeps the 3/4 event reachable by the
		// mid-bar check instead of silently absorbing it as a duplicate.
		const midi = parseMidi(
			buildMidi(480, [[...evMeter(0, 6, 3), ...evMeter(1920, 3, 2), ...evEndOfTrack]])
		);
		expect(() => midiToDtx(midi)).toThrow(/meter/i);
	});

	it('accepts an equal-length 6/8 -> 3/4 change on a bar boundary', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evMeter(0, 6, 3),
					...evMeter(2880, 3, 2), // bar 2 boundary (bars are 1440 ticks)
					...evNoteOn(720, 38), // tick 3600 -> bar 2 pos 0.5
					...evNoteOff(60, 38),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.controls.measureLengths?.get(0)).toBe(0.75);
		expect(result.controls.measureLengths?.size ?? 0).toBe(1);
		expect(result.notes['12'][0].measure).toBe(2);
		expect(result.notes['12'][0].notes).toEqual([{ noteID: '01', position: 0.5 }]);
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

	it('rejects input that would exceed the 3-digit DTX measure range', () => {
		// 480 PPQ 4/4: bar = 1920 ticks; a note at tick 1,920,000 lands in
		// measure 1000, which #NNNxx headers cannot represent.
		const midi = parseMidi(
			buildMidi(480, [[...evNoteOn(1_920_000, 38), ...evNoteOff(60, 38), ...evEndOfTrack]])
		);
		expect(() => midiToDtx(midi)).toThrow(/measure/i);
	});

	it('excludes ignored non-drum notes from the DTX measure-range check', () => {
		// Kick at tick 0 plus a melody note on channel 0 past measure 999:
		// the non-drum note is ignored and must not trigger the range error.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evNoteOn(0, 36, 100, 9),
					...evNoteOff(60, 36, 9),
					...evNoteOn(1_920_000 - 60, 60, 100, 0),
					...evNoteOff(60, 60, 0),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.notes['13'][0].notes).toEqual([{ noteID: '01', position: 0 }]);
		expect(result.warnings.some((w) => w.includes('non-drum channels ignored'))).toBe(true);
	});

	it('rolls a hit that quantizes onto the barline into the next bar slot 0', () => {
		// slot = 10 ticks at 480 PPQ 4/4: tick 1917 -> raw slot 191.7 -> 192.
		const midi = parseMidi(
			buildMidi(480, [[...evNoteOn(1917, 36), ...evNoteOff(60, 36), ...evEndOfTrack]])
		);
		const result = midiToDtx(midi);
		expect(result.notes['13'][0].measure).toBe(1);
		expect(result.notes['13'][0].notes).toEqual([{ noteID: '01', position: 0 }]);
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

	it('warns when an off-grid tempo change snaps to the 1/192 grid', () => {
		// Tick 485 falls between slots (48.5): it snaps to slot 49 = tick 490,
		// shifting the segment boundary by 5 ticks — shifts compound across
		// tempo segments, so the conversion must surface the drift.
		const midi = parseMidi(
			buildMidi(480, [[...evTempo(0, 120), ...evTempo(485, 90), ...evEndOfTrack]])
		);
		const result = midiToDtx(midi);
		expect(result.controls.bpmChanges).toEqual({ '01': 90 });
		expect(result.warnings).toContain(
			'1 tempo change(s) snapped to the 1/192 DTX grid; timing shifts up to 5 tick(s)'
		);
	});

	it('does not warn when tempo changes land exactly on grid slots', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evTempo(0, 120),
					...evTempo(960, 90), // slot 96 of bar 0
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.warnings.every((w) => !w.includes('snapped'))).toBe(true);
	});

	it('reuses a BPM id when a tempo value repeats', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evTempo(0, 120),
					...evTempo(1920, 150), // bar 1 -> '01'
					...evTempo(1920, 140), // bar 2 -> '02'
					...evTempo(1920, 150), // bar 3 returns to 150 -> reuse '01'
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(result.controls.bpmChanges).toEqual({ '01': 150, '02': 140 });
		expect(result.notes['08'].map((g) => g.notes[0].noteID)).toEqual(['01', '02', '01']);
	});

	it('throws instead of emitting a 3-char id when the BPM id space is exhausted', () => {
		// 'ZZ' is id 1295; the 1296th distinct tempo has no valid #BPMxx def.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evTempo(0, 120),
					...Array.from({ length: 1296 }, (_, i) => evTempo(10, 5 + i)).flat(),
					...evEndOfTrack
				]
			])
		);
		expect(() => midiToDtx(midi)).toThrow(/BPM|id/i);
	});

	it('allocates BPM ids only for surviving values after cell collisions', () => {
		// At 32736 PPQ (4/4 bar = 130944 ticks, 1/192 cell = 682 ticks),
		// 1296 distinct tempo events 1 tick apart all collapse onto <= 3 cells,
		// so only <= 3 #BPMxx ids are needed.
		const midi = parseMidi(
			buildMidi(32736, [
				[
					...evTempo(0, 120),
					...Array.from({ length: 1296 }, (_, i) => evTempo(1, 50 + i)).flat(),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		expect(Object.keys(result.controls.bpmChanges ?? {}).length).toBeLessThanOrEqual(3);
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

	it('keeps a positive-tick tempo change out of initial cell 0 so BPM override holds', () => {
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evTempo(0, 120),
					...evTempo(4, 180),
					...evNoteOn(0, 36),
					...evNoteOff(60, 36),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi, { bpm: 90 });
		expect(result.bpm).toBe(90);
		expect(result.notes['08'][0].notes[0]).toEqual({ noteID: '01', position: 1 / 192 });
		expect(result.warnings).toContain(
			'1 tempo change(s) snapped to the 1/192 DTX grid; timing shifts up to 6 tick(s)'
		);

		const out = new DTXFile();
		out.bpm = result.bpm;
		const reparsed = new DTXFile(out.toDtxText(result.notes, result.controls));
		reparsed.parseFromText(out.toDtxText(result.notes, result.controls));
		const timing = buildChartTiming(buildTimingInput(reparsed));
		expect(timing.positionToTime(0, 0)).toBe(0);
		expect(timing.tempoEvents).toEqual([
			{ measure: 0, fraction: 0, bpm: 90 },
			{ measure: 0, fraction: 1 / 192, bpm: 180 }
		]);
	});

	it('preserves full BPM precision for maximum 3-byte MIDI tempo (0xFFFFFF) on round trip', () => {
		const maxMpq = 0xffffff;
		const midi = parseMidi(
			buildMidi(480, [
				[
					...vlq(0),
					0xff,
					0x51,
					0x03,
					(maxMpq >> 16) & 0xff,
					(maxMpq >> 8) & 0xff,
					maxMpq & 0xff,
					...evNoteOn(0, 36),
					...evNoteOff(60, 36),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi);
		const out = new DTXFile();
		out.bpm = result.bpm;
		const text = out.toDtxText(result.notes, result.controls);
		const reparsed = new DTXFile(text);
		reparsed.parseFromText(text);

		expect(() => dtxToMidi(reparsed)).not.toThrow();
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

	it('normalizes lowercase lane overrides so same-slot hits collide on one lane', () => {
		// '1c' and '1C' both validate (laneToStaff is case-insensitive), but
		// raw-case grouping keys made them duplicate logical lanes: zero
		// collisions reported and both #0001c and #0001C serialized.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evNoteOn(0, 35),
					...evNoteOn(0, 36),
					...evNoteOff(60, 35),
					...evNoteOff(60, 36),
					...evEndOfTrack
				]
			])
		);
		const result = midiToDtx(midi, { noteToLane: { 35: '1c', 36: '1C' } });
		expect(result.collisions).toBe(1);
		expect(result.notes['1c']).toBeUndefined();
		expect(result.notes['1C'][0].notes).toEqual([{ noteID: '01', position: 0 }]);

		const out = new DTXFile();
		out.bpm = result.bpm;
		const text = out.toDtxText(result.notes, result.controls);
		expect(text).toContain('#0001C:');
		expect(text).not.toContain('#0001c:');
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

		// Time domain: reparsed DTX hits must survive serialization and
		// positionToTime must track real MIDI seconds through the tempo change.
		const out = new DTXFile();
		out.bpm = result.bpm;
		const text = out.toDtxText(result.notes, result.controls);
		const reparsed = new DTXFile(text);
		reparsed.parseFromText(text);
		const timing = buildChartTiming(buildTimingInput(reparsed));

		const reparsedHits: { measure: number; position: number }[] = [];
		for (const lm of reparsed.parseNotes()) {
			if (lm.laneID === '08') continue;
			for (const n of lm.notes) {
				if (n.noteID !== '00') {
					reparsedHits.push({ measure: lm.measure, position: n.position });
				}
			}
		}
		expect(reparsedHits).toHaveLength(5);
		reparsedHits.sort((a, b) => a.measure - b.measure || a.position - b.position);

		const reparsedSlots = reparsedHits.map((r) => r.measure * barTicks + r.position * barTicks);
		hits.map((h) => h.tick)
			.sort((a, b) => a - b)
			.forEach((tick, i) => {
				expect(Math.abs(reparsedSlots[i] - tick)).toBeLessThanOrEqual(halfSlot);
			});

		const secondsPerTick = (tick: number) =>
			tick <= 7680
				? (tick * (60 / bpmA)) / ppq
				: (7680 * (60 / bpmA)) / ppq + ((tick - 7680) * (60 / bpmB)) / ppq;
		const halfSlotSeconds = (halfSlot * (60 / Math.min(bpmA, bpmB))) / ppq;

		hits.forEach((hit, i) => {
			const r = reparsedHits[i];
			const actual = timing.positionToTime(r.measure, r.position);
			expect(Math.abs(actual - secondsPerTick(hit.tick))).toBeLessThanOrEqual(
				halfSlotSeconds
			);
		});
	});

	it('round-trips a 3/4 -> 4/4 file with a mid-measure tempo change', () => {
		// 480 PPQ: bar 0 is 3/4 (1440 ticks); 4/4 resumes at bar 1. Tempo drops
		// 150 -> 90 at tick 2160 = position 0.375 inside bar 1.
		const midi = parseMidi(
			buildMidi(480, [
				[
					...evMeter(0, 3, 2),
					...evTempo(0, 150),
					...evNoteOn(0, 36),
					...evNoteOff(60, 36), // cursor 60
					...evMeter(1380, 4, 2), // tick 1440 = bar 1 start
					...evNoteOn(560, 38), // tick 2000 -> pos 56/192 in bar 1
					...evNoteOff(60, 38), // cursor 2060
					...evTempo(100, 90), // tick 2160, mid-bar
					...evNoteOn(480, 42), // tick 2640 -> pos 120/192 = 0.625
					...evNoteOff(60, 42),
					...evEndOfTrack
				]
			])
		);

		const result = midiToDtx(midi);
		expect(result.bpm).toBe(150);
		expect(result.controls.bpmChanges).toEqual({ '01': 90 });
		expect(result.controls.measureLengths?.get(0)).toBe(0.75);
		expect(result.controls.measureLengths?.get(1)).toBe(1);
		expect(result.notes['08'][0].notes).toEqual([{ noteID: '01', position: 0.375 }]);

		// Base BPM, extended BPM, channel-08 refs and channel-02 controls must
		// all appear together in the serialized text.
		const out = new DTXFile();
		out.bpm = result.bpm;
		const text = out.toDtxText(result.notes, result.controls);
		expect(text).toContain('#BPM: 150');
		expect(text).toContain('#BPM01: 90');
		expect(text).toContain('#00002: 0.75');
		expect(text).toContain('#00102: 1');
		expect(text).toContain('#00108:');

		// Reparsing the serialized text preserves the tempo ref and timing.
		const reparsed = new DTXFile(text);
		reparsed.parseFromText(text);
		const refGroup = reparsed.parseNotes().find((lm) => lm.laneID === '08');
		expect(refGroup?.measure).toBe(1);
		expect(refGroup?.notes).toEqual([{ noteID: '01', position: 0.375 }]);

		// Time domain across the mid-measure tempo change: hihat at tick 2640.
		const timing = buildChartTiming(buildTimingInput(reparsed));
		const expectedSeconds = (2160 * (60 / 150)) / 480 + ((2640 - 2160) * (60 / 90)) / 480;
		expect(timing.positionToTime(1, 0.625)).toBeCloseTo(expectedSeconds, 6);
	});

	it('converts the committed drum-off-grid fixture end-to-end', () => {
		// packages/e2e-web/fixtures/drum-off-grid.mid: 960 PPQ, 140 BPM,
		// 4/4 -> 3/4 at bar 2, humanized hits, one unmapped GM note (99) and
		// one channel-0 note that must be ignored.
		const bytes = new Uint8Array(
			readFileSync(
				path.join(
					path.dirname(fileURLToPath(import.meta.url)),
					'../../../../e2e-web/fixtures/drum-off-grid.mid'
				)
			)
		);

		const midi = parseMidi(bytes);
		expect(midi.ticksPerQuarter).toBe(960);
		// Eight positive-velocity note-ons in the file; overlapping snare
		// attacks at ticks 487 and 500 are both retained.
		expect(midi.totalNotes).toBe(8);
		expect(midi.tracks[0].notes.filter((n) => n.note === 38).map((n) => n.startTime)).toEqual([
			487, 500
		]);
		expect(midi.meterEvents).toEqual([
			{ tick: 0, numerator: 4, denominator: 4, notated32ndsPerQuarter: 8 },
			{ tick: 7680, numerator: 3, denominator: 4, notated32ndsPerQuarter: 8 }
		]);

		const result = midiToDtx(midi);
		expect(result.bpm).toBe(140);
		expect(result.unmappedNotes).toBe(1);
		expect(result.warnings.some((w) => w.includes('non-drum'))).toBe(true);
		expect(result.collisions).toBe(0);
		expect(result.controls.measureLengths?.get(2)).toBe(0.75);
		// Both snare attacks survive into adjacent 1/192 cells of lane '12'.
		expect(result.notes['12'][0].notes).toHaveLength(2);

		const out = new DTXFile();
		out.bpm = result.bpm;
		const text = out.toDtxText(result.notes, result.controls);
		expect(text).toContain('#BPM: 140');
		expect(text).toContain('#00202: 0.75');
	});

	it('keeps absolute hit ticks reimportable when an unrepresentable meter precedes 4/4', () => {
		// 0.96 has no power-of-two meter, so it exports no meter event. The 4/4
		// restoration at measure 1 used to emit one at true tick 1843 — mid-bar
		// on the bar grid the importer rebuilds, so reimport threw.
		const source = dtxFromText(
			['#BPM: 120', '#00002: 0.96', '#00013: 01', '#00102: 1', '#00112: 01'].join('\r\n')
		);

		const { data, warnings } = dtxToMidi(source);
		expect(warnings.some((w) => w.includes('0.96'))).toBe(true);
		// Kick at tick 0; snare at round(4 * 480 * 0.96) = 1843 — true ticks kept.
		expect(noteOnTicks(data).map((e) => e.tick)).toEqual([0, 1843]);
		// No meter event can land on the importer's rebuilt grid, so none is sent.
		expect(meterEventsOf(data)).toEqual([]);

		const back = midiToDtx(parseMidi(data)); // must not throw mid-bar meter
		const out = new DTXFile();
		out.bpm = back.bpm;
		const reparsed = dtxFromText(out.toDtxText(back.notes, back.controls));

		const recovered: Record<string, { measure: number; position: number }> = {};
		for (const group of reparsed.parseNotes()) {
			for (const n of group.notes) {
				if (n.noteID === '00') continue;
				recovered[group.laneID] = { measure: group.measure, position: n.position };
			}
		}
		expect(recovered['13']).toEqual({ measure: 0, position: 0 });
		const snare = recovered['12'];
		expect(snare).toBeDefined();
		if (!snare) throw new Error('snare hit lost in round trip');

		// Onset seconds are preserved within half a 1/192 slot (5 ticks at
		// 480 PPQ 4/4, ~5.2ms at 120 BPM).
		const srcTiming = buildChartTiming(buildTimingInput(source));
		const dstTiming = buildChartTiming(buildTimingInput(reparsed));
		const halfSlotSeconds = (5 * (60 / 120)) / 480;
		expect(
			Math.abs(
				dstTiming.positionToTime(snare.measure, snare.position) -
					srcTiming.positionToTime(1, 0)
			)
		).toBeLessThanOrEqual(halfSlotSeconds);
	});
});
