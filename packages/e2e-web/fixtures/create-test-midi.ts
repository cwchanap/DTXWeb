// TypeScript script to create test MIDI files with proper types
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MIDI file structure types
interface MidiHeader {
	chunkType: 'MThd';
	length: number;
	format: number;
	trackCount: number;
	ticksPerQuarter: number;
}

class MidiFileBuilder {
	private header: MidiHeader;
	private tracks: Uint8Array[] = [];

	constructor(format: number = 0, ticksPerQuarter: number = 480) {
		this.header = {
			chunkType: 'MThd',
			length: 6,
			format,
			trackCount: 0,
			ticksPerQuarter
		};
	}

	/**
	 * Create MIDI header chunk
	 */
	private createHeaderChunk(): Uint8Array {
		const header = new Uint8Array(14);
		const view = new DataView(header.buffer);

		// "MThd" chunk type
		header.set([0x4d, 0x54, 0x68, 0x64], 0);

		// Header length (6 bytes)
		view.setUint32(4, this.header.length, false);

		// Format type
		view.setUint16(8, this.header.format, false);

		// Number of tracks
		view.setUint16(10, this.header.trackCount, false);

		// Ticks per quarter note
		view.setUint16(12, this.header.ticksPerQuarter, false);

		return header;
	}

	/**
	 * Encode variable length quantity (used for delta times)
	 */
	private encodeVariableLength(value: number): number[] {
		const bytes: number[] = [];
		let remaining = value;

		// Handle the first byte (no continuation bit needed initially)
		bytes.unshift(remaining & 0x7f);
		remaining >>= 7;

		// Add continuation bytes
		while (remaining > 0) {
			bytes.unshift((remaining & 0x7f) | 0x80);
			remaining >>= 7;
		}

		return bytes;
	}

	/**
	 * Create a tempo meta event (Set Tempo)
	 */
	private createTempoEvent(bpm: number, deltaTime: number = 0): number[] {
		const microsecondsPerQuarter = Math.round(60_000_000 / bpm);
		return [
			...this.encodeVariableLength(deltaTime),
			0xff,
			0x51,
			0x03, // Meta event: Set Tempo, length 3
			(microsecondsPerQuarter >> 16) & 0xff,
			(microsecondsPerQuarter >> 8) & 0xff,
			microsecondsPerQuarter & 0xff
		];
	}

	/**
	 * Create a track name meta event
	 */
	private createTrackNameEvent(name: string, deltaTime: number = 0): number[] {
		const nameBytes = Array.from(new TextEncoder().encode(name));
		return [
			...this.encodeVariableLength(deltaTime),
			0xff,
			0x03, // Meta event: Track Name
			...this.encodeVariableLength(nameBytes.length),
			...nameBytes
		];
	}

	/**
	 * Create a time signature meta event
	 * @param numerator beats per bar
	 * @param denominator beat unit (4 = quarter); encoded as log2 per SMF
	 */
	private createTimeSignatureEvent(
		numerator: number,
		denominator: number,
		deltaTime: number = 0
	): number[] {
		return [
			...this.encodeVariableLength(deltaTime),
			0xff,
			0x58, // Meta event: Time Signature
			0x04,
			numerator & 0xff,
			Math.log2(denominator) & 0xff,
			24, // metronome clocks per click
			8 // 32nd notes per quarter
		];
	}

	/**
	 * Create note on event
	 */
	private createNoteOnEvent(
		note: number,
		velocity: number,
		channel: number = 0,
		deltaTime: number = 0
	): number[] {
		return [
			...this.encodeVariableLength(deltaTime),
			0x90 | (channel & 0x0f), // Note On + channel
			note & 0x7f,
			velocity & 0x7f
		];
	}

	/**
	 * Create note off event
	 */
	private createNoteOffEvent(
		note: number,
		velocity: number = 0,
		channel: number = 0,
		deltaTime: number = 0
	): number[] {
		return [
			...this.encodeVariableLength(deltaTime),
			0x80 | (channel & 0x0f), // Note Off + channel
			note & 0x7f,
			velocity & 0x7f
		];
	}

