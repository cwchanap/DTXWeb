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
		// 288/576 are the triplet-oriented grids and 384/768 the widened
		// power-of-two grids toPattern() itself emits — without them an
		// exact-resolution search misses the grid a chart already sits on
		// and the fallback rewrites untouched hits by a fraction of a cell.
		const commonResolutions = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192, 288, 384, 576, 768];
		// Fall back to the finest grid: a coarse default collapses off-grid
		// notes (e.g. humanized MIDI) into shared slots and silently drops them.
		let resolution = 0;

		const canAccommodate = (res: number): boolean => {
			const used = new Set<number>();
			for (const note of this.notes) {
				const pos = note.position / this.measureLength;
				const cell = Math.round(pos * res);
				// Check if this resolution can represent this position precisely
				if (Math.abs(pos * res - cell) >= 0.001) return false;
				used.add(cell);
			}
			// The tolerance alone can still merge distinct positions into one
			// cell (e.g. 0.5 and 0.5001 at res 4) and silently overwrite a hit —
			// a viable grid must give every note its own cell.
			return used.size === this.notes.length;
		};

		// Find the smallest standard resolution that can accommodate all note positions
		for (const res of commonResolutions) {
			if (canAccommodate(res)) {
				resolution = res;
				break; // Use the first (smallest) standard resolution that works
			}
		}

		// DTX patterns are not limited to power-of-two/triplet grids: parsed
		// quintuplet, septuplet and other arbitrary cell counts must round-trip
		// instead of being nudged onto the 192 fallback. Positions are stored as
		// floating-point bar fractions, so recover each small rational denominator
		// within canonicalization error and try the LCM grid before widening.
		if (resolution === 0) {
			const denominatorOf = (position: number): number | undefined => {
				for (let denominator = 1; denominator <= 768; denominator++) {
					const scaled = position * denominator;
					if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return denominator;
				}
				return undefined;
			};
			const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
			let lcm = 1;
			let exactGrid = true;
			for (const note of this.notes) {
				const denominator = denominatorOf(note.position / this.measureLength);
				if (denominator === undefined) {
					exactGrid = false;
					break;
				}
				lcm = (lcm * denominator) / gcd(lcm, denominator);
				if (lcm > 768) {
					exactGrid = false;
					break;
				}
			}
			if (exactGrid && lcm > 0 && canAccommodate(lcm)) resolution = lcm;
		}

		// No standard or exact rational grid holds every position (they sit finer than 1/192).
		// Widen until each note keeps its own valid cell rather than dropping
		// or overwriting a hit; capped so a pathological position can't allocate
		// a huge string.
		if (resolution === 0) {
			resolution = 192;
			const inspectGrid = (
				res: number
			): { allInRange: boolean; distinctCount: number; inRangeCount: number } => {
				const used = new Set<number>();
				let allInRange = true;
				let inRangeCount = 0;
				for (const note of this.notes) {
					const index = Math.round((note.position / this.measureLength) * res);
					if (index >= 0 && index < res) {
						used.add(index);
						inRangeCount++;
					} else {
						allInRange = false;
					}
				}
				return { allInRange, distinctCount: used.size, inRangeCount };
			};
			const preservesAll = (res: number): boolean => {
				const stats = inspectGrid(res);
				return stats.allInRange && stats.distinctCount === this.notes.length;
			};
			while (resolution < 768 && !preservesAll(resolution)) {
				resolution *= 2;
			}
			// If doubling missed triplet-subdivided hits (e.g. 3/4096 and 4/4096),
			// try the remaining supported triplet grids before warning.
			if (!preservesAll(resolution)) {
				for (const tripletRes of [288, 576]) {
					if (preservesAll(tripletRes)) {
						resolution = tripletRes;
						break;
					}
				}
			}
			if (!preservesAll(resolution)) {
				// No supported grid keeps every hit distinct and in range —
				// export on the grid that preserves the most hits, not the
				// finest by default. Rounding to nearest is not monotonic in
				// resolution (768 can merge hits a coarser grid keeps apart),
				// so the candidate set is scored, not just widened. Prefer the
				// finer grid on a tie for fidelity.
				let bestDistinct = -1;
				for (const res of [192, 384, 768, 288, 576]) {
					const stats = inspectGrid(res);
					if (
						stats.distinctCount > bestDistinct ||
						(stats.distinctCount === bestDistinct && res > resolution)
					) {
						resolution = res;
						bestDistinct = stats.distinctCount;
					}
				}
			}
			const finalStats = inspectGrid(resolution);
			if (finalStats.distinctCount < finalStats.inRangeCount) {
				(onWarning ?? console.warn)(
					`toPattern: ${finalStats.inRangeCount - finalStats.distinctCount} note(s) share a cell at ${resolution}-cell resolution and overwrite earlier hits`
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
