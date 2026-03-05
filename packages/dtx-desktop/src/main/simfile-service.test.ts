import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import fs from 'fs';
import {
	fetchUserSimFiles,
	getPreviewUrl,
	getSoundPreviewUrl,
	createSimfileRecord,
	parseDtxFiles
} from './simfile-service';
import { getSupabaseClient, ensureSupabaseAuth, getCurrentSession } from './auth';
import { apiGet, apiPost } from './api-client';
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
	getSupabaseClient: vi.fn(),
	getCurrentSession: vi.fn()
}));

vi.mock('./api-client', () => ({
	apiGet: vi.fn(),
	apiPost: vi.fn(),
	apiPatch: vi.fn()
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
	const fetchMock: Mock = vi.fn();

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
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);

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
		(getCurrentSession as Mock).mockReturnValue({
			access_token: 'mock-access-token',
			user: { id: 'user-123' }
		});
		(apiGet as Mock).mockResolvedValue({ success: true, data: { data: [], count: 0 } });
		(apiPost as Mock).mockResolvedValue({
			success: true,
			data: { id: 1, title: 'New Song', artist: 'New Artist', bpm: 150 }
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('fetchUserSimFiles', () => {
		it('should fetch user simfiles successfully with single page', async () => {
			const mockSimfiles = [{ id: 'sim-1', title: 'Test Simfile' }];
			(apiGet as Mock).mockResolvedValue({
				success: true,
				data: { data: mockSimfiles, count: 1 }
			});

			const result = await fetchUserSimFiles();

			expect(result.success).toBe(true);
			if (!result.success) {
				throw new Error('Expected success result');
			}
			expect(result.data).toEqual(mockSimfiles);
			expect(result.fromCache).toBe(false);
			expect(apiGet).toHaveBeenCalledWith('/api/chart?scope=mine&page=1&pageSize=100');
		});

		it('should fetch user simfiles with pagination for multiple pages', async () => {
			const mockSimfiles = Array.from({ length: 150 }, (_, i) => ({
				id: `sim-${i}`,
				title: `Song ${i}`
			}));

			// First call returns 100 items and total count 150
			const firstPageData = mockSimfiles.slice(0, 100);
			const secondPageData = mockSimfiles.slice(100);

			(apiGet as Mock)
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
			expect(apiGet).toHaveBeenCalledTimes(2);
			expect(apiGet).toHaveBeenNthCalledWith(1, '/api/chart?scope=mine&page=1&pageSize=100');
			expect(apiGet).toHaveBeenNthCalledWith(2, '/api/chart?scope=mine&page=2&pageSize=100');
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
			(apiGet as Mock).mockResolvedValue({ success: false, error: 'User not authenticated' });
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
			(apiGet as Mock).mockResolvedValue({ success: false, error: 'Fetch failed' });
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
			const mockSimfiles = Array.from({ length: 100 }, (_, i) => ({
				id: `sim-${i}`,
				title: `Song ${i}`
			}));

			// First call succeeds, second call fails
			(apiGet as Mock)
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

		afterEach(() => {
			// Clean up environment variable after each test
			delete process.env.VITE_DTX_SERVER_URL;
		});

		beforeEach(() => {
			// Set required environment variable for API calls
			process.env.VITE_DTX_SERVER_URL = 'http://test-server.com';

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
			// Mock fetch for R2 upload API calls
			fetchMock.mockResolvedValue({ ok: true });

			try {
				const result = await createSimfileRecord(simfileData);

				expect(result.success).toBe(true);
				expect(result.simfileId).toBe('1');
				expect(apiPost).toHaveBeenCalledWith('/api/chart', expect.any(Object));

				// Verify fetch was called twice (once for image, once for audio)
				expect(fetchMock).toHaveBeenCalledTimes(2);

				// Verify that the fetch calls include proper headers
				fetchMock.mock.calls.forEach((call) => {
					const options = call[1] ?? {};
					const headers = (options as RequestInit).headers as Record<string, string>;
					expect(headers).toBeDefined();
					// Verify authentication header is included (note: case matters for header names)
					expect(headers['Authorization']).toBe('Bearer mock-access-token');
					// Verify desktop app identifiers for CSRF protection
					expect(headers['User-Agent']).toBe('DTXDesktopApp');
					expect(headers['X-Requested-With']).toBe('DTXDesktopApp');
					expect((options as RequestInit).body).toBeInstanceOf(FormData);
				});
			} finally {
				fetchMock.mockReset();
			}
		});

		it('should handle errors during file reading gracefully and still succeed', async () => {
			// Mock fetch for R2 upload API calls
			fetchMock.mockResolvedValue({ ok: true });

			try {
				(fs.promises.readdir as Mock).mockRejectedValue(new Error('Read error'));
				const result = await createSimfileRecord(simfileData);
				expect(result.success).toBe(true); // Continues without previews
				// No fetch calls for uploads since file reading failed
				expect(fetchMock).not.toHaveBeenCalled();
			} finally {
				fetchMock.mockReset();
			}
		});

		it('should return an error if simfile insertion fails', async () => {
			(apiPost as Mock).mockResolvedValue({ success: false, error: 'Insert failed' });
			const result = await createSimfileRecord(simfileData);
			expect(result.success).toBe(false);
			expect(result.error).toContain('Insert failed');
		});

		it('should handle missing authentication gracefully and skip uploads', async () => {
			// Mock getCurrentSession to return null (no session)
			(getCurrentSession as Mock).mockReturnValue(null);

			const result = await createSimfileRecord(simfileData);

			expect(result.success).toBe(true);
			expect(result.simfileId).toBe('1');

			// Verify fetch was NOT called since there's no session
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('should skip uploads when session refresh fails', async () => {
			fetchMock.mockResolvedValue({ ok: true });
			mockSupabaseClient.auth.getSession.mockResolvedValue({
				data: { session: null },
				error: new Error('Session expired')
			});

			const result = await createSimfileRecord(simfileData);

			expect(result.success).toBe(true);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('should create simfile successfully without preview files and no server URL', async () => {
			// Remove VITE_DTX_SERVER_URL to simulate offline/misconfigured environment
			delete process.env.VITE_DTX_SERVER_URL;

			// Mock readdir to return no preview files
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'song.dtx', isFile: () => true }
			]);

			const result = await createSimfileRecord(simfileData);

			expect(result.success).toBe(true);
			expect(result.simfileId).toBe('1');

			// Verify fetch was NOT called since there are no preview files
			expect(fetchMock).not.toHaveBeenCalled();
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
	});
});
