export class LaneMeasureNote {
    public notes: {
        noteID: string,
        position: number
    }[] = [];

    constructor(public measure: number, pattern: string, measureLength: number = 1) {
        const patterns = pattern.match(/.{1,2}/g);
        if (!patterns) return;
        const patternCount = patterns.length;

        this.notes = patterns?.map((pattern, index) => {
            const position = index * measureLength / patternCount;
            return {
                noteID: pattern,
                position: position
            }
        }).filter((note) => note.noteID !== '00');
    }
}