import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toSimfileWithDtx } from '../types/d1.types';
import { simfiles, dtxFiles, userProfiles, chartScores, scores } from './db/schema';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import {
	createDrizzleDb,
	escapeLikePattern,
	getSimfile,
	getSimfileOwner,
	getChartVisibility,
	listSimfiles,
	searchSimfiles,
	getNextDisplayId,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile,
	upsertChartScore,
	replaceScores,
	getUserChartScore,
	listUserScoredSimfiles
} from './db';
import type { D1Database } from '@cloudflare/workers-types';

const drizzleSelectResults = vi.hoisted(() => [] as unknown[]);
const createMockDrizzleQuery = vi.hoisted(() => {
	return () => {
		const query: Record<string, unknown> = {};
		query.from = vi.fn(() => query);
		query.where = vi.fn(() => query);
		query.limit = vi.fn(() => query);
		query.orderBy = vi.fn(() => query);
		query.offset = vi.fn(() => query);
		query.then = (
			onFulfilled: (value: unknown[]) => unknown,
			onRejected?: (reason: unknown) => unknown
		) =>
			Promise.resolve((drizzleSelectResults.shift() as unknown[]) ?? []).then(
				onFulfilled,
				onRejected
			);
		return query;
	};
});

const mockDrizzleDb = vi.hoisted(() => ({
	select: vi.fn(() => createMockDrizzleQuery())
}));

vi.mock('drizzle-orm/d1', () => ({
	drizzle: vi.fn(() => mockDrizzleDb)
}));

vi.mock('../types/d1.types', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../types/d1.types')>();
	return {
		...actual,
		toSimfileWithDtx: vi.fn((row, dtxFiles) => ({
			...row,
			is_published: row.is_published === 1,
			dtx_files: dtxFiles
		}))
	};
});

// Helpers to build D1 mock objects
const createMockStmt = (firstResult: unknown = null, allResult: unknown[] = []) => ({
	bind: vi.fn().mockReturnThis(),
	first: vi.fn().mockResolvedValue(firstResult),
	all: vi.fn().mockResolvedValue({ results: allResult })
});

const createMockDb = (prepareImpl?: (sql: string) => ReturnType<typeof createMockStmt>) => ({
	prepare: vi.fn().mockImplementation(prepareImpl ?? (() => createMockStmt())),
	batch: vi.fn()
});

const baseSimfileRow = {
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
	publish_date: '2024-01-01T00:00:00.000Z',
	created_at: '2024-01-01T00:00:00.000Z',
	updated_at: '2024-01-01T00:00:00.000Z'
};

// ---------------------------------------------------------------------------
// escapeLikePattern
// ---------------------------------------------------------------------------
describe('escapeLikePattern', () => {
	it('leaves plain strings unchanged', () => {
		expect(escapeLikePattern('hello world')).toBe('hello world');
	});

	it('escapes percent signs', () => {
		expect(escapeLikePattern('100%')).toBe('100\\%');
	});

	it('escapes underscores', () => {
		expect(escapeLikePattern('some_thing')).toBe('some\\_thing');
	});

	it('escapes backslashes first to avoid double-escaping', () => {
		expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
	});

	it('escapes all metacharacters in a combined string', () => {
		expect(escapeLikePattern('100%_\\mix')).toBe('100\\%\\_\\\\mix');
	});

	it('returns empty string unchanged', () => {
		expect(escapeLikePattern('')).toBe('');
	});
});

describe('db schema', () => {
	it('exports the D1 tables used by the query layer', () => {
		expect(simfiles).toBeDefined();
		expect(dtxFiles).toBeDefined();
		expect(userProfiles).toBeDefined();
	});

	it('defines correct indexes on simfiles', () => {
		const config = getTableConfig(simfiles);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_simfiles_user_id');
		expect(indexNames).toContain('idx_simfiles_is_published');
		expect(indexNames).toContain('idx_simfiles_publish_date');
	});

	it('defines correct index on dtxFiles', () => {
		const config = getTableConfig(dtxFiles);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_dtx_files_simfile_id');
	});

	it('defines unique index on userProfiles', () => {
		const config = getTableConfig(userProfiles);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('user_profiles_user_id_unique');
	});
});

