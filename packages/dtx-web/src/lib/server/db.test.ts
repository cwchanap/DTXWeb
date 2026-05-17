import { describe, it, expect } from 'vitest';
import { getDb } from './db';
import type { D1Database } from '@cloudflare/workers-types';

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
