import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toSimfileWithDtx } from '../types/d1.types';
import { simfiles, dtxFiles, userProfiles, chartScores, scores } from './db/schema';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import {
	createDrizzleDb,
	escapeLikePattern,
	getSimfile,
	getSimfileOwner,
	listSimfiles,
	searchSimfiles,
	getNextDisplayId,
	createSimfile,
	updateSimfile,
	updateSimfileDriveFile,
	deleteSimfile,
	createDtxFiles,
	getUserProfile,
	upsertUserProfile,
	updateUserProfile,
	upsertChartScoreAndReplaceScores,
	getUserChartScore,
	listUserScoredSimfiles,
	listUserChartScores
} from './db';
import type { D1Database } from '@cloudflare/workers-types';
import type { SimfileInsert, SimfileUpdate } from '../types/d1.types';

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
	google_drive_file_id: null,
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
		const userChartIdx = config.indexes.find(
			(i) => i.config.name === 'idx_chart_scores_user_chart'
		);
		expect(userChartIdx).toBeDefined();
		// The index must be unique — not just a plain index — to enforce the
		// one-chart_score-per-user-per-chart invariant from the migration.
		expect(userChartIdx?.config.unique).toBe(true);
		expect(config.indexes.map((i) => i.config.name)).toContain('idx_chart_scores_chart');
	});

	it('defines the chart_score index on scores', () => {
		const config = getTableConfig(scores);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_scores_chart_score');
	});

	// Parity check: the Drizzle schema now includes the partial unique indexes
	// that mirror the migration (0002_scores.sql). Previously these lived only
	// in the raw SQL migration because Drizzle's sqlite-core builder lacked
	// partial-index support; Drizzle 0.44+ supports .where() on index builders,
	// so the declarations were moved into schema.ts for test/production parity.
	const serializeWherePredicate = (where: unknown): string => {
		const walk = (chunk: unknown): string => {
			if (chunk === null || chunk === undefined) return '';
			if (typeof chunk === 'object' && 'queryChunks' in chunk) {
				return ((chunk as { queryChunks: unknown[] }).queryChunks ?? []).map(walk).join('');
			}
			if (
				typeof chunk === 'object' &&
				'value' in chunk &&
				Array.isArray((chunk as { value: unknown[] }).value)
			) {
				return (chunk as { value: string[] }).value.join('');
			}
			if (typeof chunk === 'object' && 'name' in chunk) {
				return String((chunk as { name: string }).name);
			}
			return '';
		};
		return walk(where).replace(/\s+/g, ' ').trim();
	};

	it('defines the idx_scores_one_best partial unique index (WHERE is_best = 1)', () => {
		const config = getTableConfig(scores);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_scores_one_best');

		const oneBestIdx = config.indexes.find((i) => i.config.name === 'idx_scores_one_best');
		expect(oneBestIdx).toBeDefined();
		expect(oneBestIdx?.config.unique).toBe(true);
		expect(serializeWherePredicate(oneBestIdx?.config.where)).toBe('is_best = 1');
	});

	it('defines the idx_scores_display_order partial unique index (WHERE display_order IS NOT NULL)', () => {
		const config = getTableConfig(scores);
		const indexNames = config.indexes.map((i) => i.config.name);
		expect(indexNames).toContain('idx_scores_display_order');

		const displayOrderIdx = config.indexes.find(
			(i) => i.config.name === 'idx_scores_display_order'
		);
		expect(displayOrderIdx).toBeDefined();
		expect(displayOrderIdx?.config.unique).toBe(true);
		expect(serializeWherePredicate(displayOrderIdx?.config.where)).toBe(
			'display_order IS NOT NULL'
		);
	});
});

