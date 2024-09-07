export interface SoundChip {
    label: string;
    id: number;
    volume: number;
    position: number;
    file: string |undefined;
}

export class DTXFile {
    level!: number;
    artist!: string;
    title!: string;
    bpm!: number;
    preview!: string;
    soundPreview!: string;
    comment!: string;
    soundChips!: SoundChip[];
    bpmNotes: Record<string, number>[] = [];
    lines!: string[];

    constructor(private file?: File, public difficulty?: string) { }

    async parse(encoding: string = 'shift-jis') {
        if (!this.file) {
            console.error('File is not set');
            return;
        }
        const arrayBuffer = await this.file.arrayBuffer();
        const decoder = new TextDecoder(encoding);
        const content = decoder.decode(arrayBuffer);
        const lines = content.split('\r\n');

        const remove_prefix = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.split(prefix)[1] || '';

        this.title = remove_prefix('#TITLE: ');
        this.artist = remove_prefix('#ARTIST: ');
        this.level = parseInt(remove_prefix('#DLEVEL: '));
        this.bpm = parseInt(remove_prefix('#BPM: '));
        this.preview = remove_prefix('#PREIMAGE: ');
        this.soundPreview = remove_prefix('#PREVIEW: ');

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
            return { label: '', id: parseInt(id, 36), volume, position, file: soundFile };
        });
        return this.soundChips;
    }

    parseBPMChanges() {
        const bpmLines = this.lines.filter(line => line.startsWith('#BPM'));
        this.bpmNotes = bpmLines.map(line => {
            const [header, bpm] = line.split(': ', 2);
            const noteID = header.slice(4, 6);
            return { [noteID]: parseFloat(bpm) };
        });
    }

    parseNotes() {
        const noteLines = this.lines.filter(line => /^#\d+/.test(line));
        if (noteLines.length > 0) {
            const notes = noteLines.map(line => {
                const [header, pattern] = line.split(': ', 2);
                const measure = parseInt(header.slice(1, 4));
                const laneID = header.slice(4, 6);
                return { measure, laneID, pattern };
            });
            return notes;
        } else {
            console.log('No note line found.');
        }
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