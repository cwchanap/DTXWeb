import { describe, it, expect, vi } from 'vitest';
import { SimFile } from './simFile';

// Simple tests focusing on public API and structure
describe('SimFile', () => {
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
});
