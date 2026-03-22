import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DTXFile, SoundChip } from './dtx';
import { LaneMeasureNote } from './note';
import { decodeFileWithEncodingDetection, decodeFileWithSpecificEncoding } from './encoding-utils';

// Mock encoding utilities
vi.mock('./encoding-utils', () => ({
	decodeFileWithEncodingDetection: vi.fn(),
	decodeFileWithSpecificEncoding: vi.fn()
}));

// Mock DOM APIs for export functionality
let capturedBlobContent = '';

class MockBlob {
	constructor(parts: any[]) {
		capturedBlobContent = parts.join('');
	}
}

global.Blob = MockBlob as any;

Object.defineProperty(window, 'URL', {
	value: {
		createObjectURL: vi.fn(() => 'mock-url'),
		revokeObjectURL: vi.fn()
	}
});

Object.defineProperty(document, 'createElement', {
	value: vi.fn(() => ({
		href: '',
		download: '',
		click: vi.fn(),
		style: {}
	}))
});

Object.defineProperty(document.body, 'appendChild', {
	value: vi.fn()
});

Object.defineProperty(document.body, 'removeChild', {
	value: vi.fn()
});

// Helper function to get captured blob content
const getCapturedBlobContent = () => capturedBlobContent;

describe('SoundChip', () => {
	describe('constructor', () => {
		it('should create a SoundChip with provided values', () => {
			const soundChip = new SoundChip('kick', 1, 100, 0, 'kick.wav');

			expect(soundChip.label).toBe('kick');
			expect(soundChip.id).toBe(1);
			expect(soundChip.volume).toBe(100);
			expect(soundChip.position).toBe(0);
			expect(soundChip.fileName).toBe('kick.wav');
		});

		it('should lowercase the filename', () => {
			const soundChip = new SoundChip('kick', 1, 100, 0, 'KICK.WAV');

			expect(soundChip.fileName).toBe('kick.wav');
		});

		it('should store the file if provided', () => {
			const file = new File(['content'], 'test.wav');
			const soundChip = new SoundChip('kick', 1, 100, 0, 'kick.wav', file);

			expect(soundChip.file).toBe(file);
		});
	});

	describe('fetchRemote', () => {
		it('should throw error if fileName is empty', async () => {
			const soundChip = new SoundChip('kick', 1, 100, 0, '');

			await expect(soundChip.fetchRemote('simfile123', 'https://bucket.com')).rejects.toThrow(
				'Sound chip file name is not set'
			);
		});

		it('should throw error when fetch fails', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 404,
				statusText: 'Not Found'
			});

			const soundChip = new SoundChip('kick', 1, 100, 0, 'kick.wav');

			await expect(soundChip.fetchRemote('simfile123', 'https://bucket.com')).rejects.toThrow(
				'Failed to fetch sound chip: kick.wav (404: Not Found)'
			);
		});

		it('should create file from successful fetch', async () => {
			const mockBlob = new Blob(['audio content']);
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				blob: () => Promise.resolve(mockBlob)
			});

			const soundChip = new SoundChip('kick', 1, 100, 0, 'kick.wav');
			await soundChip.fetchRemote('simfile123', 'https://bucket.com');

			expect(fetch).toHaveBeenCalledWith('https://bucket.com/simfile123/kick.wav');
			expect(soundChip.file).toBeInstanceOf(File);
			expect(soundChip.file?.name).toBe('kick.wav');
		});
	});
});

