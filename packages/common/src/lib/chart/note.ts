import { canonicalizeCellOffset, normalizePosition } from '../utils/position';

export class LaneMeasureNote {
	public measure: number;
	public laneID: string;
	public measureLength: number = 1;
	public notes: {
		noteID: string;
		position: number;
	}[] = [];

	constructor(
		measure: number,
		laneID: string,
		notes: { noteID: string; position: number }[],
		measureLength: number = 1
	) {
		this.measure = measure;
		this.laneID = laneID;
		this.notes = notes;
		this.measureLength = measureLength;
	}

	/**
	 * Normalize a position to prevent floating point precision issues
	 */
	private static normalizePosition(position: number, cellsPerMeasure: number): number {
		return normalizePosition(position, cellsPerMeasure);
	}

	/**
	 * Parse notes from a pattern string
	 */
	static parseFromPattern(
		pattern: string,
		measureLength: number = 1
	): { noteID: string; position: number }[] {
		const patterns = pattern.match(/.{1,2}/g);
		if (!patterns) return [];
		const patternCount = patterns.length;
		// Snap to the pattern's own cell spacing, not a fixed 192-slot grid:
		// snapping to 192 merges cells a widened toPattern() wrote to keep
		// off-grid notes distinct (e.g. cells 1 and 2 of a 384-cell pattern).
		const cellsPerMeasure = measureLength > 0 ? patternCount / measureLength : patternCount;

		return patterns
			.map((pattern, index) => {
				const position = (index * measureLength) / patternCount;
				const normalizedPosition = LaneMeasureNote.normalizePosition(
					position,
					cellsPerMeasure
				);
				// Editor note keys embed this value textually; a canonical
				// form keeps one key per logical position.
				return {
					noteID: pattern,
					position: canonicalizeCellOffset(normalizedPosition)
				};
			})
			.filter((note) => note.noteID !== '00');
	}

	/**
	 * Determine the subdivision level based on pattern length
	 */
	static getSubdivisionLevel(patternLength: number): number {
		// DTX patterns can have various lengths representing different subdivisions
		// 16 = 16th notes, 24 = 24th notes, 32 = 32nd notes, 48 = 48th notes, 64 = 64th notes
		if (patternLength <= 16) return 16;
		if (patternLength <= 24) return 24;
		if (patternLength <= 32) return 32;
		if (patternLength <= 48) return 48;
		if (patternLength <= 64) return 64;
		return Math.min(patternLength, 192); // Cap at 192 for extreme cases
	}

	/**
	 * Calculate the measure length multiplier based on subdivision level
	 */
	static getMeasureLengthMultiplier(subdivisionLevel: number): number {
		// Base subdivision is 16th notes
		return subdivisionLevel / 16;
	}

	/**
	 * Add a note to this measure
	 */
	addNote(noteID: string, position: number): void {
		// Remove any existing note at this position
		this.notes = this.notes.filter((note) => note.position !== position);
		// Add the new note
		this.notes.push({ noteID, position });
		// Sort by position
		this.notes.sort((a, b) => a.position - b.position);
	}

	/**
	 * Remove a note at the specified position
	 */
	removeNote(position: number): void {
		this.notes = this.notes.filter((note) => note.position !== position);
	}

	/**
	 * Convert notes back to DTX pattern string (reverse of parseFromPattern)
	 */
	toPattern(onWarning?: (message: string) => void): string {
		if (this.notes.length === 0) return '';

		// Determine the pattern resolution based on the most precise position
		// Include common subdivision levels: 4, 8, 12, 16, 24, 32, 48, 64, 96, 192.
		// 288 and 576 are the triplet-oriented grids that would otherwise be
		// rewritten onto the nearest power-of-two fallback (192/384/768),
		// shifting every hit on those grids by a fraction of a cell.
		const commonResolutions = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192, 288, 576];
		// Fall back to the finest grid: a coarse default collapses off-grid
		// notes (e.g. humanized MIDI) into shared slots and silently drops them.
		let resolution = 0;

		// Find the smallest resolution that can accommodate all note positions
		for (const res of commonResolutions) {
			const used = new Set<number>();
			let canAccommodateAll = true;
			for (const note of this.notes) {
				const pos = note.position / this.measureLength;
				const cell = Math.round(pos * res);
				// Check if this resolution can represent this position precisely
				if (Math.abs(pos * res - cell) >= 0.001) {
					canAccommodateAll = false;
					break;
				}
				used.add(cell);
			}
			// The tolerance alone can still merge distinct positions into one
			// cell (e.g. 0.5 and 0.5001 at res 4) and silently overwrite a hit —
			// a viable grid must give every note its own cell.
			if (canAccommodateAll && used.size === this.notes.length) {
				resolution = res;
				break; // Use the first (smallest) resolution that works for all notes
			}
		}

		// No standard grid holds every position (they sit finer than 1/192).
		// Widen until each note keeps its own cell rather than overwriting a
		// hit; capped so a pathological position can't allocate a huge string.
		if (resolution === 0) {
			resolution = 192;
			const distinctCells = (res: number): number => {
				const used = new Set<number>();
				for (const note of this.notes) {
					used.add(Math.round((note.position / this.measureLength) * res));
				}
				return used.size;
			};
			while (resolution < 768 && distinctCells(resolution) < this.notes.length) {
				resolution *= 2;
			}
			if (distinctCells(resolution) < this.notes.length) {
				(onWarning ?? console.warn)(
					`toPattern: ${this.notes.length - distinctCells(resolution)} note(s) share a cell at ${resolution}-cell resolution and overwrite earlier hits`
				);
			}
		}

		// Create pattern array filled with '00'
		const pattern = new Array(resolution).fill('00');

		// Place notes in the pattern. A position a hair under the bar end
		// rounds to index `resolution` and would otherwise vanish silently,
		// same as the shared-cell case above — count and report the drops.
		let dropped = 0;
		for (const note of this.notes) {
			const pos = note.position / this.measureLength;
			const index = Math.round(pos * resolution);
			if (index >= 0 && index < resolution) {
				pattern[index] = note.noteID;
			} else {
				dropped++;
			}
		}
		if (dropped > 0) {
			(onWarning ?? console.warn)(
				`toPattern: ${dropped} note(s) rounded outside the ${resolution}-cell grid and were dropped`
			);
		}

		return pattern.join('');
	}
}
