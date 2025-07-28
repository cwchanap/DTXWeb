import { LaneMeasureNote } from './note.js';
import {
	decodeFileWithEncodingDetection,
	decodeFileWithSpecificEncoding
} from './encoding-utils.js';

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
			throw new Error('Sound chip file name is not set');
		}

		const url = `${bucketUrl}/${simfileID}/${this.fileName}`;
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch sound chip: ${this.fileName} (${response.status}: ${response.statusText})`
			);
		}

		const blob = await response.blob();
		this.file = new File([blob], this.fileName);
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

	/**
	 * Get the filename from the original file
	 * @returns The filename if available, null otherwise
	 */
	public getFileName(): string | null {
		if (this.file instanceof File) {
			return this.file.name;
		}
		return null;
	}

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
		return await decodeFileWithSpecificEncoding(this.file, encoding);
	}

	private async parseWithEncodingDetection(): Promise<string> {
		if (!(this.file instanceof File)) {
			throw new Error('File is not set');
		}

		// DTX file validation callback
		const validateDtxContent = (content: string): boolean => {
			return (
				content.includes('#TITLE:') ||
				content.includes('#ARTIST:') ||
				content.includes('#BPM:') ||
				content.includes('#WAV')
			);
		};

		return await decodeFileWithEncodingDetection(
			this.file,
			validateDtxContent,
			['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'], // DTX files typically use shift-jis first
			'shift-jis' // DTX fallback is shift-jis
		);
	}

	async parseFromText(text: string) {
		const lines = text.split('\r\n');

		const remove_prefix = (prefix: string) => {
			// Look for the line that starts with the prefix (without colon)
			const line = lines.find((line) => line.startsWith(prefix));
			if (!line) return '';

			// Find the colon and extract everything after it, trimming whitespace
			const colonIndex = line.indexOf(':');
			if (colonIndex === -1) return '';

			return line.substring(colonIndex + 1).trim();
		};

		this.title = remove_prefix('#TITLE');
		this.artist = remove_prefix('#ARTIST');
		this.level = parseInt(remove_prefix('#DLEVEL')) || 0;
		this.bpm = parseInt(remove_prefix('#BPM')) || 0;
		this.preview = remove_prefix('#PREIMAGE');
		this.soundPreview = remove_prefix('#PREVIEW');

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
				const parsedNotes = LaneMeasureNote.parseFromPattern(pattern);
				return new LaneMeasureNote(measure, laneID, parsedNotes);
			});
			return notes;
		} else {
			console.log('No note line found.');
			return [];
		}
	}

	async export(notes?: Record<string, LaneMeasureNote[]>): Promise<void> {
		const content: string[] = [];

		// Add header information
		content.push(`#TITLE: ${this.title || ''}`);
		content.push(`#ARTIST: ${this.artist || ''}`);
		content.push(`#DLEVEL: ${this.level || 0}`);
		content.push(`#BPM: ${this.bpm || 120}`);
		if (this.preview) content.push(`#PREIMAGE: ${this.preview}`);
		if (this.soundPreview) content.push(`#PREVIEW: ${this.soundPreview}`);
		if (this.comment) content.push(`#COMMENT: ${this.comment}`);

		// Add sound chips
		if (this.soundChips && this.soundChips.length > 0) {
			this.soundChips.forEach((chip) => {
				const id = chip.id.toString(36).toUpperCase().padStart(2, '0');
				content.push(`#WAV${id}: ${chip.fileName}`);
				if (chip.volume !== 100) {
					content.push(`#VOLUME${id}: ${chip.volume}`);
				}
				if (chip.position !== 0) {
					content.push(`#POSITION${id}: ${chip.position}`);
				}
			});
		}

		// Add notes if provided
		if (notes) {
			const allMeasureNotes: { measure: number; laneID: string; pattern: string }[] = [];

			// Collect all notes and convert to patterns
			for (const [laneID, laneMeasureNotes] of Object.entries(notes)) {
				laneMeasureNotes.forEach((laneMeasureNote) => {
					const pattern = laneMeasureNote.toPattern();
					if (pattern) {
						allMeasureNotes.push({
							measure: laneMeasureNote.measure,
							laneID: laneID,
							pattern: pattern
						});
					}
				});
			}

			// Sort by measure then by lane ID for consistent output
			allMeasureNotes.sort((a, b) => {
				if (a.measure !== b.measure) return a.measure - b.measure;
				return a.laneID.localeCompare(b.laneID);
			});

			// Add note lines
			allMeasureNotes.forEach(({ measure, laneID, pattern }) => {
				const measureStr = measure.toString().padStart(3, '0');
				content.push(`#${measureStr}${laneID}: ${pattern}`);
			});
		}

		const fileContent = content.join('\r\n');
		const blob = new Blob([fileContent], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${this.title || 'exported'}.dtx`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
}
