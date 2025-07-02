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
}

export class SoundChip {
	constructor() {}
}

export class LaneMeasureNote {
	constructor(
		public measure: number,
		public laneID: string,
		public pattern: string
	) {
		this.measureLength = 1;
		this.notes = [];
		this.parseNote(); // Call parseNote on construction like the real class
	}
	measureLength = 1;
	notes: Array<{ noteID: string; position: number }> = [];

	parseNote() {
		// Implement real parsing logic for tests
		this.notes = [];
		const patternLength = this.pattern.length / 2; // Each note is 2 characters

		for (let i = 0; i < patternLength; i++) {
			const noteIndex = i * 2;
			const noteID = this.pattern.substring(noteIndex, noteIndex + 2);

			if (noteID !== '00') {
				const position = i / 48; // Convert index to fractional position
				this.notes.push({ noteID, position });
			}
		}
	}
}

// Mock the normalizePosition utility function
export const normalizePosition = vi.fn();

// UploadedAssetFiles component is now exported from @dtx/common/components
// This mock is no longer needed here since the component is in a separate export