	/**
	 * Create end of track meta event
	 */
	private createEndOfTrackEvent(deltaTime: number = 0): number[] {
		return [
			...this.encodeVariableLength(deltaTime),
			0xff,
			0x2f,
			0x00 // Meta event: End of Track
		];
	}

	/**
	 * Add a track with optional notes and metadata
	 */
	addTrack(
		options: {
			name?: string;
			tempo?: number;
			tempos?: Array<{
				tick: number;
				bpm: number;
			}>;
			timeSignatures?: Array<{
				tick: number;
				numerator: number;
				denominator: number;
			}>;
			notes?: Array<{
				note: number;
				velocity: number;
				channel?: number;
				startTime: number;
				duration: number;
			}>;
		} = {}
	): void {
		const trackEvents: number[] = [];
		let currentTime = 0;

		// Add track name if provided
		if (options.name) {
			trackEvents.push(...this.createTrackNameEvent(options.name, 0));
		}

		// Add tempo if provided
		if (options.tempo) {
			trackEvents.push(...this.createTempoEvent(options.tempo, 0));
		}

		// Timed events: meter changes and note on/offs, emitted in tick order
		// with meter first at identical ticks.
		const timedEvents: Array<
			| { time: number; type: 'sig'; numerator: number; denominator: number }
			| { time: number; type: 'tempo'; bpm: number }
			| { time: number; type: 'on' | 'off'; note: number; velocity: number; channel: number }
		> = [];

		for (const sig of options.timeSignatures ?? []) {
			timedEvents.push({
				time: sig.tick,
				type: 'sig',
				numerator: sig.numerator,
				denominator: sig.denominator
			});
		}

		for (const tempoChange of options.tempos ?? []) {
			timedEvents.push({ time: tempoChange.tick, type: 'tempo', bpm: tempoChange.bpm });
		}

		for (const noteData of options.notes ?? []) {
			const channel = noteData.channel || 0;
			timedEvents.push({
				time: noteData.startTime,
				type: 'on',
				note: noteData.note,
				velocity: noteData.velocity,
				channel
			});
			timedEvents.push({
				time: noteData.startTime + noteData.duration,
				type: 'off',
				note: noteData.note,
				velocity: 0,
				channel
			});
		}

		// Meter/tempo before note events at the same tick; off before on keeps a
		// re-struck note's release ahead of its next attack.
		const typeRank = { sig: 0, tempo: 1, off: 2, on: 3 } as const;
		timedEvents.sort((a, b) => a.time - b.time || typeRank[a.type] - typeRank[b.type]);

		for (const event of timedEvents) {
			const deltaTime = event.time - currentTime;
			if (event.type === 'sig') {
				trackEvents.push(
					...this.createTimeSignatureEvent(event.numerator, event.denominator, deltaTime)
				);
			} else if (event.type === 'tempo') {
				trackEvents.push(...this.createTempoEvent(event.bpm, deltaTime));
			} else if (event.type === 'on') {
				trackEvents.push(
					...this.createNoteOnEvent(event.note, event.velocity, event.channel, deltaTime)
				);
			} else {
				trackEvents.push(
					...this.createNoteOffEvent(event.note, event.velocity, event.channel, deltaTime)
				);
			}
			currentTime = event.time;
		}

		// End of track
		trackEvents.push(...this.createEndOfTrackEvent(0));

		// Create track chunk
		const trackData = new Uint8Array(trackEvents);
		const trackHeader = new Uint8Array(8);
		const view = new DataView(trackHeader.buffer);

		// "MTrk" chunk type
		trackHeader.set([0x4d, 0x54, 0x72, 0x6b], 0);

		// Track length
		view.setUint32(4, trackData.length, false);

		// Combine header and data
		const track = new Uint8Array(trackHeader.length + trackData.length);
		track.set(trackHeader, 0);
		track.set(trackData, trackHeader.length);

		this.tracks.push(track);
		this.header.trackCount++;
	}