describe('score schema', () => {
	it('exports the chart_scores and scores tables', () => {
		expect(chartScores).toBeDefined();
		expect(scores).toBeDefined();
	});

	it('defines the unique (user, chart) index on chart_scores', () => {
		const config = getTableConfig(chartScores);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_chart_scores_user_chart');
		expect(indexNames).toContain('idx_chart_scores_chart');
	});

	it('defines the chart_score index on scores', () => {
		const config = getTableConfig(scores);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_scores_chart_score');
	});
});

describe('createDrizzleDb', () => {
	it('wraps the provided D1 database', () => {
		const rawDb = createMockDb() as unknown as D1Database;
		const orm = createDrizzleDb(rawDb);

		expect(drizzle).toHaveBeenCalledWith(rawDb, {
			schema: { simfiles, dtxFiles, userProfiles }
		});
		expect(orm).toBe(mockDrizzleDb);
	});
});

// ---------------------------------------------------------------------------
// getSimfile
// ---------------------------------------------------------------------------
describe('getSimfile', () => {
	beforeEach(() => {
		vi.mocked(toSimfileWithDtx).mockClear();
		drizzleSelectResults.length = 0;
		mockDrizzleDb.select.mockClear();
	});

	it('uses drizzle queries instead of raw prepared statements', async () => {
		drizzleSelectResults.push([baseSimfileRow], [{ level: 5, label: 'BASIC' }]);
		const db = {
			prepare: vi.fn(() => {
				throw new Error('raw sql should not be used');
			})
		} as unknown as D1Database;

		const result = await getSimfile(db, 1);

		expect(drizzle).toHaveBeenCalledWith(db, {
			schema: { simfiles, dtxFiles, userProfiles }
		});
		expect(mockDrizzleDb.select).toHaveBeenCalledTimes(2);
		expect(result).toEqual({
			...baseSimfileRow,
			is_published: true,
			dtx_files: [{ level: 5, label: 'BASIC' }]
		});
	});

	it('returns null when row not found', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getSimfile(db as unknown as D1Database, 1);
		expect(result).toBeNull();
	});

	it('returns SimfileWithDtxFiles when found', async () => {
		const dtxRows = [{ level: 5, label: 'BASIC' }];
		drizzleSelectResults.push([baseSimfileRow], dtxRows);
		const db = createMockDb();

		const result = await getSimfile(db as unknown as D1Database, 1);
		expect(result).not.toBeNull();
		expect(result?.id).toBe(1);
		expect(result?.is_published).toBe(true);
		expect(result?.dtx_files).toEqual(dtxRows);
		expect(toSimfileWithDtx).toHaveBeenCalledWith(baseSimfileRow, dtxRows);
	});
});

describe('getSimfile chart id', () => {
	it('includes the dtx_files id in the joined result', async () => {
		mockDrizzleDb.select.mockClear();
		drizzleSelectResults.push([baseSimfileRow]); // simfile select
		drizzleSelectResults.push([{ id: 77, level: 5, label: 'BASIC' }]); // dtx select
		const result = await getSimfile({} as unknown as D1Database, 1);
		expect(result?.dtx_files).toEqual([{ id: 77, level: 5, label: 'BASIC' }]);

		// Guard against regressing the `id: dtxFiles.id` field in the dtx select itself:
		// the mock replays queued rows regardless of the requested fields, so without this
		// assertion the test above would still pass even if `id` were dropped from the select.
		const dtxSelectCall = (mockDrizzleDb.select.mock.calls as unknown[][])[1]?.[0];
		expect(dtxSelectCall).toHaveProperty('id', dtxFiles.id);
	});
});

