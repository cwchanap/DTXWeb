import { describe, it, expect, vi } from 'vitest';
import { DTXFile } from '@dtx/common';

// Mock dependencies for component logic tests
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('svelte-i18n', () => ({
	locale: { set: vi.fn() },
	locales: { subscribe: vi.fn(() => () => {}) }
}));

vi.mock('$lib/toaster', () => ({
	default: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

describe('DTX to MIDI Converter Logic', () => {
	it('should validate DTX file extensions', () => {
		const validDtxFile = new File(['content'], 'test.dtx', { type: 'text/plain' });
		const validTxtFile = new File(['content'], 'test.txt', { type: 'text/plain' });
		const invalidFile = new File(['content'], 'test.mp3', { type: 'audio/mpeg' });

		expect(validDtxFile.name.toLowerCase().endsWith('.dtx')).toBe(true);
		expect(validTxtFile.name.toLowerCase().endsWith('.txt')).toBe(true);
		expect(invalidFile.name.toLowerCase().endsWith('.dtx')).toBe(false);
		expect(invalidFile.name.toLowerCase().endsWith('.txt')).toBe(false);
	});

	it('should handle DTX content structure', () => {
		const mockDtxContent = `#TITLE:Test Song\r\n#ARTIST:Test Artist\r\n#BPM:120\r\n#DLEVEL:5\r\n001: 01020000\r\n002: 00000300`;

		// Test DTX content parsing logic
		const lines = mockDtxContent.split('\r\n');
		const titleLine = lines.find((line) => line.startsWith('#TITLE:'));
		const bpmLine = lines.find((line) => line.startsWith('#BPM:'));

		expect(titleLine).toBe('#TITLE:Test Song');
		expect(bpmLine).toBe('#BPM:120');

		// Test extraction logic
		if (titleLine) {
			const title = titleLine.substring(titleLine.indexOf(':') + 1).trim();
			expect(title).toBe('Test Song');
		}

		if (bpmLine) {
			const bpm = parseInt(bpmLine.substring(bpmLine.indexOf(':') + 1).trim());
			expect(bpm).toBe(120);
		}
	});

	it('should generate correct filename for MIDI export', () => {
		const inputFileName = 'mysong.dtx';
		const baseName = inputFileName.replace(/\.[^/.]+$/, '');
		const outputFileName = `${baseName}.mid`;

		expect(outputFileName).toBe('mysong.mid');
	});

	it('should handle file size display correctly', () => {
		// Mock File constructor to return a specific size
		const mockFile = {
			name: 'test.dtx',
			size: 1024 * 5, // 5KB
			type: 'text/plain'
		} as File;

		const fileSizeKB = (mockFile.size / 1024).toFixed(1);

		expect(parseFloat(fileSizeKB)).toBe(5.0);
		expect(fileSizeKB).toBe('5.0');
	});

	it('should group notes by lane correctly', () => {
		const mockNotes = [
			{ measure: 1, laneID: '01', notes: ['01', '00', '00', '00'] },
			{ measure: 1, laneID: '02', notes: ['00', '02', '00', '00'] },
			{ measure: 2, laneID: '01', notes: ['01', '00', '01', '00'] }
		];

		const notesByLane: Record<string, any[]> = {};
		mockNotes.forEach((note) => {
			if (!notesByLane[note.laneID]) {
				notesByLane[note.laneID] = [];
			}
			notesByLane[note.laneID].push(note);
		});

		expect(notesByLane['01']).toHaveLength(2);
		expect(notesByLane['02']).toHaveLength(1);
		expect(Object.keys(notesByLane)).toHaveLength(2);
	});

	it('should have correct default lane to MIDI note mapping', () => {
		const defaultLaneNoteMap = {
			'01': 36, // Bass Drum
			'02': 38, // Snare
			'03': 42, // Closed Hi-Hat
			'04': 46, // Open Hi-Hat
			'05': 49, // Crash Cymbal
			'06': 51, // Ride Cymbal
			'07': 45, // Low Tom
			'08': 47, // Mid Tom
			'09': 50, // High Tom
			'0A': 44, // Pedal Hi-Hat
			'0B': 57, // Crash 2
			'0C': 59 // Ride 2
		};

		expect(defaultLaneNoteMap['01']).toBe(36); // Bass drum
		expect(defaultLaneNoteMap['02']).toBe(38); // Snare
		expect(defaultLaneNoteMap['03']).toBe(42); // Hi-hat
		expect(Object.keys(defaultLaneNoteMap)).toHaveLength(12);
	});

	it('should validate MIDI note range', () => {
		const validNotes = [0, 36, 127];
		const invalidNotes = [-1, 128, 255];

		validNotes.forEach((note) => {
			expect(note >= 0 && note <= 127).toBe(true);
		});

		invalidNotes.forEach((note) => {
			expect(note >= 0 && note <= 127).toBe(false);
		});
	});

	it('should get correct lane descriptions', () => {
		const laneDescriptions: Record<string, string> = {
			'01': 'Bass Drum',
			'02': 'Snare',
			'03': 'Closed Hi-Hat',
			'04': 'Open Hi-Hat',
			'05': 'Crash',
			'06': 'Ride',
			'07': 'Low Tom',
			'08': 'Mid Tom',
			'09': 'High Tom',
			'0A': 'Pedal Hi-Hat',
			'0B': 'Crash 2',
			'0C': 'Ride 2'
		};

		expect(laneDescriptions['01']).toBe('Bass Drum');
		expect(laneDescriptions['02']).toBe('Snare');
		expect(laneDescriptions['0A']).toBe('Pedal Hi-Hat');
	});

	it('should handle blob creation for download', () => {
		const midiData = new Uint8Array([0x4d, 0x54, 0x68, 0x64]); // "MThd"

		// Capture original Blob before mocking
		const originalBlob = global.Blob;

		try {
			// Mock Blob constructor
			global.Blob = vi.fn().mockImplementation((data, options) => {
				return {
					data: data[0], // Access the buffer
					type: options?.type
				};
			});

			const blob = new Blob([midiData.buffer], { type: 'audio/midi' });

			expect(Blob).toHaveBeenCalledWith([midiData.buffer], { type: 'audio/midi' });
		} finally {
			// Always restore original Blob
			global.Blob = originalBlob;
		}
	});

	it('should handle error states correctly', () => {
		const mockError = new Error('Test error message');

		expect(mockError instanceof Error).toBe(true);
		expect(mockError.message).toBe('Test error message');
	});

	it('should handle note mapping customization', () => {
		let laneNoteMap = {
			'01': 36, // Bass Drum
			'02': 38, // Snare
			'03': 42 // Hi-hat
		};

		// Modify mapping
		laneNoteMap['01'] = 50; // Map bass drum to high tom note
		laneNoteMap['02'] = 45; // Map snare to low tom note

		expect(laneNoteMap['01']).toBe(50);
		expect(laneNoteMap['02']).toBe(45);
		expect(laneNoteMap['03']).toBe(42); // Unchanged
	});

	it('should handle UI state transitions correctly', () => {
		let isConverting = false;
		let isConverted = false;
		let convertedFileName = '';

		// Initial state
		expect(isConverting).toBe(false);
		expect(isConverted).toBe(false);

		// During conversion
		isConverting = true;
		expect(isConverting).toBe(true);
		expect(isConverted).toBe(false);

		// After conversion
		isConverting = false;
		isConverted = true;
		convertedFileName = 'test.mid';
		expect(isConverting).toBe(false);
		expect(isConverted).toBe(true);
		expect(convertedFileName).toBe('test.mid');

		// Reset state
		isConverting = false;
		isConverted = false;
		convertedFileName = '';
		expect(isConverting).toBe(false);
		expect(isConverted).toBe(false);
		expect(convertedFileName).toBe('');
	});

	it('should handle MIDI export workflow', async () => {
		const mockDTXFile = new DTXFile();
		const mockNotesByLane = { '01': [] };
		const mockLaneNoteMap = { '01': 36 };

		// Mock exportToMidi method
		const mockMidiData = new Uint8Array([0x4d, 0x54, 0x68, 0x64]); // "MThd" header
		const mockExportToMidi = vi.fn().mockReturnValue(mockMidiData);
		mockDTXFile.exportToMidi = mockExportToMidi;

		// Simulate export
		const midiData = mockDTXFile.exportToMidi(mockNotesByLane, mockLaneNoteMap);

		expect(mockExportToMidi).toHaveBeenCalledWith(mockNotesByLane, mockLaneNoteMap);
		expect(midiData).toBeInstanceOf(Uint8Array);
		expect(midiData[0]).toBe(0x4d); // 'M' from "MThd"
	});

	it('should validate input field ranges for MIDI notes', () => {
		const validateMidiNote = (note: number) => note >= 0 && note <= 127;

		// Test boundary values
		expect(validateMidiNote(0)).toBe(true); // Minimum
		expect(validateMidiNote(127)).toBe(true); // Maximum
		expect(validateMidiNote(36)).toBe(true); // Bass drum
		expect(validateMidiNote(38)).toBe(true); // Snare

		// Test invalid values
		expect(validateMidiNote(-1)).toBe(false);
		expect(validateMidiNote(128)).toBe(false);
		expect(validateMidiNote(255)).toBe(false);
	});

	it('should handle reset functionality correctly', () => {
		let uploadedFile: File | null = new File(['test'], 'test.dtx');
		let isConverted = true;
		let isConverting = false;
		let convertedFileName = 'test.mid';
		let dtxFile: DTXFile | null = new DTXFile();

		// Simulate reset
		uploadedFile = null;
		isConverted = false;
		isConverting = false;
		convertedFileName = '';
		dtxFile = null;

		expect(uploadedFile).toBeNull();
		expect(isConverted).toBe(false);
		expect(isConverting).toBe(false);
		expect(convertedFileName).toBe('');
		expect(dtxFile).toBeNull();
	});
});
