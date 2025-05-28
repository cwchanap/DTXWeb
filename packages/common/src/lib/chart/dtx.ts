import { LaneMeasureNote } from './note.js';

export class SoundChip {
	label: string;
	id: number;
	volume: number;
	position: number;
	fileName: string;
	file?: File;

	constructor(
		label: string,
		id: number,
		volume: number,
		position: number,
		fileName: string,
		file?: File
	) {
		this.label = label;
		this.id = id;
		this.volume = volume;
		this.position = position;
		this.fileName = fileName.toLowerCase();

		if (file) {
			this.file = file;
		}
	}

	async fetchRemote(simfileID: string, bucketUrl: string) {
		if (!this.fileName) {
			console.error('Sound chip file name is not set');
			return;
		}
		const response = await fetch(`${bucketUrl}/${simfileID}/${this.fileName}`);
		if (!response.ok) {
			console.error(`Failed to fetch sound chip: ${this.fileName}`);
			return;
		}
		this.file = new File([await response.blob()], this.fileName);
	}
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
	lines!: string[];

	constructor(
		private file?: File | string,
		public difficulty?: string
	) {}

	async parse(encoding?: string) {
		if (typeof this.file === 'string') {
			this.parseFromText(this.file);
		} else if (this.file instanceof File) {
			const content = encoding
				? await this.parseWithSpecificEncoding(encoding)
				: await this.parseWithEncodingDetection();
			this.parseFromText(content);
		} else {
			console.error('File is not set');
			return;
		}
	}

	private async parseWithSpecificEncoding(encoding: string): Promise<string> {
		if (!(this.file instanceof File)) {
			throw new Error('File is not set');
		}
		const arrayBuffer = await this.file.arrayBuffer();
		const decoder = new TextDecoder(encoding);
		return decoder.decode(arrayBuffer);
	}

	private async parseWithEncodingDetection(): Promise<string> {
		if (!(this.file instanceof File)) {
			throw new Error('File is not set');
		}
		const arrayBuffer = await this.file.arrayBuffer();

		// List of encodings to try in order
		const encodings = ['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'];

		for (const encoding of encodings) {
			try {
				const decoder = new TextDecoder(encoding);
				const content = decoder.decode(arrayBuffer);

				// Check if the content looks valid (contains expected DTX header patterns)
				if (
					content.includes('#TITLE:') ||
					content.includes('#ARTIST:') ||
					content.includes('#BPM:') ||
					content.includes('#WAV')
				) {
					// Additional check: ensure no excessive null bytes (which would indicate wrong encoding)
					const nullByteRatio = (content.match(/\0/g) || []).length / content.length;
					if (nullByteRatio < 0.1) {
						// Less than 10% null bytes
						return content;
					}
				}
			} catch (error) {
				// Continue to next encoding if this one fails
				continue;
			}
		}

		// Fallback to shift-jis (original default) if nothing else works
		const decoder = new TextDecoder('shift-jis');
		return decoder.decode(arrayBuffer);
	}

	async parseFromText(text: string) {
		const lines = text.split('\r\n');

		const remove_prefix = (prefix: string) =>
			lines.find((line) => line.startsWith(prefix))?.split(prefix)[1] || '';

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
			return new SoundChip('', parseInt(id, 36), volume, position, soundFile);
		});
		return this.soundChips;
	}

	parseBPMChanges() {
		const bpmLines = this.lines.filter((line) => line.startsWith('#BPM'));
		const bpmNotes: Record<string, number> = {};
		bpmLines.forEach((line) => {
			const [header, bpm] = line.split(': ', 2);
			const noteID = header.slice(4, 6);
			bpmNotes[noteID] = parseFloat(bpm);
		});
		return bpmNotes;
	}

	parseNotes(): LaneMeasureNote[] {
		const noteLines = this.lines.filter((line) => /^#\d+/.test(line));
		if (noteLines.length > 0) {
			const notes = noteLines.map((line) => {
				const [header, pattern] = line.split(': ', 2);
				const measure = parseInt(header.slice(1, 4));
				const laneID = header.slice(4, 6);
				return new LaneMeasureNote(measure, laneID, pattern);
			});
			return notes;
		} else {
			console.log('No note line found.');
			return [];
		}
	}

	async export(): Promise<void> {
		const content = [
			`#TITLE: ${this.title}`,
			`#ARTIST: ${this.artist}`,
			`#DLEVEL: ${this.level}`,
			`#BPM: ${this.bpm}`,
			`#PREIMAGE: ${this.preview}`
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
