
export class DTXFile {
    level!: number;
    artist!: string;
    title!: string;
    bpm!: number;
    preview!: string;

    constructor(private file: File, public difficulty: string) {}

    async parse() {
        const content = await this.file.text();
        const lines = content.split('\r\n');

        const remove_prefix = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.split(prefix)[1] || '';

        this.title = remove_prefix('#TITLE: ');
        this.artist = remove_prefix('#ARTIST: ');
        this.level = parseInt(remove_prefix('#DLEVEL: '));
        this.bpm = parseInt(remove_prefix('#BPM: '));
        this.preview = remove_prefix('#PREIMAGE: ');
    }
}