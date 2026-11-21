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
	constructor(_input?: any) {}
	level = 1;
	artist = 'Mock Artist';
	bpm = 120;
	difficulty = 'BASIC';
	title = 'Mock Title';
	comment = 'Mock Comment';
	detectedEncoding?: string;

	parse = vi.fn().mockResolvedValue(undefined);
	parseNotes = vi.fn().mockReturnValue([]);

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

// Mirror the real formatLevel/normalizeLevel from @dtx/common (utils/level.ts)
// so callers (e.g. web's formatLevelDisplay) exercise the actual decode contract
// in tests. Uses DTXManiaCX's canonical encoding:
//   level >= 100 → level / 100
//   level <  100 → level / 10 + levelDec / 100
export const normalizeLevel = (level: string | number | undefined | null, levelDec = 0): number => {
	const parsed = typeof level === 'string' ? parseFloat(level) : (level ?? 0);
	const n = Number.isFinite(parsed) ? parsed : 0;
	if (!Number.isInteger(n)) return n;
	return n >= 100 ? n / 100 : n / 10 + levelDec / 100;
};

export const formatLevel = (level: string | number | undefined | null): string =>
	normalizeLevel(level).toFixed(2);

export {
	laneToStaff,
	staffKey,
	PLAYABLE_DRUM_LANES,
	GM_IMPORT_LANE,
	type DrumStaff
} from '../../packages/common/src/lib/notation/drumMapping';
export { groupNotesByLane } from '../../packages/common/src/lib/notation/quantize';
// Same reason for the shared SMF parser and DTX<->MIDI converters — tool
// pages must exercise the real implementations in tests.
export {
	parseMidi,
	type MidiEvent,
	type MidiNote,
	type MidiTrack,
	type MidiTempoEvent,
	type MidiMeterEvent,
	type ParsedMidi
} from '../../packages/common/src/lib/midi/parser';
export {
	dtxToMidi,
	midiToDtx,
	MIDI_PPQ,
	type DtxToMidiResult,
	type MidiToDtxOptions,
	type MidiToDtxResult
} from '../../packages/common/src/lib/midi/convert';
export { DURATION_TABLE } from '../../packages/common/src/lib/notation/model';
// Re-export the real pure decoder so server routes importing it from the main
// barrel keep exercising actual BOM detection in tests.
export { decodeArrayBufferWithBomDetection } from '../../packages/common/src/lib/chart/encoding-utils';
// Same reason for the shared SET.def parser — server routes (e.g. the editor
// page load) must exercise the real implementation in tests.
export { parseSetDef } from '../../packages/common/src/lib/chart/setDef';
export { normalizeAudioReference } from '../../packages/common/src/lib/audio/reference';

// UploadedAssetFiles component is now exported from @dtx/common/components
// This mock is no longer needed here since the component is in a separate export
