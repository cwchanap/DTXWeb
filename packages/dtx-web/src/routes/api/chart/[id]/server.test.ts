import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET, PATCH } from './+server';
import { getDb, getSimfile, getSimfileOwner, updateSimfile } from '$lib/server/db';
import logger from '$lib/server/logger';

vi.mock('$lib/server/db');
vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockPlatform = { env: { DB: {} } };

const mockSimfile = {
	id: 1,
	title: 'Test',
	artist: 'Artist',
	bpm: 120,
	user_id: 'user-1',
	is_published: true,
	display_id: null,
	download_url: null,
	preview_url: null,
	video_preview_url: null,
	publish_date: '2024-01-01',
	created_at: '2024-01-01',
	updated_at: '2024-01-01',
	dtx_files: []
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/chart/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as any);
		vi.mocked(getSimfile).mockResolvedValue(mockSimfile);
	});

	it('returns 200 when unauthenticated for published chart', async () => {
		const response = await GET({
			params: { id: '1' },
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(200);
	});

	it('returns 401 when unauthenticated for unpublished chart', async () => {
		vi.mocked(getSimfile).mockResolvedValue({ ...mockSimfile, is_published: false });
		const response = await GET({
			params: { id: '1' },
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(401);
	});

	it('returns 400 for non-integer id', async () => {
		const response = await GET({
			params: { id: 'abc' },
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 500 when getSimfile throws', async () => {
		vi.mocked(getSimfile).mockRejectedValue(new Error('db error'));
		const response = await GET({
			params: { id: '1' },
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(500);
		expect(logger.error).toHaveBeenCalledWith('Error getting chart:', expect.any(Error));
	});

	it('returns 404 when simfile not found', async () => {
		vi.mocked(getSimfile).mockResolvedValue(null);
		const response = await GET({
			params: { id: '1' },
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(404);
	});

	it('returns 200 for owner of unpublished chart', async () => {
		vi.mocked(getSimfile).mockResolvedValue({ ...mockSimfile, is_published: false });
		const response = await GET({
			params: { id: '1' },
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(200);
	});

	it('returns 200 for non-owner viewing published chart', async () => {
		vi.mocked(getSimfile).mockResolvedValue({
			...mockSimfile,
			user_id: 'other-user',
			is_published: true
		});
		const response = await GET({
			params: { id: '1' },
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(200);
	});

	it('returns 403 for non-owner viewing unpublished chart', async () => {
		vi.mocked(getSimfile).mockResolvedValue({
			...mockSimfile,
			user_id: 'other-user',
			is_published: false
		});
		const response = await GET({
			params: { id: '1' },
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(403);
	});
});

describe('PATCH /api/chart/[id]', () => {
	const mockOwner = { user_id: 'user-1', is_published: 0 as 0 | 1 };
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
		vi.mocked(getSimfileOwner).mockResolvedValue(mockOwner);
		vi.mocked(updateSimfile).mockResolvedValue(mockSimfileRow);
		vi.mocked(getSimfile).mockResolvedValue({ ...mockSimfile });
	});

	it('returns 401 when unauthenticated', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(401);
	});

	it('returns 400 for non-integer id', async () => {
		const request = new Request('http://localhost/api/chart/abc', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New' })
		});
		const response = await PATCH({
			params: { id: 'abc' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 for malformed JSON body', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: 'not-json'
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 for array body', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify([{ title: 'New' }])
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid request body');
	});

	it('returns 400 when display_id is a number but not a safe integer', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ display_id: Number.MAX_SAFE_INTEGER + 1 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid display_id');
	});

	it('returns 404 when simfile not found', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue(null);
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(404);
	});

	it('returns 403 for non-owner', async () => {
		vi.mocked(getSimfileOwner).mockResolvedValue({ user_id: 'other-user', is_published: 0 });
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'New' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(403);
	});

	it('updates and returns 200 for owner with preview_url', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: 'Updated',
				previewUrl: 'https://example.com/preview.mp3'
			})
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(200);
		expect(updateSimfile).toHaveBeenCalledWith(
			expect.anything(),
			1,
			expect.objectContaining({
				title: 'Updated',
				preview_url: 'https://example.com/preview.mp3'
			})
		);
	});

	it('camelCase isPublished maps to is_published integer 1', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isPublished: true })
		});
		await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(updateSimfile).toHaveBeenCalledWith(
			expect.anything(),
			1,
			expect.objectContaining({ is_published: 1 })
		);
	});

	it('returns 400 when isPublished is not boolean', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isPublished: 'true' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 when bpm is not a finite number', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bpm: '120' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 when downloadUrl is not a string or null', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ downloadUrl: 123 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 500 when updated chart cannot be reloaded', async () => {
		vi.mocked(getSimfile).mockResolvedValue(null);
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'Updated' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(500);
	});

	it('returns a generic 500 error when update fails unexpectedly', async () => {
		vi.mocked(updateSimfile).mockRejectedValue(new Error('Database exploded'));
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'Updated' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: 'Failed to update chart',
			message: 'Internal server error'
		});
		expect(logger.error).toHaveBeenCalledWith('Error updating chart:', expect.any(Error));
	});

	it('returns 400 when no fields are provided', async () => {
		vi.mocked(updateSimfile).mockRejectedValue(new Error('No fields to update'));
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
	});

	it('returns 400 when title is not a string', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 123 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid title');
	});

	it('returns 400 when artist is not a string', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ artist: 42 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid artist');
	});

	it('returns 400 when snake_case is_published is not boolean', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ is_published: 'yes' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid is_published');
	});

	it('returns 400 when display_id is not a safe integer or null', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ display_id: 'not-a-number' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid display_id');
	});

	it('returns 400 when displayId is not a safe integer or null', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayId: 'bad' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid displayId');
	});

	it('returns 400 when snake_case download_url is invalid', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ download_url: 99 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid download_url');
	});

	it('returns 400 when publish_date is not a valid date string', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ publish_date: 'not-a-date' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid publish_date');
	});

	it('returns 400 when publishDate is not a valid date string', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ publishDate: 'not-a-date' })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid publishDate');
	});

	it('returns 400 when video_preview_url is invalid', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ video_preview_url: 55 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid video_preview_url');
	});

	it('returns 400 when videoPreviewUrl is invalid', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ videoPreviewUrl: 55 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid videoPreviewUrl');
	});

	it('returns 400 when preview_url is invalid', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ preview_url: 55 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid preview_url');
	});

	it('returns 400 when previewUrl (camelCase) is invalid', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ previewUrl: 99 })
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('Invalid previewUrl');
	});

	it('updates all fields at once with valid values', async () => {
		const request = new Request('http://localhost/api/chart/1', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				artist: 'New Artist',
				bpm: 140,
				is_published: true,
				display_id: null,
				displayId: 2,
				download_url: 'https://dl.example.com',
				downloadUrl: 'https://dl2.example.com',
				publish_date: '2024-06-01',
				publishDate: '2024-07-01',
				video_preview_url: null,
				videoPreviewUrl: 'https://vid.example.com',
				preview_url: null,
				previewUrl: 'https://preview.example.com'
			})
		});
		const response = await PATCH({
			params: { id: '1' },
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(200);
	});
});
