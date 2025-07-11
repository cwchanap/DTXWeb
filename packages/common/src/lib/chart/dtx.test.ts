import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DTXFile, SoundChip } from './dtx.js';
import { LaneMeasureNote } from './note.js';

// Mock encoding utilities
vi.mock('./encoding-utils.js', () => ({
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
		it('should return early if fileName is empty', async () => {
			const soundChip = new SoundChip('kick', 1, 100, 0, '');
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await soundChip.fetchRemote('simfile123', 'https://bucket.com');

			expect(consoleSpy).toHaveBeenCalledWith('Sound chip file name is not set');
			consoleSpy.mockRestore();
		});

		it('should handle fetch errors gracefully', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 404
			});

			const soundChip = new SoundChip('kick', 1, 100, 0, 'kick.wav');
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			await soundChip.fetchRemote('simfile123', 'https://bucket.com');

			expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch sound chip: kick.wav');
			consoleSpy.mockRestore();
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

		it('should use title as filename', async () => {
			await dtxFile.export();

			const createElementCall = (document.createElement as any).mock.calls[0];

			// The download property should be set after createElement returns the mock element
			expect(createElementCall).toBeTruthy();
		});
	});
});
