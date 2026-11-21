import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PopoverStub from '../../../../tests/stubs/PopoverStub.svelte';

// Mock dependencies for component logic tests
const gotoMock = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

vi.mock('svelte-i18n', () => ({
	locale: { set: vi.fn() },
	locales: {
		subscribe: (run: (value: string[]) => void) => {
			run(['en']);
			return () => {};
		}
	}
}));

const toastMock = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn()
}));

vi.mock('$lib/toaster', () => ({
	default: toastMock
}));

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Popover: PopoverStub
}));

import {
	DTXFile,
	GM_IMPORT_LANE,
	PLAYABLE_DRUM_LANES,
	laneToStaff,
	parseMidi,
	midiToDtx
} from '@dtx/common';
import MidiToDtx from './+page.svelte';

if (!File.prototype.arrayBuffer) {
	Object.defineProperty(File.prototype, 'arrayBuffer', {
		configurable: true,
		value: async function arrayBuffer() {
			const text = typeof this.text === 'function' ? await this.text() : '';
			return new TextEncoder().encode(text).buffer;
		}
	});
}

const vlq = (v: number): number[] => {
	const bytes = [v & 0x7f];
	let r = Math.floor(v / 128);
	while (r > 0) {
		bytes.unshift((r & 0x7f) | 0x80);
		r = Math.floor(r / 128);
	}
	return bytes;
};

const mpq = (bpm: number) => Math.round(60000000 / bpm);

// Minimal format-0 SMF at 480 PPQ for the converter tests.
const drumMidiFile = (opts: {
	tempos?: { tick: number; bpm: number }[];
	hits?: { tick: number; note: number; channel?: number }[];
	name?: string;
}): File => {
	const events: { tick: number; bytes: number[] }[] = [];
	for (const t of opts.tempos ?? []) {
		const m = mpq(t.bpm);
		events.push({
			tick: t.tick,
			bytes: [0xff, 0x51, 0x03, (m >> 16) & 0xff, (m >> 8) & 0xff, m & 0xff]
		});
	}
	for (const h of opts.hits ?? []) {
		const ch = h.channel ?? 9;
		events.push({ tick: h.tick, bytes: [0x90 | ch, h.note, 100] });
		events.push({ tick: h.tick + 120, bytes: [0x80 | ch, h.note, 0] });
	}
	events.sort((a, b) => a.tick - b.tick);
	const track: number[] = [];
	let prev = 0;
	for (const e of events) {
		track.push(...vlq(e.tick - prev), ...e.bytes);
		prev = e.tick;
	}
	track.push(0x00, 0xff, 0x2f, 0x00);
	const bytes = new Uint8Array(22 + track.length);
	const view = new DataView(bytes.buffer);
	bytes.set([0x4d, 0x54, 0x68, 0x64], 0);
	view.setUint32(4, 6, false);
	view.setUint16(10, 1, false);
	view.setUint16(12, 480, false);
	bytes.set([0x4d, 0x54, 0x72, 0x6b], 14);
	view.setUint32(18, track.length, false);
	bytes.set(track, 22);
	return new File([bytes], opts.name ?? 'drums.mid', { type: 'audio/midi' });
};