// ---------------------------------------------------------------------------
// getSimfileOwner
// ---------------------------------------------------------------------------
describe('getSimfileOwner', () => {
	beforeEach(() => {
		drizzleSelectResults.length = 0;
		mockDrizzleDb.select.mockClear();
	});

	it('returns null when not found', async () => {
		const db = createMockDb();
		const result = await getSimfileOwner(db as unknown as D1Database, 99);
		expect(result).toBeNull();
	});

	it('returns owner data when found', async () => {
		const owner = { user_id: 'user-1', is_published: 1 };
		drizzleSelectResults.push([owner]);
		const db = createMockDb();
		const result = await getSimfileOwner(db as unknown as D1Database, 1);
		expect(result).toEqual(owner);
	});
});

// ---------------------------------------------------------------------------
// listSimfiles
// ---------------------------------------------------------------------------
describe('listSimfiles', () => {
	beforeEach(() => {
		vi.mocked(toSimfileWithDtx).mockClear();
		drizzleSelectResults.length = 0;
		mockDrizzleDb.select.mockClear();
	});

	it('returns empty data with count 0 when no rows', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = createMockDb();
		const result = await listSimfiles(db as unknown as D1Database, {});
		expect(result).toEqual({ data: [], count: 0 });
	});

	it('returns data and count when rows exist', async () => {
		const dtxRow = { simfile_id: 1, level: 5, label: 'BASIC' };
		drizzleSelectResults.push([{ cnt: 1 }], [baseSimfileRow], [dtxRow]);
		const db = createMockDb();

		const result = await listSimfiles(db as unknown as D1Database, {});
		expect(result.count).toBe(1);
		expect(result.data).toHaveLength(1);
		expect(result.data[0].is_published).toBe(true);
		expect(result.data[0].dtx_files).toEqual([{ level: 5, label: 'BASIC' }]);
		expect(toSimfileWithDtx).toHaveBeenCalledWith(baseSimfileRow, [
			{ level: 5, label: 'BASIC' }
		]);
	});

	it('uses drizzle queries instead of raw prepared statements', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = {
			prepare: vi.fn(() => {
				throw new Error('raw sql should not be used');
			})
		} as unknown as D1Database;

		await expect(listSimfiles(db, { userId: 'user-1', publishedOnly: true })).resolves.toEqual({
			data: [],
			count: 0
		});
		expect(mockDrizzleDb.select).toHaveBeenCalledTimes(2);
	});

	it('returns public-safe fields when publishedOnly is true', async () => {
		// baseSimfileRow includes user_id; this row simulates what publishedOnly select returns (no user_id)
		const rowWithoutUserId = {
			id: 1,
			title: 'Test Song',
			artist: 'Test Artist',
			bpm: 120,
			is_published: 1 as 0 | 1,
			display_id: null,
			download_url: null,
			preview_url: null,
			video_preview_url: null,
			publish_date: '2024-01-01T00:00:00.000Z',
			created_at: '2024-01-01T00:00:00.000Z',
			updated_at: '2024-01-01T00:00:00.000Z'
		};
		drizzleSelectResults.push([{ cnt: 1 }], [rowWithoutUserId], []);
		const db = createMockDb();

		const result = await listSimfiles(db as unknown as D1Database, { publishedOnly: true });
		expect(result.count).toBe(1);
		expect(result.data[0]).not.toHaveProperty('user_id');

		const secondSelectCall = (mockDrizzleDb.select.mock.calls as unknown[][])[1]?.[0];
		expect(secondSelectCall).not.toHaveProperty('user_id');
	});

	it('includes user_id in result when not publishedOnly', async () => {
		drizzleSelectResults.push([{ cnt: 1 }], [baseSimfileRow], []);
		const db = createMockDb();

		const result = await listSimfiles(db as unknown as D1Database, { userId: 'user-1' });
		expect(result.data[0]).toHaveProperty('user_id', 'user-1');

		const secondSelectCall = (mockDrizzleDb.select.mock.calls as unknown[][])[1]?.[0];
		expect(secondSelectCall).toHaveProperty('user_id');
	});

	it('uses default page (1) and pageSize (20) for limit and offset', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = createMockDb();
		await listSimfiles(db as unknown as D1Database, {});
		// results[1] is the data query (results[0] is the count query)
		const dataQuery = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[1]?.value;
		expect(dataQuery?.limit).toHaveBeenCalledWith(20);
		expect(dataQuery?.offset).toHaveBeenCalledWith(0);
	});

	it('computes correct limit and offset for page 3 with pageSize 10', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = createMockDb();
		await listSimfiles(db as unknown as D1Database, { page: 3, pageSize: 10 });
		const dataQuery = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[1]?.value;
		expect(dataQuery?.limit).toHaveBeenCalledWith(10);
		expect(dataQuery?.offset).toHaveBeenCalledWith(20); // (3-1) * 10
	});

	it('clamps page to minimum of 1 when page is 0', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = createMockDb();
		await listSimfiles(db as unknown as D1Database, { page: 0 });
		const dataQuery = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[1]?.value;
		expect(dataQuery?.offset).toHaveBeenCalledWith(0); // page clamped to 1
	});

	it('clamps pageSize to maximum of 100', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = createMockDb();
		await listSimfiles(db as unknown as D1Database, { pageSize: 999 });
		const dataQuery = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[1]?.value;
		expect(dataQuery?.limit).toHaveBeenCalledWith(100);
	});

	it('returns empty result when count query returns no rows', async () => {
		drizzleSelectResults.push([]); // count query returns empty array
		const db = createMockDb();
		const result = await listSimfiles(db as unknown as D1Database, {});
		expect(result).toEqual({ data: [], count: 0 });
	});

	it('defaults pageSize to 20 when non-finite value provided', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = createMockDb();
		await listSimfiles(db as unknown as D1Database, { pageSize: NaN });
		const dataQuery = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[1]?.value;
		// pageSize defaults to 20, page defaults to 1, so offset = 0
		expect(dataQuery?.limit).toHaveBeenCalledWith(20);
		expect(dataQuery?.offset).toHaveBeenCalledWith(0);
	});

	it('requests the dtx_files id in the joined dtx select', async () => {
		const dtxRow = { simfile_id: 1, id: 77, level: 5, label: 'BASIC' };
		drizzleSelectResults.push([{ cnt: 1 }], [baseSimfileRow], [dtxRow]);
		const db = createMockDb();

		await listSimfiles(db as unknown as D1Database, {});

		// Guard against regressing the `id: dtxFiles.id` field in the dtx select itself:
		// the mock replays queued rows regardless of the requested fields, so without this
		// assertion the test above would still pass even if `id` were dropped from the select.
		const dtxSelectCall = (mockDrizzleDb.select.mock.calls as unknown[][])[2]?.[0];
		expect(dtxSelectCall).toHaveProperty('id', dtxFiles.id);
	});

	it('applies search condition when search option is provided', async () => {
		drizzleSelectResults.push([{ cnt: 2 }], []);
		const db = createMockDb();
		await listSimfiles(db as unknown as D1Database, { search: 'test song' });
		// Verify where() was invoked on both count and data queries (search condition applied)
		const queries = mockDrizzleDb.select.mock.results as {
			value: Record<string, ReturnType<typeof vi.fn>>;
		}[];
		expect(queries[0]?.value?.where).toHaveBeenCalled();
		expect(queries[1]?.value?.where).toHaveBeenCalled();
	});

	it('defaults page to 1 when non-finite page value provided', async () => {
		drizzleSelectResults.push([{ cnt: 0 }], []);
		const db = createMockDb();
		await listSimfiles(db as unknown as D1Database, { page: NaN });
		const dataQuery = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[1]?.value;
		// page defaults to 1, pageSize defaults to 20, so offset = 0
		expect(dataQuery?.limit).toHaveBeenCalledWith(20);
		expect(dataQuery?.offset).toHaveBeenCalledWith(0);
	});
});

