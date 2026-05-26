import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import fs from 'fs';
import {
	fetchUserSimFiles,
	getPreviewUrl,
	getSoundPreviewUrl,
	createSimfileRecord,
	parseDtxFiles,
	getNextDisplayId
} from './simfile-service';
import { getSupabaseClient, ensureSupabaseAuth } from './auth';
import { listSimfiles, nextDisplayId, createSimfile } from './api-client';
import { uploadFile } from './upload';
import { DTXFile, decodeFileWithEncodingDetection } from '@dtx/common/server';

// Mock dependencies
vi.mock('fs', () => ({
	default: {
		promises: {
			readdir: vi.fn(),
			readFile: vi.fn()
		}
	}
}));

vi.mock('crypto', () => ({
	default: {
		randomUUID: vi.fn(() => 'mock-uuid')
	}
}));

vi.mock('./auth', () => ({
	ensureSupabaseAuth: vi.fn(),
	getSupabaseClient: vi.fn()
}));

vi.mock('./api-client', () => ({
	listSimfiles: vi.fn(),
	nextDisplayId: vi.fn(),
	createSimfile: vi.fn(),
	updateSimfile: vi.fn(),
	deleteSimfile: vi.fn(),
	simfileSearch: vi.fn()
}));

vi.mock('./upload', () => ({
	uploadFile: vi.fn()
}));

// Use the global Supabase mock
vi.mock('@supabase/supabase-js');

// Define a type for the mocked DTXFile to ensure type safety
type MockDTXFile = {
	title: string;
	artist: string;
	bpm: number;
	level: number;
	parse: Mock;
	preview: string;
	soundPreview: string;
	comment: string;
	soundChips: unknown[];
	bpmChanges: unknown[];
	stopSequences: unknown[];
	chipCounts: Record<string, number>;
	totalNotes: number;
	duration: number;
	measures: unknown[];
	lanes: Record<string, unknown>;
	notes: unknown[];
	content: string;
};

vi.mock('@dtx/common/server', async (importOriginal) => {
	const actual = (await importOriginal()) as object;

	// Create a typed mock object
	const mockDtxFile: MockDTXFile = {
		title: 'Test Title',
		artist: 'Test Artist',
		bpm: 120,
		level: 5.5,
		parse: vi.fn().mockResolvedValue(undefined),
		preview: '',
		soundPreview: '',
		comment: '',
		soundChips: [],
		bpmChanges: [],
		stopSequences: [],
		chipCounts: {},
		totalNotes: 0,
		duration: 0,
		measures: [],
		lanes: {},
		notes: [],
		content: ''
	};

	return {
		...actual,
		DTXFile: vi.fn().mockImplementation(() => mockDtxFile),
		decodeFileWithEncodingDetection: vi
			.fn()
			.mockImplementation(async (file: { name: string }) => {
				// Return different content based on file name
				if (file.name.toLowerCase() === 'set.def') {
					return {
						content: `#L1LABEL EXT
#L1FILE song1.dtx`,
						encoding: 'utf-8'
					};
				}
				return {
					content: `#TITLE:Test Title
#ARTIST:Test Artist
#BPM:120
#DLEVEL:55`,
					encoding: 'utf-8'
				};
			})
	};
});

