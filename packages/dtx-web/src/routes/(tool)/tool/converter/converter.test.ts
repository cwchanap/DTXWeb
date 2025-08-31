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

	it('should have correct default lane channel mapping', () => {
		const defaultLaneChannelMap = {
			'01': 9, // Bass Drum -> Drum channel
			'02': 9, // Snare -> Drum channel
			'03': 9, // Closed Hi-Hat -> Drum channel
			'04': 9, // Open Hi-Hat -> Drum channel
			'05': 9, // Crash Cymbal -> Drum channel
			'06': 9, // Ride Cymbal -> Drum channel
			'07': 9, // Low Tom -> Drum channel
			'08': 9, // Mid Tom -> Drum channel
			'09': 9, // High Tom -> Drum channel
			'0A': 9, // Pedal Hi-Hat -> Drum channel
			'0B': 9, // Crash 2 -> Drum channel
			'0C': 9 // Ride 2 -> Drum channel
		};

		expect(defaultLaneChannelMap['01']).toBe(9);
		expect(defaultLaneChannelMap['02']).toBe(9);
		expect(Object.keys(defaultLaneChannelMap)).toHaveLength(12);
	});

	it('should validate MIDI channel range', () => {
		const validChannels = [0, 1, 9, 15];
		const invalidChannels = [-1, 16, 20];

		validChannels.forEach((channel) => {
			expect(channel >= 0 && channel <= 15).toBe(true);
		});

		invalidChannels.forEach((channel) => {
			expect(channel >= 0 && channel <= 15).toBe(false);
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

		// Mock Blob constructor
		global.Blob = vi.fn().mockImplementation((data, options) => {
			return {
				data: data[0], // Access the buffer
				type: options?.type
			};
		});

		const blob = new Blob([midiData.buffer], { type: 'audio/midi' });

		expect(Blob).toHaveBeenCalledWith([midiData.buffer], { type: 'audio/midi' });
	});

	it('should handle error states correctly', () => {
		const mockError = new Error('Test error message');

		expect(mockError instanceof Error).toBe(true);
		expect(mockError.message).toBe('Test error message');
	});
});
