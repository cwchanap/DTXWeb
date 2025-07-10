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
		public notes: { noteID: string; position: number }[],
		public measureLength: number = 1
	) {
		this.measure = measure;
		this.laneID = laneID;
		this.notes = notes;
		this.measureLength = measureLength;
	}

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