// ---------------------------------------------------------------------------
// searchSimfiles
// ---------------------------------------------------------------------------
describe('searchSimfiles', () => {
	beforeEach(() => {
		drizzleSelectResults.length = 0;
		mockDrizzleDb.select.mockClear();
	});

	it('returns empty array when query is blank', async () => {
		const db = createMockDb();
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: '',
			userId: 'user-1'
		});
		expect(result).toEqual([]);
		expect(mockDrizzleDb.select).not.toHaveBeenCalled();
	});

	it('returns empty array when query is only whitespace', async () => {
		const db = createMockDb();
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: '   ',
			userId: 'user-1'
		});
		expect(result).toEqual([]);
		expect(mockDrizzleDb.select).not.toHaveBeenCalled();
	});

	it('returns matching rows', async () => {
		const searchRow = {
			id: 1,
			title: 'Test Song',
			artist: 'Test Artist',
			bpm: 120,
			is_published: 1 as 0 | 1
		};
		drizzleSelectResults.push([searchRow]);
		const db = createMockDb();
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1'
		});
		expect(result).toEqual([searchRow]);
	});

	it('uses drizzle queries instead of raw prepared statements', async () => {
		drizzleSelectResults.push([]);
		const db = {
			prepare: vi.fn(() => {
				throw new Error('raw sql should not be used');
			})
		} as unknown as D1Database;

		await expect(searchSimfiles(db, { query: 'test', userId: 'user-1' })).resolves.toEqual([]);
		expect(mockDrizzleDb.select).toHaveBeenCalledTimes(1);
	});

	it('applies where filter for all search calls', async () => {
		drizzleSelectResults.push([]);
		const db = createMockDb();
		await searchSimfiles(db as unknown as D1Database, { query: 'test' });
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.where).toHaveBeenCalled();
	});

	it('uses default limit of 8', async () => {
		drizzleSelectResults.push([]);
		const db = createMockDb();
		await searchSimfiles(db as unknown as D1Database, { query: 'test', userId: 'user-1' });
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(8);
	});

	it('uses custom limit', async () => {
		drizzleSelectResults.push([]);
		const db = createMockDb();
		await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			limit: 5
		});
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(5);
	});

	it('applies excludeIds filter when provided', async () => {
		drizzleSelectResults.push([]);
		const db = createMockDb();
		await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			excludeIds: [1, 2]
		});
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.where).toHaveBeenCalled();
	});

	it('defaults limit to 8 when non-finite limit value provided', async () => {
		drizzleSelectResults.push([]);
		const db = createMockDb();
		await searchSimfiles(db as unknown as D1Database, { query: 'test', limit: NaN });
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(8);
	});
});

