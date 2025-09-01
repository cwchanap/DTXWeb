// TypeScript script to create test MIDI files with proper types
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

interface MidiTrackHeader {
	chunkType: 'MTrk';
	length: number;
}

interface MidiEvent {
	deltaTime: number;
	eventType: 'meta' | 'channel';
	data: number[];
}

interface MidiNote {
	channel: number;
	note: number;
	velocity: number;
	deltaTime: number;
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

		// Add notes if provided
		if (options.notes && options.notes.length > 0) {
			// Sort notes by start time
			const sortedNotes = [...options.notes].sort((a, b) => a.startTime - b.startTime);

			// Create note events
			const noteEvents: Array<{
				time: number;
				type: 'on' | 'off';
				note: number;
				velocity: number;
				channel: number;
			}> = [];

			for (const noteData of sortedNotes) {
				const channel = noteData.channel || 0;
				noteEvents.push({
					time: noteData.startTime,
					type: 'on',
					note: noteData.note,
					velocity: noteData.velocity,
					channel
				});
				noteEvents.push({
					time: noteData.startTime + noteData.duration,
					type: 'off',
					note: noteData.note,
					velocity: 0,
					channel
				});
			}

			// Sort all events by time
			noteEvents.sort((a, b) => a.time - b.time);

			// Convert to MIDI events with proper delta times
			for (const event of noteEvents) {
				const deltaTime = event.time - currentTime;

				if (event.type === 'on') {
					trackEvents.push(
						...this.createNoteOnEvent(
							event.note,
							event.velocity,
							event.channel,
							deltaTime
						)
					);
				} else {
					trackEvents.push(
						...this.createNoteOffEvent(
							event.note,
							event.velocity,
							event.channel,
							deltaTime
						)
					);
				}

				currentTime = event.time;
			}
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

	// Write files
	const outputDir = __dirname;

	writeFileSync(path.join(outputDir, 'test-sample.mid'), testMidi.build());
	writeFileSync(path.join(outputDir, 'empty-sample.mid'), emptyMidi.build());
	writeFileSync(path.join(outputDir, 'multi-track-sample.mid'), multiTrackMidi.build());

	// Create invalid file for error testing
	writeFileSync(path.join(outputDir, 'invalid-file.txt'), 'This is not a MIDI file');

	console.log('✅ Created test MIDI fixtures:');
	console.log('  📄 test-sample.mid (simple melody with 4 notes)');
	console.log('  📄 empty-sample.mid (no notes, metadata only)');
	console.log('  📄 multi-track-sample.mid (2 tracks with melody + bass)');
	console.log('  📄 invalid-file.txt (for error testing)\n');

	// Display file information
	const testFile = testMidi.build();
	const emptyFile = emptyMidi.build();
	const multiTrackFile = multiTrackMidi.build();

	console.log('📊 File sizes:');
	console.log(`  test-sample.mid: ${testFile.length} bytes`);
	console.log(`  empty-sample.mid: ${emptyFile.length} bytes`);
	console.log(`  multi-track-sample.mid: ${multiTrackFile.length} bytes`);
	console.log('\n🎯 All fixtures created successfully!');
}

// Run the script
createTestMidiFiles();
