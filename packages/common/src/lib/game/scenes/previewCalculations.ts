import type { LaneMeasureNote } from '../../chart/note';

// Mirrors Preview.bpmNoteID. Duplicated here (rather than imported from Preview.ts)
// to keep this module Phaser-free and avoid a circular import with Preview.ts.
const BPM_NOTE_ID = '08';

export interface PreviewCalculationsHashInput {
	bpm: number;
	measureCount: number;
	measureLength: number[];
	bpmNotes: Record<string, number>;
}

export interface PreviewCalculationsData {
	bpm: number;
	notes: Record<string, LaneMeasureNote[]>;
	bpmNotes: Record<string, number>;
	measureCount: number;
	measureLength: number[];
}

export interface PreviewCalculationsConfig extends PreviewCalculationsData {
	cellHeight: number;
	cellsPerMeasure: number;
}

/**
 * Generate a hash of the data that affects timing/measure calculations,
 * used to detect when the performance caches need to be invalidated.
 */
export function generateDataHash(data: PreviewCalculationsHashInput): string {
	return JSON.stringify({
		bpm: data.bpm,
		measureCount: data.measureCount,
		measureLength: data.measureLength,
		bpmNotes: data.bpmNotes
	});
}

/**
 * Phaser-free timing/measure-offset calculations extracted from Preview.
 * Holds its own copy of the chart data, refreshed explicitly via update()
 * (mirroring the sync points Preview.ts already had: init() and updateData()).
 */
export class PreviewCalculations {
	private bpm: number;
	private notes: Record<string, LaneMeasureNote[]>;
	private bpmNotes: Record<string, number>;
	private measureCount: number;
	private measureLength: number[];
	private readonly cellHeight: number;
	private readonly cellsPerMeasure: number;

	// Performance caches for expensive calculations
	private timeElapsedCache = new Map<number, number>();
	private measureOffsetCache = new Map<number, number>();
	private lastDataHash = '';

	constructor(config: PreviewCalculationsConfig) {
		this.bpm = config.bpm;
		this.notes = config.notes;
		this.bpmNotes = config.bpmNotes;
		this.measureCount = config.measureCount;
		this.measureLength = config.measureLength;
		this.cellHeight = config.cellHeight;
		this.cellsPerMeasure = config.cellsPerMeasure;
	}

	/**
	 * Refresh the chart data used for calculations and invalidate the caches.
	 * Mirrors the data-refresh portion of Preview.updateData().
	 */
	update(data: PreviewCalculationsData): void {
		this.bpm = data.bpm;
		this.notes = data.notes;
		this.bpmNotes = data.bpmNotes;
		this.measureCount = data.measureCount;
		this.measureLength = data.measureLength;
		this.invalidate();
	}

	/**
	 * Invalidate performance caches when data changes
	 */
	invalidate(): void {
		this.timeElapsedCache.clear();
		this.measureOffsetCache.clear();
		this.lastDataHash = '';
	}

	/**
	 * Validate cache and update if needed
	 */
	private validateCache(): void {
		const currentHash = this.generateDataHash();
		if (this.lastDataHash !== currentHash) {
			this.invalidate();
			this.lastDataHash = currentHash;
		}
	}

	generateDataHash(): string {
		return generateDataHash({
			bpm: this.bpm,
			measureCount: this.measureCount,
			measureLength: this.measureLength,
			bpmNotes: this.bpmNotes
		});
	}

