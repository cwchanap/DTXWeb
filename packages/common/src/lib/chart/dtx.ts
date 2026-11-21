import { LaneMeasureNote } from './note';
import { decodeFileWithEncodingDetection, decodeFileWithSpecificEncoding } from './encoding-utils';
import { dedupedFetch } from '../utils/dedupedFetch';

/**
 * Optional controls for {@link DTXFile.toDtxText}. Editor save omits them so
 * values are recovered from the parsed file lines; MIDI import supplies them
 * explicitly on a fresh DTXFile.
 */
export interface DtxExportControls {
	/** Extended `#BPMxx` definitions keyed by two-char ID — same shape as parseBPMChanges(). */
	bpmChanges?: Record<string, number>;
	/** Channel-02 bar lengths: measure index -> decimal multiplier of 4/4. */
	measureLengths?: Map<number, number>;
}

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
		const response = await dedupedFetch(url);
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
	pathWav?: string;
	comment!: string;
	soundChips!: SoundChip[];
	// Initialized empty so a fresh `new DTXFile()` used for MIDI import can
	// call the control parsers and serializer without a prior parse().
	lines: string[] = [];
	detectedEncoding?: string;

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

		const result = await decodeFileWithEncodingDetection(
			this.file,
			validateDtxContent,
			['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'], // DTX files typically use shift-jis first
			'shift-jis' // DTX fallback is shift-jis
		);

		// Store the detected encoding for later use in export
		this.detectedEncoding = result.encoding;
		return result.content;
	}

	async parseFromText(text: string) {
		const lines = text.split(/\r?\n/);

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
		// Base BPM needs the exact `#BPM` directive: prefix matching would let
		// an earlier `#BPMxx` definition (e.g. `#BPM01: 200`) shadow it. The
		// header half is compared before the colon, parsed with parseFloat so
		// decimal BPMs survive, and validated positive/finite so a malformed
		// value can't poison the timing builder with NaN/Infinity.
		const baseBpmLine = lines.find((line) => {
			const colonIndex = line.indexOf(':');
			return colonIndex !== -1 && line.slice(0, colonIndex).trim() === '#BPM';
		});
		const baseBpm = baseBpmLine
			? parseFloat(baseBpmLine.slice(baseBpmLine.indexOf(':') + 1).trim())
			: NaN;
		this.bpm = Number.isFinite(baseBpm) && baseBpm > 0 ? baseBpm : 0;
		this.preview = remove_prefix('#PREIMAGE');
		this.soundPreview = remove_prefix('#PREVIEW');

		// #PATH_WAV accepts both `#PATH_WAV: dir` and `#PATH_WAV dir`. The
		// delimiter check keeps longer directives like #PATH_WAV_EXTRA or
		// #PATH_WAV2 from prefix-matching and shadowing the real line.
		const pathWavLine = lines.find((line) => /^#PATH_WAV(?:[:\s]|$)/.test(line));
		this.pathWav = pathWavLine
			?.slice('#PATH_WAV'.length)
			.replace(/^[:\s]+/, '')
			.trim();

		this.lines = lines;
	}

	parseSoundChips() {
		const wavLines = this.lines.filter((line) => line.startsWith('#WAV'));

		// Extract the value after the first colon, trimming whitespace. Tolerates
		// both `: ` (standard DTX) and `:` (no-space, e.g. `#WAV01:kick.wav`),
		// matching parseNotes' colon handling. The strict `': '` split left
		// soundFile undefined for the no-space form, crashing the SoundChip
		// constructor on `undefined.toLowerCase()`.
		const valueAfterColon = (line: string): string => {
			const idx = line.indexOf(':');
			return idx === -1 ? '' : line.slice(idx + 1).trim();
		};

		this.soundChips = wavLines.map((line) => {
			const id = line.split('#WAV')[1].split(':')[0];
			// `startsWith('#VOLUME${id}:')` (colon, no trailing space) matches both
			// `#VOLUME01: 80` and `#VOLUME01:80`; the colon delimits the id so it
			// won't prefix-match a longer id like `#VOLUME012:`.
			const volumeLine = this.lines.find((l) => l.startsWith(`#VOLUME${id}:`));
			const volume = volumeLine ? parseInt(valueAfterColon(volumeLine)) : 100;
			const positionLine = this.lines.find((l) => l.startsWith(`#POSITION${id}:`));
			const position = positionLine ? parseInt(valueAfterColon(positionLine)) : 0;
			const soundFile = valueAfterColon(line);
			return new SoundChip('', parseInt(id, 36), volume, position, soundFile);
		});

		return this.soundChips;
	}

	parseBPMChanges() {
		const bpmLines = this.lines.filter((line) => line.startsWith('#BPM'));
		const bpmNotes: Record<string, number> = {};
		bpmLines.forEach((line) => {
			// Split on the first colon, tolerating both `: ` (standard DTX)
			// and `:` (no-space, e.g. `#BPMAA:240`), matching parseNotes'
			// colon handling. The strict `': '` split left `bpm` undefined for
			// the no-space form, so parseFloat(undefined) recorded NaN — and
			// feeding that into the timing builder turned totalDuration/cursor
			// times into NaN (NaN ?? bpm is NaN; `??` does not catch NaN).
			const colonIndex = line.indexOf(':');
			if (colonIndex === -1) return;
			// Only `#BPM` (base directive, keyed '') and exactly two-character
			// `#BPMxx` ids are valid; a longer header like `#BPM01_EXTRA` must
			// not alias the `01` definition via slice(4, 6).
			const idMatch = /^#BPM([0-9A-Z]{2})?$/i.exec(line.slice(0, colonIndex).trim());
			if (!idMatch) return;
			const noteID = idMatch[1] ?? '';
			const value = parseFloat(line.slice(colonIndex + 1).trim());
			// Skip unparseable or non-finite values so a malformed line does not
			// inject NaN/Infinity into the bpm map and poison the timing builder.
			// `parseFloat('Infinity')` and `parseFloat('1e309')` (which overflows
			// to Infinity) pass `!isNaN`, so the `isFinite` guard mirrors
			// parseMeasureLengths' finite-number check.
			if (!isNaN(value) && isFinite(value)) bpmNotes[noteID] = value;
		});
		return bpmNotes;
	}

	/**
	 * Parse channel 02 (bar-length change) entries. In DTX, channel 02
	 * specifies the measure length as a decimal multiplier of 4/4 time
	 * (e.g. 0.75 = 3/4, 2 = 8/4). Unlike BMS where the effect lasts one
	 * measure, DTX bar-length changes are sticky: once set, all subsequent
	 * measures use that length until another channel 02 line appears.
	 *
	 * Returns a map of measure index -> length multiplier for measures that
	 * explicitly set a length. Callers must apply the sticky semantics when
	 * building a full per-measure array.
	 */
	parseMeasureLengths(): Map<number, number> {
		const result = new Map<number, number>();
		for (const line of this.lines) {
			// Channel 02 lines: #NNN02: value. Split on the first colon and trim,
			// matching parseNotes'/bpmLines' colon handling (tolerates both `: `
			// and `:`). Avoids a `\s*(.+)` regex whose overlapping whitespace
			// classes trigger CodeQL js/polynomial-redos on untrusted input.
			const colonIndex = line.indexOf(':');
			if (colonIndex === -1) continue;
			const header = line.slice(0, colonIndex);
			// Fixed `{3}` quantifier — no backtracking ambiguity.
			if (!/^#\d{3}02$/.test(header)) continue;
			const measure = parseInt(header.slice(1, 4), 10);
			const length = parseFloat(line.slice(colonIndex + 1).trim());
			if (!isNaN(length) && isFinite(length) && length > 0) {
				result.set(measure, length);
			}
		}
		return result;
	}

	parseNotes(): LaneMeasureNote[] {
		const noteLines = this.lines.filter((line) => /^#\d+/.test(line));
		if (noteLines.length > 0) {
			const notes = noteLines.flatMap((line) => {
				// Split on the first colon and trim, tolerating both `: ` (standard
				// DTX) and `:` (no space, e.g. `#NNN02:0.5`). The strict `': '`
				// split left `pattern` undefined for the no-space form, crashing
				// LaneMeasureNote.parseFromPattern().
				const colonIndex = line.indexOf(':');
				// Skip malformed note lines without a colon, matching the guard
				// used by parseBPMChanges and parseMeasureLengths. Without this,
				// `line.slice(0, -1)` drops the last header char and
				// `line.slice(0)` returns the whole line as the pattern, building
				// a LaneMeasureNote from garbage.
				if (colonIndex === -1) return [];
				const header = line.slice(0, colonIndex);
				const pattern = line.slice(colonIndex + 1).trim();
				const measure = parseInt(header.slice(1, 4));
				const laneID = header.slice(4, 6);
				const parsedNotes = LaneMeasureNote.parseFromPattern(pattern);
				return [new LaneMeasureNote(measure, laneID, parsedNotes)];
			});
			return notes;
		} else {
			console.log('No note line found.');
			return [];
		}
	}

	/**
	 * Serialize this chart to DTX text. Pure counterpart of export() — safe
	 * to call without a DOM, e.g. for MIDI import on a fresh DTXFile.
	 */
	toDtxText(notes?: Record<string, LaneMeasureNote[]>, controls?: DtxExportControls): string {
		const content: string[] = [];

		// Add header information
		content.push(`#TITLE: ${this.title || ''}`);
		content.push(`#ARTIST: ${this.artist || ''}`);
		content.push(`#DLEVEL: ${this.level || 0}`);
		// Base #BPM is emitted exactly once, here — never via the '' key that
		// parseBPMChanges() reports for the base directive.
		content.push(`#BPM: ${this.bpm || 120}`);

		// Extended #BPMxx definitions: parsed lines on editor save, supplied
		// controls on MIDI import. Only two-char IDs are definitions.
		const bpmChanges = controls?.bpmChanges ?? this.parseBPMChanges();
		for (const [id, value] of Object.entries(bpmChanges)) {
			if (/^[0-9A-Z]{2}$/i.test(id)) content.push(`#BPM${id}: ${value}`);
		}

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

		const allMeasureNotes: { measure: number; laneID: string; pattern: string }[] = [];

		// Collect all notes and convert to patterns when provided. Channel 02
		// is a decimal bar-length channel, not a pattern channel — its parsed
		// "notes" are garbage pairs ('0.75' -> '0.', '75') that toPattern()
		// would corrupt; #NNN02 is emitted from the length map below.
		if (notes) {
			for (const [laneID, laneMeasureNotes] of Object.entries(notes)) {
				if (laneID === '02') continue;
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
		}

		// Measure lengths emit whether or not note patterns were supplied —
		// controls-only or parsed-lines exports must not drop #NNN02.
		const measureLengths = controls?.measureLengths ?? this.parseMeasureLengths();
		for (const [measure, length] of measureLengths) {
			allMeasureNotes.push({ measure, laneID: '02', pattern: `${length}` });
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

		return content.join('\r\n');
	}

	async export(
		notes?: Record<string, LaneMeasureNote[]>,
		controls?: DtxExportControls
	): Promise<void> {
		const fileContent = this.toDtxText(notes, controls);

		// Always export as UTF-8 for consistency and compatibility
		const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });

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