// ---------------------------------------------------------------------------
// createSimfile
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// getNextDisplayId
// ---------------------------------------------------------------------------
describe('getNextDisplayId', () => {
	it('returns max + 1 when user has existing simfiles', async () => {
		const db = createMockDb(() => createMockStmt({ max_display_id: 7 }));
		const result = await getNextDisplayId(db as unknown as D1Database, 'user-1');
		expect(result).toBe(8);
	});

	it('coerces string aggregate values from D1 before incrementing', async () => {
		const db = createMockDb(() => createMockStmt({ max_display_id: '7' }));
		const result = await getNextDisplayId(db as unknown as D1Database, 'user-1');
		expect(result).toBe(8);
	});

	it('throws when max display_id cannot be coerced to a safe integer', async () => {
		const db = createMockDb(() => createMockStmt({ max_display_id: 'not-a-number' }));
		await expect(getNextDisplayId(db as unknown as D1Database, 'user-1')).rejects.toThrow(
			'Invalid max display_id'
		);
	});

	it('returns 1 when user has no simfiles', async () => {
		const db = createMockDb(() => createMockStmt({ max_display_id: null }));
		const result = await getNextDisplayId(db as unknown as D1Database, 'user-1');
		expect(result).toBe(1);
	});

	it('returns 1 when row lookup returns null', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getNextDisplayId(db as unknown as D1Database, 'user-1');
		expect(result).toBe(1);
	});

	it('binds the userId to the query', async () => {
		const stmt = createMockStmt({ max_display_id: 3 });
		const db = createMockDb(() => stmt);
		await getNextDisplayId(db as unknown as D1Database, 'user-42');
		expect(stmt.bind).toHaveBeenCalledWith('user-42');
	});

	it('throws when current + 1 overflows safe integer range', async () => {
		const db = createMockDb(() => createMockStmt({ max_display_id: Number.MAX_SAFE_INTEGER }));
		await expect(getNextDisplayId(db as unknown as D1Database, 'user-1')).rejects.toThrow(
			'Invalid next display_id'
		);
	});
});