describe('MIDI to DTX Converter Logic', () => {
	it('should validate MIDI file extensions', () => {
		const validMidiFile = new File(['content'], 'test.mid', { type: 'audio/midi' });
		const validMidiFile2 = new File(['content'], 'test.midi', { type: 'audio/midi' });
		const invalidFile = new File(['content'], 'test.dtx', { type: 'text/plain' });

		expect(validMidiFile.name.toLowerCase().endsWith('.mid')).toBe(true);
		expect(validMidiFile2.name.toLowerCase().endsWith('.midi')).toBe(true);
		expect(invalidFile.name.toLowerCase().endsWith('.mid')).toBe(false);
		expect(invalidFile.name.toLowerCase().endsWith('.midi')).toBe(false);
	});

	it('should generate correct filename for DTX export', () => {
		const inputFileName = 'mysong.mid';
		const baseName = inputFileName.replace(/\.[^/.]+$/, '');
		const outputFileName = `${baseName}.dtx`;

		expect(outputFileName).toBe('mysong.dtx');
	});

	it('should handle file size display correctly', () => {
		const mockFile = {
			name: 'test.mid',
			size: 1024 * 2.5, // 2.5KB
			type: 'audio/midi'
		} as File;

		const fileSizeKB = (mockFile.size / 1024).toFixed(1);

		expect(parseFloat(fileSizeKB)).toBe(2.5);
		expect(fileSizeKB).toBe('2.5');
	});

	it('maps GM drum notes to canonical DTX lanes via the shared converter', async () => {
		const midiFile = drumMidiFile({
			hits: [
				{ tick: 0, note: 36 }, // Bass drum -> '13'
				{ tick: 480, note: 38 }, // Snare -> '12'
				{ tick: 960, note: 42 }, // Closed hi-hat -> '11'
				{ tick: 1440, note: 40 }, // Electric snare alias -> '12'
				{ tick: 1920, note: 35 } // Acoustic bass drum alias -> '13'
			]
		});

		const parsed = parseMidi(new Uint8Array(await midiFile.arrayBuffer()));
		const { notes } = midiToDtx(parsed);

		// Positions quantize to 1/192 of a 4/4 bar: 480ppq ticks -> 0.25/0.5/0.75.
		expect(notes['13'].flatMap((g) => g.notes.map((n) => [g.measure, n.position]))).toEqual([
			[0, 0],
			[1, 0]
		]);
		expect(notes['12'].flatMap((g) => g.notes.map((n) => [g.measure, n.position]))).toEqual([
			[0, 0.25],
			[0, 0.75]
		]);
		expect(notes['11'].flatMap((g) => g.notes.map((n) => [g.measure, n.position]))).toEqual([
			[0, 0.5]
		]);
	});

	it('should label GM notes by their aliased lane instrument name', () => {
		// The row label comes from GM_IMPORT_LANE + laneToStaff, not a
		// second hardcoded drum-name table.
		expect(laneToStaff(GM_IMPORT_LANE[36])?.instrumentName).toBe('Bass');
		expect(laneToStaff(GM_IMPORT_LANE[38])?.instrumentName).toBe('Snare');
		expect(GM_IMPORT_LANE[99]).toBeUndefined(); // unmapped note
	});

	it('should provide staff names for playable DTX lanes', () => {
		expect(laneToStaff('13')?.instrumentName).toBe('Bass');
		expect(laneToStaff('12')?.instrumentName).toBe('Snare');
		expect(laneToStaff('ZZ')).toBeUndefined(); // Unknown lane
	});

	it('should validate DTX metadata ranges', () => {
		// Level validation (1-10)
		const validLevels = [1, 5, 10];
		const invalidLevels = [0, 11, -1];

		validLevels.forEach((level) => {
			expect(level >= 1 && level <= 10).toBe(true);
		});

		invalidLevels.forEach((level) => {
			expect(level >= 1 && level <= 10).toBe(false);
		});

		// BPM validation (60-300)
		const validBPMs = [60, 120, 300];
		const invalidBPMs = [59, 301, 0];

		validBPMs.forEach((bpm) => {
			expect(bpm >= 60 && bpm <= 300).toBe(true);
		});

		invalidBPMs.forEach((bpm) => {
			expect(bpm >= 60 && bpm <= 300).toBe(false);
		});
	});

	it('should have correct default DTX metadata values', () => {
		const defaultMetadata = {
			title: 'Converted from MIDI',
			artist: 'Unknown',
			level: 5,
			bpm: 120,
			comment: 'Converted from MIDI file'
		};

		expect(defaultMetadata.title).toBe('Converted from MIDI');
		expect(defaultMetadata.artist).toBe('Unknown');
		expect(defaultMetadata.level).toBe(5);
		expect(defaultMetadata.bpm).toBe(120);
		expect(defaultMetadata.comment).toBe('Converted from MIDI file');
	});

	it('should extract title from filename correctly', () => {
		const testCases = [
			{ filename: 'song.mid', expected: 'song' },
			{ filename: 'my-song.midi', expected: 'my-song' },
			{ filename: 'complex.song.name.mid', expected: 'complex.song.name' },
			{ filename: 'no-extension', expected: 'no-extension' }
		];

		testCases.forEach((testCase) => {
			const title = testCase.filename.replace(/\.[^/.]+$/, '');
			expect(title).toBe(testCase.expected);
		});
	});

	describe('MIDI file processing logic', () => {
		it('should handle ArrayBuffer conversion', async () => {
			const testData = new Uint8Array([0x4d, 0x54, 0x68, 0x64]); // "MThd"
			const file = {
				name: 'test.mid',
				type: 'audio/midi',
				arrayBuffer: async () => testData.buffer
			} as File;

			const arrayBuffer = await file.arrayBuffer();
			const data = new Uint8Array(arrayBuffer);

			expect(data[0]).toBe(0x4d); // 'M'
			expect(data[1]).toBe(0x54); // 'T'
			expect(data[2]).toBe(0x68); // 'h'
			expect(data[3]).toBe(0x64); // 'd'
		});

		it('should calculate note count from converted notes', () => {
			const mockConvertedNotes = {
				'01': [
					{
						measure: 0,
						notes: [
							{ noteID: '01', position: 0 },
							{ noteID: '01', position: 0.5 }
						]
					},
					{ measure: 1, notes: [{ noteID: '01', position: 0 }] }
				],
				'02': [{ measure: 0, notes: [{ noteID: '02', position: 0.25 }] }]
			};

			const totalNotes = Object.values(mockConvertedNotes)
				.flat()
				.reduce((sum, measure) => sum + measure.notes.length, 0);
			expect(totalNotes).toBe(4); // 2 + 1 + 1 = 4 notes total
		});

		it('should handle error states correctly', () => {
			// "MThe" instead of "MThd" — the shared parser rejects malformed
			// bytes, which the page surfaces as a conversion failure.
			const invalidMidiData = new Uint8Array([0x4d, 0x54, 0x68, 0x65]);

			expect(() => parseMidi(invalidMidiData)).toThrow('Invalid MIDI file');
		});

		it('should extract BPM from Set Tempo meta events', async () => {
			const midiFile = drumMidiFile({ tempos: [{ tick: 0, bpm: 140 }] });

			const parsed = parseMidi(new Uint8Array(await midiFile.arrayBuffer()));
			expect(parsed.tempo).toBe(140);

			// The tick-0 tempo seeds the converter's base #BPM.
			expect(midiToDtx(parsed).bpm).toBe(140);
		});
	});

	describe('UI state management', () => {
		it('should track conversion states correctly', () => {
			let isConverting = false;
			let isConverted = false;

			// Initial state
			expect(isConverting).toBe(false);
			expect(isConverted).toBe(false);

			// During conversion
			isConverting = true;
			expect(isConverting).toBe(true);
			expect(isConverted).toBe(false);

			// After conversion
			isConverting = false;
			isConverted = true;
			expect(isConverting).toBe(false);
			expect(isConverted).toBe(true);

			// Reset state
			isConverting = false;
			isConverted = false;
			expect(isConverting).toBe(false);
			expect(isConverted).toBe(false);
		});

		it('should handle reset functionality', () => {
			let uploadedFile: File | null = new File(['test'], 'test.mid');
			let isConverted = true;
			let isConverting = false;
			let convertedFileName = 'test.dtx';
			let title = 'Test Song';
			let artist = 'Test Artist';
			let level = 7;
			let bpm = 140;
			let comment = 'Test comment';

			// Simulate reset
			uploadedFile = null;
			isConverted = false;
			isConverting = false;
			convertedFileName = '';
			title = 'Converted from MIDI';
			artist = 'Unknown';
			level = 5;
			bpm = 120;
			comment = 'Converted from MIDI file';

			expect(uploadedFile).toBeNull();
			expect(isConverted).toBe(false);
			expect(isConverting).toBe(false);
			expect(convertedFileName).toBe('');
			expect(title).toBe('Converted from MIDI');
			expect(artist).toBe('Unknown');
			expect(level).toBe(5);
			expect(bpm).toBe(120);
			expect(comment).toBe('Converted from MIDI file');
		});
	});

	describe('MIDI note mapping configuration', () => {
		it('should allow customization of note mappings', () => {
			const midiToDtxMap = {
				36: '01', // Bass Drum
				38: '02', // Snare
				42: '03' // Hi-hat
			};

			// Modify mapping
			midiToDtxMap[36] = '02'; // Map bass drum to snare lane
			midiToDtxMap[38] = '01'; // Map snare to bass drum lane

			expect(midiToDtxMap[36]).toBe('02');
			expect(midiToDtxMap[38]).toBe('01');
			expect(midiToDtxMap[42]).toBe('03'); // Unchanged
		});

		it('should generate select options from the playable drum lanes', () => {
			const selectOptions = PLAYABLE_DRUM_LANES.map((lane) => ({
				value: lane,
				label: `${lane} - ${laneToStaff(lane)?.instrumentName}`
			}));

			expect(selectOptions).toHaveLength(12);
			expect(selectOptions).toContainEqual({ value: '13', label: '13 - Bass' });
			expect(selectOptions).toContainEqual({ value: '12', label: '12 - Snare' });
			// Control/BGM lanes are never offered as drum targets.
			expect(selectOptions.map((o) => o.value)).not.toContain('01');
			expect(selectOptions.map((o) => o.value)).not.toContain('08');
		});
	});

	describe('download functionality', () => {
		it('should handle DTX file download', async () => {
			const mockDTXFile = new DTXFile();
			mockDTXFile.title = 'Test Song';
			mockDTXFile.artist = 'Test Artist';
			mockDTXFile.level = 5;
			mockDTXFile.bpm = 120;

			const mockExport = vi.fn();
			mockDTXFile.export = mockExport;

			const mockConvertedNotes = { '01': [] };

			// Simulate download
			await mockDTXFile.export(mockConvertedNotes);

			expect(mockExport).toHaveBeenCalledWith(mockConvertedNotes);
		});

		it('should handle download errors gracefully', () => {
			const downloadError = new Error('Export failed');

			expect(downloadError instanceof Error).toBe(true);
			expect(downloadError.message).toBe('Export failed');

			// Error message for user display
			const userMessage = `Failed to generate DTX file: ${downloadError.message}`;
			expect(userMessage).toBe('Failed to generate DTX file: Export failed');
		});
	});

	describe('form validation', () => {
		it('should validate metadata input fields', () => {
			const validateTitle = (title: string) => title.trim().length > 0;
			const validateArtist = (artist: string) => artist.trim().length > 0;
			const validateLevel = (level: number) => level >= 1 && level <= 10;
			const validateBPM = (bpm: number) => bpm >= 60 && bpm <= 300;

			expect(validateTitle('Valid Title')).toBe(true);
			expect(validateTitle('')).toBe(false);
			expect(validateTitle('   ')).toBe(false);

			expect(validateArtist('Valid Artist')).toBe(true);
			expect(validateArtist('')).toBe(false);

			expect(validateLevel(5)).toBe(true);
			expect(validateLevel(0)).toBe(false);
			expect(validateLevel(11)).toBe(false);

			expect(validateBPM(120)).toBe(true);
			expect(validateBPM(59)).toBe(false);
			expect(validateBPM(301)).toBe(false);
		});

		it('should handle input field changes', () => {
			let title = 'Original Title';
			let level = 5;
			let bpm = 120;

			// Simulate user input
			title = 'New Title';
			level = 8;
			bpm = 140;

			expect(title).toBe('New Title');
			expect(level).toBe(8);
			expect(bpm).toBe(140);
		});
	});

	describe('conversion workflow', () => {
		it('should track conversion progress', () => {
			const conversionSteps = [
				'Upload MIDI file',
				'Configure metadata',
				'Configure note mapping',
				'Convert to DTX',
				'Download DTX file'
			];

			let currentStep = 0;

			// Progress through steps
			expect(conversionSteps[currentStep]).toBe('Upload MIDI file');

			currentStep = 1;
			expect(conversionSteps[currentStep]).toBe('Configure metadata');

			currentStep = 4;
			expect(conversionSteps[currentStep]).toBe('Download DTX file');
		});

		it('should handle workflow state transitions', () => {
			let workflowState = 'initial'; // initial -> uploaded -> configured -> converting -> converted -> downloaded

			// File uploaded
			workflowState = 'uploaded';
			expect(workflowState).toBe('uploaded');

			// Metadata configured
			workflowState = 'configured';
			expect(workflowState).toBe('configured');

			// Conversion started
			workflowState = 'converting';
			expect(workflowState).toBe('converting');

			// Conversion completed
			workflowState = 'converted';
			expect(workflowState).toBe('converted');

			// File downloaded
			workflowState = 'downloaded';
			expect(workflowState).toBe('downloaded');
		});
	});
});