	/**
	 * Build the complete MIDI file
	 */
	build(): Uint8Array {
		const headerChunk = this.createHeaderChunk();

		// Calculate total length
		let totalLength = headerChunk.length;
		for (const track of this.tracks) {
			totalLength += track.length;
		}

		// Combine all chunks
		const midiFile = new Uint8Array(totalLength);
		let offset = 0;

		// Add header
		midiFile.set(headerChunk, offset);
		offset += headerChunk.length;

		// Add tracks
		for (const track of this.tracks) {
			midiFile.set(track, offset);
			offset += track.length;
		}

		return midiFile;
	}
}

/**
 * MIDI note constants for better readability
 */
const MIDI_NOTES = {
	C4: 60,
	D4: 62,
	E4: 64,
	F4: 65,
	G4: 67,
	A4: 69,
	B4: 71,
	C5: 72
} as const;

/**
 * Create test MIDI files
 */
function createTestMidiFiles(): void {
	console.log('🎵 Creating test MIDI files with TypeScript...\n');

	// 1. Create MIDI file with a simple melody
	const testMidi = new MidiFileBuilder(0, 480);
	testMidi.addTrack({
		name: 'Test Track',
		tempo: 120,
		notes: [
			{ note: MIDI_NOTES.C4, velocity: 80, startTime: 0, duration: 480 },
			{ note: MIDI_NOTES.E4, velocity: 75, startTime: 480, duration: 480 },
			{ note: MIDI_NOTES.G4, velocity: 70, startTime: 960, duration: 480 },
			{ note: MIDI_NOTES.C5, velocity: 85, startTime: 1440, duration: 960 }
		]
	});

	// 2. Create empty MIDI file (no notes, just metadata)
	const emptyMidi = new MidiFileBuilder(0, 480);
	emptyMidi.addTrack({
		name: 'Empty Track',
		tempo: 120
	});

	// 3. Create multi-track MIDI file
	const multiTrackMidi = new MidiFileBuilder(1, 480); // Format 1 for multi-track

	// Melody track
	multiTrackMidi.addTrack({
		name: 'Melody',
		tempo: 120,
		notes: [
			{ note: MIDI_NOTES.C4, velocity: 80, startTime: 0, duration: 240 },
			{ note: MIDI_NOTES.D4, velocity: 80, startTime: 240, duration: 240 },
			{ note: MIDI_NOTES.E4, velocity: 80, startTime: 480, duration: 240 },
			{ note: MIDI_NOTES.F4, velocity: 80, startTime: 720, duration: 240 }
		]
	});

	// Bass track
	multiTrackMidi.addTrack({
		name: 'Bass',
		notes: [
			{ note: MIDI_NOTES.C4 - 12, velocity: 100, startTime: 0, duration: 960 },
			{ note: MIDI_NOTES.F4 - 12, velocity: 100, startTime: 960, duration: 960 }
		]
	});

	// 4. Create a drum fixture at non-480 PPQ with humanized (off-grid) hits —
	//    exercises 1/192 quantization, GM import aliases and a mid-file meter
	//    change end-to-end. Bar = 3840 ticks; 3/4 starts at bar 2 (tick 7680).
	const drumOffGridMidi = new MidiFileBuilder(0, 960);
	drumOffGridMidi.addTrack({
		name: 'Drums',
		tempo: 140,
		timeSignatures: [
			{ tick: 0, numerator: 4, denominator: 4 },
			{ tick: 7680, numerator: 3, denominator: 4 }
		],
		notes: [
			{ note: 36, velocity: 100, channel: 9, startTime: 3, duration: 60 },
			{ note: 38, velocity: 96, channel: 9, startTime: 487, duration: 60 },
			{ note: 38, velocity: 96, channel: 9, startTime: 500, duration: 60 },
			{ note: 42, velocity: 90, channel: 9, startTime: 963, duration: 60 },
			{ note: 36, velocity: 100, channel: 9, startTime: 3843, duration: 60 },
			{ note: 57, velocity: 88, channel: 9, startTime: 8003, duration: 60 },
			{ note: 99, velocity: 70, channel: 9, startTime: 1920, duration: 60 }, // unmapped GM
			{ note: 60, velocity: 80, channel: 0, startTime: 0, duration: 480 } // ignored (ch 0)
		]
	});

	// 5. Create a drum fixture for the MIDI -> DTX converter specs: a 3/4 bar
	//    then 4/4, a mid-bar tempo change, GM import aliases (35/40/51/53),
	//    simultaneous cross-lane hits at tick 0, a same-lane 1/192 collision,
	//    and a late-bar hit. All drum hits on channel 9 at 480 PPQ.
	const drumConvertMidi = new MidiFileBuilder(0, 480);
	drumConvertMidi.addTrack({
		name: 'Drums',
		tempo: 120,
		tempos: [{ tick: 2160, bpm: 180 }], // mid-bar inside bar 1
		timeSignatures: [
			{ tick: 0, numerator: 3, denominator: 4 }, // bar 0: [0, 1440)
			{ tick: 1440, numerator: 4, denominator: 4 } // bar 1: [1440, 3360)
		],
		notes: [
			{ note: 36, velocity: 100, channel: 9, startTime: 0, duration: 120 }, // Bass -> 13
			{ note: 38, velocity: 100, channel: 9, startTime: 0, duration: 120 }, // Snare -> 12
			{ note: 42, velocity: 100, channel: 9, startTime: 0, duration: 120 }, // HHC -> 11
			{ note: 40, velocity: 100, channel: 9, startTime: 0, duration: 120 }, // E-snare -> 12, collides
			{ note: 53, velocity: 90, channel: 9, startTime: 240, duration: 120 }, // ride bell -> 19
			{ note: 35, velocity: 95, channel: 9, startTime: 480, duration: 120 }, // ac. bass -> 13
			{ note: 40, velocity: 95, channel: 9, startTime: 960, duration: 120 }, // E-snare -> 12
			{ note: 45, velocity: 95, channel: 9, startTime: 1200, duration: 120 }, // low tom -> 15, late-bar
			{ note: 51, velocity: 90, channel: 9, startTime: 1440, duration: 120 }, // ride -> 19, bar 1
			{ note: 38, velocity: 95, channel: 9, startTime: 2160, duration: 120 } // snare -> 12, mid-bar
		]
	});

	// Write files
	const outputDir = __dirname;

	writeFileSync(path.join(outputDir, 'test-sample.mid'), testMidi.build());
	writeFileSync(path.join(outputDir, 'empty-sample.mid'), emptyMidi.build());
	writeFileSync(path.join(outputDir, 'multi-track-sample.mid'), multiTrackMidi.build());
	writeFileSync(path.join(outputDir, 'drum-off-grid.mid'), drumOffGridMidi.build());
	writeFileSync(path.join(outputDir, 'drum-convert.mid'), drumConvertMidi.build());

	// Create invalid file for error testing
	writeFileSync(path.join(outputDir, 'invalid-file.txt'), 'This is not a DTX file.\n');

	console.log('✅ Created test MIDI fixtures:');
	console.log('  📄 test-sample.mid (simple melody with 4 notes)');
	console.log('  📄 empty-sample.mid (no notes, metadata only)');
	console.log('  📄 multi-track-sample.mid (2 tracks with melody + bass)');
	console.log('  📄 drum-off-grid.mid (960 PPQ drums, humanized off-grid, 4/4 -> 3/4)');
	console.log('  📄 drum-convert.mid (3/4 -> 4/4 drums, aliases, collision, mid-bar tempo)');
	console.log('  📄 invalid-file.txt (for error testing)\n');

	// Display file information
	const testFile = testMidi.build();
	const emptyFile = emptyMidi.build();
	const multiTrackFile = multiTrackMidi.build();
	const drumOffGridFile = drumOffGridMidi.build();
	const drumConvertFile = drumConvertMidi.build();

	console.log('📊 File sizes:');
	console.log(`  test-sample.mid: ${testFile.length} bytes`);
	console.log(`  empty-sample.mid: ${emptyFile.length} bytes`);
	console.log(`  multi-track-sample.mid: ${multiTrackFile.length} bytes`);
	console.log(`  drum-off-grid.mid: ${drumOffGridFile.length} bytes`);
	console.log(`  drum-convert.mid: ${drumConvertFile.length} bytes`);
	console.log('\n🎯 All fixtures created successfully!');
}

// Run the script
createTestMidiFiles();
