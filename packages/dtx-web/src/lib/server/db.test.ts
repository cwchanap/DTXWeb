import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toSimfileWithDtx } from '@dtx/common';
import { simfiles, dtxFiles, userProfiles } from '$lib/server/db/schema';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import {
	createDrizzleDb,
	escapeLikePattern,
	getDb,
	getSimfile,
	getSimfileOwner,
	listSimfiles,
	searchSimfiles,
	getNextDisplayId,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile
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

vi.mock('@dtx/common', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@dtx/common')>();
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
// getDb
// ---------------------------------------------------------------------------
describe('getDb', () => {
	it('returns a mock database when platform is undefined', () => {
		const db = getDb(undefined);
		expect(db).toBeDefined();
		expect(typeof db.prepare).toBe('function');
	});

	it('throws when platform.env exists but DB binding is missing', () => {
		expect(() => getDb({ env: {} } as App.Platform)).toThrow(
			'D1 database binding (DB) is missing from the runtime environment.'
		);
	});

	it('returns the DB binding when present', () => {
		const mockDb = {} as D1Database;
		const result = getDb({ env: { DB: mockDb } } as App.Platform);
		expect(result).toBe(mockDb);
	});

	it('mock database returns empty data for read operations', async () => {
		const db = getDb(undefined);
		const stmt = db.prepare('SELECT * FROM test');
		const firstResult = await stmt.first();
		const allResult = await stmt.all();

		expect(firstResult).toBeNull();
		expect(allResult.results).toEqual([]);
	});

	it('mock database handles batch operations', async () => {
		const db = getDb(undefined);
		const batchResult = await db.batch([
			db.prepare('INSERT INTO test VALUES (1)'),
			db.prepare('INSERT INTO test VALUES (2)')
		]);

		expect(batchResult).toHaveLength(2);
		expect(batchResult[0]).toHaveProperty('success', true);
		expect(batchResult[0]).toHaveProperty('meta');
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