describe('MIDI to DTX Component Rendering', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders the page with initial upload state', () => {
		render(MidiToDtx);
		expect(screen.getByText('MIDI to DTX Converter')).toBeInTheDocument();
		expect(screen.getByText('Upload MIDI File')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument();
	});

	it('shows Back to Tools button that calls goto', async () => {
		render(MidiToDtx);
		await fireEvent.click(screen.getByRole('button', { name: '← Back to Tools' }));
		expect(gotoMock).toHaveBeenCalledWith('/tool');
	});

	it('shows file ready state after uploading a valid .mid file', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = new File(['midi data'], 'track.mid', { type: 'audio/midi' });
		await fireEvent.change(input, { target: { files: [midiFile] } });
		expect(screen.getByText('File Ready')).toBeInTheDocument();
		expect(screen.getByText('track.mid')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Convert to DTX' })).toBeInTheDocument();
	});

	it('shows error toast for invalid file extension', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const badFile = new File(['bad'], 'audio.mp3', { type: 'audio/mpeg' });
		await fireEvent.change(input, { target: { files: [badFile] } });
		expect(toastMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Invalid file type' })
		);
	});

	it('shows DTX metadata fields after file upload', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = new File(['midi data'], 'track.mid', { type: 'audio/midi' });
		await fireEvent.change(input, { target: { files: [midiFile] } });
		expect(screen.getByLabelText('Title')).toBeInTheDocument();
		expect(screen.getByLabelText('Artist')).toBeInTheDocument();
		expect(screen.getByLabelText('BPM')).toBeInTheDocument();
	});

	it('performs conversion and shows download section', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({ name: 'song.mid', hits: [{ tick: 0, note: 36 }] });
		await fireEvent.change(input, { target: { files: [midiFile] } });

		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));

		await vi.waitFor(() => {
			expect(screen.getByText('Conversion Complete!')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: 'Download DTX File' })).toBeInTheDocument();
		expect(screen.getByText('song.dtx')).toBeInTheDocument();
	});

	it('counts playable hits, not lane groups or tempo refs', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({
			tempos: [
				{ tick: 0, bpm: 140 },
				{ tick: 1920, bpm: 180 }
			],
			hits: [
				{ tick: 0, note: 36 },
				{ tick: 480, note: 38 }
			]
		});
		await fireEvent.change(input, { target: { files: [midiFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));

		await vi.waitFor(() => screen.getByText('Conversion Complete!'));
		// 2 drum hits on channel 9; the channel-08 tempo ref must not count.
		expect(screen.getByText('Converted 2 note events')).toBeInTheDocument();
	});

	it('shows nonfatal warnings for unmapped notes', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({ hits: [{ tick: 0, note: 99 }] });
		await fireEvent.change(input, { target: { files: [midiFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));

		await vi.waitFor(() => screen.getByText('Conversion Complete!'));
		expect(screen.getByText(/had no lane mapping/)).toBeInTheDocument();
	});

	it('shows error toast when conversion fails', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = new File(['bad'], 'invalid.mid', { type: 'audio/midi' });
		await fireEvent.change(input, { target: { files: [midiFile] } });

		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));

		await vi.waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Conversion failed' })
			);
		});
	});

	it('downloads DTX file and shows success toast', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({ name: 'song.mid', hits: [{ tick: 0, note: 36 }] });
		await fireEvent.change(input, { target: { files: [midiFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		await fireEvent.click(screen.getByRole('button', { name: 'Download DTX File' }));

		await vi.waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Success' })
			);
		});
	});

	it('resets to initial state when Remove button is clicked', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = new File(['midi data'], 'song.mid', { type: 'audio/midi' });
		await fireEvent.change(input, { target: { files: [midiFile] } });

		expect(screen.getByText('File Ready')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

		expect(screen.getByText('Upload MIDI File')).toBeInTheDocument();
	});

	it('resets to initial state when Convert Another File button is clicked', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({ name: 'song.mid', hits: [{ tick: 0, note: 36 }] });
		await fireEvent.change(input, { target: { files: [midiFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		await fireEvent.click(screen.getByRole('button', { name: 'Convert Another File' }));
		expect(screen.getByText('Upload MIDI File')).toBeInTheDocument();
	});

	it('shows error toast when download fails', async () => {
		const exportSpy = vi
			.spyOn(DTXFile.prototype, 'export')
			.mockRejectedValueOnce(new Error('export failed'));

		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({ name: 'song.mid', hits: [{ tick: 0, note: 36 }] });
		await fireEvent.change(input, { target: { files: [midiFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		await fireEvent.click(screen.getByRole('button', { name: 'Download DTX File' }));

		await vi.waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Download failed' })
			);
		});
		exportSpy.mockRestore();
	});

	it('updates MIDI to DTX lane mapping when select changes', async () => {
		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = new File(['midi data'], 'song.mid', { type: 'audio/midi' });
		await fireEvent.change(input, { target: { files: [midiFile] } });

		// The mapping section is rendered when uploadedFile is set, one row per
		// GM_IMPORT_LANE entry; each select offers the playable drum lanes.
		const selects = container.querySelectorAll('select');
		expect(selects.length).toBe(Object.keys(GM_IMPORT_LANE).length);

		const firstSelect = selects[0] as HTMLSelectElement;
		await fireEvent.change(firstSelect, { target: { value: '12' } });
		expect(firstSelect.value).toBe('12');
	});

	it('clicking Choose File button triggers handleUploadClick', async () => {
		const { container } = render(MidiToDtx);
		const button = screen.getByRole('button', { name: 'Choose File' });
		const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
		const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
		await fireEvent.click(button);
		expect(clickSpy).toHaveBeenCalled();
		clickSpy.mockRestore();
	});

	it('populates BPM from a 120 BPM file and keeps later tempo changes', async () => {
		const exportSpy = vi.spyOn(DTXFile.prototype, 'export');

		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({
			tempos: [
				{ tick: 0, bpm: 120 },
				{ tick: 1920, bpm: 180 }
			],
			hits: [{ tick: 0, note: 36 }]
		});
		await fireEvent.change(input, { target: { files: [midiFile] } });

		// A pre-convert user value must not survive: detected 120 is a real
		// tempo and seeds the editable base BPM.
		const bpmInput = screen.getByLabelText('BPM') as HTMLInputElement;
		await fireEvent.input(bpmInput, { target: { value: '200' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));
		expect(bpmInput.value).toBe('120');

		await fireEvent.click(screen.getByRole('button', { name: 'Download DTX File' }));
		await vi.waitFor(() => expect(exportSpy).toHaveBeenCalled());

		const instance = exportSpy.mock.instances[0] as DTXFile;
		expect(instance.bpm).toBe(120);
		const controls = exportSpy.mock.calls[0][1];
		expect(Object.values(controls?.bpmChanges ?? {})).toContain(180);

		exportSpy.mockRestore();
	});

	it('lets a BPM edit override the base tempo without dropping later changes', async () => {
		const exportSpy = vi.spyOn(DTXFile.prototype, 'export');

		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({
			tempos: [
				{ tick: 0, bpm: 140 },
				{ tick: 1920, bpm: 180 }
			],
			hits: [{ tick: 0, note: 36 }]
		});
		await fireEvent.change(input, { target: { files: [midiFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		const bpmInput = screen.getByLabelText('BPM') as HTMLInputElement;
		expect(bpmInput.value).toBe('140');
		await fireEvent.input(bpmInput, { target: { value: '160' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Download DTX File' }));
		await vi.waitFor(() => expect(exportSpy).toHaveBeenCalled());

		const instance = exportSpy.mock.instances[0] as DTXFile;
		expect(instance.bpm).toBe(160);
		const controls = exportSpy.mock.calls[0][1];
		expect(Object.values(controls?.bpmChanges ?? {})).toContain(180);

		exportSpy.mockRestore();
	});

	it('applies the latest lane mapping at download without reparsing', async () => {
		const exportSpy = vi.spyOn(DTXFile.prototype, 'export');

		const { container } = render(MidiToDtx);
		const input = container.querySelector('input[type="file"]') as HTMLInputElement;
		const midiFile = drumMidiFile({ hits: [{ tick: 0, note: 36 }] });
		await fireEvent.change(input, { target: { files: [midiFile] } });
		await fireEvent.click(screen.getByRole('button', { name: 'Convert to DTX' }));
		await vi.waitFor(() => screen.getByText('Conversion Complete!'));

		// Remap note 36 from its GM default '13' to '12' after conversion.
		const rowLabel = screen.getByText(/\(36\):/);
		const select = rowLabel.parentElement?.querySelector('select') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: '12' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Download DTX File' }));
		await vi.waitFor(() => expect(exportSpy).toHaveBeenCalled());

		const notes = exportSpy.mock.calls[0][0] ?? {};
		expect(notes['12']).toBeDefined();
		expect(notes['13']).toBeUndefined();

		exportSpy.mockRestore();
	});
});
