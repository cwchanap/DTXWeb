import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getDb,
	getSimfile,
	getSimfileOwner,
	listSimfiles,
	searchSimfiles,
	createSimfile,
	updateSimfile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile
} from './db';
import type { D1Database } from '@cloudflare/workers-types';

vi.mock('@dtx/common', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@dtx/common')>();
	return { ...actual };
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
// getDb
// ---------------------------------------------------------------------------
describe('getDb', () => {
	it('throws when platform is undefined', () => {
		expect(() => getDb(undefined)).toThrow('D1 database binding (DB) not available');
	});

	it('throws when DB binding is missing', () => {
		expect(() => getDb({ env: {} } as App.Platform)).toThrow(
			'D1 database binding (DB) not available'
		);
	});

	it('returns the DB binding when present', () => {
		const mockDb = {} as D1Database;
		const result = getDb({ env: { DB: mockDb } } as App.Platform);
		expect(result).toBe(mockDb);
	});
});

// ---------------------------------------------------------------------------
// getSimfile
// ---------------------------------------------------------------------------
describe('getSimfile', () => {
	it('returns null when row not found', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getSimfile(db as unknown as D1Database, 1);
		expect(result).toBeNull();
	});

	it('returns SimfileWithDtxFiles when found', async () => {
		const dtxRows = [{ level: 5, label: 'BASIC' }];
		let callCount = 0;
		const db = createMockDb(() => {
			callCount++;
			return callCount === 1 ? createMockStmt(baseSimfileRow) : createMockStmt(null, dtxRows);
		});

		const result = await getSimfile(db as unknown as D1Database, 1);
		expect(result).not.toBeNull();
		expect(result?.id).toBe(1);
		expect(result?.is_published).toBe(true);
		expect(result?.dtx_files).toEqual(dtxRows);
	});
});

// ---------------------------------------------------------------------------
// getSimfileOwner
// ---------------------------------------------------------------------------
describe('getSimfileOwner', () => {
	it('returns null when not found', async () => {
		const db = createMockDb(() => createMockStmt(null));
		const result = await getSimfileOwner(db as unknown as D1Database, 99);
		expect(result).toBeNull();
	});

	it('returns owner data when found', async () => {
		const owner = { user_id: 'user-1', is_published: 1 };
		const db = createMockDb(() => createMockStmt(owner));
		const result = await getSimfileOwner(db as unknown as D1Database, 1);
		expect(result).toEqual(owner);
	});
});

// ---------------------------------------------------------------------------
// listSimfiles
// ---------------------------------------------------------------------------
describe('listSimfiles', () => {
	it('returns empty data with count 0 when no rows', async () => {
		const db = createMockDb(() => createMockStmt({ cnt: 0 }, []));
		const result = await listSimfiles(db as unknown as D1Database, {});
		expect(result).toEqual({ data: [], count: 0 });
	});

	it('returns data and count when rows exist', async () => {
		const dtxRow = { simfile_id: 1, level: 5, label: 'BASIC' };
		let callCount = 0;
		const db = createMockDb(() => {
			callCount++;
			if (callCount === 1) return createMockStmt({ cnt: 1 }); // count query
			if (callCount === 2) return createMockStmt(null, [baseSimfileRow]); // data query
			return createMockStmt(null, [dtxRow]); // dtx_files query
		});

		const result = await listSimfiles(db as unknown as D1Database, {});
		expect(result.count).toBe(1);
		expect(result.data).toHaveLength(1);
		expect(result.data[0].is_published).toBe(true);
		expect(result.data[0].dtx_files).toEqual([{ level: 5, label: 'BASIC' }]);
	});

	it('applies userId filter', async () => {
		const db = createMockDb(() => createMockStmt({ cnt: 0 }));
		await listSimfiles(db as unknown as D1Database, { userId: 'user-1' });
		const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(prepareCall).toContain('s.user_id = ?');
	});

	it('applies publishedOnly filter', async () => {
		const db = createMockDb(() => createMockStmt({ cnt: 0 }));
		await listSimfiles(db as unknown as D1Database, { publishedOnly: true });
		const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(prepareCall).toContain('s.is_published = 1');
	});

	it('applies search filter', async () => {
		const db = createMockDb(() => createMockStmt({ cnt: 0 }));
		await listSimfiles(db as unknown as D1Database, { search: 'rock' });
		const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(prepareCall).toContain('s.title LIKE ?');
	});

	it('uses default page and pageSize', async () => {
		const db = createMockDb(() => createMockStmt({ cnt: 0 }));
		await listSimfiles(db as unknown as D1Database, {});
		// Second prepare call is the data query with LIMIT/OFFSET
		const dataStmt = (db.prepare as ReturnType<typeof vi.fn>).mock.results[1]?.value;
		expect(dataStmt?.bind).toHaveBeenCalledWith(20, 0);
	});

	it('uses custom page and pageSize', async () => {
		const db = createMockDb(() => createMockStmt({ cnt: 0 }));
		await listSimfiles(db as unknown as D1Database, { page: 3, pageSize: 10 });
		const dataStmt = (db.prepare as ReturnType<typeof vi.fn>).mock.results[1]?.value;
		expect(dataStmt?.bind).toHaveBeenCalledWith(10, 20);
	});
});

// ---------------------------------------------------------------------------
// searchSimfiles
// ---------------------------------------------------------------------------
describe('searchSimfiles', () => {
	it('returns matching rows', async () => {
		const db = createMockDb(() => createMockStmt(null, [baseSimfileRow]));
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1'
		});
		expect(result).toEqual([baseSimfileRow]);
	});

	it('applies userId filter for published or owned charts', async () => {
		const db = createMockDb(() => createMockStmt(null, []));
		await searchSimfiles(db as unknown as D1Database, { query: 'test', userId: 'user-1' });
		const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(sql).toContain('(is_published = 1 OR user_id = ?)');
	});

	it('applies only published filter when no userId provided', async () => {
		const db = createMockDb(() => createMockStmt(null, []));
		await searchSimfiles(db as unknown as D1Database, { query: 'test' });
		const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(sql).toContain('is_published = 1');
		expect(sql).not.toContain('user_id');
	});

	it('applies excludeIds when provided', async () => {
		const db = createMockDb(() => createMockStmt(null, []));
		await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			excludeIds: [1, 2]
		});
		const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(sql).toContain('id NOT IN');
	});

	it('uses default limit of 8', async () => {
		const db = createMockDb(() => createMockStmt(null, []));
		await searchSimfiles(db as unknown as D1Database, { query: 'test', userId: 'user-1' });
		const stmt = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		const bindArgs = stmt?.bind.mock.calls[0] as unknown[];
		expect(bindArgs[bindArgs.length - 1]).toBe(8);
	});

	it('uses custom limit', async () => {
		const db = createMockDb(() => createMockStmt(null, []));
		await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			limit: 5
		});
		const stmt = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0]?.value;
		const bindArgs = stmt?.bind.mock.calls[0] as unknown[];
		expect(bindArgs[bindArgs.length - 1]).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// createSimfile
// ---------------------------------------------------------------------------
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
