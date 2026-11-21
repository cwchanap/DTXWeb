/**
 * Shared Standard MIDI File parser (SMF format 0/1, PPQ division).
 *
 * Started from the midi-preview page parser (which read header lengths and
 * channel-message widths correctly) and hardened: every read is bounds-checked
 * against the declared track length, so malformed or truncated bytes reject
 * instead of producing NaN-poisoned metadata. Running status, velocity-zero
 * note-offs, variable channel-message widths, meta tempo/meter and sysex
 * skipping are supported; SMPTE divisions and non-file status bytes reject.
 */

export interface MidiEvent {
	deltaTime: number;
	absoluteTime: number;
	type: 'meta' | 'channel' | 'sysex';
	/** Meta-event subtype (0x51 tempo, 0x58 meter, 0x2F end-of-track, ...). */
	subtype?: number;
	/** Meta payload bytes. */
	data?: number[];
	channel?: number;
	/** High nibble of the status byte: 0x80, 0x90, ..., 0xE0. */
	command?: number;
	note?: number;
	velocity?: number;
}

export interface MidiNote {
	channel: number;
	note: number;
	velocity: number;
	/** Absolute tick of the note-on. */
	startTime: number;
	/** Tick length; runs to track end when no matching note-off exists. */
	duration: number;
}

export interface MidiTrack {
	name?: string;
	events: MidiEvent[];
	notes: MidiNote[];
	instruments: Set<number>;
	channels: Set<number>;
}

export interface MidiTempoEvent {
	/** Absolute tick, merged across tracks. */
	tick: number;
	microsecondsPerQuarter: number;
}

export interface MidiMeterEvent {
	tick: number;
	numerator: number;
	/** Real denominator (2^encoded): a 3/4 bar reports 4, not the byte 2. */
	denominator: number;
	/** 32nd notes per MIDI quarter note (SMF byte 3; defaults to 8). */
	notated32ndsPerQuarter: number;
}

export interface ParsedMidi {
	format: number;
	trackCount: number;
	ticksPerQuarter: number;
	tracks: MidiTrack[];
	/** All tempo changes merged across tracks, sorted by tick. */
	tempoEvents: MidiTempoEvent[];
	/** All time-signature changes merged across tracks, sorted by tick. */
	meterEvents: MidiMeterEvent[];
	/** Display tempo: BPM of the last tempo event (120 when absent). */
	tempo: number;
	/** Rough seconds estimate at `tempo`, for the preview metadata UI. */
	duration: number;
	totalNotes: number;
}

const fail = (reason: string): never => {
	throw new Error(`Invalid MIDI file: ${reason}`);
};

const CHANNEL_DATA_BYTES: Record<number, number> = {
	0x80: 2,
	0x90: 2,
	0xa0: 2,
	0xb0: 2,
	0xc0: 1,
	0xd0: 1,
	0xe0: 2
};

interface RawTrack {
	track: MidiTrack;
	nextOffset: number;
	tempoEvents: MidiTempoEvent[];
	meterEvents: MidiMeterEvent[];
}

/** FIFO of open note-ons; `head` advances on dequeue so removal is O(1). */
interface PendingNotes {
	items: MidiNote[];
	head: number;
}