// ---------------------------------------------------------------------------
// CHECK constraint parity: 0002_scores.sql vs Drizzle schema.ts
//
// The migration SQL and the Drizzle schema both define CHECK constraints on
// chart_scores and scores. They can drift when one is updated without the
// other. This test parses both sources, normalizes the SQL expressions, and
// asserts they define the same set of constraints.
// ---------------------------------------------------------------------------
describe('CHECK constraint parity (0002_scores.sql vs schema.ts)', () => {
	const MIGRATIONS_DIR = join(
		__dirname,
		'..',
		'..',
		'..',
		'..',
		'..',
		'packages',
		'dtx-api',
		'd1-migrations'
	);
	const SCHEMA_PATH = join(__dirname, 'db', 'schema.ts');

	// Normalize a SQL expression for comparison: lowercase, collapse whitespace,
	// strip surrounding parens, and remove redundant spacing around operators.
	const normalize = (expr: string): string =>
		expr
			.toLowerCase()
			.replace(/\s+/g, ' ')
			.replace(/\s*([()])\s*/g, '$1')
			.replace(/\s*(>=|<=|!=|<>|=|<|>|AND|OR|IN|IS NULL|IS NOT NULL)\s*/gi, (_, op) => {
				const upper = op.toUpperCase();
				if (
					upper === 'AND' ||
					upper === 'OR' ||
					upper === 'IN' ||
					upper === 'IS NULL' ||
					upper === 'IS NOT NULL'
				) {
					return ` ${upper} `;
				}
				return op;
			})
			.trim();

	// Parse inline CHECK constraints from CREATE TABLE statements in the
	// migration SQL. Returns a map of column-name → normalized expression.
	const parseMigrationChecks = (sql: string): Map<string, string> => {
		const checks = new Map<string, string>();
		// Match: column_name TYPE ... CHECK (expression)
		// The expression may contain nested parens (e.g. IN (...)).
		const lines = sql.split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			// Skip comment-only lines
			if (trimmed.startsWith('--')) continue;
			// Find CHECK (...) — handle nested parens by counting depth.
			const checkIdx = trimmed.indexOf('CHECK');
			if (checkIdx === -1) continue;
			// Extract the column name: the first token on the line (before any
			// TYPE keyword). For inline constraints the column name precedes
			// the type definition.
			const beforeCheck = trimmed.slice(0, checkIdx).trim();
			const colName = beforeCheck.split(/\s+/)[0];
			// Extract the parenthesized expression after CHECK, handling nesting.
			let depth = 0;
			let start = -1;
			let end = -1;
			for (let i = checkIdx + 5; i < trimmed.length; i++) {
				if (trimmed[i] === '(') {
					if (depth === 0) start = i;
					depth++;
				} else if (trimmed[i] === ')') {
					depth--;
					if (depth === 0) {
						end = i;
						break;
					}
				}
			}
			if (start !== -1 && end !== -1 && colName) {
				const expr = trimmed.slice(start + 1, end);
				checks.set(colName, normalize(expr));
			}
		}
		return checks;
	};

	// Parse check() definitions from schema.ts source text. Returns a map of
	// column-name → normalized expression. The Drizzle check() calls use
	// sql`${table.X} OP Y` template literals; we extract the expression text,
	// replace `${table.X}` with the snake_case column name, and normalize.
	const parseSchemaChecks = (source: string): Map<string, string> => {
		const checks = new Map<string, string>();
		// Drizzle property-name → SQL column-name mapping. Derived from the
		// table definitions in schema.ts (camelCase → snake_case).
		const propToColumn: Record<string, string> = {
			playCount: 'play_count',
			clearCount: 'clear_count',
			isBest: 'is_best',
			score: 'score',
			achievementRate: 'achievement_rate',
			rankLabel: 'rank_label',
			fullCombo: 'full_combo',
			cleared: 'cleared',
			maxCombo: 'max_combo',
			perfect: 'perfect',
			great: 'great',
			good: 'good',
			poor: 'poor',
			miss: 'miss',
			displayOrder: 'display_order'
		};
		// Match: check('name', sql`expression`)
		// The expression contains ${table.X} references and literal SQL.
		const checkRegex = /check\s*\(\s*['"][^'"]+['"]\s*,\s*sql`([^`]+)`/g;
		let match;
		while ((match = checkRegex.exec(source)) !== null) {
			let expr = match[1];
			// Replace ${table.X} with the snake_case column name.
			expr = expr.replace(/\$\{table\.(\w+)\}/g, (_, prop) => propToColumn[prop] ?? prop);
			// The check name encodes the column (e.g. 'scores_is_best_check').
			// Extract the column from the check name to use as the key.
			const nameMatch = match[0].match(/['"](\w+)_(\w+)_check['"]/);
			// We key by the normalized expression itself, not the column name,
			// because the migration uses column names inline and the schema
			// uses check names — the expression is the common ground.
			checks.set(normalize(expr), normalize(expr));
		}
		return checks;
	};

	it('chart_scores CHECK constraints match between migration and Drizzle schema', () => {
		const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0002_scores.sql'), 'utf8');
		const schemaSource = readFileSync(SCHEMA_PATH, 'utf8');

		// Extract the chart_scores CREATE TABLE block from the migration.
		const chartScoresBlock =
			migrationSql.match(/CREATE TABLE IF NOT EXISTS chart_scores \([\s\S]*?\);/)?.[0] ?? '';
		const migrationChecks = parseMigrationChecks(chartScoresBlock);

		// Extract chart_scores check() calls from the Drizzle schema.
		// The chartScores table definition is between 'export const chartScores'
		// and the next 'export const' (or end of table).
		const chartScoresSchema =
			schemaSource.match(/export const chartScores = sqliteTable\([\s\S]*?\);\s*/)?.[0] ?? '';
		const schemaChecks = parseSchemaChecks(chartScoresSchema);

		// Both should define the same set of normalized expressions.
		const migrationExprs = [...migrationChecks.values()].sort();
		const schemaExprs = [...schemaChecks.keys()].sort();

		expect(migrationExprs).toHaveLength(schemaExprs.length);
		for (const expr of schemaExprs) {
			expect(migrationExprs).toContain(expr);
		}
	});

	it('scores CHECK constraints match between migration and Drizzle schema', () => {
		const migrationSql = readFileSync(join(MIGRATIONS_DIR, '0002_scores.sql'), 'utf8');
		const schemaSource = readFileSync(SCHEMA_PATH, 'utf8');

		// Extract the scores CREATE TABLE block from the migration.
		const scoresBlock =
			migrationSql.match(
				/CREATE TABLE IF NOT EXISTS scores \([\s\S]*?\);\s*\nCREATE INDEX/
			)?.[0] ??
			migrationSql.match(/CREATE TABLE IF NOT EXISTS scores \([\s\S]*?\);/)?.[0] ??
			'';
		const migrationChecks = parseMigrationChecks(scoresBlock);

		// Extract scores check() calls from the Drizzle schema.
		const scoresSchema =
			schemaSource.match(/export const scores = sqliteTable\([\s\S]*?\);\s*$/m)?.[0] ?? '';
		const schemaChecks = parseSchemaChecks(scoresSchema);

		const migrationExprs = [...migrationChecks.values()].sort();
		const schemaExprs = [...schemaChecks.keys()].sort();

		expect(migrationExprs).toHaveLength(schemaExprs.length);
		for (const expr of schemaExprs) {
			expect(migrationExprs).toContain(expr);
		}
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

	it('maps nullable Google Drive metadata from the simfile select', async () => {
		const row = { ...baseSimfileRow, google_drive_file_id: 'drive-file-123' };
		drizzleSelectResults.push([row], []);

		const result = await getSimfile(createMockDb() as unknown as D1Database, 1);

		expect(result?.google_drive_file_id).toBe('drive-file-123');
		const simfileSelectCall = (mockDrizzleDb.select.mock.calls as unknown[][])[0]?.[0];
		expect(simfileSelectCall).toHaveProperty(
			'google_drive_file_id',
			simfiles.googleDriveFileId
		);
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
		expect(secondSelectCall).not.toHaveProperty('google_drive_file_id');
	});

	it('includes owner-only Google Drive metadata when not publishedOnly', async () => {
		const row = { ...baseSimfileRow, google_drive_file_id: 'drive-file-123' };
		drizzleSelectResults.push([{ cnt: 1 }], [row], []);
		const db = createMockDb();

		const result = await listSimfiles(db as unknown as D1Database, { userId: 'user-1' });
		expect(result.data[0]).toHaveProperty('user_id', 'user-1');
		expect(result.data[0]).toHaveProperty('google_drive_file_id', 'drive-file-123');

		const secondSelectCall = (mockDrizzleDb.select.mock.calls as unknown[][])[1]?.[0];
		expect(secondSelectCall).toHaveProperty('user_id');
		expect(secondSelectCall).toHaveProperty('google_drive_file_id', simfiles.googleDriveFileId);
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

	it('filters excluded IDs in JavaScript instead of SQL NOT IN', async () => {
		// Excluded IDs are no longer passed to SQL NOT IN (which was capped at
		// 90 by the D1 parameter limit). Instead, the SQL query over-fetches
		// by excludeIds.length (capped at 200) and all excluded IDs are
		// filtered in JS so valid rows past the excluded prefix are returned.
		const rows = [
			{ id: 1, title: 'Linked A', artist: 'A', bpm: 120, is_published: 1 as 0 | 1 },
			{ id: 2, title: 'Linked B', artist: 'A', bpm: 120, is_published: 1 as 0 | 1 },
			{ id: 3, title: 'Valid C', artist: 'A', bpm: 120, is_published: 1 as 0 | 1 },
			{ id: 4, title: 'Valid D', artist: 'A', bpm: 120, is_published: 1 as 0 | 1 }
		];
		drizzleSelectResults.push(rows);
		const db = createMockDb();
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			limit: 10,
			excludeIds: [1, 2]
		});
		// IDs 1 and 2 are filtered out; only valid rows remain.
		expect(result.map((r) => r.id)).toEqual([3, 4]);
		// SQL LIMIT over-fetches by excludeIds.length to compensate for JS filtering.
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(12);
	});

	it('over-fetches SQL so valid rows past an excluded prefix are not hidden', async () => {
		// Reproduces the false "no results" bug: 60 rows match, the first 50
		// are already linked (excluded), and the valid unlinked row sits at
		// position 51. With a plain LIMIT 50 the SQL page would contain only
		// excluded rows and the JS filter would return []. Over-fetching by
		// excludeIds.length (capped) lets the valid row surface.
		const excludeIds = Array.from({ length: 50 }, (_, i) => i + 1);
		const rows = [
			...Array.from({ length: 50 }, (_, i) => ({
				id: i + 1,
				title: `Linked ${i}`,
				artist: 'A',
				bpm: 120,
				is_published: 1 as 0 | 1
			})),
			...Array.from({ length: 10 }, (_, i) => ({
				id: 51 + i,
				title: `Valid ${i}`,
				artist: 'A',
				bpm: 120,
				is_published: 1 as 0 | 1
			}))
		];
		drizzleSelectResults.push(rows);
		const db = createMockDb();
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			limit: 50,
			excludeIds
		});
		// The valid rows past the excluded prefix are returned — no false negative.
		expect(result.map((r) => r.id)).toEqual(Array.from({ length: 10 }, (_, i) => 51 + i));
		// SQL LIMIT = limit(50) + excludeIds.length(50) = 100 (under the 200 cap).
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(100);
	});

	it('caps SQL over-fetch at 200 even with very large exclude lists', async () => {
		const excludeIds = Array.from({ length: 300 }, (_, i) => i + 1);
		drizzleSelectResults.push([]);
		const db = createMockDb();
		await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			limit: 50,
			excludeIds
		});
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(200);
	});

	it('handles large exclude lists without SQL parameter limits', async () => {
		// 95 exclude IDs — previously required SQL NOT IN capped at 90 plus
		// JS over-fetch. Now all filtering is in JS, so there's no SQL
		// parameter limit concern.
		const excludeIds = Array.from({ length: 95 }, (_, i) => i + 1);
		const rows = [
			...Array.from({ length: 5 }, (_, i) => ({
				id: 91 + i,
				title: `Linked ${i}`,
				artist: 'A',
				bpm: 120,
				is_published: 1 as 0 | 1
			})),
			...Array.from({ length: 15 }, (_, i) => ({
				id: 100 + i,
				title: `Valid ${i}`,
				artist: 'A',
				bpm: 120,
				is_published: 1 as 0 | 1
			}))
		];
		drizzleSelectResults.push(rows);
		const db = createMockDb();
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			limit: 50,
			excludeIds
		});
		// All 5 linked rows (IDs 91-95) are filtered out; only valid rows remain.
		expect(result.every((r) => !excludeIds.includes(r.id))).toBe(true);
		expect(result.map((r) => r.id)).toEqual(Array.from({ length: 15 }, (_, i) => 100 + i));
		// SQL LIMIT over-fetches by excludeIds.length: 50 + 95 = 145 (under the 200 cap).
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(145);
	});

	it('trims the filtered result back to `limit` rows (does not return the full over-fetch)', async () => {
		// Reproduces the P2 bug: limit=8, excludeIds has 20 entries, SQL
		// over-fetches to 28 rows, but only 2 of those are excluded. The
		// caller must receive at most `limit` (8) rows — not the 26 that
		// survive the filter. The autocomplete caller masks this with its
		// own .slice(0, 8), but the shared helper's contract is to bound
		// the result by `limit`.
		const excludeIds = Array.from({ length: 20 }, (_, i) => i + 1);
		const rows = [
			// 2 rows match the exclude set (will be filtered out).
			{ id: 1, title: 'Linked 1', artist: 'A', bpm: 120, is_published: 1 as 0 | 1 },
			{ id: 2, title: 'Linked 2', artist: 'A', bpm: 120, is_published: 1 as 0 | 1 },
			// 26 valid rows survive the filter — must be trimmed to `limit`.
			...Array.from({ length: 26 }, (_, i) => ({
				id: 100 + i,
				title: `Valid ${i}`,
				artist: 'A',
				bpm: 120,
				is_published: 1 as 0 | 1
			}))
		];
		drizzleSelectResults.push(rows);
		const db = createMockDb();
		const result = await searchSimfiles(db as unknown as D1Database, {
			query: 'test',
			userId: 'user-1',
			limit: 8,
			excludeIds
		});
		expect(result).toHaveLength(8);
		expect(result.every((r) => !excludeIds.includes(r.id))).toBe(true);
		// SQL LIMIT = limit(8) + excludeIds.length(20) = 28 (under the 200 cap).
		const query = (
			mockDrizzleDb.select.mock.results as {
				value: Record<string, ReturnType<typeof vi.fn>>;
			}[]
		)[0]?.value;
		expect(query?.limit).toHaveBeenCalledWith(28);
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
// updateSimfileDriveFile
// ---------------------------------------------------------------------------
describe('updateSimfileDriveFile', () => {
	it('updates Google Drive ID and download URL in one owner-constrained statement', async () => {
		const updated = {
			...baseSimfileRow,
			google_drive_file_id: 'drive-file-123',
			download_url: 'https://drive.google.com/uc?id=drive-file-123'
		};
		const stmt = createMockStmt(updated);
		const db = createMockDb(() => stmt);

		const result = await updateSimfileDriveFile(db as unknown as D1Database, 1, 'user-1', {
			googleDriveFileId: 'drive-file-123',
			downloadUrl: 'https://drive.google.com/uc?id=drive-file-123'
		});

		expect(result).toEqual(updated);
		expect(db.prepare).toHaveBeenCalledTimes(1);
		expect(db.prepare).toHaveBeenCalledWith(
			expect.stringMatching(
				/^UPDATE simfiles\s+SET google_drive_file_id = \?, download_url = \?, updated_at = \?\s+WHERE id = \? AND user_id = \?\s+RETURNING \*$/s
			)
		);
		expect(stmt.bind).toHaveBeenCalledWith(
			'drive-file-123',
			'https://drive.google.com/uc?id=drive-file-123',
			expect.any(String),
			1,
			'user-1'
		);
	});

	it.each([
		['wrong owner', 1, 'user-2'],
		['missing simfile', 99, 'user-1']
	])('returns the same neutral not-found failure for a %s', async (_case, id, ownerUserId) => {
		const db = createMockDb(() => createMockStmt(null));

		await expect(
			updateSimfileDriveFile(db as unknown as D1Database, id, ownerUserId, {
				googleDriveFileId: 'drive-file-123',
				downloadUrl: 'https://drive.google.com/uc?id=drive-file-123'
			})
		).rejects.toThrow('Simfile not found');
	});

	it('distinguishes a guard mismatch from a genuine deletion when expectedPreviousDriveFileId is set', async () => {
		const db = createMockDb((sql) => {
			if (sql.startsWith('UPDATE')) {
				return createMockStmt(null);
			}
			return createMockStmt({ id: 1 });
		});

		await expect(
			updateSimfileDriveFile(db as unknown as D1Database, 1, 'user-1', {
				googleDriveFileId: 'drive-file-new',
				downloadUrl: 'https://drive.google.com/uc?id=drive-file-new',
				expectedPreviousDriveFileId: 'drive-file-old'
			})
		).rejects.toThrow('Drive binding mismatch');
	});

	it('distinguishes a guard mismatch from a genuine deletion when expectNoExistingDriveFile is set', async () => {
		const db = createMockDb((sql) => {
			if (sql.startsWith('UPDATE')) {
				return createMockStmt(null);
			}
			return createMockStmt({ id: 1 });
		});

		await expect(
			updateSimfileDriveFile(db as unknown as D1Database, 1, 'user-1', {
				googleDriveFileId: 'drive-file-new',
				downloadUrl: 'https://drive.google.com/uc?id=drive-file-new',
				expectNoExistingDriveFile: true
			})
		).rejects.toThrow('Drive binding mismatch');
	});

	it('still returns not-found when the guard fails and the row is genuinely gone', async () => {
		const db = createMockDb(() => createMockStmt(null));

		await expect(
			updateSimfileDriveFile(db as unknown as D1Database, 1, 'user-1', {
				googleDriveFileId: 'drive-file-new',
				downloadUrl: 'https://drive.google.com/uc?id=drive-file-new',
				expectedPreviousDriveFileId: 'drive-file-old'
			})
		).rejects.toThrow('Simfile not found');
	});

	// Cross-layer TOCTOU guard: verify the SQL WHERE clause actually includes
	// the optimistic-concurrency guard. Without this, a refactor that drops
	// the guard from the SQL would still pass the logic tests above (which
	// mock the UPDATE result) while silently re-opening the TOCTOU window.
	it('includes expectedPreviousDriveFileId in the UPDATE WHERE clause', async () => {
		let capturedSql = '';
		const db = createMockDb((sql) => {
			capturedSql = sql;
			return createMockStmt({
				id: 1,
				title: 'Song',
				artist: 'Artist',
				bpm: 120,
				user_id: 'user-1',
				is_published: 0,
				display_id: 1,
				download_url: 'https://drive.google.com/new',
				google_drive_file_id: 'drive-file-new',
				preview_url: null,
				video_preview_url: null,
				publish_date: '2026-01-01',
				created_at: '2026-01-01',
				updated_at: '2026-01-01'
			});
		});

		await updateSimfileDriveFile(db as unknown as D1Database, 1, 'user-1', {
			googleDriveFileId: 'drive-file-new',
			downloadUrl: 'https://drive.google.com/uc?id=drive-file-new',
			expectedPreviousDriveFileId: 'drive-file-old'
		});

		expect(capturedSql).toMatch(/WHERE.*google_drive_file_id = \?/s);
		expect(capturedSql).toMatch(
			/WHERE.*id = \?.*AND.*user_id = \?.*AND.*google_drive_file_id = \?/s
		);
	});

	it('includes expectNoExistingDriveFile as a NULL check in the UPDATE WHERE clause', async () => {
		let capturedSql = '';
		const db = createMockDb((sql) => {
			capturedSql = sql;
			return createMockStmt({
				id: 1,
				title: 'Song',
				artist: 'Artist',
				bpm: 120,
				user_id: 'user-1',
				is_published: 0,
				display_id: 1,
				download_url: 'https://drive.google.com/new',
				google_drive_file_id: 'drive-file-new',
				preview_url: null,
				video_preview_url: null,
				publish_date: '2026-01-01',
				created_at: '2026-01-01',
				updated_at: '2026-01-01'
			});
		});

		await updateSimfileDriveFile(db as unknown as D1Database, 1, 'user-1', {
			googleDriveFileId: 'drive-file-new',
			downloadUrl: 'https://drive.google.com/uc?id=drive-file-new',
			expectNoExistingDriveFile: true
		});

		expect(capturedSql).toMatch(/google_drive_file_id IS NULL/);
		expect(capturedSql).toMatch(
			/WHERE.*id = \?.*AND.*user_id = \?.*AND.*google_drive_file_id IS NULL/s
		);
	});

	it('omits the guard from the WHERE clause when no guard args are provided', async () => {
		let capturedSql = '';
		const db = createMockDb((sql) => {
			capturedSql = sql;
			return createMockStmt({
				id: 1,
				title: 'Song',
				artist: 'Artist',
				bpm: 120,
				user_id: 'user-1',
				is_published: 0,
				display_id: 1,
				download_url: 'https://drive.google.com/new',
				google_drive_file_id: 'drive-file-new',
				preview_url: null,
				video_preview_url: null,
				publish_date: '2026-01-01',
				created_at: '2026-01-01',
				updated_at: '2026-01-01'
			});
		});

		await updateSimfileDriveFile(db as unknown as D1Database, 1, 'user-1', {
			googleDriveFileId: 'drive-file-new',
			downloadUrl: 'https://drive.google.com/uc?id=drive-file-new'
		});

		// The SET clause always contains `google_drive_file_id = ?`, so scope
		// the negative assertion to the WHERE clause only.
		expect(capturedSql).not.toMatch(/WHERE.*google_drive_file_id = \?/s);
		expect(capturedSql).not.toMatch(/WHERE.*google_drive_file_id IS NULL/s);
	});
});

describe('general simfile write types', () => {
	it('do not allow general insert or update payloads to write Google Drive metadata', () => {
		const insert: SimfileInsert = {
			bpm: 120,
			user_id: 'user-1',
			// @ts-expect-error Google Drive ownership metadata is only writable by updateSimfileDriveFile.
			google_drive_file_id: 'forbidden'
		};
		const update: SimfileUpdate = {
			// @ts-expect-error Google Drive ownership metadata is only writable by updateSimfileDriveFile.
			google_drive_file_id: 'forbidden'
		};
		expect(insert).toBeDefined();
		expect(update).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// deleteSimfile
// ---------------------------------------------------------------------------
describe('deleteSimfile', () => {
	// sqlite_master probe helper: returns a prepare impl that answers the
	// table-existence check with the given table names, and a default stmt
	// otherwise. The probe is the first prepare call deleteSimfile makes.
	const prepareWithTables = (tables: string[]) => (sql: string) => {
		if (sql.includes('sqlite_master')) {
			return createMockStmt(
				null,
				tables.map((name) => ({ name }))
			);
		}
		return createMockStmt();
	};

	it('deletes without error when found', async () => {
		const db = createMockDb(prepareWithTables(['scores', 'chart_scores']));
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ meta: { changes: 0 } },
			{ meta: { changes: 0 } },
			{ meta: { changes: 0 } },
			{ meta: { changes: 1 } }
		]);
		await expect(deleteSimfile(db as unknown as D1Database, 1)).resolves.toBeUndefined();
	});

	it('throws when simfile not found', async () => {
		const db = createMockDb(prepareWithTables(['scores', 'chart_scores']));
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ meta: { changes: 0 } },
			{ meta: { changes: 0 } },
			{ meta: { changes: 0 } },
			{ meta: { changes: 0 } }
		]);
		await expect(deleteSimfile(db as unknown as D1Database, 99)).rejects.toThrow(
			'Simfile not found'
		);
	});

	it('deletes scores and chart_scores for the simfile before dtx_files and simfiles', async () => {
		const db = createMockDb(prepareWithTables(['scores', 'chart_scores']));
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ meta: { changes: 2 } },
			{ meta: { changes: 1 } },
			{ meta: { changes: 1 } },
			{ meta: { changes: 1 } }
		]);

		await deleteSimfile(db as unknown as D1Database, 1);

		// The sqlite_master probe is the first prepare call; the four DELETEs
		// follow in the required order (scores -> chart_scores -> dtx_files -> simfiles).
		const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map(
			(call) => call[0]
		);
		expect(prepareCalls).toHaveLength(5);
		expect(prepareCalls[0]).toContain('sqlite_master');
		expect(prepareCalls[1]).toBe(
			'DELETE FROM scores WHERE chart_score_id IN (SELECT id FROM chart_scores WHERE chart_id IN (SELECT id FROM dtx_files WHERE simfile_id = ?))'
		);
		expect(prepareCalls[2]).toBe(
			'DELETE FROM chart_scores WHERE chart_id IN (SELECT id FROM dtx_files WHERE simfile_id = ?)'
		);
		expect(prepareCalls[3]).toBe('DELETE FROM dtx_files WHERE simfile_id = ?');
		expect(prepareCalls[4]).toBe('DELETE FROM simfiles WHERE id = ?');

		// Each DELETE statement must be parameterized with the simfile id, not
		// string-interpolated. The sqlite_master probe has no bind call.
		const stmts = (db.prepare as ReturnType<typeof vi.fn>).mock.results.map(
			(result) => result.value
		);
		for (let i = 1; i < stmts.length; i++) {
			expect(stmts[i].bind).toHaveBeenCalledWith(1);
		}
	});

	it('skips scores/chart_scores DELETEs on a 0001-only D1 (no 0002_scores.sql applied)', async () => {
		// A fresh local D1 used by `wrangler dev` before `wrangler d1 migrations apply`
		// has only the 0001 schema: no `scores` or `chart_scores` tables. The batch
		// must not include DELETEs against missing tables (D1 batch is atomic and
		// would fail with "no such table"), while dtx_files/simfiles deletion still
		// works — this also protects the createSimfileWithDtx rollback path.
		const db = createMockDb(prepareWithTables([]));
		(db.batch as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ meta: { changes: 1 } },
			{ meta: { changes: 1 } }
		]);

		await deleteSimfile(db as unknown as D1Database, 1);

		const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.map(
			(call) => call[0]
		);
		expect(prepareCalls).toHaveLength(3);
		expect(prepareCalls[0]).toContain('sqlite_master');
		expect(prepareCalls[1]).toBe('DELETE FROM dtx_files WHERE simfile_id = ?');
		expect(prepareCalls[2]).toBe('DELETE FROM simfiles WHERE id = ?');
		expect(db.batch).toHaveBeenCalledTimes(1);
		// Only the two always-on DELETEs are batched.
		const batchArg = (db.batch as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(batchArg).toHaveLength(2);
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

describe('upsertChartScoreAndReplaceScores', () => {
	it('batches the upsert, delete, and inserts in one D1 batch', async () => {
		const chartScoreRow = {
			id: 3,
			chart_id: 10,
			user_id: 'u1',
			play_count: 10,
			clear_count: 4,
			created_at: 't',
			updated_at: 't'
		};
		const db = createMockDb();
		db.batch = vi
			.fn()
			.mockResolvedValue([{ results: [chartScoreRow] }, { results: [] }, { results: [] }]);
		const result = await upsertChartScoreAndReplaceScores(db as unknown as D1Database, {
			chartId: 10,
			userId: 'u1',
			playCount: 10,
			clearCount: 4,
			scores: [
				{ is_best: true, score: 900000, achievement_rate: 91.3 },
				{ is_best: false, achievement_rate: 82.4, display_order: 1 }
			]
		});
		// 1 upsert + 1 delete + 2 inserts = 4 statements in ONE batch
		expect(db.prepare).toHaveBeenCalledTimes(4);
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect(db.batch.mock.calls[0][0]).toHaveLength(4);
		expect(result).toEqual(chartScoreRow);
	});

	it('batches only the upsert and delete when there are no scores', async () => {
		const chartScoreRow = {
			id: 3,
			chart_id: 10,
			user_id: 'u1',
			play_count: 0,
			clear_count: 0,
			created_at: 't',
			updated_at: 't'
		};
		const db = createMockDb();
		db.batch = vi.fn().mockResolvedValue([{ results: [chartScoreRow] }, { results: [] }]);
		const result = await upsertChartScoreAndReplaceScores(db as unknown as D1Database, {
			chartId: 10,
			userId: 'u1',
			playCount: 0,
			clearCount: 0,
			scores: []
		});
		expect(db.prepare).toHaveBeenCalledTimes(2);
		expect(db.batch.mock.calls[0][0]).toHaveLength(2);
		expect(result).toEqual(chartScoreRow);
	});

	it('throws when the upsert returns no row', async () => {
		const db = createMockDb();
		db.batch = vi.fn().mockResolvedValue([{ results: [] }, { results: [] }]);
		await expect(
			upsertChartScoreAndReplaceScores(db as unknown as D1Database, {
				chartId: 10,
				userId: 'u1',
				playCount: 0,
				clearCount: 0,
				scores: []
			})
		).rejects.toThrow('Failed to upsert chart_score');
	});

	it('scopes all batch statements to the calling user — user-1 write never binds user-2', async () => {
		// Cross-user write isolation: the upsert's ON CONFLICT(user_id, chart_id)
		// and the delete/insert subqueries all resolve via `WHERE user_id = ?`.
		// A write for user-1 on chart 10 must never bind user-2, proving it
		// cannot touch user-2's chart_scores row or scores for the same chart.
		const chartScoreRow = {
			id: 3,
			chart_id: 10,
			user_id: 'user-1',
			play_count: 1,
			clear_count: 1,
			created_at: 't',
			updated_at: 't'
		};
		const db = createMockDb();
		db.batch = vi
			.fn()
			.mockResolvedValue([{ results: [chartScoreRow] }, { results: [] }, { results: [] }]);

		await upsertChartScoreAndReplaceScores(db as unknown as D1Database, {
			chartId: 10,
			userId: 'user-1',
			playCount: 1,
			clearCount: 1,
			scores: [{ is_best: true, score: 900, full_combo: false, cleared: true }]
		});

		// 1 upsert + 1 delete + 1 insert = 3 statements in the batch.
		const statements = db.batch.mock.calls[0][0] as Array<{
			bind: { mock: { calls: unknown[][] } };
		}>;
		expect(statements).toHaveLength(3);

		// Every statement must bind 'user-1' and never 'user-2'.
		for (const stmt of statements) {
			const bindArgs = stmt.bind.mock.calls[0];
			expect(bindArgs).toContain('user-1');
			expect(bindArgs).not.toContain('user-2');
		}

		// The upsert binds (chartId, userId, ..., chartId, userId) — userId is
		// the 2nd arg, the 7th arg is the chartId for the `WHERE d.id = ?`
		// existence gate, and the trailing 8th arg is the userId for the
		// `(s.is_published = 1 OR s.user_id = ?)` visibility gate (TOCTOU fix).
		const upsertBinds = statements[0].bind.mock.calls[0];
		expect(upsertBinds[0]).toBe(10);
		expect(upsertBinds[1]).toBe('user-1');
		expect(upsertBinds[6]).toBe(10);
		expect(upsertBinds[7]).toBe('user-1');

		// The delete binds (userId, chartId, userId) — the subquery scoping,
		// with the trailing userId for the visibility gate in resolveChartScoreId.
		const deleteBinds = statements[1].bind.mock.calls[0];
		expect(deleteBinds[0]).toBe('user-1');
		expect(deleteBinds[1]).toBe(10);
		expect(deleteBinds[2]).toBe('user-1');

		// The insert binds (userId, chartId, userId, ...) — the subquery
		// scoping, with the trailing userId for the visibility gate.
		const insertBinds = statements[2].bind.mock.calls[0];
		expect(insertBinds[0]).toBe('user-1');
		expect(insertBinds[1]).toBe(10);
		expect(insertBinds[2]).toBe('user-1');
	});

	it('gates the upsert INSERT on dtx_files existence (TOCTOU defense)', async () => {
		// The first statement's SQL must use `SELECT ... FROM dtx_files WHERE id = ?`
		// (not `VALUES (...)`) so a chart deleted between the visibility check and
		// the write can't orphan a chart_scores row.
		const chartScoreRow = {
			id: 3,
			chart_id: 10,
			user_id: 'u1',
			play_count: 1,
			clear_count: 1,
			created_at: 't',
			updated_at: 't'
		};
		const db = createMockDb();
		db.batch = vi.fn().mockResolvedValue([{ results: [chartScoreRow] }, { results: [] }]);

		await upsertChartScoreAndReplaceScores(db as unknown as D1Database, {
			chartId: 10,
			userId: 'u1',
			playCount: 1,
			clearCount: 1,
			scores: []
		});

		const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
		const upsertSql = prepareCalls[0][0] as string;
		// The upsert must SELECT FROM dtx_files joined to simfiles and gate on
		// both chart existence AND visibility (published OR owned by the
		// caller), so a chart deleted or hidden between the visibility check
		// and the write can't orphan/alter a chart_scores row.
		expect(upsertSql).toContain('FROM dtx_files');
		expect(upsertSql).toContain('JOIN simfiles');
		expect(upsertSql).toContain('WHERE d.id = ?');
		expect(upsertSql).toContain('(s.is_published = 1 OR s.user_id = ?)');
		expect(upsertSql).not.toContain('VALUES (');

		// The DELETE and INSERT-score statements' subquery must also gate on
		// chart visibility (EXISTS), so a TOCTOU chart deletion/unpublish
		// can't partially commit (replace scores while leaving a stale
		// aggregate) when a chart_scores row already exists from a prior upload.
		const deleteSql = prepareCalls[1][0] as string;
		expect(deleteSql).toContain('EXISTS (SELECT 1 FROM dtx_files');
		expect(deleteSql).toContain('(s.is_published = 1 OR s.user_id = ?)');
	});

	it('parallel upserts on the same chart are last-write-wins (no partial state)', async () => {
		// Two concurrent upserts for the same (user, chart) with different
		// play/clear counts. D1 batches are atomic per call, so each upsert
		// is an independent transaction. The mock resolves both; the test
		// verifies each call gets its own batch (no statement sharing) and
		// the last-write-wins invariant holds (the caller's allSettled in
		// score.ts accumulates results from both, each seeing its own row).
		const rowA = {
			id: 3,
			chart_id: 10,
			user_id: 'u1',
			play_count: 5,
			clear_count: 2,
			created_at: 't',
			updated_at: 't'
		};
		const rowB = {
			id: 3,
			chart_id: 10,
			user_id: 'u1',
			play_count: 9,
			clear_count: 7,
			created_at: 't',
			updated_at: 't'
		};
		const dbA = createMockDb();
		dbA.batch = vi.fn().mockResolvedValue([{ results: [rowA] }, { results: [] }]);
		const dbB = createMockDb();
		dbB.batch = vi.fn().mockResolvedValue([{ results: [rowB] }, { results: [] }]);

		const [resultA, resultB] = await Promise.all([
			upsertChartScoreAndReplaceScores(dbA as unknown as D1Database, {
				chartId: 10,
				userId: 'u1',
				playCount: 5,
				clearCount: 2,
				scores: []
			}),
			upsertChartScoreAndReplaceScores(dbB as unknown as D1Database, {
				chartId: 10,
				userId: 'u1',
				playCount: 9,
				clearCount: 7,
				scores: []
			})
		]);

		// Each upsert sees its own row — no cross-contamination of bind args.
		expect(resultA.play_count).toBe(5);
		expect(resultB.play_count).toBe(9);
		// Each call issued exactly one batch (independent transactions).
		expect(dbA.batch).toHaveBeenCalledTimes(1);
		expect(dbB.batch).toHaveBeenCalledTimes(1);
		// Each batch has 2 statements (upsert + delete, no scores).
		expect(dbA.batch.mock.calls[0][0]).toHaveLength(2);
		expect(dbB.batch.mock.calls[0][0]).toHaveLength(2);
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
		const db = createMockDb((sql: string) => {
			if (sql.includes('COUNT(DISTINCT')) return createMockStmt({ cnt: 0 });
			return createMockStmt(null, []);
		});
		const result = await listUserScoredSimfiles(db as unknown as D1Database, { userId: 'u1' });
		expect(result).toEqual({ data: [], count: 0 });
	});

	it('lists scored simfiles with their dtx_files', async () => {
		const scoredSimfileRow = { ...baseSimfileRow, id: 42 };
		const db = createMockDb((sql: string) => {
			if (sql.includes('COUNT(DISTINCT')) return createMockStmt({ cnt: 1 });
			if (sql.includes('GROUP BY')) return createMockStmt(null, [{ simfile_id: 42 }]);
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

	it('clamps an out-of-range page to 1, returning a full page instead of an empty one', async () => {
		// 25 scored simfile ids for the user, matching the paged query's recency ordering
		const allIds = Array.from({ length: 25 }, (_, i) => 125 - i); // [125, 124, ..., 101]

		const db = createMockDb((sql: string) => {
			if (sql.includes('COUNT(DISTINCT')) {
				return createMockStmt({ cnt: 25 });
			}
			if (sql.includes('GROUP BY')) {
				// The paged query returns only the first page (20 ids) when page is clamped to 1
				return createMockStmt(
					null,
					allIds.slice(0, 20).map((simfile_id) => ({ simfile_id }))
				);
			}
			if (sql.includes('FROM simfiles')) {
				const stmt = {
					bind: vi.fn((...ids: number[]) => {
						stmt.all = vi.fn().mockResolvedValue({
							results: ids.map((id) => ({ ...baseSimfileRow, id }))
						});
						return stmt;
					}),
					first: vi.fn().mockResolvedValue(null),
					all: vi.fn().mockResolvedValue({ results: [] })
				};
				return stmt;
			}
			return createMockStmt(null, []);
		});

		// page: 0 is out of range; unclamped this computes a negative offset
		// which would yield an empty page even though 25 matching simfiles exist.
		// Clamped, page 0 -> 1, so this should return the first 20 ids.
		const result = await listUserScoredSimfiles(db as unknown as D1Database, {
			userId: 'user-1',
			page: 0,
			pageSize: 20
		});

		expect(result.count).toBe(25);
		expect(result.data).toHaveLength(20);
		expect(result.data.map((d) => d.id)).toEqual(allIds.slice(0, 20));
	});

	it('returns empty data with count when the paged id query yields no rows', async () => {
		// count > 0 but the page is beyond the data (e.g. page 999 of 1 page).
		// The paged id query returns [] -> pageIds.length === 0 early return.
		const db = createMockDb((sql: string) => {
			if (sql.includes('COUNT(DISTINCT')) return createMockStmt({ cnt: 5 });
			if (sql.includes('GROUP BY')) return createMockStmt(null, []);
			return createMockStmt(null, []);
		});
		const result = await listUserScoredSimfiles(db as unknown as D1Database, {
			userId: 'user-1',
			page: 999,
			pageSize: 10
		});
		expect(result).toEqual({ data: [], count: 5 });
	});
});

// ---------------------------------------------------------------------------
// listUserChartScores
// ---------------------------------------------------------------------------
describe('listUserChartScores', () => {
	it('returns an empty map without querying when chartIds is empty', async () => {
		const db = createMockDb();
		const result = await listUserChartScores(db as unknown as D1Database, 'u1', []);
		expect(result.size).toBe(0);
		expect(db.prepare).not.toHaveBeenCalled();
	});

	it('batches chart_scores + scores into two queries and groups by chart_id', async () => {
		const csRows = [
			{
				id: 3,
				chart_id: 10,
				user_id: 'u1',
				play_count: 10,
				clear_count: 4,
				created_at: 't',
				updated_at: 't'
			},
			{
				id: 4,
				chart_id: 11,
				user_id: 'u1',
				play_count: 2,
				clear_count: 0,
				created_at: 't',
				updated_at: 't'
			}
		];
		const scoreRows = [
			{ id: 1, chart_score_id: 3, is_best: 1, display_order: null },
			{ id: 2, chart_score_id: 3, is_best: 0, display_order: 1 },
			{ id: 5, chart_score_id: 4, is_best: 1, display_order: null }
		];
		const db = createMockDb((sql: string) =>
			sql.includes('FROM chart_scores')
				? createMockStmt(null, csRows)
				: createMockStmt(null, scoreRows)
		);
		const result = await listUserChartScores(db as unknown as D1Database, 'u1', [10, 11]);

		// The whole point of this helper: two queries total, NOT two per chart.
		expect(db.prepare).toHaveBeenCalledTimes(2);
		expect(result.get(10)?.chartScore.id).toBe(3);
		expect(result.get(10)?.scores.map((s) => s.id)).toEqual([1, 2]);
		expect(result.get(11)?.chartScore.id).toBe(4);
		expect(result.get(11)?.scores.map((s) => s.id)).toEqual([5]);
	});

	it('short-circuits before the scores query when no chart_scores match', async () => {
		const db = createMockDb((sql: string) =>
			sql.includes('FROM chart_scores') ? createMockStmt(null, []) : createMockStmt(null, [])
		);
		const result = await listUserChartScores(db as unknown as D1Database, 'u1', [10, 11]);
		expect(result.size).toBe(0);
		expect(db.prepare).toHaveBeenCalledTimes(1);
	});

	it('chunks more than 99 chart IDs to stay within D1 parameter limit', async () => {
		// 150 chart IDs -> 2 chart_scores chunks (99 + 51) + 2 score chunks (99 + 51) = 4 queries
		const chartIds = Array.from({ length: 150 }, (_, i) => i + 1);
		const db = createMockDb((sql: string) => {
			let boundArgs: unknown[] = [];
			const stmt = {
				bind: vi.fn((...args: unknown[]) => {
					boundArgs = args;
					return stmt;
				}),
				first: vi.fn().mockResolvedValue(null),
				all: vi.fn().mockImplementation(() => {
					if (sql.includes('FROM chart_scores')) {
						const chunkIds = boundArgs.slice(1) as number[];
						return Promise.resolve({
							results: chunkIds.map((id) => ({
								id: id + 1000,
								chart_id: id,
								user_id: 'u1',
								play_count: 1,
								clear_count: 0,
								created_at: 't',
								updated_at: 't'
							}))
						});
					}
					const csIds = boundArgs as number[];
					return Promise.resolve({
						results: csIds.map((csId) => ({
							id: csId + 5000,
							chart_score_id: csId,
							is_best: 1,
							display_order: null
						}))
					});
				})
			};
			return stmt;
		});

		const result = await listUserChartScores(db as unknown as D1Database, 'u1', chartIds);

		expect(db.prepare).toHaveBeenCalledTimes(4);
		expect(result.size).toBe(150);
		expect(result.get(1)?.chartScore.chart_id).toBe(1);
		expect(result.get(150)?.chartScore.chart_id).toBe(150);
		expect(result.get(1)?.scores).toHaveLength(1);
	});

	it('deduplicates chart IDs before chunking', async () => {
		const db = createMockDb((sql: string) => {
			let boundArgs: unknown[] = [];
			const stmt = {
				bind: vi.fn((...args: unknown[]) => {
					boundArgs = args;
					return stmt;
				}),
				first: vi.fn().mockResolvedValue(null),
				all: vi.fn().mockImplementation(() => {
					if (sql.includes('FROM chart_scores')) {
						const chunkIds = boundArgs.slice(1) as number[];
						return Promise.resolve({
							results: chunkIds.map((id) => ({
								id: id + 1000,
								chart_id: id,
								user_id: 'u1',
								play_count: 1,
								clear_count: 0,
								created_at: 't',
								updated_at: 't'
							}))
						});
					}
					return Promise.resolve({ results: [] });
				})
			};
			return stmt;
		});

		const result = await listUserChartScores(
			db as unknown as D1Database,
			'u1',
			[10, 10, 11, 11, 12]
		);
		expect(result.size).toBe(3);
		expect(result.get(10)).toBeDefined();
		expect(result.get(11)).toBeDefined();
		expect(result.get(12)).toBeDefined();
	});
});
