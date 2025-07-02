import { normalizePosition } from '../utils/position';

export class LaneMeasureNote {
	public measure: number;
	public laneID: string;
	public pattern: string;
	public measureLength: number = 1;
	public notes: {
		noteID: string;
		position: number;
	}[] = [];

	constructor(measure: number, laneID: string, pattern: string, measureLength: number = 1) {
		this.measure = measure;
		this.laneID = laneID;
		this.pattern = pattern;
		this.measureLength = measureLength;
		this.parseNote();
	}

	/**
	 * Normalize a position to prevent floating point precision issues
	 */
	private normalizePosition(position: number): number {
		return normalizePosition(position, 16);
	}

	parseNote() {
		const patterns = this.pattern.match(/.{1,2}/g);
		if (!patterns) return;
		const patternCount = patterns.length;

		this.notes = patterns
			?.map((pattern, index) => {
				const position = (index * this.measureLength) / patternCount;
				return {
					noteID: pattern,
					position: this.normalizePosition(position)
				};
			})
			.filter((note) => note.noteID !== '00');
	}
}