const parseTrack = (data: Uint8Array, offset: number, trackEnd: number): RawTrack => {
	const events: MidiEvent[] = [];
	const notes: MidiNote[] = [];
	const instruments = new Set<number>();
	const channels = new Set<number>();
	const tempoEvents: MidiTempoEvent[] = [];
	const meterEvents: MidiMeterEvent[] = [];
	let trackName: string | undefined;

	let currentTime = 0;
	let runningStatus = 0;
	let sawEndOfTrack = false;
	// Open note-ons per channel+pitch, oldest first. Overlapping re-attacks
	// queue so every attack is retained; a note-off pairs FIFO with the
	// earliest still-open attack, and offs with none pending are ignored.
	// The head index keeps dequeue O(1) — Array.shift() is O(n) per release
	// and made massed overlapping attacks quadratic.
	const activeNotes = new Map<string, PendingNotes>();

	const readByte = (): number => {
		if (offset >= trackEnd) fail('unexpected end of track');
		return data[offset++];
	};
	const readDataByte = (): number => {
		const byte = readByte();
		if (byte >= 0x80) fail('status byte where data byte expected');
		return byte;
	};
	const readVlq = (): number => {
		let value = 0;
		for (let i = 0; i < 4; i++) {
			const byte = readByte();
			value = (value << 7) | (byte & 0x7f);
			if (!(byte & 0x80)) return value;
		}
		return fail('variable-length quantity exceeds 4 bytes');
	};

	while (offset < trackEnd) {
		const deltaTime = readVlq();
		currentTime += deltaTime;

		let status = data[offset];
		if (status < 0x80) {
			// Data byte where a status should be: only legal as running status.
			if (runningStatus === 0) fail('data byte without running status');
			status = runningStatus;
		} else {
			offset++;
		}

		if (status >= 0x80 && status < 0xf0) {
			// Channel message. Data length depends on the command nibble.
			runningStatus = status;
			const command = status & 0xf0;
			const channel = status & 0x0f;
			const event: MidiEvent = {
				deltaTime,
				absoluteTime: currentTime,
				type: 'channel',
				command,
				channel
			};
			channels.add(channel);

			const dataBytes = CHANNEL_DATA_BYTES[command];
			if (command === 0x80 || command === 0x90) {
				const note = readDataByte();
				const velocity = readDataByte();
				event.note = note;
				event.velocity = velocity;

				const key = `${channel}-${note}`;
				if (command === 0x90 && velocity > 0) {
					const pending = activeNotes.get(key) ?? { items: [], head: 0 };
					pending.items.push({
						channel,
						note,
						velocity,
						startTime: currentTime,
						duration: 0
					});
					activeNotes.set(key, pending);
				} else {
					// 0x80 or velocity-zero 0x90 closes the oldest matching note-on.
					const pending = activeNotes.get(key);
					const active =
						pending && pending.head < pending.items.length
							? pending.items[pending.head++]
							: undefined;
					if (pending && active) {
						active.duration = currentTime - active.startTime;
						notes.push(active);
						if (pending.head === pending.items.length) activeNotes.delete(key);
					}
				}
			} else if (command === 0xc0) {
				instruments.add(readDataByte());
			} else {
				for (let i = 0; i < dataBytes; i++) readDataByte();
			}
			events.push(event);
		} else if (status === 0xff) {
			// Meta event; cancels running status.
			runningStatus = 0;
			const subtype = readByte();
			const length = readVlq();
			if (offset + length > trackEnd) fail('meta event extends past track end');
			const payload = Array.from(data.slice(offset, offset + length));
			offset += length;

			if (subtype === 0x51) {
				if (payload.length !== 3) {
					fail(`tempo meta event has ${payload.length} bytes, expected 3`);
				}
				const microsecondsPerQuarter = (payload[0] << 16) | (payload[1] << 8) | payload[2];
				// Zero would produce an infinite BPM downstream.
				if (microsecondsPerQuarter === 0) {
					fail('tempo of 0 microseconds per quarter');
				}
				tempoEvents.push({ tick: currentTime, microsecondsPerQuarter });
			} else if (subtype === 0x58) {
				if (payload.length !== 4) {
					fail(`time signature meta event has ${payload.length} bytes, expected 4`);
				}
				meterEvents.push({
					tick: currentTime,
					numerator: payload[0],
					denominator: 2 ** payload[1],
					notated32ndsPerQuarter: payload[3]
				});
			} else if (subtype === 0x2f) {
				// End of track must be a zero-length, genuinely terminal meta
				// event — not padding and not followed by more bytes.
				if (payload.length !== 0) {
					fail(`end-of-track meta event has ${payload.length} bytes, expected 0`);
				}
				if (offset !== trackEnd) {
					fail('data follows the end-of-track event');
				}
				sawEndOfTrack = true;
			} else if (subtype === 0x03 && trackName === undefined) {
				trackName = new TextDecoder().decode(new Uint8Array(payload));
			}
			events.push({
				deltaTime,
				absoluteTime: currentTime,
				type: 'meta',
				subtype,
				data: payload
			});
		} else if (status === 0xf0 || status === 0xf7) {
			// System exclusive (start or continuation); cancels running status.
			runningStatus = 0;
			const length = readVlq();
			if (offset + length > trackEnd) fail('sysex event extends past track end');
			offset += length;
			events.push({ deltaTime, absoluteTime: currentTime, type: 'sysex' });
		} else {
			return fail(`unsupported system status 0x${status.toString(16)}`);
		}
	}

	if (!sawEndOfTrack) fail('missing end-of-track meta event');

	// Notes still open at track end close at the last seen tick.
	for (const pending of activeNotes.values()) {
		for (let i = pending.head; i < pending.items.length; i++) {
			const active = pending.items[i];
			active.duration = currentTime - active.startTime;
			notes.push(active);
		}
	}
	notes.sort((a, b) => a.startTime - b.startTime);

	return {
		track: { name: trackName, events, notes, instruments, channels },
		nextOffset: offset,
		tempoEvents,
		meterEvents
	};
};

