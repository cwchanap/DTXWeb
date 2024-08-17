export interface SoundChip {
    label: string;
    id: number;
    volume: number;
    position: number;
    file: File | undefined;
}

export class DTXFile {
    level!: number;
    artist!: string;
    title!: string;
    bpm!: number;
    preview!: string;
    comment!: string;
    soundChips!: SoundChip[];
    lines!: string[];

    constructor(private file?: File, public difficulty?: string) { }

    async parse() {
        if (!this.file) {
            console.error('File is not set');
            return;
        }
        const content = await this.file.text();
        const lines = content.split('\r\n');

        const remove_prefix = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.split(prefix)[1] || '';

        this.title = remove_prefix('#TITLE: ');
        this.artist = remove_prefix('#ARTIST: ');
        this.level = parseInt(remove_prefix('#DLEVEL: '));
        this.bpm = parseInt(remove_prefix('#BPM: '));
        this.preview = remove_prefix('#PREIMAGE: ');

        this.lines = lines;
    }

    parseSoundChips() {
        const wavLines = this.lines.filter((line) => line.startsWith('#WAV'));
        this.soundChips = wavLines.map((line) => {
            const id = line.split('#WAV')[1].split(':')[0];
            const volumeLine = this.lines.find((l) => l.startsWith(`#VOLUME${id}: `));
            const volume = volumeLine ? parseInt(volumeLine.split(`#VOLUME${id}: `)[1]) : 100;
            const positionLine = this.lines.find((l) => l.startsWith(`#POSITION${id}: `));
            const position = positionLine ? parseInt(positionLine.split(`#POSITION${id}: `)[1]) : 0;
            const soundFile = line.split(`#WAV${id}: `)[1];
            return { label: '', id: parseInt(id, 36), volume, position, file: undefined };
        });
        return this.soundChips;
    }

    async export(): Promise<void> {
        const content = [
            `#TITLE: ${this.title}`,
            `#ARTIST: ${this.artist}`,
            `#DLEVEL: ${this.level}`,
            `#BPM: ${this.bpm}`,
            `#PREIMAGE: ${this.preview}`,
        ].join('\r\n');

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'exported.dtx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}