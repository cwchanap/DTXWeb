import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { getDb, listSimfiles, createSimfile, createDtxFiles } from '$lib/server/db';
import { toSimfileWithDtx } from '@dtx/common';

vi.mock('$lib/server/db');
vi.mock('@dtx/common', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@dtx/common')>();
	return { ...actual, toSimfileWithDtx: vi.fn() };
});
vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockPlatform = { env: { DB: {} } };

describe('GET /api/chart', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as any);
		vi.mocked(listSimfiles).mockResolvedValue({ data: [], count: 0 });
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

	it('clamps pageSize to 100', async () => {
		await GET({
			url: new URL('http://localhost/api/chart?scope=published&pageSize=9999'),
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(listSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ pageSize: 100 })
		);
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
});

describe('POST /api/chart', () => {
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
		vi.mocked(toSimfileWithDtx).mockReturnValue({
			...mockSimfileRow,
			is_published: false,
			dtx_files: []
		});
	});

	it('returns 401 when unauthenticated', async () => {
		const request = new Request('http://localhost/api/chart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bpm: 120 })
		});
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: null } as any
		});
		expect(response.status).toBe(401);
	});

	it('creates simfile and returns 201', async () => {
		const request = new Request('http://localhost/api/chart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ title: 'Test', artist: 'Artist', bpm: 120 })
		});
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
		const request = new Request('http://localhost/api/chart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bpm: 120, levels: [{ label: 'EXT', level: 50 }] })
		});
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
		const request = new Request('http://localhost/api/chart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ bpm: 120 })
		});
		const response = await POST({
			request,
			platform: mockPlatform as any,
			locals: { user: mockUser } as any
		});
		expect(response.status).toBe(500);
	});
});