describe('createSimfile', () => {
	it('creates and returns simfile row', async () => {
		const db = createMockDb(() => createMockStmt(baseSimfileRow));
		const result = await createSimfile(db as unknown as D1Database, {
			bpm: 120,
			user_id: 'user-1'
		});
		expect(result).toEqual(baseSimfileRow);
	});

	it('allocates display_id inside the INSERT statement when display_id is null', async () => {
		const stmt = createMockStmt({ ...baseSimfileRow, display_id: 8 });
		const db = createMockDb(() => stmt);
		await createSimfile(db as unknown as D1Database, {
			bpm: 120,
			user_id: 'user-1',
			display_id: null
		});

		const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(sql).toContain(
			'COALESCE((SELECT MAX(display_id) FROM simfiles WHERE user_id = ?), 0) + 1'
		);
		const bindArgs = stmt.bind.mock.calls[0];
		expect(bindArgs[5]).toBeNull();
		expect(bindArgs[6]).toBeNull();
		expect(bindArgs[7]).toBe('user-1');
		expect(bindArgs[8]).toBeNull();
	});

	it('passes explicit display_id through the INSERT statement for manual values', async () => {
		const stmt = createMockStmt({ ...baseSimfileRow, display_id: 12 });
		const db = createMockDb(() => stmt);
		await createSimfile(db as unknown as D1Database, {
			bpm: 120,
			user_id: 'user-1',
			display_id: 12
		});

		const bindArgs = stmt.bind.mock.calls[0];
		expect(bindArgs[5]).toBe(12);
		expect(bindArgs[6]).toBe(12);
		expect(bindArgs[8]).toBe(12);
	});

	it('throws when insert returns null', async () => {
		const db = createMockDb(() => createMockStmt(null));
		await expect(
			createSimfile(db as unknown as D1Database, { bpm: 120, user_id: 'user-1' })
		).rejects.toThrow('Failed to create simfile');
	});
});

// ---------------------------------------------------------------------------
// updateSimfile
// ---------------------------------------------------------------------------
describe('updateSimfile', () => {
	it('updates and returns simfile row', async () => {
		const updated = { ...baseSimfileRow, title: 'Updated' };
		const db = createMockDb(() => createMockStmt(updated));
		const result = await updateSimfile(db as unknown as D1Database, 1, { title: 'Updated' });
		expect(result.title).toBe('Updated');
	});

	it('throws when no fields provided', async () => {
		const db = createMockDb(() => createMockStmt(baseSimfileRow));
		await expect(updateSimfile(db as unknown as D1Database, 1, {})).rejects.toThrow(
			'No fields to update'
		);
	});

	it('throws when simfile not found', async () => {
		const db = createMockDb(() => createMockStmt(null));
		await expect(
			updateSimfile(db as unknown as D1Database, 99, { title: 'X' })
		).rejects.toThrow('Simfile not found');
	});
});

// ---------------------------------------------------------------------------
// deleteSimfile
// ---------------------------------------------------------------------------
describe('deleteSimfile', () => {
	it('deletes without error when found', async () => {
		const db = createMockDb();
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ meta: { changes: 0 } },
			{ meta: { changes: 1 } }
		]);
		await expect(deleteSimfile(db as unknown as D1Database, 1)).resolves.toBeUndefined();
	});

	it('throws when simfile not found', async () => {
		const db = createMockDb();
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ meta: { changes: 0 } },
			{ meta: { changes: 0 } }
		]);
		await expect(deleteSimfile(db as unknown as D1Database, 99)).rejects.toThrow(
			'Simfile not found'
		);
	});
});

