import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { getDb, listSimfiles, createSimfile, createDtxFiles, deleteSimfile } from '$lib/server/db';
import { toSimfileWithDtx } from '@dtx/common';
import logger from '$lib/server/logger';
import { hasR2Objects } from '$lib/server/r2';

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn(),
	listSimfiles: vi.fn(),
	createSimfile: vi.fn(),
	createDtxFiles: vi.fn(),
	deleteSimfile: vi.fn()
}));
vi.mock('@dtx/common', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@dtx/common')>();
	return { ...actual, toSimfileWithDtx: vi.fn() };
});
vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));
vi.mock('$lib/server/r2', () => ({ hasR2Objects: vi.fn() }));

const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockPlatform = { env: { DB: {}, DTXFILE_BUCKET: {} } };

describe('GET /api/chart', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as any);
		vi.mocked(listSimfiles).mockResolvedValue({ data: [], count: 0 });
		vi.mocked(hasR2Objects).mockResolvedValue(false);
	});

	it('returns 401 when unauthenticated and scope is not published', async () => {
		const response = await GET({
			url: new URL('http://localhost/api/chart?scope=mine'),
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error).toBe('Unauthorized');
	});

	it('returns 200 when unauthenticated and scope is published', async () => {
		const response = await GET({
			url: new URL('http://localhost/api/chart?scope=published'),
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual({ data: [], count: 0 });
	});

	it('passes userId to listSimfiles when scope is mine', async () => {
		await GET({
			url: new URL('http://localhost/api/chart?scope=mine'),
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(listSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ userId: 'user-1', publishedOnly: false })
		);
	});

	it('passes publishedOnly to listSimfiles when scope is published', async () => {
		await GET({
			url: new URL('http://localhost/api/chart?scope=published'),
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(listSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ publishedOnly: true })
		);
	});

	it('returns 400 for invalid scope', async () => {
		const response = await GET({
			url: new URL('http://localhost/api/chart?scope=all'),
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 for invalid page', async () => {
		const response = await GET({
			url: new URL('http://localhost/api/chart?scope=published&page=abc'),
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 for invalid pageSize', async () => {
		const response = await GET({
			url: new URL('http://localhost/api/chart?scope=published&pageSize=9999'),
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 500 when listSimfiles throws', async () => {
		vi.mocked(listSimfiles).mockRejectedValue(new Error('db error'));
		const response = await GET({
			url: new URL('http://localhost/api/chart?scope=mine'),
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(500);
	});

	it('returns published chart responses with upload availability enrichment', async () => {
		vi.mocked(listSimfiles).mockResolvedValue({
			data: [
				{
					id: 7,
					title: 'Published Chart',
					artist: 'Artist',
					bpm: 120,
					download_url: null,
					is_published: true,
					display_id: 7,
					dtx_files: [],
					preview_url: null,
					video_preview_url: null,
					publish_date: '2024-01-01',
					created_at: '2024-01-01',
					updated_at: '2024-01-02',
					user_id: 'user-1'
				}
			],
			count: 1
		});
		vi.mocked(hasR2Objects).mockResolvedValueOnce(true);

		const response = await GET({
			url: new URL('http://localhost/api/chart?scope=published'),
			platform: mockPlatform as any,
			locals: { user: null } as any
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			data: [
				expect.objectContaining({
					id: 7,
					has_uploaded_files: true
				})
			],
			count: 1
		});
		expect(hasR2Objects).toHaveBeenCalledWith(mockPlatform.env.DTXFILE_BUCKET, '7/');
	});
});

describe('POST /api/chart', () => {
	const buildPostRequest = (payload: unknown) =>
		new Request('http://localhost/api/chart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});

	const mockSimfileRow = {
		id: 1,
		title: 'Test',
		artist: 'Artist',
		bpm: 120,
		user_id: 'user-1',
		is_published: 0 as 0 | 1,
		display_id: null,
		download_url: null,
		preview_url: null,
		video_preview_url: null,
		publish_date: '2024-01-01',
		created_at: '2024-01-01',
		updated_at: '2024-01-01'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as any);
		vi.mocked(createSimfile).mockResolvedValue(mockSimfileRow);
		vi.mocked(createDtxFiles).mockResolvedValue([]);
		vi.mocked(deleteSimfile).mockResolvedValue(undefined);
		vi.mocked(toSimfileWithDtx).mockReturnValue({
			...mockSimfileRow,
			is_published: false,
			dtx_files: []
		});
	});

	it('returns 401 when unauthenticated', async () => {
		const request = buildPostRequest({ bpm: 120 });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(401);
	});

	it('returns 400 for malformed JSON request body', async () => {
		const request = new Request('http://localhost/api/chart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not-json'
		});
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 for array body', async () => {
		const request = buildPostRequest([{ bpm: 120 }]);
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid request body');
	});

	it('returns 400 for non-boolean isPublished', async () => {
		const request = buildPostRequest({ bpm: 120, isPublished: 'false' });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('creates simfile and returns 201', async () => {
		const request = buildPostRequest({ title: 'Test', artist: 'Artist', bpm: 120 });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(201);
		expect(createSimfile).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ user_id: 'user-1', bpm: 120 })
		);
	});

	it('creates dtx_files when levels array is provided', async () => {
		vi.mocked(createDtxFiles).mockResolvedValue([
			{ id: 1, label: 'EXT', level: 50, simfile_id: 1 }
		]);
		const request = buildPostRequest({ bpm: 120, levels: [{ label: 'EXT', level: 50 }] });
		await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(createDtxFiles).toHaveBeenCalledWith(expect.anything(), [
			{ label: 'EXT', level: 50, simfile_id: 1 }
		]);
	});

	it('returns 500 when createSimfile throws', async () => {
		vi.mocked(createSimfile).mockRejectedValue(new Error('db error'));
		const request = buildPostRequest({ bpm: 120 });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(500);
	});

	it('deletes created simfile if createDtxFiles fails', async () => {
		vi.mocked(createDtxFiles).mockRejectedValue(new Error('dtx insert failed'));
		const request = buildPostRequest({ bpm: 120, levels: [{ label: 'EXT', level: 50 }] });

		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});

		expect(response.status).toBe(500);
		expect(deleteSimfile).toHaveBeenCalledWith(expect.anything(), 1);
	});

	it('returns 500 and logs when both createDtxFiles and deleteSimfile fail', async () => {
		vi.mocked(createDtxFiles).mockRejectedValue(new Error('dtx insert failed'));
		vi.mocked(deleteSimfile).mockRejectedValue(new Error('delete also failed'));
		const request = buildPostRequest({ bpm: 120, levels: [{ label: 'EXT', level: 50 }] });

		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});

		expect(response.status).toBe(500);
		expect(logger.error).toHaveBeenCalledWith(
			'Failed cleanup after createDtxFiles error:',
			expect.objectContaining({ simfileId: 1 })
		);
	});

	it('returns 400 for invalid displayId', async () => {
		const request = buildPostRequest({ bpm: 120, displayId: 'not-a-number' });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid displayId');
	});

	it('returns 400 for invalid downloadUrl', async () => {
		const request = buildPostRequest({ bpm: 120, downloadUrl: 12345 });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid downloadUrl');
	});

	it('returns 400 for invalid videoPreviewUrl', async () => {
		const request = buildPostRequest({ bpm: 120, videoPreviewUrl: 99 });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid videoPreviewUrl');
	});

	it('returns 400 for invalid publishDate', async () => {
		const request = buildPostRequest({ bpm: 120, publishDate: 'not-a-date' });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid publishDate');
	});

	it('returns 400 for non-array dtx_files', async () => {
		const request = buildPostRequest({ bpm: 120, dtx_files: 'not-an-array' });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid dtx files payload');
	});

	it('returns 400 when dtx_files entry has invalid label', async () => {
		const request = buildPostRequest({ bpm: 120, dtx_files: [{ label: 123, level: 50 }] });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid dtx file label');
	});

	it('returns 400 when dtx_files entry has invalid level', async () => {
		const request = buildPostRequest({
			bpm: 120,
			dtx_files: [{ label: 'BASIC', level: 'one' }]
		});
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid dtx file level');
	});

	it('accepts null displayId and null downloadUrl', async () => {
		const request = buildPostRequest({ bpm: 120, displayId: null, downloadUrl: null });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(201);
	});

	it('returns 400 for invalid bpm (not a finite number)', async () => {
		const request = buildPostRequest({ bpm: 'fast' });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid bpm');
	});

	it('returns 400 when dtx_files entry is null', async () => {
		const request = buildPostRequest({ bpm: 120, dtx_files: [null] });
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid dtx files payload');
	});
});
