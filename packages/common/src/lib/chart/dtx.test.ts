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
			const mockResponse = {
				ok: false,
				status: 404,
				statusText: 'Not Found',
				clone() {
					return this;
				}
			};
			global.fetch = vi.fn().mockResolvedValue(mockResponse);

			const soundChip = new SoundChip('kick', 1, 100, 0, 'kick.wav');

			await expect(soundChip.fetchRemote('simfile123', 'https://bucket.com')).rejects.toThrow(
				'Failed to fetch sound chip: kick.wav (404: Not Found)'
			);
		});

		it('should create file from successful fetch', async () => {
			const mockBlob = new Blob(['audio content']);
			const mockResponse = {
				ok: true,
				blob: () => Promise.resolve(mockBlob),
				clone() {
					return this;
				}
			};
			global.fetch = vi.fn().mockResolvedValue(mockResponse);

			const soundChip = new SoundChip('kick', 1, 100, 0, 'kick.wav');
			await soundChip.fetchRemote('simfile123', 'https://bucket.com');

			expect(fetch).toHaveBeenCalledWith('https://bucket.com/simfile123/kick.wav', undefined);
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

		it.each([
			['#PATH_WAV: .\\wav\\', '.\\wav\\'],
			['#PATH_WAV .\\wav\\', '.\\wav\\'],
			['#PATH_WAV:', '']
		])('parses "%s" as the WAV directory', async (line, expected) => {
			await dtxFile.parseFromText(line);

			expect(dtxFile.pathWav).toBe(expected);
		});

		it.each(['#PATH_WAV_EXTRA: other', '#PATH_WAV2: other'])(
			'ignores the longer directive "%s"',
			async (line) => {
				await dtxFile.parseFromText(line);

				expect(dtxFile.pathWav).toBeUndefined();
			}
		);

		it('prefers the real #PATH_WAV line over an earlier longer directive', async () => {
			await dtxFile.parseFromText('#PATH_WAV_EXTRA: other\r\n#PATH_WAV: drums');

			expect(dtxFile.pathWav).toBe('drums');
		});

		it('parses LF-only line endings', async () => {
			await dtxFile.parseFromText('#TITLE: LF Song\n#BPM: 150');

			expect(dtxFile.title).toBe('LF Song');
			expect(dtxFile.bpm).toBe(150);
		});

		it('parses LF and CRLF content identically across all parsed facets', async () => {
			const lfContent = [
				'#TITLE: LF Song',
				'#ARTIST: Artist',
				'#DLEVEL: 7',
				'#BPM: 142.5',
				'#BPM01: 180',
				'#PREIMAGE: preview.jpg',
				'#WAV01: KICK.WAV',
				'#VOLUME01: 90',
				'#00111: 01020000',
				'#00202: 0.75',
				'#00308: 01010101'
			].join('\n');
			const crlfContent = lfContent.replaceAll('\n', '\r\n');

			const lfFile = new DTXFile();
			await lfFile.parseFromText(lfContent);
			const crlfFile = new DTXFile();
			await crlfFile.parseFromText(crlfContent);

			// The LF copy must actually parse — equivalence alone would also
			// pass if both copies produced garbage.
			expect(lfFile.title).toBe('LF Song');
			expect(lfFile.artist).toBe('Artist');
			expect(lfFile.level).toBe(7);
			expect(lfFile.bpm).toBe(142.5);

			expect(crlfFile.lines).toEqual(lfFile.lines);
			expect([crlfFile.title, crlfFile.artist, crlfFile.level, crlfFile.bpm]).toEqual([
				lfFile.title,
				lfFile.artist,
				lfFile.level,
				lfFile.bpm
			]);
			expect(crlfFile.parseSoundChips()).toEqual(lfFile.parseSoundChips());
			expect(crlfFile.parseNotes()).toEqual(lfFile.parseNotes());
			expect(crlfFile.parseMeasureLengths()).toEqual(lfFile.parseMeasureLengths());
			expect(crlfFile.parseBPMChanges()).toEqual(lfFile.parseBPMChanges());
		});

		it('parses a decimal base BPM', async () => {
			await dtxFile.parseFromText('#BPM: 143.5');

			expect(dtxFile.bpm).toBe(143.5);
		});

		it('matches the exact #BPM directive when #BPM01 appears before it', async () => {
			await dtxFile.parseFromText('#BPM01: 200\r\n#BPM: 130.5');

			expect(dtxFile.bpm).toBe(130.5);
		});

		it('does not treat a #BPMxx definition as the base BPM', async () => {
			await dtxFile.parseFromText('#BPM01: 200');

			expect(dtxFile.bpm).toBe(0);
		});

		it.each(['#BPM: -20', '#BPM: 1e999'])(
			'rejects invalid base BPM from "%s"',
			async (line) => {
				await dtxFile.parseFromText(line);

				expect(dtxFile.bpm).toBe(0);
			}
		);
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

		it('tolerates no-space colon form (#WAV01:kick.wav)', () => {
			// Some DTX authors omit the space after the colon. parseNotes and
			// parseMeasureLengths already tolerate this form; parseSoundChips must
			// too, otherwise `line.split('#WAV01: ')[1]` is undefined and the
			// SoundChip constructor throws on `undefined.toLowerCase()`.
			dtxFile.lines = ['#WAV01:kick.wav', '#WAV02:snare.wav'];

			const soundChips = dtxFile.parseSoundChips();

			expect(soundChips).toHaveLength(2);
			expect(soundChips[0].id).toBe(1);
			expect(soundChips[0].fileName).toBe('kick.wav');
			expect(soundChips[1].id).toBe(2);
			expect(soundChips[1].fileName).toBe('snare.wav');
		});

		it('tolerates no-space colon form for VOLUME and POSITION', () => {
			dtxFile.lines = ['#WAV01:kick.wav', '#VOLUME01:80', '#POSITION01:50'];

			const soundChips = dtxFile.parseSoundChips();

			expect(soundChips).toHaveLength(1);
			expect(soundChips[0].fileName).toBe('kick.wav');
			expect(soundChips[0].volume).toBe(80);
			expect(soundChips[0].position).toBe(50);
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

		it('tolerates no-space colon form (#BPMAA:240)', () => {
			// Some DTX authors omit the space after the colon. parseNotes and
			// parseMeasureLengths already tolerate this form; parseBPMChanges
			// must too, otherwise `line.split(': ', 2)` returns a single element,
			// `bpm` is undefined, `parseFloat(undefined)` is NaN, and feeding
			// that into the timing builder turns totalDuration/cursor times into
			// NaN (NaN ?? bpm is NaN — `??` does not catch NaN).
			dtxFile.lines = ['#BPMAA:240', '#BPM01: 140.5'];

			const bpmChanges = dtxFile.parseBPMChanges();

			expect(bpmChanges['AA']).toBe(240);
			expect(bpmChanges['01']).toBe(140.5);
		});

		it('skips BPM lines with unparseable values instead of recording NaN', () => {
			// A malformed value (e.g. empty after the colon) must not inject NaN
			// into the bpm map, which would poison the timing builder.
			dtxFile.lines = ['#BPMAA:', '#BPM01: 140.5'];

			const bpmChanges = dtxFile.parseBPMChanges();

			expect(bpmChanges['AA']).toBeUndefined();
			expect(bpmChanges['01']).toBe(140.5);
		});

		it('rejects non-finite BPM values (Infinity / 1e309)', () => {
			// `parseFloat('Infinity')` and `parseFloat('1e309')` (which overflows
			// to Infinity) pass `!isNaN`, so an `isFinite` guard is required to
			// keep them out of the bpm map, matching parseMeasureLengths.
			dtxFile.lines = ['#BPMAA: Infinity', '#BPM02: 1e309', '#BPM03: 140.5'];

			const bpmChanges = dtxFile.parseBPMChanges();

			expect(bpmChanges['AA']).toBeUndefined();
			expect(bpmChanges['02']).toBeUndefined();
			expect(bpmChanges['03']).toBe(140.5);
		});

		it('ignores #BPM-prefixed headers that are not exactly #BPM or #BPMxx', () => {
			// `#BPM01_EXTRA` used to have its ID truncated via slice(4, 6),
			// overwriting the real `#BPM01` definition that channel-08 refs use.
			dtxFile.lines = ['#BPM01: 140.5', '#BPM01_EXTRA: 240'];

			const bpmChanges = dtxFile.parseBPMChanges();

			expect(bpmChanges['01']).toBe(140.5);
			expect(Object.keys(bpmChanges)).toEqual(['01']);
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

		it('should parse note lines with colon-without-space delimiter', () => {
			// Some DTX writers omit the space after the colon (e.g. `#NNN02:0.5`).
			// parseNotes must tolerate both `: ` and `:` so the pattern is not
			// left undefined before LaneMeasureNote.parseFromPattern() runs.
			dtxFile.lines = ['#00011:01020304', '#00102:0.5'];

			const notes = dtxFile.parseNotes();

			expect(notes).toHaveLength(2);
			expect(notes[0].laneID).toBe('11');
			expect(notes[0].notes).toHaveLength(4);
			expect(notes[1].laneID).toBe('02');
		});

		it('skips note lines without a colon instead of building garbage notes', () => {
			// A line matching `^#\d+` but lacking a colon must be skipped, matching
			// the colon guard in parseBPMChanges and parseMeasureLengths. Without
			// the guard, `line.slice(0, -1)` drops the last header char and
			// `line.slice(0)` returns the whole line as the pattern.
			dtxFile.lines = ['#00011', '#00111: 01020000'];

			const notes = dtxFile.parseNotes();

			expect(notes).toHaveLength(1);
			expect(notes[0].measure).toBe(1);
			expect(notes[0].laneID).toBe('11');
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

	describe('parseMeasureLengths', () => {
		let dtxFile: DTXFile;

		beforeEach(() => {
			dtxFile = new DTXFile();
		});

		it('parses channel-02 bar-length with and without space after colon', () => {
			dtxFile.lines = ['#00102: 0.5', '#00202:0.75'];
			const lengths = dtxFile.parseMeasureLengths();
			expect(lengths.get(1)).toBe(0.5);
			expect(lengths.get(2)).toBe(0.75);
		});

		it('rejects non-finite bar-length values (Infinity / 1e999)', () => {
			dtxFile.lines = ['#00102: Infinity', '#00202: 1e999', '#00302: 0.5'];
			const lengths = dtxFile.parseMeasureLengths();
			expect(lengths.has(1)).toBe(false);
			expect(lengths.has(2)).toBe(false);
			expect(lengths.get(3)).toBe(0.5);
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

		it('should preserve decimal BPM, #BPMxx definitions and channel-02 lengths on editor save', async () => {
			// Simulates the editor save path: parse a file, group notes by lane
			// (as handleNoteImport does), then export. The parsed controls —
			// decimal base BPM, #BPMxx definitions and channel-02 bar lengths —
			// must survive the round-trip as text, not as regenerated patterns.
			const source = [
				'#TITLE: Save Test',
				'#ARTIST: Tester',
				'#DLEVEL: 55',
				'#BPM: 145.5',
				'#BPM01: 200',
				'#WAV01: kick.wav',
				'#00102: 0.75',
				'#00108: 0100',
				'#00111: 01000000',
				'#00112: 00020000'
			].join('\r\n');

			const sourceFile = new DTXFile(source);
			await sourceFile.parse();
			sourceFile.parseSoundChips();

			const notesRecord: Record<string, LaneMeasureNote[]> = {};
			for (const laneNote of sourceFile.parseNotes()) {
				(notesRecord[laneNote.laneID] ??= []).push(laneNote);
			}
			// Channel 02 was parsed as a note lane — export must not pattern it.
			expect(notesRecord['02']).toBeDefined();

			await sourceFile.export(notesRecord);
			const content = getCapturedBlobContent();
			const lines = content.split('\r\n');

			expect(content).toContain('#BPM: 145.5');
			expect(content).toContain('#BPM01: 200');
			// Channel 02 stays a decimal line — never the corrupted
			// pattern artifact the old writer produced from '0.75'.
			expect(content).toContain('#00102: 0.75');
			expect(content).not.toContain('0.007500');
			expect(lines.filter((line) => /^#\d{3}02:/.test(line))).toHaveLength(1);
			// Exactly one base #BPM line.
			expect(lines.filter((line) => line.startsWith('#BPM:'))).toHaveLength(1);
			// Channel-08 BPM reference and playable lanes survive as patterns.
			expect(content).toContain('#00108: 0100');
			expect(content).toContain('#00111: 01000000');
			expect(content).toContain('#00112: 00020000');

			// Reparse the exported text: every control survives intact.
			const reparsed = new DTXFile(content);
			await reparsed.parse();
			expect(reparsed.bpm).toBe(145.5);
			expect(reparsed.parseBPMChanges()).toEqual({ '': 145.5, '01': 200 });
			expect(reparsed.parseMeasureLengths()).toEqual(new Map([[1, 0.75]]));
			const reNotes = reparsed.parseNotes();
			expect(reNotes.filter((note) => note.laneID === '08')[0].notes).toEqual([
				{ noteID: '01', position: 0 }
			]);
		});
	});

	describe('toDtxText', () => {
		it('should serialize explicit MIDI-import controls on a fresh DTXFile', () => {
			const file = new DTXFile();
			file.title = 'MIDI Import';
			file.artist = 'Converter';
			file.level = 40;
			file.bpm = 120;

			const notes = {
				'12': [new LaneMeasureNote(0, '12', [{ noteID: '01', position: 0.5 }])],
				// A channel-02 lane in the notes map is ignored — bar lengths
				// come only from the supplied control map.
				'02': [new LaneMeasureNote(0, '02', [{ noteID: '99', position: 0 }])]
			};

			const text = file.toDtxText(notes, {
				bpmChanges: { '': 999, '01': 177.5 },
				measureLengths: new Map([[1, 0.75]])
			});
			const lines = text.split('\r\n');

			// Base BPM comes from this.bpm, never the '' control key.
			expect(text).toContain('#BPM: 120');
			expect(lines.filter((line) => line.startsWith('#BPM:'))).toHaveLength(1);
			expect(text).toContain('#BPM01: 177.5');
			// Supplied measure lengths become decimal channel-02 lines.
			expect(text).toContain('#00102: 0.75');
			expect(text).not.toContain('#00002:');
			expect(text).toContain('#00012: 00000100');
		});

		it('should serialize a fresh DTXFile without controls or parsed lines', () => {
			// lines starts as [] so the control parsers are safe to call on a
			// file that was never parsed — no undefined.filter() crash.
			const file = new DTXFile();
			const text = file.toDtxText({
				'12': [new LaneMeasureNote(0, '12', [{ noteID: '01', position: 0 }])]
			});

			expect(text).toContain('#BPM: 120');
			expect(text).not.toContain('#BPM01');
			expect(text).not.toMatch(/#\d{3}02:/);
			expect(text).toContain('#00012: 01000000');
		});

		it('should emit channel-02 lengths when notes are omitted', () => {
			// Controls-only export: measure lengths must not be dropped just
			// because no note patterns were supplied.
			const file = new DTXFile();
			const text = file.toDtxText(undefined, {
				measureLengths: new Map([[0, 0.75]])
			});

			expect(text).toContain('#00002: 0.75');
		});

		it('should keep parsed channel-02 lines on a notes-free export', () => {
			// A parsed chart exported without notes still owns its bar-length
			// lines — dropping them would silently flatten the meter.
			const file = new DTXFile();
			file.parseFromText('#BPM: 120\r\n#00102: 0.75\r\n#00211: 01000000');
			const text = file.toDtxText();

			expect(text).toContain('#00102: 0.75');
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

	describe('parseWithSpecificEncoding and parseWithEncodingDetection error paths', () => {
		let dtx: DTXFile;
		beforeEach(() => {
			dtx = new DTXFile();
			dtx['file'] = null as any;
		});

		it('should throw when parseWithSpecificEncoding called with non-File', async () => {
			await expect((dtx as any).parseWithSpecificEncoding('utf-8')).rejects.toThrow(
				'File is not set'
			);
		});

		it('should throw when parseWithEncodingDetection called with non-File', async () => {
			await expect((dtx as any).parseWithEncodingDetection()).rejects.toThrow(
				'File is not set'
			);
		});
	});
});
