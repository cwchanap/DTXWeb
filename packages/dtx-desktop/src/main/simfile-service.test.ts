import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import fs from 'fs';
import {
	fetchUserSimFiles,
	getPreviewUrl,
	getSoundPreviewUrl,
	createSimfileRecord,
	parseDtxFiles
} from './simfile-service';
import { getSupabaseClient, ensureSupabaseAuth } from './auth';
import { DTXFile, decodeFileWithEncodingDetection } from '@dtx/common';

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

vi.mock('@dtx/common', async (importOriginal) => {
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
		decodeFileWithEncodingDetection: vi.fn().mockResolvedValue('')
	};
});

describe('SimFile Service', () => {
	// The global mock will be automatically used via vi.mock('@supabase/supabase-js')
	// We just need to get a reference to it for our test setup
	const mockSupabaseClient = {
		auth: {
			getUser: vi.fn()
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
		mockSupabaseClient.order.mockResolvedValue({ data: [], error: null });
		mockSupabaseClient.single.mockResolvedValue({ data: { id: '1' }, error: null });
		mockSupabaseClient.storage.upload.mockResolvedValue({ error: null });
		mockSupabaseClient.storage.getPublicUrl.mockImplementation((path: string) => ({
			data: { publicUrl: `http://google.com/${path}` }
		}));

		(getSupabaseClient as Mock).mockReturnValue(mockSupabaseClient);
		(ensureSupabaseAuth as Mock).mockResolvedValue(true);
	});

	describe('fetchUserSimFiles', () => {
		it('should fetch user simfiles successfully', async () => {
			const mockUser = { id: 'user-123' };
			const mockSimfiles = [{ id: 'sim-1', title: 'Test Simfile' }];
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: mockUser },
				error: null
			});
			mockSupabaseClient.order.mockResolvedValue({ data: mockSimfiles, error: null });

			const result = await fetchUserSimFiles();

			expect(result.data).toEqual(mockSimfiles);
			expect(result.fromCache).toBe(false);
			expect(result.error).toBeUndefined();
			expect(mockSupabaseClient.from).toHaveBeenCalledWith('simfiles');
			expect(mockSupabaseClient.select).toHaveBeenCalledWith(expect.any(String));
			expect(mockSupabaseClient.eq).toHaveBeenCalledWith('user_id', mockUser.id);
		});

		it('should return an error if authentication is not ready', async () => {
			(ensureSupabaseAuth as Mock).mockResolvedValue(false);
			const result = await fetchUserSimFiles();
			expect(result.error).toBe('Authentication not available. Please log in first.');
		});

		it('should return an error if user is not authenticated', async () => {
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: null },
				error: null
			});
			const result = await fetchUserSimFiles();
			expect(result.error).toBe('User not authenticated');
		});

		it('should return an error if fetching fails', async () => {
			mockSupabaseClient.auth.getUser.mockResolvedValue({
				data: { user: { id: '123' } },
				error: null
			});
			mockSupabaseClient.order.mockResolvedValue({
				data: null,
				error: { message: 'Fetch failed' }
			});
			const result = await fetchUserSimFiles();
			expect(result.error).toContain('Failed to fetch simFiles: Fetch failed');
		});
	});

	describe('getPreviewUrl', () => {
		it('should return a public URL for the preview', () => {
			const url = getPreviewUrl('user/preview.jpg');
			expect(url).toBe('http://google.com/user/preview.jpg');
			expect(mockSupabaseClient.storage.from).toHaveBeenCalledWith('simfile-previews');
		});
	});

	describe('getSoundPreviewUrl', () => {
		it('should return a public URL for the sound preview', () => {
			const url = getSoundPreviewUrl('user/preview.mp3');
			expect(url).toBe('http://google.com/user/preview.mp3');
			expect(mockSupabaseClient.storage.from).toHaveBeenCalledWith('simfile-sound-previews');
		});

		it('should return null if no sound preview url is provided', () => {
			const url = getSoundPreviewUrl(null);
			expect(url).toBeNull();
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
			expect(mockSupabaseClient.storage.from).toHaveBeenCalledWith('simfile-previews');
			expect(mockSupabaseClient.storage.from).toHaveBeenCalledWith('simfile-sound-previews');
			expect(mockSupabaseClient.storage.upload).toHaveBeenCalledTimes(2);
			expect(mockSupabaseClient.from).toHaveBeenCalledWith('simfiles');
			expect(mockSupabaseClient.insert).toHaveBeenCalledTimes(2); // once for simfiles, once for dtx_files
		});

		it('should handle errors during file reading gracefully and still succeed', async () => {
			(fs.promises.readdir as Mock).mockRejectedValue(new Error('Read error'));
			const result = await createSimfileRecord(simfileData);
			expect(result.success).toBe(true); // Continues without previews
			expect(mockSupabaseClient.storage.upload).not.toHaveBeenCalled();
		});

		it('should return an error if simfile insertion fails', async () => {
			mockSupabaseClient.single.mockResolvedValue({
				data: null,
				error: { message: 'Insert failed' }
			});
			const result = await createSimfileRecord(simfileData);
			expect(result.success).toBe(false);
			expect(result.error).toContain('Insert failed');
		});
	});

	describe('parseDtxFiles', () => {
		beforeEach(() => {
			(decodeFileWithEncodingDetection as Mock).mockImplementation(async (file: File) => {
				if (file.name.toLowerCase() === 'set.def') {
					return `#L1LABEL EXT
#L1FILE song1.dtx`;
				}
				return `#TITLE:Test Title
#ARTIST:Test Artist
#BPM:120
#DLEVEL:55`;
			});
		});

		it('should parse DTX files and SET.def correctly', async () => {
			(fs.promises.readdir as Mock).mockResolvedValue([
				{ name: 'set.def', isFile: () => true },
				{ name: 'song1.dtx', isFile: () => true }
			]);

			const result = await parseDtxFiles('/fake/path');

			expect(result.bpm).toBe(120);
			expect(result.artist).toBe('Test Artist');
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