// ---------------------------------------------------------------------------
// createDtxFiles
// ---------------------------------------------------------------------------
describe('createDtxFiles', () => {
	it('returns empty array when input is empty', async () => {
		const db = createMockDb();
		const result = await createDtxFiles(db as unknown as D1Database, []);
		expect(result).toEqual([]);
	});

	it('uses batch to insert files and returns rows', async () => {
		const dtxRow = { id: 1, label: 'BASIC', level: 5, simfile_id: 1 };
		const db = createMockDb();
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([{ results: [dtxRow] }]);
		const result = await createDtxFiles(db as unknown as D1Database, [
			{ simfile_id: 1, label: 'BASIC', level: 5 }
		]);
		expect(db.batch).toHaveBeenCalled();
		expect(result).toEqual([dtxRow]);
	});

	it('inserts multiple files in a single batch', async () => {
		const dtxRows = [
			{ id: 1, label: 'BASIC', level: 5, simfile_id: 1 },
			{ id: 2, label: 'ADVANCED', level: 7, simfile_id: 1 }
		];
		const db = createMockDb();
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ results: [dtxRows[0]] },
			{ results: [dtxRows[1]] }
		]);
		const result = await createDtxFiles(db as unknown as D1Database, [
			{ simfile_id: 1, label: 'BASIC', level: 5 },
			{ simfile_id: 1, label: 'ADVANCED', level: 7 }
		]);
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect(result).toEqual(dtxRows);
	});

	it('throws when batch insert returns null for a row', async () => {
		const db = createMockDb();
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([{ results: [] }]);
		await expect(
			createDtxFiles(db as unknown as D1Database, [{ simfile_id: 1 }])
		).rejects.toThrow('Failed to insert dtx_file');
	});
});