describe('SimFile Service', () => {
	// The global mock will be automatically used via vi.mock('@supabase/supabase-js')
	// We just need to get a reference to it for our test setup
	const mockSupabaseClient = {
		auth: {
			getUser: vi.fn(),
			getSession: vi.fn()
		},
		from: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		order: vi.fn(),
		single: vi.fn(),
		storage: {
			from: vi.fn().mockReturnThis(),
			upload: vi.fn(),
			getPublicUrl: vi.fn()
		}
	};

	beforeEach(() => {
		// Reset and configure mocks for each test
		vi.clearAllMocks();

		// Set up default successful responses
		mockSupabaseClient.auth.getUser.mockResolvedValue({
			data: { user: { id: 'user-123' } },
			error: null
		});
		mockSupabaseClient.auth.getSession.mockResolvedValue({
			data: { session: { access_token: 'mock-access-token' } },
			error: null
		});
		mockSupabaseClient.order.mockResolvedValue({ data: [], error: null });
		mockSupabaseClient.single.mockResolvedValue({ data: { id: '1' }, error: null });
		mockSupabaseClient.storage.upload.mockResolvedValue({ error: null });
		mockSupabaseClient.storage.getPublicUrl.mockImplementation((path: string) => ({
			data: { publicUrl: `http://google.com/${path}` }
		}));

		(getSupabaseClient as Mock).mockReturnValue(mockSupabaseClient);
		(ensureSupabaseAuth as Mock).mockResolvedValue(true);
		(listSimfiles as Mock).mockResolvedValue({ success: true, data: { data: [], count: 0 } });
		(nextDisplayId as Mock).mockResolvedValue({ success: true, data: 1 });
		(createSimfile as Mock).mockResolvedValue({
			success: true,
			data: {
				createSimfile: {
					id: '1',
					title: 'New Song',
					artist: 'New Artist',
					bpm: 150,
					displayId: null,
					userId: 'user-123',
					isPublished: false,
					downloadUrl: null,
					previewUrl: null,
					videoPreviewUrl: null,
					publishDate: new Date().toISOString(),
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					dtxFiles: []
				}
			}
		});
		(uploadFile as Mock).mockResolvedValue({
			success: true,
			data: { file: { key: 'mock-key' } }
		});
	});

	describe('fetchUserSimFiles', () => {
		const makeGqlSimfile = (id: string, title: string) => ({
			id,
			title,
			artist: 'Artist',
			bpm: 120,
			displayId: null,
			userId: 'user-1',
			isPublished: false,
			downloadUrl: null,
			previewUrl: null,
			videoPreviewUrl: null,
			publishDate: '2024-01-01T00:00:00Z',
			createdAt: '2024-01-01T00:00:00Z',
			updatedAt: '2024-01-01T00:00:00Z',
			dtxFiles: []
		});

		it('should fetch user simfiles successfully with single page', async () => {
			const mockSimfiles = [makeGqlSimfile('1', 'Test Simfile')];
			(listSimfiles as Mock).mockResolvedValue({
				success: true,
				data: { data: mockSimfiles, count: 1 }
			});

			const result = await fetchUserSimFiles();

			expect(result.success).toBe(true);
			if (!result.success) {
				throw new Error('Expected success result');
			}
			// Adapter converts camelCase to snake_case
			expect(result.data[0].id).toBe(1);
			expect(result.data[0].title).toBe('Test Simfile');
			expect(result.fromCache).toBe(false);
			expect(listSimfiles).toHaveBeenCalledWith({
				scope: 'MINE',
				page: 1,
				pageSize: 100
			});
		});

		it('should fetch user simfiles with pagination for multiple pages', async () => {
			const makePage = (start: number, count: number) =>
				Array.from({ length: count }, (_, i) =>
					makeGqlSimfile(String(start + i), `Song ${start + i}`)
				);

			const firstPageData = makePage(0, 100);
			const secondPageData = makePage(100, 50);

			(listSimfiles as Mock)
				.mockResolvedValueOnce({
					success: true,
					data: { data: firstPageData, count: 150 }
				})
				.mockResolvedValueOnce({
					success: true,
					data: { data: secondPageData, count: 150 }
				});

			const result = await fetchUserSimFiles();

			expect(result.success).toBe(true);
			if (!result.success) {
				throw new Error('Expected success result');
			}
			expect(result.data).toHaveLength(150);
			expect(result.fromCache).toBe(false);
			expect(listSimfiles).toHaveBeenCalledTimes(2);
			expect(listSimfiles).toHaveBeenNthCalledWith(1, {
				scope: 'MINE',
				page: 1,
				pageSize: 100
			});
			expect(listSimfiles).toHaveBeenNthCalledWith(2, {
				scope: 'MINE',
				page: 2,
				pageSize: 100
			});
		});

		it('should return an error if authentication is not ready', async () => {
			(ensureSupabaseAuth as Mock).mockResolvedValue(false);
			const result = await fetchUserSimFiles();
			expect(result.success).toBe(false);
			if (result.success) {
				throw new Error('Expected error result');
			}
			expect(result.error).toBe('Authentication not available. Please log in first.');
			expect(result.data).toEqual([]);
			expect(result.fromCache).toBe(false);
		});

		it('should return an error if user is not authenticated', async () => {
			(listSimfiles as Mock).mockResolvedValue({
				success: false,
				error: 'User not authenticated'
			});
			const result = await fetchUserSimFiles();
			expect(result.success).toBe(false);
			if (result.success) {
				throw new Error('Expected error result');
			}
			expect(result.error).toBe('User not authenticated');
			expect(result.data).toEqual([]);
			expect(result.fromCache).toBe(false);
		});

		it('should return an error if fetching fails', async () => {
			(listSimfiles as Mock).mockResolvedValue({ success: false, error: 'Fetch failed' });
			const result = await fetchUserSimFiles();
			expect(result.success).toBe(false);
			if (result.success) {
				throw new Error('Expected error result');
			}
			expect(result.error).toContain('Fetch failed');
			expect(result.data).toEqual([]);
			expect(result.fromCache).toBe(false);
		});

		it('should handle pagination error on subsequent pages', async () => {
			const mockSimfiles = Array.from({ length: 100 }, (_, i) =>
				makeGqlSimfile(String(i), `Song ${i}`)
			);

			// First call succeeds, second call fails
			(listSimfiles as Mock)
				.mockResolvedValueOnce({
					success: true,
					data: { data: mockSimfiles, count: 150 }
				})
				.mockResolvedValueOnce({
					success: false,
					error: 'Page fetch failed'
				});

			const result = await fetchUserSimFiles();

			expect(result.success).toBe(false);
			if (result.success) {
				throw new Error('Expected error result');
			}
			expect(result.error).toContain('Page fetch failed');
		});
	});

	describe('getNextDisplayId', () => {
		it('returns nextDisplayId from API', async () => {
			(nextDisplayId as Mock).mockResolvedValue({
				success: true,
				data: 42
			});

			const result = await getNextDisplayId();

			expect(result).toBe(42);
			expect(nextDisplayId).toHaveBeenCalled();
		});

		it('throws when authentication is not ready', async () => {
			(ensureSupabaseAuth as Mock).mockResolvedValue(false);
			await expect(getNextDisplayId()).rejects.toThrow(
				'Authentication not available. Please log in first.'
			);
		});

		it('throws when API call fails', async () => {
			(nextDisplayId as Mock).mockResolvedValue({ success: false, error: 'Server error' });
			await expect(getNextDisplayId()).rejects.toThrow('Server error');
		});

		it('throws when result.data is missing', async () => {
			(nextDisplayId as Mock).mockResolvedValue({ success: true, data: undefined });
			await expect(getNextDisplayId()).rejects.toThrow(
				'Invalid nextDisplayId in API response'
			);
		});

		it('throws when nextDisplayId is not a finite number', async () => {
			(nextDisplayId as Mock).mockResolvedValue({
				success: true,
				data: Infinity
			});
			await expect(getNextDisplayId()).rejects.toThrow(
				'Invalid nextDisplayId in API response'
			);
		});

		it('throws when nextDisplayId is not a number', async () => {
			(nextDisplayId as Mock).mockResolvedValue({
				success: true,
				data: 'not-a-number'
			});
			await expect(getNextDisplayId()).rejects.toThrow(
				'Invalid nextDisplayId in API response'
			);
		});
	});

	describe('preview url helpers', () => {
		let originalBucketUrl: string | undefined;
		let originalSupabaseUrl: string | undefined;

		beforeEach(() => {
			originalBucketUrl = process.env.PUBLIC_SIMFILE_BUCKET_URL;
			originalSupabaseUrl = process.env.PUBLIC_SUPABASE_URL;
			vi.stubEnv('PUBLIC_SIMFILE_BUCKET_URL', 'https://example.com/');
			vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://supabase.example');
		});

		afterEach(() => {
			vi.unstubAllEnvs();
			if (originalBucketUrl === undefined) {
				delete process.env.PUBLIC_SIMFILE_BUCKET_URL;
			} else {
				process.env.PUBLIC_SIMFILE_BUCKET_URL = originalBucketUrl;
			}
			if (originalSupabaseUrl === undefined) {
				delete process.env.PUBLIC_SUPABASE_URL;
			} else {
				process.env.PUBLIC_SUPABASE_URL = originalSupabaseUrl;
			}
		});

		describe('getPreviewUrl', () => {
			it('should construct R2 URL from simfile ID', () => {
				const url = getPreviewUrl(123);
				expect(url).toBe('https://example.com/123/preview.jpg');
			});

			it('should handle different simfile IDs', () => {
				const url = getPreviewUrl(456);
				expect(url).toBe('https://example.com/456/preview.jpg');
			});
		});

		describe('getSoundPreviewUrl', () => {
			it('should construct R2 URL from simfile ID', () => {
				const url = getSoundPreviewUrl(123);
				expect(url).toBe('https://example.com/123/preview.mp3');
			});

			it('should handle different simfile IDs', () => {
				const url = getSoundPreviewUrl(456);
				expect(url).toBe('https://example.com/456/preview.mp3');
			});
		});
	});

	describe('createSimfileRecord', () => {
		const simfileData = {
			title: 'New Song',
			artist: 'New Artist',
			bpm: 150,
			displayId: 1,
			isPublished: true,
			publishDate: new Date().toISOString(),
			downloadUrl: '',
			videoPreviewUrl: '',
			levels: [{ label: 'EXT', level: 9.5 }],
			songPath: '/path/to/song'
		};

		beforeEach(() => {
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: 'user-123' } },
				error: null
			});
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'preview.jpg', isFile: () => true },
				{ name: 'preview.mp3', isFile: () => true },
				{ name: 'song.dtx', isFile: () => true }
			]);
			(fs.promises.readFile as Mock).mockResolvedValue(Buffer.from('mock-data'));
		});

		it('should create a simfile record successfully with previews', async () => {
			const result = await createSimfileRecord(simfileData);

			expect(result.success).toBe(true);
			expect(result.simfileId).toBe('1');
			expect(createSimfile).toHaveBeenCalledWith(
				expect.objectContaining({
					title: 'New Song',
					artist: 'New Artist',
					bpm: 150
				})
			);

			// Verify uploadFile was called twice (once for image, once for audio)
			expect(uploadFile).toHaveBeenCalledTimes(2);
		});

		it('should handle errors during file reading gracefully and still succeed', async () => {
			(fs.promises.readdir as Mock).mockRejectedValue(new Error('Read error'));
			const result = await createSimfileRecord(simfileData);
			expect(result.success).toBe(true); // Continues without previews
			// No upload calls since file reading failed
			expect(uploadFile).not.toHaveBeenCalled();
		});

		it('should return an error if simfile insertion fails', async () => {
			(createSimfile as Mock).mockResolvedValue({ success: false, error: 'Insert failed' });
			const result = await createSimfileRecord(simfileData);
			expect(result.success).toBe(false);
			expect(result.error).toContain('Insert failed');
		});

		it('should create simfile successfully without preview files', async () => {
			// Mock readdir to return no preview files
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'song.dtx', isFile: () => true }
			]);

			const result = await createSimfileRecord(simfileData);

			expect(result.success).toBe(true);
			expect(result.simfileId).toBe('1');

			// Verify uploadFile was NOT called since there are no preview files
			expect(uploadFile).not.toHaveBeenCalled();
		});

		it('should return warnings when preview upload fails', async () => {
			(uploadFile as Mock).mockResolvedValue({ success: false, error: 'Upload failed' });

			const result = await createSimfileRecord(simfileData);

			expect(result.success).toBe(true);
			expect(result.simfileId).toBe('1');
			expect(result.warnings).toBeDefined();
			expect(result.warnings).toHaveLength(2);
		});
	});

	describe('parseDtxFiles', () => {
		beforeEach(() => {
			(decodeFileWithEncodingDetection as Mock).mockImplementation(
				async (file: { name: string }) => {
					if (file.name.toLowerCase() === 'set.def') {
						return {
							content: `#L1LABEL EXT
#L1FILE song1.dtx`,
							encoding: 'utf-8'
						};
					}
					return {
						content: `#TITLE:Test Title
#ARTIST:Test Artist
#BPM:120
#DLEVEL:55`,
						encoding: 'utf-8'
					};
				}
			);
		});

		it('should parse DTX files and SET.def correctly', async () => {
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'set.def', isFile: () => true },
				{ name: 'song1.dtx', isFile: () => true }
			]);

			const result = await parseDtxFiles('/fake/path');

			expect(result.bpm).toBe(120);
			expect(result.artist).toBe('Test Artist');
			// SET.def parsing correctly extracts the 'EXT' label from the mapping
			expect(result.levels).toEqual([{ label: 'EXT', level: 5.5 }]);
			expect(DTXFile).toHaveBeenCalled();
		});

		it('should use filename as label if SET.def is not present', async () => {
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'MYSONG.dtx', isFile: () => true }
			]);

			const result = await parseDtxFiles('/fake/path');

			expect(result.levels).toEqual([{ label: 'MYSONG', level: 5.5 }]);
		});

		it('should return empty data if no DTX files are found', async () => {
			(fs.promises.readdir as Mock).mockResolvedValue([]);
			const result = await parseDtxFiles('/fake/path');
			expect(result.levels).toEqual([]);
			expect(result.bpm).toBeUndefined();
			expect(result.artist).toBeUndefined();
		});

		it('should skip DTX files that fail to parse and continue with others', async () => {
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'bad.dtx', isFile: () => true },
				{ name: 'good.dtx', isFile: () => true }
			]);

			// First readFile call throws, second succeeds
			(fs.promises.readFile as Mock)
				.mockRejectedValueOnce(new Error('read error'))
				.mockResolvedValueOnce(Buffer.from('mock'));

			const result = await parseDtxFiles('/fake/path');

			// good.dtx is still parsed
			expect(result.bpm).toBe(120);
			expect(result.artist).toBe('Test Artist');
		});

		it('should return empty result when top-level readdir throws', async () => {
			(fs.promises.readdir as Mock).mockRejectedValue(new Error('EACCES'));

			const result = await parseDtxFiles('/fake/path');
			expect(result.bpm).toBeUndefined();
			expect(result.artist).toBeUndefined();
			expect(result.levels).toEqual([]);
		});

		it('should invoke validateSetDefContent callback during SET.def parsing', async () => {
			let validateSetDefContentCalled = false;
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'SET.def', isFile: () => true },
				{ name: 'song.dtx', isFile: () => true }
			]);
			(fs.promises.readFile as Mock)
				.mockResolvedValueOnce(Buffer.from('mock-set-def')) // for SET.def
				.mockResolvedValueOnce(Buffer.from('mock-dtx')); // for song.dtx

			// Make the mock call the SET.def validator
			(decodeFileWithEncodingDetection as Mock).mockImplementationOnce(
				async (_file: unknown, validator: (content: string) => boolean) => {
					const content = '#L1LABEL EASY\n#L1FILE song.dtx';
					validateSetDefContentCalled = true;
					expect(validator(content)).toBe(true);
					return { content, encoding: 'utf-8' };
				}
			);

			const result = await parseDtxFiles('/fake/path');
			expect(result.bpm).toBe(120);
			expect(validateSetDefContentCalled).toBe(true);
		});

		it('should continue when SET.def read fails', async () => {
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'SET.def', isFile: () => true },
				{ name: 'song.dtx', isFile: () => true }
			]);
			// First readFile (for SET.def) throws, second (for DTX) succeeds
			(fs.promises.readFile as Mock)
				.mockRejectedValueOnce(new Error('EACCES'))
				.mockResolvedValueOnce(Buffer.from('mock'));

			const result = await parseDtxFiles('/fake/path');
			expect(result.bpm).toBe(120);
			expect(result.artist).toBe('Test Artist');
			// Label falls back to filename without extension (uppercased)
			expect(result.levels).toEqual([{ label: 'SONG', level: 5.5 }]);
		});

		it('should invoke validateDtxContent callback during DTX parsing', async () => {
			let validateDtxContentCalled = false;
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'song.dtx', isFile: () => true }
			]);
			(fs.promises.readFile as Mock).mockResolvedValueOnce(Buffer.from('mock'));

			// Make the mock actually call the validator
			(decodeFileWithEncodingDetection as Mock).mockImplementationOnce(
				async (_file: unknown, validator: (content: string) => boolean) => {
					const content = '#TITLE:Test\n#ARTIST:Artist\n#BPM:120';
					validateDtxContentCalled = true;
					expect(validator(content)).toBe(true);
					return { content, encoding: 'utf-8' };
				}
			);

			const result = await parseDtxFiles('/fake/path');
			expect(result.bpm).toBe(120);
			expect(validateDtxContentCalled).toBe(true);
		});
	});
});
