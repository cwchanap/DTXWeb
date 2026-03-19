import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimFile } from './simFile';

const mockJSZip = vi.hoisted(() => {
	const mockLoadAsync = vi.fn();
	const MockJSZip = vi.fn(() => ({
		loadAsync: mockLoadAsync,
		file: vi.fn(),
		generateAsync: vi.fn().mockResolvedValue(new Blob())
	}));
	(MockJSZip as any).mockLoadAsync = mockLoadAsync;
	return MockJSZip;
});

vi.mock('jszip', () => ({ default: mockJSZip }));

const mockDTXParse = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const MockDTXFile = vi.hoisted(() => vi.fn());

const createMockDTXFile = (file?: File | string, label?: string) => ({
	parse: mockDTXParse,
	label,
	getFileName: () => (file instanceof File ? file.name : null)
});

vi.mock('./dtx', () => ({
	DTXFile: MockDTXFile
}));

// Simple tests focusing on public API and structure
describe('SimFile', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDTXParse.mockResolvedValue(undefined);
		MockDTXFile.mockImplementation(createMockDTXFile);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	describe('parseHeader', () => {
		it('parses title from def file content', async () => {
			const defContent = '#TITLE My Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
			const defFile = new File([defContent], 'set.def');
			const dtxFile = new File(['dtx data'], 'bas.dtx');
			const simFile = new SimFile([defFile, dtxFile]);

			await simFile.parseHeader(defFile);

			expect(simFile.title).toBe('My Song');
		});

		it('sets empty title when #TITLE not found', async () => {
			const defContent = '#L1LABEL BASIC\n#L1FILE bas.dtx\n';
			const defFile = new File([defContent], 'set.def');
			const dtxFile = new File(['dtx data'], 'bas.dtx');
			const simFile = new SimFile([defFile, dtxFile]);

			await simFile.parseHeader(defFile);

			expect(simFile.title).toBe('');
		});

		it('populates levels from def file', async () => {
			const defContent = '#TITLE Test\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
			const defFile = new File([defContent], 'set.def');
			const dtxFile = new File(['dtx data'], 'bas.dtx');
			const simFile = new SimFile([defFile, dtxFile]);

			await simFile.parseHeader(defFile);

			expect(simFile.levels[1]).toBeDefined();
			expect(simFile.levels[1]?.label).toBe('BASIC');
		});

		it('skips level when dtx file not found in files array', async () => {
			const defContent = '#TITLE Test\n#L2LABEL ADVANCED\n#L2FILE adv.dtx\n';
			const defFile = new File([defContent], 'set.def');
			// No adv.dtx in the files array
			const simFile = new SimFile([defFile]);

			await simFile.parseHeader(defFile);

			expect(simFile.levels[2]).toBeUndefined();
		});

		it('parses multiple levels from def file', async () => {
			const defContent =
				'#TITLE Multi\n#L1LABEL BASIC\n#L1FILE bas.dtx\n#L3LABEL EXTREME\n#L3FILE ext.dtx\n';
			const defFile = new File([defContent], 'set.def');
			const dtxFile1 = new File(['dtx'], 'bas.dtx');
			const dtxFile3 = new File(['dtx'], 'ext.dtx');
			const simFile = new SimFile([defFile, dtxFile1, dtxFile3]);

			await simFile.parseHeader(defFile);

			expect(simFile.levels[1]).toBeDefined();
			expect(simFile.levels[3]).toBeDefined();
			expect(simFile.levels[2]).toBeUndefined();
		});
	});

	describe('parse', () => {
		it('calls parseHeader with the def file', async () => {
			const defContent = '#TITLE Test Song\n';
			const defFile = new File([defContent], 'set.def');
			const simFile = new SimFile([defFile]);
			const parseHeaderSpy = vi.spyOn(simFile, 'parseHeader').mockResolvedValue(undefined);

			await simFile.parse();

			expect(parseHeaderSpy).toHaveBeenCalledWith(defFile);
		});
	});
	describe('constructor', () => {
		it('should create SimFile with files', () => {
			const mockFiles = [new File(['test'], 'test.dtx')];
			const simFile = new SimFile(mockFiles);
			expect(simFile.files).toBe(mockFiles);
		});

		it('should create SimFile with bucket URL', () => {
			const mockFiles = [new File(['test'], 'test.dtx')];
			const bucketUrl = 'https://example.com';
			const simFile = new SimFile(mockFiles, bucketUrl);
			expect(simFile.files).toBe(mockFiles);
		});
	});

	describe('generateDefFileContent', () => {
		it('should generate def file content with default values', () => {
			const simFile = new SimFile([]);

			const content = simFile.generateDefFileContent();

			expect(content).toContain('#L1LABEL BASIC');
			expect(content).toContain('#L1FILE bas.dtx');
			expect(content).toContain('#L2LABEL ADVANCED');
			expect(content).toContain('#L2FILE adv.dtx');
			expect(content).toContain('#L3LABEL EXTREME');
			expect(content).toContain('#L3FILE ext.dtx');
			expect(content).toContain('#L4LABEL MASTER');
			expect(content).toContain('#L4FILE mas.dtx');
			expect(content).toContain('#L5LABEL REAL');
			expect(content).toContain('#L5FILE real.dtx');
		});

		it('should generate def file content with title when set', () => {
			const simFile = new SimFile([]);
			simFile.title = 'Test Song';

			const content = simFile.generateDefFileContent();

			expect(content).toContain('#TITLE Test Song');
		});

		it('should not include title when empty', () => {
			const simFile = new SimFile([]);

			const content = simFile.generateDefFileContent();

			expect(content).not.toContain('#TITLE');
		});
	});

	describe('getHighestLevel', () => {
		it('should throw error when no levels found', () => {
			const simFile = new SimFile([]);

			expect(() => simFile.getHighestLevel()).toThrow('No levels found');
		});

		it('should return highest priority level when multiple exist', () => {
			const simFile = new SimFile([]);
			const mockDTX1 = { parse: vi.fn() } as any;
			const mockDTX5 = { parse: vi.fn() } as any;

			simFile.levels[1] = { label: 'BASIC', file: mockDTX1 };
			simFile.levels[5] = { label: 'REAL', file: mockDTX5 };

			expect(simFile.getHighestLevel()).toBe(mockDTX5); // Level 5 has priority over 1
		});

		it('should fallback to lower levels when higher ones unavailable', () => {
			const simFile = new SimFile([]);
			const mockDTX2 = { parse: vi.fn() } as any;

			simFile.levels[2] = { label: 'ADVANCED', file: mockDTX2 };

			expect(simFile.getHighestLevel()).toBe(mockDTX2); // Should get level 2 when 5,4,3 not available
		});
	});

	describe('level management', () => {
		it('should handle level parsing and retrieval', () => {
			const simFile = new SimFile([]);
			simFile.levels = [
				{ label: 'BASIC', difficulty: 1 },
				{ label: 'ADVANCED', difficulty: 5 },
				{ label: 'EXTREME', difficulty: 8 }
			] as any;

			expect(() => simFile.getHighestLevel()).not.toThrow();
		});

		it('should properly validate level structure', () => {
			const simFile = new SimFile([]);

			// Test with empty levels - should throw
			expect(() => simFile.getHighestLevel()).toThrow('No levels found');
		});
	});

	describe('def file content generation logic', () => {
		it('should generate consistent def file structure', () => {
			const simFile = new SimFile([]);
			const content = simFile.generateDefFileContent();

			// Check that all level entries are present
			const levelPattern = /#L\d+LABEL/g;
			const filePattern = /#L\d+FILE/g;

			const labelMatches = content.match(levelPattern);
			const fileMatches = content.match(filePattern);

			expect(labelMatches).toHaveLength(5); // BASIC, ADVANCED, EXTREME, MASTER, REAL
			expect(fileMatches).toHaveLength(5);
		});

		it('should handle title inclusion logic correctly', () => {
			const simFile = new SimFile([]);

			// Test with title
			simFile.title = 'Test Song';
			const contentWithTitle = simFile.generateDefFileContent();
			expect(contentWithTitle).toContain('#TITLE Test Song');

			// Test without title
			simFile.title = '';
			const contentWithoutTitle = simFile.generateDefFileContent();
			expect(contentWithoutTitle).not.toContain('#TITLE');
		});
	});

	describe('error handling', () => {
		it('should throw error when no .def file found during parse', async () => {
			const mockFiles = [new File(['test'], 'test.dtx'), new File(['audio'], 'test.mp3')];
			const simFile = new SimFile(mockFiles);

			await expect(simFile.parse()).rejects.toThrow('No .def file found');
		});

		it('should throw error when preview file not found', () => {
			const simFile = new SimFile([]);
			const mockDTX = {
				parse: vi.fn(),
				preview: 'missing_preview.wav'
			} as any;

			simFile.levels[1] = { label: 'BASIC', file: mockDTX };

			expect(() => simFile.getPreviewFile()).toThrow('Preview file not found');
		});

		it('should throw error when sound preview file not found', () => {
			const simFile = new SimFile([]);
			const mockDTX = {
				parse: vi.fn(),
				soundPreview: 'missing_sound_preview.wav'
			} as any;

			simFile.levels[1] = { label: 'BASIC', file: mockDTX };

			expect(() => simFile.getSoundPreviewFile()).toThrow('Preview file not found');
		});

		it('should validate SimFile constructor parameters', () => {
			const files = [new File(['content'], 'test.def')];
			const bucketUrl = 'https://example.com/bucket';

			const simFile = new SimFile(files, bucketUrl);
			expect(simFile.files).toBe(files);

			const simFileWithoutBucket = new SimFile(files);
			expect(simFileWithoutBucket.files).toBe(files);
		});
	});

	describe('getLevel method', () => {
		it('should return specific level when requested and available', () => {
			const simFile = new SimFile([]);
			const mockDTX = { parse: vi.fn() } as any;

			simFile.levels[3] = { label: 'EXTREME', file: mockDTX };

			expect(simFile.getLevel(3)).toBe(mockDTX);
		});

		it('should return highest level when level parameter is undefined', () => {
			const simFile = new SimFile([]);
			const mockDTX = { parse: vi.fn() } as any;

			simFile.levels[2] = { label: 'ADVANCED', file: mockDTX };

			expect(simFile.getLevel(undefined)).toBe(mockDTX);
		});

		it('should return undefined when requested level not available', () => {
			const simFile = new SimFile([]);
			const mockDTX1 = { parse: vi.fn() } as any;

			simFile.levels[1] = { label: 'BASIC', file: mockDTX1 };

			// Request level 4 but only level 1 exists, should return undefined since levels[4] doesn't exist
			expect(simFile.getLevel(4)).toBeUndefined();
		});

		it('should fallback to highest level when level parameter is falsy', () => {
			const simFile = new SimFile([]);
			const mockDTX1 = { parse: vi.fn() } as any;

			simFile.levels[1] = { label: 'BASIC', file: mockDTX1 };

			// When level is 0 (falsy), should return highest level
			expect(simFile.getLevel(0)).toBe(mockDTX1);
		});
	});

	describe('ZIP handling', () => {
		it('should create JSZip instance with files', () => {
			const mockFiles = [
				new File(['def content'], 'set.def'),
				new File(['dtx content'], 'bas.dtx')
			];
			const simFile = new SimFile(mockFiles);

			const zip = simFile.getZip();
			expect(zip).toBeDefined();
			expect(typeof zip.generateAsync).toBe('function');
		});
	});

	describe('getPreview and getSoundPreview', () => {
		it('should return object URL for preview file', () => {
			const previewFile = new File(['preview data'], 'preview.wav');
			const simFile = new SimFile([previewFile]);
			const mockDTX = { parse: vi.fn(), preview: 'preview.wav' } as any;
			simFile.levels[1] = { label: 'BASIC', file: mockDTX };

			const mockUrl = 'blob:http://localhost/preview-url';
			vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue(mockUrl) });

			const result = simFile.getPreview();

			expect(result).toBe(mockUrl);
			expect(URL.createObjectURL).toHaveBeenCalledWith(previewFile);
		});

		it('should return object URL for sound preview file', () => {
			const soundFile = new File(['sound data'], 'preview_sound.ogg');
			const simFile = new SimFile([soundFile]);
			const mockDTX = { parse: vi.fn(), soundPreview: 'preview_sound.ogg' } as any;
			simFile.levels[1] = { label: 'BASIC', file: mockDTX };

			const mockUrl = 'blob:http://localhost/sound-url';
			vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue(mockUrl) });

			const result = simFile.getSoundPreview();

			expect(result).toBe(mockUrl);
			expect(URL.createObjectURL).toHaveBeenCalledWith(soundFile);
		});

		it('should find preview file case-sensitively by name', () => {
			const drumFile = new File(['audio'], 'drum.wav');
			const exactPreviewFile = new File(['preview lowercase'], 'preview.mp3');
			const wrongCasePreviewFile = new File(['preview uppercase'], 'Preview.mp3');
			const simFile = new SimFile([drumFile, exactPreviewFile, wrongCasePreviewFile]);
			const mockDTX = { parse: vi.fn(), preview: 'preview.mp3' } as any;
			simFile.levels[1] = { label: 'BASIC', file: mockDTX };

			const createObjectURLMock = vi.fn().mockReturnValue('blob:url');
			vi.stubGlobal('URL', { createObjectURL: createObjectURLMock });

			simFile.getPreview();

			// Verify the exact file passed — name must be lowercase 'preview.mp3', not 'Preview.mp3'
			expect(createObjectURLMock).toHaveBeenCalledTimes(1);
			const passedFile = createObjectURLMock.mock.calls[0][0] as File;
			expect(passedFile.name).toBe('preview.mp3');
			expect(passedFile.name).not.toBe('Preview.mp3');
		});
	});

	describe('parseFromRemoteURL', () => {
		it('should throw when set.def fetch fails', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

			await expect(
				SimFile.parseFromRemoteURL('sim-fail', 'https://example.com')
			).rejects.toThrow('Network error');
		});

		it('fetches set.def and creates a SimFile from remote URL', async () => {
			const mockBlob = new Blob(['#TITLE Remote Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n']);
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({ blob: () => Promise.resolve(mockBlob) })
			);
			MockDTXFile.mockImplementation(createMockDTXFile);

			const dtxBlob = new Blob(['dtx content']);
			vi.mocked(global.fetch)
				.mockResolvedValueOnce({ blob: () => Promise.resolve(mockBlob) } as any)
				.mockResolvedValue({ ok: true, blob: () => Promise.resolve(dtxBlob) } as any);

			const simFile = await SimFile.parseFromRemoteURL('sim-001', 'https://example.com');

			expect(simFile).toBeInstanceOf(SimFile);
			expect(simFile.title).toBe('Remote Song');
		});
	});

	describe('parseFromRemoteURLWithMetadata', () => {
		it('creates a SimFile using server-provided metadata', async () => {
			const dtxBlob = new Blob(['dtx content']);
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(dtxBlob) })
			);
			MockDTXFile.mockImplementation(createMockDTXFile);

			const metadata = {
				title: 'Metadata Song',
				levels: {
					1: { label: 'BASIC', fileName: 'bas.dtx' },
					3: { label: 'EXTREME', fileName: 'ext.dtx' }
				}
			};

			const simFile = await SimFile.parseFromRemoteURLWithMetadata(
				'sim-002',
				'https://example.com',
				metadata
			);

			expect(simFile).toBeInstanceOf(SimFile);
			expect(simFile.title).toBe('Metadata Song');
			expect(simFile.levels[1]).toBeDefined();
			expect(simFile.levels[3]).toBeDefined();
			expect(simFile.levels[2]).toBeUndefined();
		});

		it('skips levels where fetch response is not ok', async () => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, blob: vi.fn() }));
			MockDTXFile.mockImplementation(createMockDTXFile);

			const metadata = {
				title: 'Partial Song',
				levels: {
					1: { label: 'BASIC', fileName: 'bas.dtx' }
				}
			};

			const simFile = await SimFile.parseFromRemoteURLWithMetadata(
				'sim-003',
				'https://example.com',
				metadata
			);

			expect(simFile.levels[1]).toBeUndefined();
		});

		it('handles fetch errors gracefully and continues processing', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

			const metadata = {
				title: 'Error Song',
				levels: {
					1: { label: 'BASIC', fileName: 'bas.dtx' }
				}
			};

			const simFile = await SimFile.parseFromRemoteURLWithMetadata(
				'sim-004',
				'https://example.com',
				metadata
			);

			expect(simFile).toBeInstanceOf(SimFile);
			expect(simFile.levels[1]).toBeUndefined();
		});

		it('returns a SimFile with empty levels for empty metadata', async () => {
			const metadata = {
				title: 'Empty Song',
				levels: {}
			};

			const simFile = await SimFile.parseFromRemoteURLWithMetadata(
				'sim-005',
				'https://example.com',
				metadata
			);

			expect(simFile).toBeInstanceOf(SimFile);
			expect(simFile.title).toBe('Empty Song');
		});
	});

	describe('parseFromZip', () => {
		it('should extract files from zip, exclude directories, and parse title', async () => {
			const defBlob = new Blob(['#TITLE Zip Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n']);
			const dtxBlob = new Blob(['dtx content']);

			(mockJSZip as any).mockLoadAsync.mockResolvedValue({
				files: {
					'set.def': { dir: false, async: vi.fn().mockResolvedValue(defBlob) },
					'bas.dtx': { dir: false, async: vi.fn().mockResolvedValue(dtxBlob) },
					'subdir/': { dir: true, async: vi.fn() }
				}
			});

			MockDTXFile.mockImplementation(createMockDTXFile);

			const simFile = await SimFile.parseFromZip('dummy-zip-path');

			expect(simFile).toBeInstanceOf(SimFile);
			expect(simFile.files).toHaveLength(2);
			expect(simFile.files.map((f) => f.name)).toEqual(
				expect.arrayContaining(['set.def', 'bas.dtx'])
			);
			expect(simFile.files.map((f) => f.name)).not.toContain('subdir/');
		});
	});

	describe('parseFromRemoteURL with non-ok DTX fetch', () => {
		it('skips levels where DTX fetch response is not ok', async () => {
			const defContent = '#TITLE Bad DTX\n#L1LABEL BASIC\n#L1FILE bas.dtx\n';
			const defBlob = new Blob([defContent]);

			vi.stubGlobal(
				'fetch',
				vi
					.fn()
					.mockResolvedValueOnce({ blob: () => Promise.resolve(defBlob) })
					.mockResolvedValue({ ok: false, blob: vi.fn() })
			);
			MockDTXFile.mockImplementation(createMockDTXFile);

			const simFile = await SimFile.parseFromRemoteURL('sim-bad', 'https://example.com');

			expect(simFile).toBeInstanceOf(SimFile);
			expect(simFile.title).toBe('Bad DTX');
			expect(simFile.levels[1]).toBeUndefined();
		});
	});

	describe('parseHeader with only #L1FILE content', () => {
		it('parses header when content has only #L1FILE (no #TITLE or #L1LABEL)', async () => {
			// Content that will trigger the third branch of validateSimFileContent
			const defContent = '#L1FILE bas.dtx\n';
			const defFile = new File([defContent], 'set.def');
			const dtxFile = new File(['dtx data'], 'bas.dtx');
			const simFile = new SimFile([defFile, dtxFile]);

			await simFile.parseHeader(defFile);

			expect(simFile.title).toBe('');
		});
	});

	describe('generateDefFileContent with existing levels', () => {
		it('should use existing level data when available', () => {
			const simFile = new SimFile([]);
			const mockDTX = {
				parse: vi.fn(),
				getFileName: vi.fn().mockReturnValue('extreme.dtx')
			} as any;
			simFile.levels[3] = { label: 'EXTREME', file: mockDTX };

			const content = simFile.generateDefFileContent();

			expect(content).toContain('#L3LABEL EXTREME');
			expect(content).toContain('#L3FILE extreme.dtx');
		});

		it('should use defaultFile when getFileName returns null', () => {
			const simFile = new SimFile([]);
			const mockDTX = {
				parse: vi.fn(),
				getFileName: vi.fn().mockReturnValue(null)
			} as any;
			simFile.levels[2] = { label: 'ADVANCED', file: mockDTX };

			const content = simFile.generateDefFileContent();

			expect(content).toContain('#L2LABEL ADVANCED');
			expect(content).toContain('#L2FILE adv.dtx');
		});
	});
});
