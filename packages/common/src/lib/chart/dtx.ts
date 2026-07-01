import { LaneMeasureNote } from './note';
import { decodeFileWithEncodingDetection, decodeFileWithSpecificEncoding } from './encoding-utils';
import { dedupedFetch } from '../utils/dedupedFetch';

interface MidiEvent {
	deltaTime: number;
	type: 'meta' | 'channel';
	subtype?: number;
	data?: number[];
	channel?: number;
	command?: number;
	note?: number;
	velocity?: number;
}

export interface ParsedMidi {
	format: number;
	trackCount: number;
	ticksPerQuarter: number;
	tracks: MidiEvent[][];
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
	comment!: string;
	soundChips!: SoundChip[];
	lines!: string[];
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
			// Channel 02 lines: #NNN02: value (matching parseNotes' colon-space
			// convention; \s* also tolerates colon-without-space).
			const match = line.match(/^#(\d{3})02:\s*(.+)$/);
			if (!match) continue;
			const measure = parseInt(match[1], 10);
			const length = parseFloat(match[2]);
			if (!isNaN(length) && length > 0) {
				result.set(measure, length);
			}
		}
		return result;
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

	exportToMidi(
		notes: Record<string, LaneMeasureNote[]>,
		laneNoteMap: Record<string, number>
	): Uint8Array<ArrayBuffer> {
		const TICKS_PER_QUARTER = 480;

		// Create MIDI header
		const header = this.createMidiHeader(0, 1, TICKS_PER_QUARTER); // Format 0, 1 track

		// Create track with notes
		const track = this.createMidiTrack(notes, laneNoteMap, TICKS_PER_QUARTER);

		// Combine header and track
		const totalLength = header.length + track.length;
		const midiData = new Uint8Array(totalLength);
		midiData.set(header, 0);
		midiData.set(track, header.length);

		return midiData;
	}

	private createMidiHeader(format: number, tracks: number, ticksPerQuarter: number): Uint8Array {
		const header = new Uint8Array(14);
		const view = new DataView(header.buffer);

		// Header chunk type "MThd"
		header.set([0x4d, 0x54, 0x68, 0x64], 0);

		// Header length (6 bytes)
		view.setUint32(4, 6, false);

		// Format type
		view.setUint16(8, format, false);

		// Number of tracks
		view.setUint16(10, tracks, false);

		// Ticks per quarter note
		view.setUint16(12, ticksPerQuarter, false);

		return header;
	}

	private createMidiTrack(
		notes: Record<string, LaneMeasureNote[]>,
		laneNoteMap: Record<string, number>,
		ticksPerQuarter: number
	): Uint8Array {
		const events: MidiEvent[] = [];

		// Add tempo event (120 BPM default)
		const bpm = this.bpm || 120;
		const microsecondsPerQuarter = Math.round(60000000 / bpm);
		events.push({
			deltaTime: 0,
			type: 'meta',
			subtype: 0x51, // Set Tempo
			data: [
				(microsecondsPerQuarter >> 16) & 0xff,
				(microsecondsPerQuarter >> 8) & 0xff,
				microsecondsPerQuarter & 0xff
			]
		});

		// Convert DTX notes to MIDI events
		const allNoteEvents: Array<{ time: number; lane: string; noteId: string }> = [];

		for (const [laneId, laneMeasureNotes] of Object.entries(notes)) {
			for (const measureNote of laneMeasureNotes) {
				const measureStartTime = measureNote.measure * ticksPerQuarter * 4; // 4/4 time

				measureNote.notes.forEach((note) => {
					if (note.noteID !== '00') {
						const noteTime = measureStartTime + note.position * ticksPerQuarter * 4;
						allNoteEvents.push({
							time: Math.round(noteTime),
							lane: laneId,
							noteId: note.noteID
						});
					}
				});
			}
		}

		// Sort by time
		allNoteEvents.sort((a, b) => a.time - b.time);

		// Convert to MIDI note events
		let currentTime = 0;
		for (const noteEvent of allNoteEvents) {
			const channel = 9; // Always use drum channel (9)
			const noteNumber =
				laneNoteMap[noteEvent.lane] || this.getMidiNoteNumber(noteEvent.lane);
			const velocity = 100;
			const duration = Math.round(ticksPerQuarter / 4); // 16th note duration

			const deltaTime = noteEvent.time - currentTime;

			// Note On event
			events.push({
				deltaTime,
				type: 'channel',
				channel,
				command: 0x9, // Note On
				note: noteNumber,
				velocity
			});

			// Note Off event
			events.push({
				deltaTime: duration,
				type: 'channel',
				channel,
				command: 0x8, // Note Off
				note: noteNumber,
				velocity: 0
			});

			currentTime = noteEvent.time + duration;
		}

		// End of track
		events.push({
			deltaTime: 0,
			type: 'meta',
			subtype: 0x2f, // End of Track
			data: []
		});

		return this.serializeMidiTrack(events);
	}