	getTimeElapsed(measure: number, noteChipPosition: number = 0): number {
		this.validateCache();

		// Use cache for measure-level calculations (when noteChipPosition is 0)
		if (noteChipPosition === 0) {
			const cached = this.timeElapsedCache.get(measure);
			if (cached !== undefined) {
				return cached;
			}
		}

		let elapsedTime = 0;
		let currentBPM = this.bpm;

		// Calculate time for completed measures (up to but not including the current measure)
		for (let i = 0; i < measure; i++) {
			const measureLength = this.measureLength[i] || 1;
			const bpmNotes = this.notes[BPM_NOTE_ID]?.filter((note) => note.measure === i) || [];
			if (bpmNotes.length === 0) {
				// No BPM changes in this measure, use the current BPM for the whole measure
				elapsedTime += (60 / currentBPM) * 4 * measureLength;
			} else {
				// Calculate time for each segment within the measure
				let lastPosition = 0;
				bpmNotes.forEach((bpmNote) => {
					// Set the measureLength for the note
					if (bpmNote.measureLength === 1) {
						bpmNote.measureLength = measureLength;
					}
					bpmNote.notes.forEach((note: { noteID: string; position: number }) => {
						const position = note.position;
						elapsedTime +=
							(60 / currentBPM) * 4 * (position - lastPosition) * measureLength;
						currentBPM = this.bpmNotes[note.noteID];
						lastPosition = position;
					});
				});
				// Add the remaining time in the measure after the last BPM change
				elapsedTime += (60 / currentBPM) * 4 * (1 - lastPosition) * measureLength;
			}
		}

		// Calculate time within the current measure up to the noteChipPosition
		if (noteChipPosition > 0) {
			const measureLength = this.measureLength[measure] || 1;
			const bpmNotes =
				this.notes[BPM_NOTE_ID]?.filter((note) => note.measure === measure) || [];

			if (bpmNotes.length === 0) {
				// No BPM changes in this measure
				elapsedTime += (60 / currentBPM) * 4 * noteChipPosition;
			} else {
				// Calculate time for each segment within the measure up to noteChipPosition
				let lastPosition = 0;
				bpmNotes.forEach((bpmNote) => {
					// Set the measureLength for the note
					if (bpmNote.measureLength === 1) {
						bpmNote.measureLength = measureLength;
					}
					bpmNote.notes.forEach((note: { noteID: string; position: number }) => {
						const position = note.position;
						if (position > noteChipPosition) {
							// Past the noteChipPosition, stop calculating
							return;
						}
						const noteId = note.noteID;
						if (noteId !== '00') {
							elapsedTime += (60 / currentBPM) * 4 * (position - lastPosition);
							currentBPM = this.bpmNotes[noteId];
							lastPosition = position;
						}
					});
				});

				// Add time from last BPM change to noteChipPosition
				if (noteChipPosition > lastPosition) {
					elapsedTime += (60 / currentBPM) * 4 * (noteChipPosition - lastPosition);
				}
			}
		}

		// Cache the result for measure-level calculations (when noteChipPosition is 0)
		if (noteChipPosition === 0) {
			this.timeElapsedCache.set(measure, elapsedTime);
		}

		return elapsedTime;
	}

	getCellHeight(measure: number, cell: number): number {
		// For given measure and cell, calculate the height of the cell based on the BPM
		const referenceBPM = 120;

		// Find all BPM notes that apply to this measure
		const measureBpmNotes = this.notes[BPM_NOTE_ID]?.filter(
			(note) => note.measure <= measure
		).sort((a, b) => {
			// Sort by measure (ascending)
			if (a.measure !== b.measure) return a.measure - b.measure;
			// For notes in the same measure, we'll handle them later
			return 0;
		});

		if (!measureBpmNotes || measureBpmNotes.length === 0) {
			// No BPM changes, use the default BPM
			return (this.cellHeight / this.bpm) * referenceBPM;
		}

		// Find the most recent BPM change before or at our current cell position
		const lastBpmNote = measureBpmNotes[measureBpmNotes.length - 1];
		let currentBPM = this.bpm; // Default to the initial BPM

		if (lastBpmNote.measure < measure) {
			// BPM change in a previous measure, need to find the last BPM in that measure
			const bpmNotes = lastBpmNote.notes;

			// Find the last BPM change in the notes array
			for (const note of bpmNotes) {
				if (note.noteID !== '00') {
					currentBPM = this.bpmNotes[note.noteID];
				}
			}
		} else if (lastBpmNote.measure === measure) {
			// BPM change in the current measure
			const bpmNotes = lastBpmNote.notes;

			// Find the last BPM change before or at our cell position
			for (const note of bpmNotes) {
				const cellPosition = Math.floor(note.position * this.cellsPerMeasure);
				if (cellPosition > cell) {
					break; // This BPM change is after our current cell
				}

				if (note.noteID !== '00') {
					currentBPM = this.bpmNotes[note.noteID];
				}
			}
		}

		// Calculate the adjusted cell height based on the BPM
		// Slower BPM = taller cells, faster BPM = shorter cells
		return (this.cellHeight / currentBPM) * referenceBPM;
	}

	/**
	 * Wraps a Phaser-dependent measure-offset computation with caching.
	 * `compute` is expected to be `super.getTotalMesaureOffest(measure)`.
	 */
	getCachedMeasureOffset(measure: number, compute: () => number): number {
		this.validateCache();

		const cached = this.measureOffsetCache.get(measure);
		if (cached !== undefined) {
			return cached;
		}

		const result = compute();
		this.measureOffsetCache.set(measure, result);
		return result;
	}
}