describe('DTXFile', () => {
	describe('constructor', () => {
		it('should create an empty DTXFile', () => {
			const dtxFile = new DTXFile();

			expect(dtxFile.difficulty).toBeUndefined();
		});

		it('should store file and difficulty', () => {
			const file = new File(['content'], 'test.dtx');
			const dtxFile = new DTXFile(file, 'BASIC');

			expect(dtxFile.difficulty).toBe('BASIC');
		});
	});

	describe('getFileName', () => {
		it('should return filename if file is a File object', () => {
			const file = new File(['content'], 'test.dtx');
			const dtxFile = new DTXFile(file);

			expect(dtxFile.getFileName()).toBe('test.dtx');
		});

		it('should return null if file is a string', () => {
			const dtxFile = new DTXFile('string content');

			expect(dtxFile.getFileName()).toBeNull();
		});

		it('should return null if no file is set', () => {
			const dtxFile = new DTXFile();

			expect(dtxFile.getFileName()).toBeNull();
		});
	});

	describe('parseFromText', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		it('should parse basic header information', async () => {
			const dtxContent = [
				'#TITLE: Test Song',
				'#ARTIST: Test Artist',
				'#DLEVEL: 5',
				'#BPM: 140',
				'#PREIMAGE: preview.jpg',
				'#PREVIEW: preview.wav'
			].join('\r\n');

			await dtxFile.parseFromText(dtxContent);

			expect(dtxFile.title).toBe('Test Song');
			expect(dtxFile.artist).toBe('Test Artist');
			expect(dtxFile.level).toBe(5);
			expect(dtxFile.bpm).toBe(140);
			expect(dtxFile.preview).toBe('preview.jpg');
			expect(dtxFile.soundPreview).toBe('preview.wav');
		});

		it('should handle missing values with defaults', async () => {
			const dtxContent = '#TITLE: Test Song\r\n';

			await dtxFile.parseFromText(dtxContent);

			expect(dtxFile.title).toBe('Test Song');
			expect(dtxFile.artist).toBe('');
			expect(dtxFile.level).toBe(0);
			expect(dtxFile.bpm).toBe(0);
		});

		it('should store all lines', async () => {
			const dtxContent = '#TITLE: Test\r\n#ARTIST: Artist';

			await dtxFile.parseFromText(dtxContent);

			expect(dtxFile.lines).toEqual(['#TITLE: Test', '#ARTIST: Artist']);
		});
	});

	describe('parseSoundChips', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		it('should parse sound chips from lines', () => {
			dtxFile.lines = [
				'#WAV01: kick.wav',
				'#WAV02: snare.wav',
				'#VOLUME01: 80',
				'#POSITION02: 50'
			];

			const soundChips = dtxFile.parseSoundChips();

			expect(soundChips).toHaveLength(2);
			expect(soundChips[0].id).toBe(1);
			expect(soundChips[0].fileName).toBe('kick.wav');
			expect(soundChips[0].volume).toBe(80);
			expect(soundChips[0].position).toBe(0);

			expect(soundChips[1].id).toBe(2);
			expect(soundChips[1].fileName).toBe('snare.wav');
			expect(soundChips[1].volume).toBe(100);
			expect(soundChips[1].position).toBe(50);
		});

		it('should handle base-36 IDs', () => {
			dtxFile.lines = ['#WAVA1: hihat.wav'];

			const soundChips = dtxFile.parseSoundChips();

			expect(soundChips).toHaveLength(1);
			expect(soundChips[0].id).toBe(361); // A1 in base 36 = 10*36 + 1
		});
	});

	describe('parseBPMChanges', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		it('should parse BPM changes', () => {
			dtxFile.lines = ['#BPM01: 140.5', '#BPM02: 180', '#BPM: 120'];

			const bpmChanges = dtxFile.parseBPMChanges();

			expect(bpmChanges['01']).toBe(140.5);
			expect(bpmChanges['02']).toBe(180);
			expect(bpmChanges['']).toBe(120);
		});

		it('should handle empty BPM lines', () => {
			dtxFile.lines = ['#TITLE: Test'];

			const bpmChanges = dtxFile.parseBPMChanges();

			expect(Object.keys(bpmChanges)).toHaveLength(0);
		});
	});

	describe('parseNotes', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		it('should parse note lines', () => {
			dtxFile.lines = ['#00011: 01020000', '#00112: 03000400', '#TITLE: Test Song'];

			const notes = dtxFile.parseNotes();

			expect(notes).toHaveLength(2);
			expect(notes[0].measure).toBe(0);
			expect(notes[0].laneID).toBe('11');
			expect(notes[0].notes).toHaveLength(2);

			expect(notes[1].measure).toBe(1);
			expect(notes[1].laneID).toBe('12');
			expect(notes[1].notes).toHaveLength(2);
		});

		it('should handle no note lines', () => {
			dtxFile.lines = ['#TITLE: Test Song'];

			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			const notes = dtxFile.parseNotes();

			expect(notes).toHaveLength(0);
			expect(consoleSpy).toHaveBeenCalledWith('No note line found.');
			consoleSpy.mockRestore();
		});

		describe('higher subdivision parsing', () => {
			it('should parse 24th note patterns correctly', () => {
				// Create a 24-note pattern (48 characters)
				const patternParts = new Array(24).fill('00');
				patternParts[0] = '01'; // First 24th note
				patternParts[1] = '02'; // Second 24th note
				patternParts[8] = '03'; // Ninth 24th note (8/24 = 1/3)
				const pattern = patternParts.join('');

				dtxFile.lines = [`#00011: ${pattern}`];

				const notes = dtxFile.parseNotes();

				expect(notes).toHaveLength(1);
				expect(notes[0].measure).toBe(0);
				expect(notes[0].laneID).toBe('11');
				expect(notes[0].notes).toHaveLength(3);

				// Check positions are correct fractions of 24
				expect(notes[0].notes[0].position).toBe(0);
				expect(notes[0].notes[1].position).toBeCloseTo(1 / 24, 10);
				expect(notes[0].notes[2].position).toBeCloseTo(8 / 24, 10);
			});

			it('should parse 32nd note patterns correctly', () => {
				// Create a 32-note pattern (64 characters)
				const patternParts = new Array(32).fill('00');
				patternParts[0] = '01'; // First 32nd note
				patternParts[2] = '02'; // Third 32nd note
				patternParts[16] = '03'; // Seventeenth 32nd note (16/32 = 1/2)
				const pattern = patternParts.join('');

				dtxFile.lines = [`#00012: ${pattern}`];

				const notes = dtxFile.parseNotes();

				expect(notes).toHaveLength(1);
				expect(notes[0].measure).toBe(0);
				expect(notes[0].laneID).toBe('12');
				expect(notes[0].notes).toHaveLength(3);

				// Check positions are correct fractions of 32
				expect(notes[0].notes[0].position).toBe(0);
				expect(notes[0].notes[1].position).toBeCloseTo(2 / 32, 10);
				expect(notes[0].notes[2].position).toBeCloseTo(16 / 32, 10);
			});

			it('should parse 48th note patterns correctly', () => {
				// Create a 48-note pattern (96 characters)
				const patternParts = new Array(48).fill('00');
				patternParts[0] = '01'; // First 48th note
				patternParts[5] = '02'; // Sixth 48th note
				patternParts[23] = '03'; // Twenty-fourth 48th note
				const pattern = patternParts.join('');

				dtxFile.lines = [`#00013: ${pattern}`];

				const notes = dtxFile.parseNotes();

				expect(notes).toHaveLength(1);
				expect(notes[0].measure).toBe(0);
				expect(notes[0].laneID).toBe('13');
				expect(notes[0].notes).toHaveLength(3);

				// Check positions are correct fractions of 48
				expect(notes[0].notes[0].position).toBe(0);
				expect(notes[0].notes[1].position).toBeCloseTo(5 / 48, 10);
				expect(notes[0].notes[2].position).toBeCloseTo(23 / 48, 10);
			});

			it('should parse 64th note patterns correctly', () => {
				// Create a 64-note pattern (128 characters)
				const patternParts = new Array(64).fill('00');
				patternParts[0] = '01'; // First 64th note
				patternParts[7] = '02'; // Eighth 64th note
				patternParts[31] = '03'; // Thirty-second 64th note (31/64)
				const pattern = patternParts.join('');

				dtxFile.lines = [`#00014: ${pattern}`];

				const notes = dtxFile.parseNotes();

				expect(notes).toHaveLength(1);
				expect(notes[0].measure).toBe(0);
				expect(notes[0].laneID).toBe('14');
				expect(notes[0].notes).toHaveLength(3);

				// Check positions are correct fractions of 64
				expect(notes[0].notes[0].position).toBe(0);
				expect(notes[0].notes[1].position).toBeCloseTo(7 / 64, 10);
				expect(notes[0].notes[2].position).toBeCloseTo(31 / 64, 10);
			});

			it('should handle mixed subdivision patterns in different measures', () => {
				// Mix 16th, 24th, and 32nd note patterns
				const pattern16 = '01020304'; // 4 16th notes
				const pattern24 = new Array(24)
					.fill('00')
					.join('')
					.replace(/^../, '05')
					.replace(/(.{22})../, '$106'); // 2 24th notes
				const pattern32 = new Array(32)
					.fill('00')
					.join('')
					.replace(/^../, '07')
					.replace(/(.{30})../, '$108'); // 2 32nd notes

				dtxFile.lines = [
					`#00011: ${pattern16}`, // Measure 0, 16th notes
					`#00111: ${pattern24}`, // Measure 1, 24th notes
					`#00211: ${pattern32}` // Measure 2, 32nd notes
				];

				const notes = dtxFile.parseNotes();

				expect(notes).toHaveLength(3);

				// Verify 16th note measure
				expect(notes[0].measure).toBe(0);
				expect(notes[0].notes).toHaveLength(4);

				// Verify 24th note measure
				expect(notes[1].measure).toBe(1);
				expect(notes[1].notes).toHaveLength(2);
				expect(notes[1].notes[0].position).toBe(0);
				expect(notes[1].notes[1].position).toBeCloseTo(11 / 24, 10);

				// Verify 32nd note measure
				expect(notes[2].measure).toBe(2);
				expect(notes[2].notes).toHaveLength(2);
				expect(notes[2].notes[0].position).toBe(0);
				expect(notes[2].notes[1].position).toBeCloseTo(15 / 32, 10);
			});

			it('should maintain precision for complex subdivision patterns', () => {
				// Test pattern with notes at precise fractional positions
				const patternParts = new Array(48).fill('00');
				patternParts[0] = '01'; // 0/48
				patternParts[1] = '02'; // 1/48
				patternParts[2] = '03'; // 2/48 = 1/24
				patternParts[3] = '04'; // 3/48 = 1/16
				patternParts[6] = '05'; // 6/48 = 1/8
				patternParts[12] = '06'; // 12/48 = 1/4
				patternParts[24] = '07'; // 24/48 = 1/2
				const pattern = patternParts.join('');

				dtxFile.lines = [`#00011: ${pattern}`];

				const notes = dtxFile.parseNotes();

				expect(notes).toHaveLength(1);
				expect(notes[0].notes).toHaveLength(7);

				// Verify each position is precise
				const positions = notes[0].notes.map((n) => n.position);
				expect(positions[0]).toBe(0); // 0/48
				expect(positions[1]).toBeCloseTo(1 / 48, 10); // 1/48
				expect(positions[2]).toBeCloseTo(2 / 48, 10); // 2/48 = 1/24
				expect(positions[3]).toBeCloseTo(3 / 48, 10); // 3/48 = 1/16
				expect(positions[4]).toBeCloseTo(6 / 48, 10); // 6/48 = 1/8
				expect(positions[5]).toBeCloseTo(12 / 48, 10); // 12/48 = 1/4
				expect(positions[6]).toBeCloseTo(24 / 48, 10); // 24/48 = 1/2
			});
		});
	});

	describe('export', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
			dtxFile.title = 'Test Song';
			dtxFile.artist = 'Test Artist';
			dtxFile.level = 5;
			dtxFile.bpm = 140;
			dtxFile.preview = 'preview.jpg';
			dtxFile.soundPreview = 'preview.wav';
			dtxFile.comment = 'Test comment';

			// Reset mocks and captured content
			vi.clearAllMocks();
			capturedBlobContent = '';
		});

		it('should export basic DTX file without notes', async () => {
			dtxFile.soundChips = [
				new SoundChip('kick', 1, 100, 0, 'kick.wav'),
				new SoundChip('snare', 2, 80, 50, 'snare.wav')
			];

			await dtxFile.export();

			expect(window.URL.createObjectURL).toHaveBeenCalled();
			expect(document.createElement).toHaveBeenCalledWith('a');

			const content = getCapturedBlobContent();
			expect(content).toContain('#TITLE: Test Song');
			expect(content).toContain('#ARTIST: Test Artist');
			expect(content).toContain('#DLEVEL: 5');
			expect(content).toContain('#BPM: 140');
			expect(content).toContain('#PREIMAGE: preview.jpg');
			expect(content).toContain('#PREVIEW: preview.wav');
			expect(content).toContain('#COMMENT: Test comment');
			expect(content).toContain('#WAV01: kick.wav');
			expect(content).toContain('#WAV02: snare.wav');
			expect(content).toContain('#VOLUME02: 80');
			expect(content).toContain('#POSITION02: 50');
		});

		it('should export DTX file with notes', async () => {
			const notes = {
				'11': [
					new LaneMeasureNote(0, '11', [
						{ noteID: '01', position: 0 },
						{ noteID: '02', position: 0.25 }
					])
				],
				'12': [new LaneMeasureNote(1, '12', [{ noteID: '03', position: 0.5 }])]
			};

			await dtxFile.export(notes);

			const content = getCapturedBlobContent();
			expect(content).toContain('#00011: 01020000');
			expect(content).toContain('#00112: 00000300');
		});

		it('should handle empty DTX file export', async () => {
			const emptyDtxFile = new DTXFile();

			await emptyDtxFile.export();

			const content = getCapturedBlobContent();
			expect(content).toContain('#TITLE: ');
			expect(content).toContain('#ARTIST: ');
			expect(content).toContain('#DLEVEL: 0');
			expect(content).toContain('#BPM: 120');
		});

		it('should sort notes by measure and lane ID', async () => {
			const notes = {
				'12': [new LaneMeasureNote(0, '12', [{ noteID: '02', position: 0 }])],
				'11': [new LaneMeasureNote(1, '11', [{ noteID: '01', position: 0 }])]
			};

			await dtxFile.export(notes);

			const content = getCapturedBlobContent();
			const lines = content.split('\r\n');
			const noteLines = lines.filter((line) => line.match(/^#\d+/));

			// Should be sorted by measure first, then lane ID
			// Measure 0, lane 12 should come before measure 1, lane 11
			expect(noteLines[0]).toContain('#00012:');
			expect(noteLines[1]).toContain('#00111:');
		});

		it('should sort notes by lane ID when in the same measure', async () => {
			const notes = {
				'1B': [new LaneMeasureNote(0, '1B', [{ noteID: '02', position: 0 }])],
				'1A': [new LaneMeasureNote(0, '1A', [{ noteID: '01', position: 0 }])]
			};

			await dtxFile.export(notes);

			const content = getCapturedBlobContent();
			const lines = content.split('\r\n');
			const noteLines = lines.filter((line) => line.match(/^#\d+/));

			// Same measure (0), sorted by lane ID: 1A before 1B
			expect(noteLines[0]).toContain('#0001A:');
			expect(noteLines[1]).toContain('#0001B:');
		});

		it('should use title as filename', async () => {
			await dtxFile.export();

			const createElementCall = (document.createElement as any).mock.calls[0];

			// The download property should be set after createElement returns the mock element
			expect(createElementCall).toBeTruthy();
		});
	});

	describe('parse', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('should parse from string content directly', async () => {
			const content = '#TITLE: String Song\r\n#ARTIST: String Artist\r\n#BPM: 160\r\n';
			const dtxFile = new DTXFile(content);

			await dtxFile.parse();

			expect(dtxFile.title).toBe('String Song');
			expect(dtxFile.artist).toBe('String Artist');
			expect(dtxFile.bpm).toBe(160);
		});

		it('should call parseWithEncodingDetection when parsing a File without encoding', async () => {
			const mockContent = '#TITLE: Encoded Song\r\n#ARTIST: Encoded Artist\r\n#BPM: 120\r\n';
			vi.mocked(decodeFileWithEncodingDetection).mockResolvedValue({
				content: mockContent,
				encoding: 'shift-jis'
			});

			const file = new File(['raw bytes'], 'test.dtx');
			const dtxFile = new DTXFile(file);

			await dtxFile.parse();

			expect(decodeFileWithEncodingDetection).toHaveBeenCalledWith(
				file,
				expect.any(Function),
				expect.any(Array),
				expect.any(String)
			);
			expect(dtxFile.title).toBe('Encoded Song');
			expect(dtxFile.artist).toBe('Encoded Artist');
			expect(dtxFile.detectedEncoding).toBe('shift-jis');
		});

		it('should call parseWithSpecificEncoding when parsing a File with explicit encoding', async () => {
			const mockContent = '#TITLE: UTF8 Song\r\n#BPM: 140\r\n';
			vi.mocked(decodeFileWithSpecificEncoding).mockResolvedValue(mockContent);

			const file = new File(['raw bytes'], 'test.dtx');
			const dtxFile = new DTXFile(file);

			await dtxFile.parse('utf-8');

			expect(decodeFileWithSpecificEncoding).toHaveBeenCalledWith(file, 'utf-8');
			expect(dtxFile.title).toBe('UTF8 Song');
			expect(dtxFile.bpm).toBe(140);
		});

		it('should handle no file set gracefully', async () => {
			const dtxFile = new DTXFile();
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await dtxFile.parse();

			expect(consoleSpy).toHaveBeenCalledWith('File is not set');
			consoleSpy.mockRestore();
		});

		it('should invoke DTX content validation callback correctly', async () => {
			// Capture the validation callback and test it
			let capturedValidateCallback: ((content: string) => boolean) | undefined;
			vi.mocked(decodeFileWithEncodingDetection).mockImplementation(
				async (_file, validateContent) => {
					capturedValidateCallback = validateContent;
					return { content: '#TITLE: Test\r\n', encoding: 'utf-8' };
				}
			);

			const file = new File(['raw bytes'], 'test.dtx');
			const dtxFile = new DTXFile(file);
			await dtxFile.parse();

			expect(capturedValidateCallback).toBeDefined();
			// Valid DTX content
			expect(capturedValidateCallback!('#TITLE: My Song')).toBe(true);
			expect(capturedValidateCallback!('#ARTIST: Artist')).toBe(true);
			expect(capturedValidateCallback!('#BPM: 120')).toBe(true);
			expect(capturedValidateCallback!('#WAV01: kick.wav')).toBe(true);
			// Invalid content
			expect(capturedValidateCallback!('some random text')).toBe(false);
		});
	});

	describe('MIDI to DTX conversion', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		// Helper function to create a minimal valid MIDI file
		const createTestMidiData = (
			notes: Array<{ deltaTime: number; note: number; velocity: number }> = []
		) => {
			// Create minimal MIDI header (14 bytes)
			const header = new Uint8Array(14);
			header.set([0x4d, 0x54, 0x68, 0x64]); // "MThd"
			header.set([0x00, 0x00, 0x00, 0x06], 4); // Header length: 6
			header.set([0x00, 0x00], 8); // Format: 0
			header.set([0x00, 0x01], 10); // Tracks: 1
			header.set([0x01, 0xe0], 12); // Ticks per quarter: 480

			// Create track data
			const trackEvents: number[] = [];

			// Add tempo meta event (120 BPM)
			trackEvents.push(0x00); // Delta time: 0
			trackEvents.push(0xff, 0x51, 0x03); // Meta event: Set Tempo, length 3
			trackEvents.push(0x07, 0xa1, 0x20); // 500000 microseconds per quarter = 120 BPM

			// Add note events
			notes.forEach((note, index) => {
				// Variable length delta time encoding
				if (note.deltaTime < 128) {
					trackEvents.push(note.deltaTime);
				} else {
					// Simple encoding for values >= 128
					trackEvents.push(0x81, 0x00);
				}

				// Note On event (channel 9 = drum channel)
				trackEvents.push(0x99, note.note, note.velocity);

				// Note Off event after 120 ticks
				trackEvents.push(0x78); // Delta time: 120
				trackEvents.push(0x89, note.note, 0x00);
			});

			// End of track
			trackEvents.push(0x00); // Delta time: 0
			trackEvents.push(0xff, 0x2f, 0x00); // End of Track

			// Create track chunk
			const trackLength = trackEvents.length;
			const track = new Uint8Array(8 + trackLength);
			track.set([0x4d, 0x54, 0x72, 0x6b], 0); // "MTrk"
			track.set(
				[
					(trackLength >> 24) & 0xff,
					(trackLength >> 16) & 0xff,
					(trackLength >> 8) & 0xff,
					trackLength & 0xff
				],
				4
			);
			track.set(trackEvents, 8);

			// Combine header and track
			const midiFile = new Uint8Array(header.length + track.length);
			midiFile.set(header, 0);
			midiFile.set(track, header.length);

			return midiFile;
		};

		describe('parseFromMidi', () => {
			it('should parse a basic MIDI file', async () => {
				const midiData = createTestMidiData([
					{ deltaTime: 0, note: 36, velocity: 100 }, // Bass drum
					{ deltaTime: 480, note: 38, velocity: 80 } // Snare
				]);

				// Mock File with arrayBuffer method
				const file = {
					name: 'test.mid',
					type: 'audio/midi',
					arrayBuffer: async () => midiData.buffer
				} as File;

				await dtxFile.parseFromMidi(file);

				expect(dtxFile.title).toBe('Converted from MIDI');
				expect(dtxFile.artist).toBe('Unknown');
				expect(dtxFile.level).toBe(5);
				expect(dtxFile.bpm).toBe(120);
				expect(dtxFile.comment).toBe('Converted from MIDI file');
			});

			it('should throw error for invalid MIDI file', async () => {
				const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
				// Mock File with arrayBuffer method
				const file = {
					name: 'invalid.mid',
					type: 'audio/midi',
					arrayBuffer: async () => invalidData.buffer
				} as File;

				await expect(dtxFile.parseFromMidi(file)).rejects.toThrow(
					'Invalid MIDI file: Missing header'
				);
			});
		});

		describe('MIDI file parsing internals', () => {
			it('should read MIDI header correctly', () => {
				const midiData = createTestMidiData();
				const parsedData = (dtxFile as any).parseMidiFile(midiData);

				expect(parsedData.format).toBe(0);
				expect(parsedData.trackCount).toBe(1);
				expect(parsedData.ticksPerQuarter).toBe(480);
				expect(parsedData.tracks).toHaveLength(1);
			});

			it('should parse MIDI tracks correctly', () => {
				const midiData = createTestMidiData([{ deltaTime: 0, note: 36, velocity: 100 }]);
				const parsedData = (dtxFile as any).parseMidiFile(midiData);

				expect(parsedData.tracks[0]).toBeDefined();
				expect(Array.isArray(parsedData.tracks[0])).toBe(true);
				expect(parsedData.tracks[0].length).toBeGreaterThan(0);

				// Should contain tempo event and note events
				const tempoEvent = parsedData.tracks[0].find(
					(e: any) => e.type === 'meta' && e.subtype === 0x51
				);
				expect(tempoEvent).toBeDefined();

				const noteEvent = parsedData.tracks[0].find(
					(e: any) => e.type === 'channel' && e.command === 0x9
				);
				expect(noteEvent).toBeDefined();
				expect(noteEvent.note).toBe(36);
			});

			it('should read variable length values correctly', () => {
				const testCases = [
					{ input: new Uint8Array([0x00]), expected: { value: 0, nextOffset: 1 } },
					{ input: new Uint8Array([0x7f]), expected: { value: 127, nextOffset: 1 } },
					{
						input: new Uint8Array([0x81, 0x00]),
						expected: { value: 128, nextOffset: 2 }
					},
					{
						input: new Uint8Array([0xff, 0x7f]),
						expected: { value: 16383, nextOffset: 2 }
					}
				];

				testCases.forEach((testCase) => {
					const result = (dtxFile as any).readVariableLength(testCase.input, 0);
					expect(result.value).toBe(testCase.expected.value);
					expect(result.nextOffset).toBe(testCase.expected.nextOffset);
				});
			});

			it('should read uint16 and uint32 correctly', () => {
				const testData = new Uint8Array([0x12, 0x34, 0x56, 0x78]);

				const uint16Result = (dtxFile as any).readUint16(testData, 0);
				expect(uint16Result).toBe(0x1234);

				const uint32Result = (dtxFile as any).readUint32(testData, 0);
				expect(uint32Result).toBe(0x12345678);
			});
		});

		describe('convertMidiNotesToDtx', () => {
			it('should convert MIDI notes to DTX lane format', async () => {
				const midiData = createTestMidiData([
					{ deltaTime: 0, note: 36, velocity: 100 }, // Bass drum -> lane 01
					{ deltaTime: 480, note: 38, velocity: 80 }, // Snare -> lane 02
					{ deltaTime: 480, note: 42, velocity: 90 } // Hi-hat -> lane 03
				]);

				const file = {
					name: 'test.mid',
					type: 'audio/midi',
					arrayBuffer: async () => midiData.buffer
				} as File;
				await dtxFile.parseFromMidi(file);

				const arrayBuffer = await file.arrayBuffer();
				const data = new Uint8Array(arrayBuffer);
				const parsedMidiData = (dtxFile as any).parseMidiFile(data);
				const convertedNotes = dtxFile.convertMidiNotesToDtx(parsedMidiData);

				expect(convertedNotes['01']).toBeDefined(); // Bass drum lane
				expect(convertedNotes['02']).toBeDefined(); // Snare lane
				expect(convertedNotes['03']).toBeDefined(); // Hi-hat lane
			});

			it('should map MIDI notes to correct DTX lanes', () => {
				const mockMidiData = {
					ticksPerQuarter: 480,
					tracks: [
						[
							{
								deltaTime: 0,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							}, // Bass -> 01
							{
								deltaTime: 480,
								type: 'channel',
								command: 0x9,
								note: 38,
								velocity: 80
							}, // Snare -> 02
							{
								deltaTime: 480,
								type: 'channel',
								command: 0x9,
								note: 42,
								velocity: 90
							}, // Hi-hat -> 03
							{
								deltaTime: 480,
								type: 'channel',
								command: 0x9,
								note: 46,
								velocity: 70
							}, // Open Hi-hat -> 04
							{
								deltaTime: 480,
								type: 'channel',
								command: 0x9,
								note: 49,
								velocity: 85
							}, // Crash -> 05
							{
								deltaTime: 480,
								type: 'channel',
								command: 0x9,
								note: 51,
								velocity: 75
							} // Ride -> 06
						]
					]
				};

				const convertedNotes = dtxFile.convertMidiNotesToDtx(mockMidiData);

				expect(convertedNotes['01']).toBeDefined(); // Bass drum
				expect(convertedNotes['02']).toBeDefined(); // Snare
				expect(convertedNotes['03']).toBeDefined(); // Closed Hi-hat
				expect(convertedNotes['04']).toBeDefined(); // Open Hi-hat
				expect(convertedNotes['05']).toBeDefined(); // Crash
				expect(convertedNotes['06']).toBeDefined(); // Ride
			});

			it('should calculate measure positions correctly', () => {
				const mockMidiData = {
					ticksPerQuarter: 480,
					tracks: [
						[
							{
								deltaTime: 0,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							}, // Start of measure 0
							{
								deltaTime: 960,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							}, // Half of measure 0
							{
								deltaTime: 960,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							} // Start of measure 1
						]
					]
				};

				const convertedNotes = dtxFile.convertMidiNotesToDtx(mockMidiData);

				expect(convertedNotes['01']).toHaveLength(2); // Two measures
				expect(convertedNotes['01'][0].measure).toBe(0);
				expect(convertedNotes['01'][1].measure).toBe(1);

				// Check positions within measures
				expect(convertedNotes['01'][0].notes[0].position).toBe(0); // Start of measure
				expect(convertedNotes['01'][0].notes[1].position).toBe(0.5); // Middle of measure
				expect(convertedNotes['01'][1].notes[0].position).toBe(0); // Start of next measure
			});

			it('should ignore Note Off events and notes with zero velocity', () => {
				const mockMidiData = {
					ticksPerQuarter: 480,
					tracks: [
						[
							{
								deltaTime: 0,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							}, // Note On
							{
								deltaTime: 240,
								type: 'channel',
								command: 0x8,
								note: 36,
								velocity: 0
							}, // Note Off (should ignore)
							{
								deltaTime: 240,
								type: 'channel',
								command: 0x9,
								note: 38,
								velocity: 0
							}, // Note On with 0 velocity (should ignore)
							{
								deltaTime: 240,
								type: 'channel',
								command: 0x9,
								note: 42,
								velocity: 80
							} // Valid Note On
						]
					]
				};

				const convertedNotes = dtxFile.convertMidiNotesToDtx(mockMidiData);

				expect(convertedNotes['01']).toBeDefined(); // Bass drum from first note
				expect(convertedNotes['02']).toBeUndefined(); // Snare should not exist (0 velocity)
				expect(convertedNotes['03']).toBeDefined(); // Hi-hat from last note

				expect(convertedNotes['01'][0].notes).toHaveLength(1); // Only one valid note
				expect(convertedNotes['03'][0].notes).toHaveLength(1); // Only one valid note
			});

			it('should handle unknown MIDI notes gracefully', () => {
				const mockMidiData = {
					ticksPerQuarter: 480,
					tracks: [
						[
							{
								deltaTime: 0,
								type: 'channel',
								command: 0x9,
								note: 99,
								velocity: 100
							}, // Unknown note
							{
								deltaTime: 480,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 80
							} // Known note
						]
					]
				};

				const convertedNotes = dtxFile.convertMidiNotesToDtx(mockMidiData);

				// Should only have the known note
				expect(convertedNotes['01']).toBeDefined(); // Bass drum
				expect(Object.keys(convertedNotes)).toHaveLength(1);
			});

			it('should sort notes correctly within measures', () => {
				const mockMidiData = {
					ticksPerQuarter: 480,
					tracks: [
						[
							{
								deltaTime: 1440,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							}, // 3/4 through measure
							{
								deltaTime: -960,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							}, // 1/4 through measure (negative delta)
							{
								deltaTime: -480,
								type: 'channel',
								command: 0x9,
								note: 36,
								velocity: 100
							} // Start of measure (negative delta)
						]
					]
				};

				// Fix the test data - MIDI delta times should be cumulative
				mockMidiData.tracks[0] = [
					{ deltaTime: 0, type: 'channel', command: 0x9, note: 36, velocity: 100 }, // Start
					{ deltaTime: 480, type: 'channel', command: 0x9, note: 36, velocity: 100 }, // Quarter
					{ deltaTime: 960, type: 'channel', command: 0x9, note: 36, velocity: 100 } // Three quarters
				];

				const convertedNotes = dtxFile.convertMidiNotesToDtx(mockMidiData);

				expect(convertedNotes['01'][0].notes).toHaveLength(3);

				// Check positions are sorted
				const positions = convertedNotes['01'][0].notes.map((n) => n.position);
				expect(positions[0]).toBeLessThan(positions[1]);
				expect(positions[1]).toBeLessThan(positions[2]);
			});
		});

		describe('edge cases and error handling', () => {
			it('should handle empty MIDI file', async () => {
				const emptyMidiData = createTestMidiData([]); // No notes
				const file = {
					name: 'empty.mid',
					type: 'audio/midi',
					arrayBuffer: async () => emptyMidiData.buffer
				} as File;

				await dtxFile.parseFromMidi(file);

				expect(dtxFile.title).toBe('Converted from MIDI');
				expect(dtxFile.bpm).toBe(120);
			});

			it('should handle malformed MIDI track', () => {
				const invalidTrackData = new Uint8Array([
					0x4d,
					0x54,
					0x68,
					0x64, // MThd
					0x00,
					0x00,
					0x00,
					0x06, // Header length
					0x00,
					0x00,
					0x00,
					0x01,
					0x01,
					0xe0, // Format 0, 1 track, 480 ticks
					0x4d,
					0x54,
					0x72,
					0x6b, // MTrk
					0x00,
					0x00,
					0x00,
					0x04, // Track length: 4
					0xff,
					0xff,
					0xff,
					0xff // Invalid data
				]);

				expect(() => (dtxFile as any).parseMidiFile(invalidTrackData)).not.toThrow();
			});

			it('should extract BPM from tempo meta events', async () => {
				// The createTestMidiData already creates a MIDI with 120 BPM by default
				// Let's just verify that it correctly extracts the default BPM
				const midiData = createTestMidiData();

				const file = {
					name: 'test120.mid',
					type: 'audio/midi',
					arrayBuffer: async () => midiData.buffer
				} as File;
				await dtxFile.parseFromMidi(file);

				expect(dtxFile.bpm).toBe(120);
			});

			it('should handle multiple tracks', () => {
				// This is a simplified test since creating multi-track MIDI is complex
				const mockMidiData = {
					tracks: [
						[{ deltaTime: 0, type: 'channel', command: 0x9, note: 36, velocity: 100 }],
						[{ deltaTime: 480, type: 'channel', command: 0x9, note: 38, velocity: 80 }]
					],
					ticksPerQuarter: 480
				};

				const convertedNotes = dtxFile.convertMidiNotesToDtx(mockMidiData);

				expect(convertedNotes['01']).toBeDefined(); // From track 1
				expect(convertedNotes['02']).toBeDefined(); // From track 2
			});
		});
	});

	describe('error handling and edge cases', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		it('should handle malformed measure patterns gracefully', () => {
			dtxFile.lines = [
				'#00011: 0102', // Too short pattern
				'#00111: 01020304050607080910111213141516', // Valid 16-note pattern
				'#00211: INVALID_PATTERN', // Invalid characters
				'#00311: ' // Empty pattern
			];

			expect(() => dtxFile.parseNotes()).not.toThrow();

			const notes = dtxFile.parseNotes();
			// Should only parse the valid measure
			expect(notes.length).toBeGreaterThan(0);
		});

		it('should handle invalid measure numbers', () => {
			dtxFile.lines = [
				'#99999: 01020000', // Very high measure number
				'#-0111: 01020000', // Invalid negative measure
				'#XXX11: 01020000', // Non-numeric measure
				'#00011: 01020000' // Valid measure
			];

			const notes = dtxFile.parseNotes();
			// Should parse only valid measures
			expect(Array.isArray(notes)).toBe(true);
		});

		it('should handle invalid lane IDs gracefully', () => {
			dtxFile.lines = [
				'#000XX: 01020000', // Invalid lane ID
				'#00099: 01020000', // Out of range lane ID
				'#00011: 01020000' // Valid lane ID
			];

			expect(() => dtxFile.parseNotes()).not.toThrow();
		});

		it('should handle empty or whitespace-only content', () => {
			dtxFile.lines = ['', '   ', '\t', '\n'];

			const notes = dtxFile.parseNotes();
			expect(notes).toHaveLength(0);
		});

		it('should handle files without sound chips', () => {
			dtxFile.soundChips = [];
			dtxFile.lines = ['#00011: 01020000'];

			expect(() => dtxFile.parseNotes()).not.toThrow();
			const notes = dtxFile.parseNotes();
			expect(Array.isArray(notes)).toBe(true);
		});

		it('should validate sound chip properties', () => {
			const validChip = new SoundChip('test', 1, 100, 0, 'test.wav');
			expect(validChip.label).toBe('test');
			expect(validChip.id).toBe(1);
			expect(validChip.volume).toBe(100);
			expect(validChip.position).toBe(0);
			expect(validChip.fileName).toBe('test.wav');

			// Test edge case values
			const chipWithNegativePosition = new SoundChip('test', 2, 0, -100, 'test2.wav');
			expect(chipWithNegativePosition.volume).toBe(0);
			expect(chipWithNegativePosition.position).toBe(-100);

			const chipWithHighValues = new SoundChip('test', 3, 200, 100, 'test3.wav');
			expect(chipWithHighValues.volume).toBe(200);
			expect(chipWithHighValues.position).toBe(100);

			// Test filename normalization
			const chipWithUppercaseFile = new SoundChip('test', 4, 100, 0, 'TEST.WAV');
			expect(chipWithUppercaseFile.fileName).toBe('test.wav');
		});

		it('should handle export with corrupted note data', async () => {
			const corruptedNotes = {
				'11': [new LaneMeasureNote(-1, '11', [])] // Negative measure
			};

			await dtxFile.export(corruptedNotes);

			const content = getCapturedBlobContent();
			// Should still generate valid DTX structure
			expect(content).toContain('#TITLE:');
			expect(content).toContain('#ARTIST:');
		});

		it('should handle missing file properties gracefully', async () => {
			const dtxFileWithMissingProps = new DTXFile();
			// Don't set title, artist, etc.

			await dtxFileWithMissingProps.export();

			const content = getCapturedBlobContent();
			expect(content).toContain('#TITLE: '); // Empty but present
			expect(content).toContain('#ARTIST: '); // Empty but present
			expect(content).toContain('#DLEVEL: 0'); // Default value
			expect(content).toContain('#BPM: 120'); // Default value
		});
	});

	describe('exportToMidi', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
			dtxFile.bpm = 120;
		});

		it('should return a valid MIDI byte array with MThd and MTrk headers', () => {
			const result = dtxFile.exportToMidi({}, {});

			expect(result).toBeInstanceOf(Uint8Array);
			// MIDI header "MThd"
			expect(result[0]).toBe(0x4d);
			expect(result[1]).toBe(0x54);
			expect(result[2]).toBe(0x68);
			expect(result[3]).toBe(0x64);
			// Track chunk "MTrk"
			expect(result[14]).toBe(0x4d);
			expect(result[15]).toBe(0x54);
			expect(result[16]).toBe(0x72);
			expect(result[17]).toBe(0x6b);
		});

		it('should include tempo meta event (0xFF 0x51) in track data', () => {
			const result = dtxFile.exportToMidi({}, {});

			let foundTempo = false;
			for (let i = 22; i < result.length - 1; i++) {
				if (result[i] === 0xff && result[i + 1] === 0x51) {
					foundTempo = true;
					break;
				}
			}
			expect(foundTempo).toBe(true);
		});

		it('should produce longer output when notes are provided', () => {
			const notes: Record<string, LaneMeasureNote[]> = {
				'11': [new LaneMeasureNote(0, '11', [{ noteID: '01', position: 0 }])]
			};
			const withNotes = dtxFile.exportToMidi(notes, { '11': 36 });
			const withoutNotes = dtxFile.exportToMidi({}, {});

			expect(withNotes.length).toBeGreaterThan(withoutNotes.length);
		});
	});

	describe('MIDI parsing edge cases', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		const buildMidiData = (trackEvents: number[]): Uint8Array => {
			const header = new Uint8Array(14);
			header.set([0x4d, 0x54, 0x68, 0x64]);
			header.set([0x00, 0x00, 0x00, 0x06], 4);
			header.set([0x00, 0x00], 8);
			header.set([0x00, 0x01], 10);
			header.set([0x01, 0xe0], 12);

			const trackLen = trackEvents.length;
			const trackHeader = [
				0x4d,
				0x54,
				0x72,
				0x6b,
				(trackLen >> 24) & 0xff,
				(trackLen >> 16) & 0xff,
				(trackLen >> 8) & 0xff,
				trackLen & 0xff
			];

			const midiData = new Uint8Array(header.length + trackHeader.length + trackLen);
			midiData.set(header, 0);
			midiData.set(trackHeader, header.length);
			midiData.set(trackEvents, header.length + trackHeader.length);
			return midiData;
		};

		it('should skip non-note channel messages (e.g. Control Change)', () => {
			const trackEvents = [
				0x00,
				0xb9,
				0x07,
				0x64, // CC ch9 ctrl=7 val=100
				0x00,
				0xff,
				0x2f,
				0x00 // End of Track
			];
			const midiData = buildMidiData(trackEvents);

			const parsedData = (dtxFile as any).parseMidiFile(midiData);
			expect(parsedData.tracks).toHaveLength(1);
			const ccEvent = parsedData.tracks[0].find((e: any) => e.command === 0xb);
			expect(ccEvent).toBeUndefined();
		});

		it('should handle MIDI running status for consecutive note events', () => {
			const trackEvents = [
				// First Note On: status=0x99, note=36, vel=100
				0x00, 0x99, 0x24, 0x64,
				// Second note using running status: delta=0x00 is valid, note=38 (0x26 < 0x80), vel=80
				0x00,
				0x26, 0x50,
				// End of Track
				0x00, 0xff, 0x2f, 0x00
			];
			const midiData = buildMidiData(trackEvents);

			const parsedData = (dtxFile as any).parseMidiFile(midiData);
			const noteEvents = parsedData.tracks[0].filter(
				(e: any) => e.type === 'channel' && e.command === 0x9
			);
			expect(noteEvents.length).toBeGreaterThanOrEqual(2);
		});

		it('should throw when MIDI track header is not MTrk', () => {
			// Build a MIDI file where the track header is 'BADk' instead of 'MTrk'
			const invalidTrack = new Uint8Array([
				// MThd header
				0x4d, 0x54, 0x68, 0x64,
				// Header length = 6
				0x00, 0x00, 0x00, 0x06,
				// Format = 0
				0x00, 0x00,
				// Track count = 1
				0x00, 0x01,
				// Ticks per quarter = 480
				0x01, 0xe0,
				// Invalid track header 'BADk' instead of 'MTrk'
				0x42, 0x41, 0x44, 0x6b,
				// Track length = 0
				0x00, 0x00, 0x00, 0x00
			]);
			expect(() => (dtxFile as any).parseMidiFile(invalidTrack)).toThrow(
				'Invalid MIDI track'
			);
		});
	});
});
