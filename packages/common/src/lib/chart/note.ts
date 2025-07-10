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

		return (
			patterns
				?.map((pattern, index) => {
					const position = (index * measureLength) / patternCount;
					const normalizedPosition = LaneMeasureNote.normalizePosition(position);
					return {
						noteID: pattern,
						position: normalizedPosition
					};
				})
				.filter((note) => note.noteID !== '00') || []
		);
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
}
