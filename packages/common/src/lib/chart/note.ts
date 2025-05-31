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

	parseNote() {
		const patterns = this.pattern.match(/.{1,2}/g);
		if (!patterns) return;
		const patternCount = patterns.length;

		this.notes = patterns
			?.map((pattern, index) => {
				const position = (index * this.measureLength) / patternCount;
				return {
					noteID: pattern,
					position: position
				};
			})
			.filter((note) => note.noteID !== '00');
	}
}