	private getMidiNoteNumber(laneId: string): number {
		// DTX lane to General MIDI drum mapping
		const drumMap: Record<string, number> = {
			'01': 36, // Bass Drum
			'02': 38, // Snare
			'03': 42, // Closed Hi-Hat
			'04': 46, // Open Hi-Hat
			'05': 49, // Crash Cymbal
			'06': 51, // Ride Cymbal
			'07': 45, // Low Tom
			'08': 47, // Mid Tom
			'09': 50, // High Tom
			'0A': 44, // Pedal Hi-Hat
			'0B': 57, // Crash 2
			'0C': 59 // Ride 2
			// Add more mappings as needed
		};

		return drumMap[laneId.toUpperCase()] || 60; // Default to middle C
	}

	private serializeMidiTrack(events: MidiEvent[]): Uint8Array {
		const trackData: number[] = [];

		for (const event of events) {
			// Add variable-length delta time
			trackData.push(...this.encodeVariableLength(event.deltaTime));

			if (event.type === 'meta') {
				trackData.push(0xff, event.subtype!, event.data!.length, ...event.data!);
			} else if (event.type === 'channel') {
				const status = (event.command! << 4) | event.channel!;
				trackData.push(status);

				if (event.command === 0x8 || event.command === 0x9) {
					// Note events
					trackData.push(event.note!, event.velocity!);
				}
			}
		}

		// Create track chunk
		const trackLength = trackData.length;
		const track = new Uint8Array(8 + trackLength);
		const view = new DataView(track.buffer);

		// Track chunk type "MTrk"
		track.set([0x4d, 0x54, 0x72, 0x6b], 0);

		// Track length
		view.setUint32(4, trackLength, false);

		// Track data
		track.set(trackData, 8);

		return track;
	}

	private encodeVariableLength(value: number): number[] {
		if (value === 0) {
			return [0];
		}

		const bytes: number[] = [];
		while (value > 0) {
			bytes.unshift(value & 0x7f);
			value >>= 7;
		}

		for (let i = 0; i < bytes.length; i++) {
			if (i < bytes.length - 1) {
				bytes[i] |= 0x80;
			}
		}

		return bytes;
	}

	async parseFromMidi(file: File): Promise<ParsedMidi> {
		const arrayBuffer = await file.arrayBuffer();
		const data = new Uint8Array(arrayBuffer);

		// Parse MIDI file
		const midiData = this.parseMidiFile(data);

		// Convert MIDI data to DTX format
		this.convertMidiToDtx(midiData);

		return midiData;
	}

	private parseMidiFile(data: Uint8Array): ParsedMidi {
		let offset = 0;

		// Read header chunk
		const headerType = new TextDecoder().decode(data.slice(offset, offset + 4));
		if (headerType !== 'MThd') {
			throw new Error('Invalid MIDI file: Missing header');
		}
		offset += 4;

		// Header length (unused, but advance the offset)
		offset += 4;

		const format = this.readUint16(data, offset);
		offset += 2;
		const trackCount = this.readUint16(data, offset);
		offset += 2;
		const ticksPerQuarter = this.readUint16(data, offset);
		offset += 2;

		// Read tracks
		const tracks: MidiEvent[][] = [];
		for (let i = 0; i < trackCount; i++) {
			const track = this.parseTrack(data, offset);
			tracks.push(track.events);
			offset = track.nextOffset;
		}

		return {
			format,
			trackCount,
			ticksPerQuarter,
			tracks
		};
	}

	private parseTrack(data: Uint8Array, offset: number) {
		const trackType = new TextDecoder().decode(data.slice(offset, offset + 4));
		if (trackType !== 'MTrk') {
			throw new Error('Invalid MIDI track');
		}
		offset += 4;

		const trackLength = this.readUint32(data, offset);
		offset += 4;
		const trackEnd = offset + trackLength;

		const events: MidiEvent[] = [];
		let runningStatus = 0;

		while (offset < trackEnd) {
			// Read delta time
			const deltaTimeResult = this.readVariableLength(data, offset);
			const deltaTime = deltaTimeResult.value;
			offset = deltaTimeResult.nextOffset;

			// Read event
			let status = data[offset];

			// Handle running status
			if (status < 0x80) {
				status = runningStatus;
			} else {
				offset++;
			}

			if (status >= 0x80 && status <= 0xef) {
				// Channel message
				runningStatus = status;
				const command = (status >> 4) & 0x0f;
				const channel = status & 0x0f;

				if (command === 0x8 || command === 0x9) {
					// Note Off/On
					const note = data[offset++];
					const velocity = data[offset++];
					events.push({
						deltaTime,
						type: 'channel',
						command,
						channel,
						note,
						velocity
					});
				} else {
					// Skip other channel messages for now
					offset += 2;
				}
			} else if (status === 0xff) {
				// Meta event
				const subtype = data[offset++];
				const lengthResult = this.readVariableLength(data, offset);
				const length = lengthResult.value;
				offset = lengthResult.nextOffset;

				const metaData = Array.from(data.slice(offset, offset + length));
				offset += length;

				events.push({
					deltaTime,
					type: 'meta',
					subtype,
					data: metaData
				});
			} else {
				// Skip unknown events
				offset++;
			}
		}

		return {
			events,
			nextOffset: offset
		};
	}