export const parseMidi = (data: Uint8Array): ParsedMidi => {
	const readUint16 = (offset: number): number => {
		if (offset + 2 > data.length) fail('truncated file');
		return (data[offset] << 8) | data[offset + 1];
	};
	const readUint32 = (offset: number): number => {
		if (offset + 4 > data.length) fail('truncated file');
		// Chunk lengths are unsigned 32-bit; `<< 24` alone yields a signed
		// result that would bypass the declared-extent check for lengths
		// like 0x80000000.
		return (
			((data[offset] << 24) >>> 0) +
			(data[offset + 1] << 16) +
			(data[offset + 2] << 8) +
			data[offset + 3]
		);
	};

	if (data.length < 8 || String.fromCharCode(...data.slice(0, 4)) !== 'MThd') {
		fail('missing MThd header');
	}
	const headerLength = readUint32(4);
	if (headerLength < 6) fail(`header length ${headerLength} < 6`);
	if (8 + headerLength > data.length) fail('truncated header');

	const format = readUint16(8);
	if (format > 1) fail(`unsupported format ${format}`);
	const trackCount = readUint16(10);
	const ticksPerQuarter = readUint16(12);
	if (ticksPerQuarter & 0x8000) fail('SMPTE division is not supported');
	if (ticksPerQuarter === 0) fail('zero ticks per quarter note');

	const tracks: MidiTrack[] = [];
	const tempoEvents: MidiTempoEvent[] = [];
	const meterEvents: MidiMeterEvent[] = [];

	let offset = 8 + headerLength;
	for (let i = 0; i < trackCount; i++) {
		if (offset + 8 > data.length) fail(`truncated: track ${i} header missing`);
		if (String.fromCharCode(...data.slice(offset, offset + 4)) !== 'MTrk') {
			fail(`missing MTrk for track ${i}`);
		}
		const trackLength = readUint32(offset + 4);
		offset += 8;
		if (offset + trackLength > data.length) fail(`track ${i} extends past end of file`);

		const raw = parseTrack(data, offset, offset + trackLength);
		tracks.push(raw.track);
		// Spread-into-push would pass every element as a call argument; a
		// track with enough meta events overflows the engine's argument limit.
		for (const event of raw.tempoEvents) tempoEvents.push(event);
		for (const event of raw.meterEvents) meterEvents.push(event);
		offset = raw.nextOffset;
	}

	tempoEvents.sort((a, b) => a.tick - b.tick);
	meterEvents.sort((a, b) => a.tick - b.tick);

	const lastTempo = tempoEvents[tempoEvents.length - 1];
	const tempo = lastTempo ? Math.round(60000000 / lastTempo.microsecondsPerQuarter) : 120;

	let maxTick = 0;
	let totalNotes = 0;
	for (const track of tracks) {
		totalNotes += track.notes.length;
		for (const note of track.notes) {
			maxTick = Math.max(maxTick, note.startTime + note.duration);
		}
	}
	const duration = (maxTick / ticksPerQuarter) * (60 / tempo);

	return {
		format,
		trackCount,
		ticksPerQuarter,
		tracks,
		tempoEvents,
		meterEvents,
		tempo,
		duration,
		totalNotes
	};
};
