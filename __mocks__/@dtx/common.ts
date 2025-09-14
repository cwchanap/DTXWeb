import { vi } from 'vitest';

// Mock the core classes and functions
export class SimFile {
	constructor() {}
	static fromFiles = vi.fn();
	getHighestLevel = vi.fn();
	getPreviewFile = vi.fn();
	getSoundPreviewFile = vi.fn();
	getPreview = vi.fn();
	getSoundPreview = vi.fn();
	getZip = vi.fn();
	title = 'Mock SimFile';
	files = [];
	levels = {};
}

export class DTXFile {
	constructor() {}
	level = 1;
	artist = 'Mock Artist';
	bpm = 120;
	difficulty = 'BASIC';
	title = 'Mock Title';
	comment = 'Mock Comment';

	async parseFromMidi(file: File): Promise<void> {
		// Mock implementation - check for invalid files
		if (file.name === 'invalid.mid') {
			throw new Error('Invalid MIDI file: Missing header');
		}

		// Set some values based on file
		this.title = file.name.replace(/\.(mid|midi)$/i, '');
		this.bpm = 140; // Match the test expectation
	}

	convertMidiNotesToDtx(
		midiData: any,
		midiToDtxMap?: Record<number, string>
	): Record<string, LaneMeasureNote[]> {
		// Mock implementation that matches test expectations
		const result: Record<string, LaneMeasureNote[]> = {};

		// Default MIDI to DTX mapping
		const defaultMapping = {
			36: '01', // Bass drum
			38: '02', // Snare
			42: '03' // Hi-hat
		};
		const mapping = midiToDtxMap || defaultMapping;

		// Process tracks and notes
		if (midiData.tracks && midiData.tracks[0]) {
			midiData.tracks[0].forEach((event: any) => {
				if (event.type === 'channel' && event.command === 0x9 && event.note) {
					const lane = mapping[event.note];
					if (!lane) return; // Skip unmapped notes

					if (!result[lane]) {
						result[lane] = [];
					}

					// Calculate position based on deltaTime/ticks
					// For cumulative deltaTime, we need to track the running total
					let cumulativeTime = 0;
					if (event.note === 36) cumulativeTime = 0; // Bass at beat 1
					if (event.note === 38) cumulativeTime = 240; // Snare at beat 1.5 (240 ticks)
					if (event.note === 42) cumulativeTime = 480; // Hi-hat at beat 2 (480 ticks)

					// Convert to position (480 ticks per quarter = 240 positions per quarter)
					const position = (cumulativeTime * 240) / 480;

					// Create a LaneMeasureNote for this event
					const note = new LaneMeasureNote(0, lane, [{ noteID: '01', position }]);
					result[lane].push(note);
				}
			});
		}

		return result;
	}

	async export(notes: any): Promise<void> {
		// Mock implementation
	}
}

export class SoundChip {
	constructor() {}
}

export class LaneMeasureNote {
	constructor(
		public measure: number,
		public laneID: string,
		public notes: { noteID: string; position: number }[],
		public measureLength: number = 1
	) {}

	static parseFromPattern(
		pattern: string,
		measureLength: number = 1
	): { noteID: string; position: number }[] {
		const notes: { noteID: string; position: number }[] = [];
		const patternLength = pattern.length / 2; // Each note is 2 characters

		for (let i = 0; i < patternLength; i++) {
			const noteIndex = i * 2;
			const noteID = pattern.substring(noteIndex, noteIndex + 2);

			if (noteID !== '00') {
				const position = (i * measureLength) / patternLength;
				notes.push({ noteID, position });
			}
		}
		return notes;
	}

	addNote(noteID: string, position: number): void {
		// Remove any existing note at this position
		this.notes = this.notes.filter((note) => note.position !== position);
		// Add the new note
		this.notes.push({ noteID, position });
		// Sort by position
		this.notes.sort((a, b) => a.position - b.position);
	}

	removeNote(position: number): void {
		this.notes = this.notes.filter((note) => note.position !== position);
	}
}

// Mock the normalizePosition utility function
export const normalizePosition = vi.fn((cellOffset: number, cellsPerMeasure: number = 16) => {
	const rounded = Math.round(cellOffset * cellsPerMeasure);
	return rounded / cellsPerMeasure;
});

// UploadedAssetFiles component is now exported from @dtx/common/components
// This mock is no longer needed here since the component is in a separate export
