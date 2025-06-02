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
	}
	measureLength = 1;
	notes: Array<{ noteID: string; position: number }> = [];
	parseNote = vi.fn();
}

// Mock the UploadedAssetFiles component to avoid Svelte file loading issues
export const UploadedAssetFiles = vi.fn().mockImplementation(() => ({
	// Mock component implementation
	uploadSelectedFiles: vi.fn().mockResolvedValue(undefined)
}));
