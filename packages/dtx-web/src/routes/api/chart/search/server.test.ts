import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './+server';
import { getDb, searchSimfiles } from '$lib/server/db';
import type { D1Database } from '@cloudflare/workers-types';

vi.mock('$lib/server/db');
vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

const mockUser = { id: 'user-1', email: 'test@example.com' };
const mockPlatform = { env: { DB: {} } };

const createUrl = (params: Record<string, string> = {}) => {
	const url = new URL('http://localhost/api/chart/search');
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	return url;
};

const mockSimfileRow = {
	id: 1,
	title: 'Test Song',
	artist: 'Test Artist',
	bpm: 120,
	user_id: 'user-1',
	is_published: 1 as 0 | 1,
	display_id: null,
	download_url: null,
	preview_url: null,
	video_preview_url: null,
	publish_date: '2024-01-01',
	created_at: '2024-01-01',
	updated_at: '2024-01-01'
};

describe('GET /api/chart/search', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getDb).mockReturnValue({} as D1Database);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when unauthenticated', async () => {
		const response = await GET({
			url: createUrl({ q: 'test' }),
			platform: mockPlatform as App.Platform,
			locals: { user: null } as App.Locals
		});
		expect(response.status).toBe(401);
	});

	it('returns empty data when query is blank', async () => {
		const response = await GET({
			url: createUrl({ q: '   ' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual({ data: [] });
	});

	it('returns empty data when q is missing', async () => {
		const response = await GET({
			url: createUrl(),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toEqual({ data: [] });
	});

	it('returns search results', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([mockSimfileRow]);
		const response = await GET({
			url: createUrl({ q: 'Test' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.data).toHaveLength(1);
		expect(data.data[0].is_published).toBe(true);
	});

	it('passes userId to searchSimfiles', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([]);
		await GET({
			url: createUrl({ q: 'test' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(searchSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ userId: 'user-1' })
		);
	});

	it('trims the query before searching', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([]);
		await GET({
			url: createUrl({ q: '  test  ' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(searchSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ query: 'test' })
		);
	});

	it('passes excludeIds from query param', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([]);
		await GET({
			url: createUrl({ q: 'test', exclude: '1,2,3' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(searchSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ excludeIds: [1, 2, 3] })
		);
	});

	it('filters out non-integer excludeIds', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([]);
		await GET({
			url: createUrl({ q: 'test', exclude: '1,abc,3' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(searchSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ excludeIds: [1, 3] })
		);
	});

	it('clamps limit to max 50', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([]);
		await GET({
			url: createUrl({ q: 'test', limit: '100' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(searchSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ limit: 50 })
		);
	});

	it('clamps limit to min 1', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([]);
		await GET({
			url: createUrl({ q: 'test', limit: '0' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(searchSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ limit: 1 })
		);
	});

	it('defaults limit to 8 when the query param is not numeric', async () => {
		vi.mocked(searchSimfiles).mockResolvedValue([]);
		await GET({
			url: createUrl({ q: 'test', limit: 'abc' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(searchSimfiles).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ limit: 8 })
		);
	});

	it('returns 500 on unexpected error', async () => {
		vi.mocked(searchSimfiles).mockRejectedValue(new Error('DB error'));
		const response = await GET({
			url: createUrl({ q: 'test' }),
			platform: mockPlatform as App.Platform,
			locals: { user: mockUser } as App.Locals
		});
		expect(response.status).toBe(500);
	});
});
