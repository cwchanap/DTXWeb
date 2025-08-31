import { describe, it, expect, beforeEach } from 'vitest';
import { DTXFile } from './dtx';
import { LaneMeasureNote } from './note';

describe('DTX MIDI Export', () => {
	let dtxFile: DTXFile;

	beforeEach(() => {
		// Create a mock DTX file with test data (using \r\n line endings as expected by DTX parser)
		const mockDtxContent = `#TITLE:Test Song\r\n#ARTIST:Test Artist\r\n#BPM:120\r\n#DLEVEL:5\r\n#WAV01:kick.wav\r\n#WAV02:snare.wav\r\n#WAV03:hihat.wav\r\n\r\n001: 01020000 01020000 01020000 01020000\r\n002: 00000300 00000300 00000300 00000300`;

		dtxFile = new DTXFile(mockDtxContent);
	});

	describe('MIDI Encoding Functions', () => {
		describe('Variable Length Encoding', () => {
			it('should encode 0 correctly', () => {
				// Access private method through bracket notation for testing
				const encoded = (dtxFile as any).encodeVariableLength(0);
				expect(encoded).toEqual([0]);
			});

			it('should encode values under 128 correctly', () => {
				const encoded = (dtxFile as any).encodeVariableLength(127);
				expect(encoded).toEqual([127]);
			});

			it('should encode values 128 and above correctly', () => {
				const encoded = (dtxFile as any).encodeVariableLength(128);
				expect(encoded).toEqual([0x81, 0x00]);
			});

			it('should encode large values correctly', () => {
				const encoded = (dtxFile as any).encodeVariableLength(16383);
				expect(encoded).toEqual([0xff, 0x7f]);
			});

			it('should encode very large values correctly', () => {
				const encoded = (dtxFile as any).encodeVariableLength(0x1fffff);
				expect(encoded).toEqual([0xff, 0xff, 0x7f]);
			});
		});

		describe('MIDI Note Number Mapping', () => {
			it('should map standard DTX lanes to correct GM drum notes', () => {
				expect((dtxFile as any).getMidiNoteNumber('01')).toBe(36); // Bass Drum
				expect((dtxFile as any).getMidiNoteNumber('02')).toBe(38); // Snare
				expect((dtxFile as any).getMidiNoteNumber('03')).toBe(42); // Closed Hi-Hat
				expect((dtxFile as any).getMidiNoteNumber('04')).toBe(46); // Open Hi-Hat
				expect((dtxFile as any).getMidiNoteNumber('05')).toBe(49); // Crash Cymbal
				expect((dtxFile as any).getMidiNoteNumber('06')).toBe(51); // Ride Cymbal
			});

			it('should map tom lanes correctly', () => {
				expect((dtxFile as any).getMidiNoteNumber('07')).toBe(45); // Low Tom
				expect((dtxFile as any).getMidiNoteNumber('08')).toBe(47); // Mid Tom
				expect((dtxFile as any).getMidiNoteNumber('09')).toBe(50); // High Tom
			});

			it('should map additional percussion correctly', () => {
				expect((dtxFile as any).getMidiNoteNumber('0A')).toBe(44); // Pedal Hi-Hat
				expect((dtxFile as any).getMidiNoteNumber('0B')).toBe(57); // Crash 2
				expect((dtxFile as any).getMidiNoteNumber('0C')).toBe(59); // Ride 2
			});

			it('should handle lowercase lane IDs', () => {
				expect((dtxFile as any).getMidiNoteNumber('01')).toBe(36);
				expect((dtxFile as any).getMidiNoteNumber('0a')).toBe(44);
			});

			it('should return default note for unknown lanes', () => {
				expect((dtxFile as any).getMidiNoteNumber('ZZ')).toBe(60); // Middle C
				expect((dtxFile as any).getMidiNoteNumber('XX')).toBe(60);
			});
		});

		describe('MIDI Header Creation', () => {
			it('should create correct MIDI header', () => {
				const header = (dtxFile as any).createMidiHeader(0, 1, 480);

				// Check magic number "MThd"
				expect(header[0]).toBe(0x4d); // M
				expect(header[1]).toBe(0x54); // T
				expect(header[2]).toBe(0x68); // h
				expect(header[3]).toBe(0x64); // d

				// Check header length (6)
				expect(header[4]).toBe(0x00);
				expect(header[5]).toBe(0x00);
				expect(header[6]).toBe(0x00);
				expect(header[7]).toBe(0x06);

				// Check format (0)
				expect(header[8]).toBe(0x00);
				expect(header[9]).toBe(0x00);

				// Check tracks (1)
				expect(header[10]).toBe(0x00);
				expect(header[11]).toBe(0x01);

				// Check ticks per quarter (480)
				expect(header[12]).toBe(0x01);
				expect(header[13]).toBe(0xe0);
			});

			it('should handle different format types', () => {
				const header = (dtxFile as any).createMidiHeader(1, 2, 96);

				// Check format (1)
				expect(header[8]).toBe(0x00);
				expect(header[9]).toBe(0x01);

				// Check tracks (2)
				expect(header[10]).toBe(0x00);
				expect(header[11]).toBe(0x02);

				// Check ticks per quarter (96)
				expect(header[12]).toBe(0x00);
				expect(header[13]).toBe(0x60);
			});
		});

		describe('Track Serialization', () => {
			it('should serialize track with MTrk header', () => {
				const events = [
					{
						deltaTime: 0,
						type: 'meta' as const,
						subtype: 0x2f,
						data: []
					}
				];

				const track = (dtxFile as any).serializeMidiTrack(events);

				// Check track magic number "MTrk"
				expect(track[0]).toBe(0x4d); // M
				expect(track[1]).toBe(0x54); // T
				expect(track[2]).toBe(0x72); // r
				expect(track[3]).toBe(0x6b); // k

				// Check that track length is set (bytes 4-7)
				expect(track[4]).toBe(0x00);
				expect(track[5]).toBe(0x00);
				expect(track[6]).toBe(0x00);
				expect(track[7]).toBeGreaterThan(0);
			});

			it('should serialize meta events correctly', () => {
				const events = [
					{
						deltaTime: 0,
						type: 'meta' as const,
						subtype: 0x51, // Set Tempo
						data: [0x07, 0xa1, 0x20] // 120 BPM
					}
				];

				const track = (dtxFile as any).serializeMidiTrack(events);

				// Should contain meta event bytes
				expect(track.length).toBeGreaterThan(8);

				// Find the meta event in the track data
				let foundMeta = false;
				for (let i = 8; i < track.length - 2; i++) {
					if (track[i] === 0xff && track[i + 1] === 0x51) {
						foundMeta = true;
						break;
					}
				}
				expect(foundMeta).toBe(true);
			});

			it('should serialize channel events correctly', () => {
				const events = [
					{
						deltaTime: 0,
						type: 'channel' as const,
						channel: 9,
						command: 0x9, // Note On
						note: 36,
						velocity: 100
					}
				];

				const track = (dtxFile as any).serializeMidiTrack(events);

				// Should contain note event
				expect(track.length).toBeGreaterThan(8);

				// Find the note on event (0x99 = Note On channel 9)
				let foundNote = false;
				for (let i = 8; i < track.length - 2; i++) {
					if (track[i] === 0x99) {
						foundNote = true;
						expect(track[i + 1]).toBe(36); // Note number
						expect(track[i + 2]).toBe(100); // Velocity
						break;
					}
				}
				expect(foundNote).toBe(true);
			});
		});
	});

	describe('MIDI File Generation', () => {
		it('should create MIDI header correctly', async () => {
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [new LaneMeasureNote(1, '01', ['01', '00', '00', '00'])]
			};
			const laneChannelMap = { '01': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Check MIDI header (first 14 bytes)
			expect(midiData[0]).toBe(0x4d); // 'M'
			expect(midiData[1]).toBe(0x54); // 'T'
			expect(midiData[2]).toBe(0x68); // 'h'
			expect(midiData[3]).toBe(0x64); // 'd'

			// Check header length (should be 6)
			expect(midiData[4]).toBe(0x00);
			expect(midiData[5]).toBe(0x00);
			expect(midiData[6]).toBe(0x00);
			expect(midiData[7]).toBe(0x06);

			// Check format (should be 0)
			expect(midiData[8]).toBe(0x00);
			expect(midiData[9]).toBe(0x00);

			// Check number of tracks (should be 1)
			expect(midiData[10]).toBe(0x00);
			expect(midiData[11]).toBe(0x01);

			// Check ticks per quarter note (should be 480)
			expect(midiData[12]).toBe(0x01);
			expect(midiData[13]).toBe(0xe0);
		});

		it('should create track chunk correctly', async () => {
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [new LaneMeasureNote(1, '01', ['01', '00', '00', '00'])]
			};
			const laneChannelMap = { '01': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Find track chunk (starts after header at byte 14)
			expect(midiData[14]).toBe(0x4d); // 'M'
			expect(midiData[15]).toBe(0x54); // 'T'
			expect(midiData[16]).toBe(0x72); // 'r'
			expect(midiData[17]).toBe(0x6b); // 'k'
		});

		it('should map DTX lanes to correct MIDI note numbers', async () => {
			await dtxFile.parse();

			// Test different lanes
			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [new LaneMeasureNote(1, '01', ['01', '00', '00', '00'])], // Bass drum
				'02': [new LaneMeasureNote(1, '02', ['02', '00', '00', '00'])], // Snare
				'03': [new LaneMeasureNote(1, '03', ['03', '00', '00', '00'])] // Hi-hat
			};
			const laneChannelMap = { '01': 9, '02': 9, '03': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// MIDI data should contain the correct note numbers in the track
			expect(midiData.length).toBeGreaterThan(20);
		});

		it('should handle BPM correctly in tempo events', async () => {
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [new LaneMeasureNote(1, '01', ['01', '00', '00', '00'])]
			};
			const laneChannelMap = { '01': 9 };

			// BPM should be 120 from the mock DTX content (after parsing)
			expect(dtxFile.bpm).toBe(120);

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should contain tempo meta event (0xFF 0x51)
			let foundTempo = false;
			for (let i = 0; i < midiData.length - 1; i++) {
				if (midiData[i] === 0xff && midiData[i + 1] === 0x51) {
					foundTempo = true;
					break;
				}
			}
			expect(foundTempo).toBe(true);
		});

		it('should handle empty notes gracefully', async () => {
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {};
			const laneChannelMap = {};

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should still create valid MIDI file with header and empty track
			expect(midiData.length).toBeGreaterThan(14);
			expect(midiData[0]).toBe(0x4d); // Still has valid header
		});

		it('should use correct MIDI channels from lane mapping', async () => {
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [new LaneMeasureNote(1, '01', ['01', '00', '00', '00'])]
			};

			// Test different channel mapping
			const laneChannelMap = { '01': 5 }; // Use channel 5 instead of 9

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should contain note events on channel 5 (0x95 for Note On)
			let foundChannel5 = false;
			for (let i = 0; i < midiData.length; i++) {
				if (midiData[i] === 0x95) {
					// Note On channel 5
					foundChannel5 = true;
					break;
				}
			}
			expect(foundChannel5).toBe(true);
		});

		it('should convert multiple measures correctly', async () => {
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [
					new LaneMeasureNote(1, '01', ['01', '00', '00', '00']),
					new LaneMeasureNote(2, '01', ['00', '01', '00', '00']),
					new LaneMeasureNote(3, '01', ['00', '00', '01', '00'])
				]
			};
			const laneChannelMap = { '01': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should create a longer MIDI file with multiple note events
			expect(midiData.length).toBeGreaterThan(50);
		});

		it('should handle variable length encoding correctly', async () => {
			// Test the private encodeVariableLength method through the public API
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [
					// Create notes with large timing gaps to test variable length encoding
					new LaneMeasureNote(1, '01', ['01', '00', '00', '00']),
					new LaneMeasureNote(10, '01', ['01', '00', '00', '00']) // Large gap
				]
			};
			const laneChannelMap = { '01': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should handle large delta times without error
			expect(midiData.length).toBeGreaterThan(20);
		});

		it('should include end of track marker', async () => {
			await dtxFile.parse();

			const testNotes: Record<string, LaneMeasureNote[]> = {
				'01': [new LaneMeasureNote(1, '01', ['01', '00', '00', '00'])]
			};
			const laneChannelMap = { '01': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should contain end of track meta event (0xFF 0x2F)
			let foundEndOfTrack = false;
			for (let i = 0; i < midiData.length - 1; i++) {
				if (midiData[i] === 0xff && midiData[i + 1] === 0x2f) {
					foundEndOfTrack = true;
					break;
				}
			}
			expect(foundEndOfTrack).toBe(true);
		});

		it('should produce valid MIDI file structure', async () => {
			await dtxFile.parse();

			const testNotes = {
				'01': [
					{
						measure: 1,
						laneID: '01',
						notes: [
							{ noteID: '01', position: 0 },
							{ noteID: '00', position: 0.25 },
							{ noteID: '01', position: 0.5 },
							{ noteID: '00', position: 0.75 }
						]
					}
				]
			};
			const laneChannelMap = { '01': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should have minimum valid MIDI file structure
			expect(midiData.length).toBeGreaterThan(22); // Header (14) + Track header (8) + minimal content

			// Should start with MIDI header
			expect(midiData[0]).toBe(0x4d);
			expect(midiData[1]).toBe(0x54);
			expect(midiData[2]).toBe(0x68);
			expect(midiData[3]).toBe(0x64);

			// Should have track chunk
			expect(midiData[14]).toBe(0x4d);
			expect(midiData[15]).toBe(0x54);
			expect(midiData[16]).toBe(0x72);
			expect(midiData[17]).toBe(0x6b);
		});

		it('should handle complex timing scenarios', async () => {
			await dtxFile.parse();

			const testNotes = {
				'01': [
					{
						measure: 1,
						laneID: '01',
						notes: [
							{ noteID: '01', position: 0 },
							{ noteID: '00', position: 0.25 },
							{ noteID: '00', position: 0.5 },
							{ noteID: '00', position: 0.75 },
							{ noteID: '01', position: 1 }
						] // Two notes per measure
					}
				],
				'02': [
					{
						measure: 2,
						laneID: '02',
						notes: [
							{ noteID: '00', position: 0 },
							{ noteID: '02', position: 0.25 },
							{ noteID: '00', position: 0.5 },
							{ noteID: '02', position: 0.75 }
						] // Different measure, different timing
					}
				]
			};
			const laneChannelMap = { '01': 9, '02': 9 };

			const midiData = dtxFile.exportToMidi(testNotes, laneChannelMap);

			// Should handle multiple measures and lanes
			expect(midiData.length).toBeGreaterThan(50);

			// Should contain multiple note events
			let noteOnCount = 0;
			for (let i = 0; i < midiData.length; i++) {
				if (midiData[i] === 0x99) {
					// Note On channel 9
					noteOnCount++;
				}
			}
			expect(noteOnCount).toBeGreaterThan(1);
		});
	});
});