// ---------------------------------------------------------------------------
// getUserProfile
// ---------------------------------------------------------------------------
describe('getUserProfile', () => {
	it('returns profile when found', async () => {
		const profile = { id: 1, user_id: 'user-1', username: 'testuser' };
		const db = createMockDb(() => createMockStmt(profile));
		const result = await getUserProfile(db as unknown as D1Database, 'user-1');
		expect(result).toEqual(profile);
	});

	it('returns null when not found', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getUserProfile(db as unknown as D1Database, 'user-99');
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// upsertUserProfile
// ---------------------------------------------------------------------------
describe('upsertUserProfile', () => {
	it('returns upserted profile', async () => {
		const profile = { id: 1, user_id: 'user-1', username: 'testuser' };
		const db = createMockDb(() => createMockStmt(profile));
		const result = await upsertUserProfile(db as unknown as D1Database, {
			user_id: 'user-1',
			username: 'testuser'
		});
		expect(result).toEqual(profile);
	});

	it('throws when upsert returns null', async () => {
		const db = createMockDb(() => createMockStmt(null));
		await expect(
			upsertUserProfile(db as unknown as D1Database, { user_id: 'user-1', username: 'x' })
		).rejects.toThrow('Failed to upsert user profile');
	});
});

// ---------------------------------------------------------------------------
// updateUserProfile
// ---------------------------------------------------------------------------
describe('updateUserProfile', () => {
	it('updates username and returns profile', async () => {
		const profile = { id: 1, user_id: 'user-1', username: 'newname' };
		const db = createMockDb(() => createMockStmt(profile));
		const result = await updateUserProfile(db as unknown as D1Database, 'user-1', {
			username: 'newname'
		});
		expect(result).toEqual(profile);
	});

	it('returns existing profile when no username provided', async () => {
		const profile = { id: 1, user_id: 'user-1', username: 'oldname' };
		const db = createMockDb(() => createMockStmt(profile));
		const result = await updateUserProfile(db as unknown as D1Database, 'user-1', {});
		expect(result).toEqual(profile);
	});
});

// ---------------------------------------------------------------------------
// getChartVisibility
// ---------------------------------------------------------------------------
describe('getChartVisibility', () => {
	it("returns the owning simfile's visibility for a chart", async () => {
		const db = createMockDb(() => createMockStmt({ user_id: 'user-9', is_published: 1 }));
		const result = await getChartVisibility(db as unknown as D1Database, 55);
		expect(result).toEqual({ user_id: 'user-9', is_published: 1 });
	});

	it('returns null when the chart does not exist', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getChartVisibility(db as unknown as D1Database, 999);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// upsertChartScore
// ---------------------------------------------------------------------------
describe('upsertChartScore', () => {
	it('returns the upserted chart_scores row', async () => {
		const row = {
			id: 3,
			chart_id: 55,
			user_id: 'u1',
			play_count: 10,
			clear_count: 4,
			created_at: 't',
			updated_at: 't'
		};
		const db = createMockDb(() => createMockStmt(row));
		const result = await upsertChartScore(db as unknown as D1Database, {
			chartId: 55,
			userId: 'u1',
			playCount: 10,
			clearCount: 4
		});
		expect(result).toEqual(row);
	});

	it('throws when RETURNING yields no row', async () => {
		const db = createMockDb(() => createMockStmt(null));
		await expect(
			upsertChartScore(db as unknown as D1Database, {
				chartId: 1,
				userId: 'u1',
				playCount: 0,
				clearCount: 0
			})
		).rejects.toThrow();
	});
});

describe('replaceScores', () => {
	it('batches a delete followed by one insert per score', async () => {
		const db = createMockDb();
		db.batch = vi.fn().mockResolvedValue([]);
		await replaceScores(db as unknown as D1Database, 3, [
			{ is_best: true, score: 900000, achievement_rate: 91.3 },
			{ is_best: false, achievement_rate: 82.4, display_order: 1 }
		]);
		expect(db.prepare).toHaveBeenCalledTimes(3); // 1 delete + 2 inserts
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect(db.batch.mock.calls[0][0]).toHaveLength(3);
	});

	it('batches only the delete when there are no scores', async () => {
		const db = createMockDb();
		db.batch = vi.fn().mockResolvedValue([]);
		await replaceScores(db as unknown as D1Database, 3, []);
		expect(db.prepare).toHaveBeenCalledTimes(1);
		expect(db.batch.mock.calls[0][0]).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// getUserChartScore
// ---------------------------------------------------------------------------
describe('getUserChartScore', () => {
	it('returns null when there is no chart_scores row', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getUserChartScore(db as unknown as D1Database, 'u1', 55);
		expect(result).toBeNull();
	});

	it('returns the chart_scores row with its ordered scores', async () => {
		const chartScore = {
			id: 3,
			chart_id: 55,
			user_id: 'u1',
			play_count: 10,
			clear_count: 4,
			created_at: 't',
			updated_at: 't'
		};
		const scoreRows = [
			{ id: 1, chart_score_id: 3, is_best: 1 },
			{ id: 2, chart_score_id: 3, is_best: 0, display_order: 1 }
		];
		const db = createMockDb((sql: string) =>
			sql.includes('FROM chart_scores')
				? createMockStmt(chartScore)
				: createMockStmt(null, scoreRows)
		);
		const result = await getUserChartScore(db as unknown as D1Database, 'u1', 55);
		expect(result?.chartScore).toEqual(chartScore);
		expect(result?.scores).toEqual(scoreRows);
	});
});

// ---------------------------------------------------------------------------
// listUserScoredSimfiles
// ---------------------------------------------------------------------------
describe('listUserScoredSimfiles', () => {
	it('returns empty when the user has no scores', async () => {
		const db = createMockDb(() => createMockStmt(null, []));
		const result = await listUserScoredSimfiles(db as unknown as D1Database, { userId: 'u1' });
		expect(result).toEqual({ data: [], count: 0 });
	});

	it('lists scored simfiles with their dtx_files', async () => {
		const scoredSimfileRow = { ...baseSimfileRow, id: 42 };
		const db = createMockDb((sql: string) => {
			if (sql.includes('DISTINCT')) return createMockStmt(null, [{ simfile_id: 42 }]);
			if (sql.includes('FROM simfiles')) return createMockStmt(null, [scoredSimfileRow]);
			return createMockStmt(null, [{ id: 10, label: 'BASIC', level: 5, simfile_id: 42 }]);
		});
		const result = await listUserScoredSimfiles(db as unknown as D1Database, {
			userId: 'user-1'
		});
		expect(result.count).toBe(1);
		expect(result.data[0].id).toBe(42);
		expect(result.data[0].dtx_files).toEqual([{ id: 10, level: 5, label: 'BASIC' }]);
	});
});
