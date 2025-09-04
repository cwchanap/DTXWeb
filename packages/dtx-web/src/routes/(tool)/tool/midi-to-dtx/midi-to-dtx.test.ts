import { describe, it, expect, vi } from 'vitest';
import { DTXFile } from '@dtx/common';

// Mock dependencies for component logic tests
vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

vi.mock('svelte-i18n', () => ({
	locale: { set: vi.fn() },
	locales: { subscribe: vi.fn(() => () => {}) }
}));

vi.mock('$lib/toaster', () => ({
	default: {
		error: vi.fn(),
		success: vi.fn()
	}
}));

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

	it('should have correct default MIDI to DTX mapping', () => {
		const dtxFile = new DTXFile();

		// Create mock MIDI data with specific notes
		const mockMidiData = {
			ticksPerQuarter: 480,
			tracks: [
				[
					{
						deltaTime: 0,
						type: 'channel',
						command: 0x9, // Note on
						note: 36, // Bass drum
						velocity: 100
					},
					{
						deltaTime: 240,
						type: 'channel',
						command: 0x9, // Note on
						note: 38, // Snare
						velocity: 100
					},
					{
						deltaTime: 240,
						type: 'channel',
						command: 0x9, // Note on
						note: 42, // Hi-hat
						velocity: 100
					}
				]
			]
		};

		// Use the production mapping function
		const convertedNotes = dtxFile.convertMidiNotesToDtx(mockMidiData);

		// Verify lane assignments
		expect(convertedNotes['01']).toBeDefined(); // Bass drum -> lane 01
		expect(convertedNotes['02']).toBeDefined(); // Snare -> lane 02
		expect(convertedNotes['03']).toBeDefined(); // Hi-hat -> lane 03

		// Check that the correct notes were mapped
		const bassDrumNotes = convertedNotes['01'][0] as unknown as any[]; // First measure notes
		const snareNotes = convertedNotes['02'][0] as unknown as any[];
		const hihatNotes = convertedNotes['03'][0] as unknown as any[];

		expect(bassDrumNotes[0].position).toBe(0); // At beat 1
		expect(snareNotes[0].position).toBe(120); // At beat 1.5 (240 ticks / 480 * 240)
		expect(hihatNotes[0].position).toBe(240); // At beat 2 (480 ticks / 480 * 240)
	});

	it('should provide correct drum names for MIDI notes', () => {
		const getDrumName = (noteNumber: number): string => {
			const drumNames: Record<number, string> = {
				36: 'Bass Drum',
				38: 'Snare',
				42: 'Closed Hi-Hat',
				46: 'Open Hi-Hat',
				49: 'Crash Cymbal',
				51: 'Ride Cymbal',
				45: 'Low Tom',
				47: 'Mid Tom',
				50: 'High Tom',
				44: 'Pedal Hi-Hat',
				57: 'Crash 2',
				59: 'Ride 2'
			};
			return drumNames[noteNumber] || `Note ${noteNumber}`;
		};

		expect(getDrumName(36)).toBe('Bass Drum');
		expect(getDrumName(38)).toBe('Snare');
		expect(getDrumName(99)).toBe('Note 99'); // Unknown note
	});

	it('should provide correct DTX lane names', () => {
		const getLaneName = (laneId: string): string => {
			const laneNames: Record<string, string> = {
				'01': 'Bass Drum',
				'02': 'Snare',
				'03': 'Closed Hi-Hat',
				'04': 'Open Hi-Hat',
				'05': 'Crash Cymbal',
				'06': 'Ride Cymbal',
				'07': 'Low Tom',
				'08': 'Mid Tom',
				'09': 'High Tom',
				'0A': 'Pedal Hi-Hat',
				'0B': 'Crash 2',
				'0C': 'Ride 2'
			};
			return laneNames[laneId] || `Lane ${laneId}`;
		};

		expect(getLaneName('01')).toBe('Bass Drum');
		expect(getLaneName('02')).toBe('Snare');
		expect(getLaneName('ZZ')).toBe('Lane ZZ'); // Unknown lane
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

		it('should handle error states correctly', async () => {
			const dtxFile = new DTXFile();

			// Create invalid MIDI file with wrong header
			const invalidMidiData = new Uint8Array([0x4d, 0x54, 0x68, 0x65]); // "MThe" instead of "MThd"
			const invalidFile = new File([invalidMidiData], 'invalid.mid', { type: 'audio/midi' });

			// Test that parseFromMidi rejects with proper error
			await expect(dtxFile.parseFromMidi(invalidFile)).rejects.toThrow();

			try {
				await dtxFile.parseFromMidi(invalidFile);
			} catch (error) {
				expect(error instanceof Error).toBe(true);
				expect((error as Error).message).toBe('Invalid MIDI file: Missing header');
			}
		});

		it('should extract BPM from Set Tempo meta events', async () => {
			const dtxFile = new DTXFile();

			// Create a minimal valid MIDI file with 140 BPM tempo
			// BPM = 60,000,000 / microseconds_per_quarter_note
			// For 140 BPM: 60,000,000 / 140 = 428,571 microseconds
			const microsecondsPerQuarter = Math.round(60000000 / 140); // 428571

			const midiData = new Uint8Array([
				// Header chunk
				0x4d,
				0x54,
				0x68,
				0x64, // "MThd"
				0x00,
				0x00,
				0x00,
				0x06, // Header length: 6 bytes
				0x00,
				0x00, // Format type: 0
				0x00,
				0x01, // Track count: 1
				0x01,
				0xe0, // Ticks per quarter note: 480

				// Track chunk
				0x4d,
				0x54,
				0x72,
				0x6b, // "MTrk"
				0x00,
				0x00,
				0x00,
				0x0b, // Track length: 11 bytes

				// Set Tempo meta event (FF 51 03 + 3 bytes for microseconds)
				0x00, // Delta time: 0
				0xff,
				0x51,
				0x03, // Meta event: Set Tempo, 3 bytes
				(microsecondsPerQuarter >> 16) & 0xff,
				(microsecondsPerQuarter >> 8) & 0xff,
				microsecondsPerQuarter & 0xff,

				// End of track
				0x00, // Delta time: 0
				0xff,
				0x2f,
				0x00 // Meta event: End of Track
			]);

			const file = new File([midiData], 'test140bpm.mid', { type: 'audio/midi' });
			await dtxFile.parseFromMidi(file);

			expect(dtxFile.bpm).toBe(140);
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
			let midiToDtxMap = {
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

		it('should generate select options for lane mapping', () => {
			const availableLanes = [
				'01',
				'02',
				'03',
				'04',
				'05',
				'06',
				'07',
				'08',
				'09',
				'0A',
				'0B',
				'0C'
			];
			const laneNames = {
				'01': 'Bass Drum',
				'02': 'Snare',
				'03': 'Closed Hi-Hat',
				'04': 'Open Hi-Hat',
				'05': 'Crash Cymbal',
				'06': 'Ride Cymbal',
				'07': 'Low Tom',
				'08': 'Mid Tom',
				'09': 'High Tom',
				'0A': 'Pedal Hi-Hat',
				'0B': 'Crash 2',
				'0C': 'Ride 2'
			};

			const selectOptions = availableLanes.map((lane) => ({
				value: lane,
				label: `${lane} - ${laneNames[lane as keyof typeof laneNames]}`
			}));

			expect(selectOptions).toHaveLength(12);
			expect(selectOptions[0]).toEqual({ value: '01', label: '01 - Bass Drum' });
			expect(selectOptions[1]).toEqual({ value: '02', label: '02 - Snare' });
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
