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
		return normalizePosition(position, 192); // Use high precision for subdivisions
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
	toPattern(): string {
		if (this.notes.length === 0) return '';

		// Determine the pattern resolution based on the most precise position
		// Include common subdivision levels: 4, 8, 12, 16, 24, 32, 48, 64, 96, 192
		const commonResolutions = [4, 8, 12, 16, 24, 32, 48, 64, 96, 192];
		let resolution = 4; // Default to 4 subdivisions per measure

		// Find the smallest resolution that can accommodate all note positions
		for (const res of commonResolutions) {
			let canAccommodateAll = true;
			for (const note of this.notes) {
				const pos = note.position / this.measureLength;
				// Check if this resolution can represent this position precisely
				if (Math.abs(pos * res - Math.round(pos * res)) >= 0.001) {
					canAccommodateAll = false;
					break;
				}
			}
			if (canAccommodateAll) {
				resolution = res;
				break; // Use the first (smallest) resolution that works for all notes
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