	private readUint32(data: Uint8Array, offset: number): number {
		return (
			(data[offset] << 24) |
			(data[offset + 1] << 16) |
			(data[offset + 2] << 8) |
			data[offset + 3]
		);
	}

	private readUint16(data: Uint8Array, offset: number): number {
		return (data[offset] << 8) | data[offset + 1];
	}

	private readVariableLength(data: Uint8Array, offset: number) {
		let value = 0;
		let byte: number;

		do {
			byte = data[offset++];
			value = (value << 7) | (byte & 0x7f);
		} while (byte & 0x80);

		return { value, nextOffset: offset };
	}

	private convertMidiToDtx(midiData: ParsedMidi): void {
		// Set default values
		this.title = 'Converted from MIDI';
		this.artist = 'Unknown';
		this.level = 5;
		this.bpm = 120;
		this.preview = '';
		this.soundPreview = '';
		this.comment = 'Converted from MIDI file';
		this.soundChips = [];
		this.lines = [];

		// Extract tempo from meta events
		for (const track of midiData.tracks) {
			for (const event of track) {
				if (event.type === 'meta' && event.subtype === 0x51 && event.data) {
					// Set Tempo event
					const microsecondsPerQuarter =
						(event.data[0] << 16) | (event.data[1] << 8) | event.data[2];
					this.bpm = Math.round(60000000 / microsecondsPerQuarter);
					break;
				}
			}
		}

		// Generate basic header lines
		this.lines = [
			`#TITLE: ${this.title}`,
			`#ARTIST: ${this.artist}`,
			`#DLEVEL: ${this.level}`,
			`#BPM: ${this.bpm}`,
			`#COMMENT: ${this.comment}`
		];
	}

	convertMidiNotesToDtx(midiData: ParsedMidi): Record<string, LaneMeasureNote[]> {
		const notesByLane: Record<string, LaneMeasureNote[]> = {};
		const ticksPerQuarter = midiData.ticksPerQuarter;
		const ticksPerMeasure = ticksPerQuarter * 4; // Assuming 4/4 time

		// MIDI note to DTX lane mapping (reverse of the export mapping)
		const midiToDtxMap: Record<number, string> = {
			36: '01', // Bass Drum
			38: '02', // Snare
			42: '03', // Closed Hi-Hat
			46: '04', // Open Hi-Hat
			49: '05', // Crash Cymbal
			51: '06', // Ride Cymbal
			45: '07', // Low Tom
			47: '08', // Mid Tom
			50: '09', // High Tom
			44: '0A', // Pedal Hi-Hat
			57: '0B', // Crash 2
			59: '0C' // Ride 2
		};

		// Process each track
		for (const track of midiData.tracks) {
			let currentTime = 0;

			for (const event of track) {
				currentTime += event.deltaTime;

				// Only process Note On events with velocity > 0
				if (
					event.type === 'channel' &&
					event.command === 0x9 &&
					event.note !== undefined &&
					event.velocity !== undefined &&
					event.velocity > 0
				) {
					const laneId = midiToDtxMap[event.note];
					if (laneId) {
						const measure = Math.floor(currentTime / ticksPerMeasure);
						const positionInMeasure = (currentTime % ticksPerMeasure) / ticksPerMeasure;

						// Initialize lane if not exists
						if (!notesByLane[laneId]) {
							notesByLane[laneId] = [];
						}

						// Find or create measure note for this lane
						let measureNote = notesByLane[laneId].find((mn) => mn.measure === measure);
						if (!measureNote) {
							measureNote = new LaneMeasureNote(measure, laneId, []);
							notesByLane[laneId].push(measureNote);
						}

						// Add note (using a simple note ID, could be enhanced)
						measureNote.notes.push({
							noteID: '01', // Default sound chip
							position: positionInMeasure
						});
					}
				}
			}
		}

		// Sort notes within each measure
		for (const laneNotes of Object.values(notesByLane)) {
			laneNotes.forEach((measureNote) => {
				measureNote.notes.sort((a, b) => a.position - b.position);
			});
			laneNotes.sort((a, b) => a.measure - b.measure);
		}

		return notesByLane;
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
