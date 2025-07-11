import { normalizePosition } from '../utils/position.js';

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
	private static normalizePosition(position: number): number {
		return normalizePosition(position, 16);
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

		return patterns
			.map((pattern, index) => {
				const position = (index * measureLength) / patternCount;
				const normalizedPosition = LaneMeasureNote.normalizePosition(position);
				return {
					noteID: pattern,
					position: normalizedPosition
				};
			})
			.filter((note) => note.noteID !== '00');
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
	toPattern(): string {
		if (this.notes.length === 0) return '';

		// Determine the pattern resolution based on the most precise position
		let resolution = 4; // Default to 4 subdivisions per measure
		for (const note of this.notes) {
			const pos = note.position / this.measureLength;
			// Find the smallest power of 2 that can represent this position precisely
			for (let res = 4; res <= 192; res *= 2) {
				if (Math.abs(pos * res - Math.round(pos * res)) < 0.001) {
					resolution = Math.max(resolution, res);
					break;
				}
			}
		}

		// Create pattern array filled with '00'
		const pattern = new Array(resolution).fill('00');

		// Place notes in the pattern
		for (const note of this.notes) {
			const pos = note.position / this.measureLength;
			const index = Math.round(pos * resolution);
			if (index >= 0 && index < resolution) {
				pattern[index] = note.noteID;
			}
		}

		return pattern.join('');
	}
}
