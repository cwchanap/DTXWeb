import type {
	SimfileRow,
	SimfileInsert,
	SimfileUpdate,
	DtxFileRow,
	DtxFileInsert,
	UserProfileRow,
	UserProfileInsert,
	UserProfileUpdate,
	SimfileWithDtxFiles,
	ChartScoreRow,
	ScoreRow,
	ScoreInsert
} from '../types/d1.types';
import type { D1Database } from '@cloudflare/workers-types';
import { toSimfileWithDtx } from '../types/d1.types';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { type SQL, and, count as countRows, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { dtxFiles, simfiles, userProfiles } from './db/schema';

const drizzleSchema = {
	simfiles,
	dtxFiles,
	userProfiles
};

export const createDrizzleDb = (db: D1Database): DrizzleD1Database<typeof drizzleSchema> =>
	drizzle(db, { schema: drizzleSchema });

/**
 * Mock D1Database for local development when Cloudflare bindings are not available.
 * This allows local development to continue without requiring wrangler dev.
 */
export const createMockD1Database = (): D1Database => {
	const createMockStmt = () => {
		const stmt = {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			bind: (..._args: unknown[]) => stmt,
			first: async () => null,
			all: async () => ({ results: [] }),
			run: async () => ({ success: true, meta: { changes: 0, duration: 0 } }),
			raw: async () => []
		};
		return stmt;
	};

	return {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		prepare: (_query: string) => createMockStmt(),
		batch: async (statements: unknown[]) => {
			// Simulate batch operations returning success
			return statements.map(() => ({
				success: true,
				meta: { changes: 0, duration: 0 },
				results: []
			})) as unknown as ReturnType<D1Database['batch']>;
		},
		exec: async () => ({ success: true, meta: { changes: 0, duration: 0 } }),
		dump: async () => [],
		withSession: () => createMockD1Database()
	} as unknown as D1Database;
};

// ---------------------------------------------------------------------------
// Simfiles
// ---------------------------------------------------------------------------

export const getSimfile = async (
	db: D1Database,
	id: number
): Promise<SimfileWithDtxFiles | null> => {
	const orm = createDrizzleDb(db);
	const [row] = await orm
		.select({
			id: simfiles.id,
			title: simfiles.title,
			artist: simfiles.artist,
			bpm: simfiles.bpm,
			user_id: simfiles.userId,
			is_published: simfiles.isPublished,
			display_id: simfiles.displayId,
			download_url: simfiles.downloadUrl,
			preview_url: simfiles.previewUrl,
			video_preview_url: simfiles.videoPreviewUrl,
			publish_date: simfiles.publishDate,
			created_at: simfiles.createdAt,
			updated_at: simfiles.updatedAt
		})
		.from(simfiles)
		.where(eq(simfiles.id, id))
		.limit(1);
	if (!row) return null;

	const dtx = await orm
		.select({
			id: dtxFiles.id,
			level: dtxFiles.level,
			label: dtxFiles.label
		})
		.from(dtxFiles)
		.where(eq(dtxFiles.simfileId, id));

	return toSimfileWithDtx(row, dtx);
};

export const getSimfileOwner = async (
	db: D1Database,
	id: number
): Promise<{ user_id: string; is_published: 0 | 1 } | null> => {
	const orm = createDrizzleDb(db);
	const [owner] = await orm
		.select({
			user_id: simfiles.userId,
			is_published: simfiles.isPublished
		})
		.from(simfiles)
		.where(eq(simfiles.id, id))
		.limit(1);

	return owner ?? null;
};

/**
 * Resolves visibility for many chart IDs in a single D1 query (chunked at 100
 * IDs per D1 parameter limit) so uploadScores does not issue one round-trip
 * per chart. Returns a map keyed by chart_id; IDs not found in the DB are
 * absent from the map.
 */
export const getChartVisibilityBatch = async (
	db: D1Database,
	chartIds: number[]
): Promise<Map<number, { user_id: string; is_published: 0 | 1 }>> => {
	const result = new Map<number, { user_id: string; is_published: 0 | 1 }>();
	const uniqueIds = [...new Set(chartIds)];
	if (uniqueIds.length === 0) return result;
	const CHUNK_SIZE = 100;
	for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
		const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
		const placeholders = chunk.map(() => '?').join(',');
		const { results } = await db
			.prepare(
				`SELECT d.id AS chart_id, s.user_id AS user_id, s.is_published AS is_published
				 FROM dtx_files d JOIN simfiles s ON s.id = d.simfile_id
				 WHERE d.id IN (${placeholders})`
			)
			.bind(...chunk)
			.all<{ chart_id: number; user_id: string; is_published: 0 | 1 }>();
		for (const row of results ?? []) {
			result.set(row.chart_id, { user_id: row.user_id, is_published: row.is_published });
		}
	}
	return result;
};

export interface ListSimfilesOptions {
	userId?: string;
	publishedOnly?: boolean;
	search?: string;
	page?: number;
	pageSize?: number;
}

export const escapeLikePattern = (value: string): string =>
	value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

export const listSimfiles = async (
	db: D1Database,
	opts: ListSimfilesOptions
): Promise<{ data: SimfileWithDtxFiles[]; count: number }> => {
	const orm = createDrizzleDb(db);
	const conditions: SQL[] = [];

	if (opts.userId) {
		conditions.push(eq(simfiles.userId, opts.userId));
	}
	if (opts.publishedOnly) {
		conditions.push(eq(simfiles.isPublished, 1));
	}
	if (opts.search) {
		const pattern = `%${escapeLikePattern(opts.search)}%`;
		conditions.push(
			sql`(${simfiles.title} LIKE ${pattern} ESCAPE '\\' OR ${simfiles.artist} LIKE ${pattern} ESCAPE '\\')`
		);
	}

	const pageRaw = opts.page ?? 1;
	const pageSizeRaw = opts.pageSize ?? 20;
	const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
	const pageSize = Number.isFinite(pageSizeRaw)
		? Math.min(100, Math.max(1, Math.trunc(pageSizeRaw)))
		: 20;
	const offset = (page - 1) * pageSize;
	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	const [countRow] = await orm.select({ cnt: countRows() }).from(simfiles).where(whereClause);
	if (countRow === undefined) {
		return { data: [], count: 0 };
	}
	const count = Number(countRow.cnt);

	const baseFields = {
		id: simfiles.id,
		title: simfiles.title,
		artist: simfiles.artist,
		bpm: simfiles.bpm,
		is_published: simfiles.isPublished,
		display_id: simfiles.displayId,
		download_url: simfiles.downloadUrl,
		preview_url: simfiles.previewUrl,
		video_preview_url: simfiles.videoPreviewUrl,
		publish_date: simfiles.publishDate,
		created_at: simfiles.createdAt,
		updated_at: simfiles.updatedAt
	};
	const selectFields = opts.publishedOnly
		? baseFields
		: { ...baseFields, user_id: simfiles.userId };
	const rows = await orm
		.select(selectFields)
		.from(simfiles)
		.where(whereClause)
		.orderBy(desc(simfiles.publishDate))
		.limit(pageSize)
		.offset(offset);

	if (rows.length === 0) {
		return { data: [], count };
	}

	const ids = rows.map((r) => r.id);
	const dtxRows = await orm
		.select({
			simfile_id: dtxFiles.simfileId,
			id: dtxFiles.id,
			level: dtxFiles.level,
			label: dtxFiles.label
		})
		.from(dtxFiles)
		.where(inArray(dtxFiles.simfileId, ids));

	const dtxMap = new Map<number, { id?: number; level: number; label: string }[]>();
	for (const d of dtxRows) {
		const arr = dtxMap.get(d.simfile_id) ?? [];
		arr.push({ id: d.id, level: d.level, label: d.label });
		dtxMap.set(d.simfile_id, arr);
	}

	const data = rows.map((r) => toSimfileWithDtx(r, dtxMap.get(r.id) ?? []));
	return { data, count };
};

export interface SearchSimfilesOptions {
	query: string;
	userId?: string;
	excludeIds?: number[];
	limit?: number;
}

export interface SearchSimfileResult {
	id: number;
	title: string;
	artist: string;
	bpm: number;
	is_published: 0 | 1;
}

export const searchSimfiles = async (
	db: D1Database,
	opts: SearchSimfilesOptions
): Promise<SearchSimfileResult[]> => {
	if (!opts.query?.trim()) return [];
	const orm = createDrizzleDb(db);
	const pattern = `%${escapeLikePattern(opts.query)}%`;
	const conditions: SQL[] = [
		sql`(${simfiles.title} LIKE ${pattern} ESCAPE '\\' OR ${simfiles.artist} LIKE ${pattern} ESCAPE '\\')`
	];

	if (opts.userId) {
		conditions.push(or(eq(simfiles.isPublished, 1), eq(simfiles.userId, opts.userId)) as SQL);
	} else {
		conditions.push(eq(simfiles.isPublished, 1));
	}

	const excludeIds = opts.excludeIds ?? [];
	const excludeSet = new Set(excludeIds);

	const limitRaw = opts.limit ?? 8;
	const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.trunc(limitRaw))) : 8;

	// Over-fetch SQL by the number of excluded IDs so that valid unlinked
	// rows sitting just past the requested page are not hidden behind
	// excluded rows that filled the SQL result set. Without this, a query
	// matching 60 rows where the first 50 are already linked would return
	// 50 excluded rows, the JS filter would drop all of them, and the
	// caller would see a false "no results" even though row 51 is valid.
	// The caller still gets at most `limit` usable rows after filtering;
	// the cap keeps the result set bounded for this personal app (full
	// pagination is unnecessary). Filtering excluded IDs in JavaScript
	// also avoids the Cloudflare D1 bound-parameter limit (100/statement)
	// that previously capped SQL NOT IN at 90 IDs.
	const SQL_LIMIT_CAP = 200;
	const sqlLimit = Math.min(SQL_LIMIT_CAP, limit + excludeIds.length);

	const rows = await orm
		.select({
			id: simfiles.id,
			title: simfiles.title,
			artist: simfiles.artist,
			bpm: simfiles.bpm,
			is_published: simfiles.isPublished
		})
		.from(simfiles)
		.where(and(...conditions))
		.limit(sqlLimit);

	if (excludeIds.length > 0) {
		return rows.filter((r) => !excludeSet.has(r.id)).slice(0, limit);
	}
	return rows.slice(0, limit);
};

export const getNextDisplayId = async (db: D1Database, userId: string): Promise<number> => {
	const row = await db
		.prepare('SELECT MAX(display_id) AS max_display_id FROM simfiles WHERE user_id = ?')
		.bind(userId)
		.first<{ max_display_id: number | string | null }>();
	const current = Number(row?.max_display_id ?? 0);
	if (!Number.isFinite(current) || !Number.isSafeInteger(current)) {
		throw new Error('Invalid max display_id');
	}
	const next = current + 1;
	if (!Number.isFinite(next) || !Number.isSafeInteger(next)) {
		throw new Error('Invalid next display_id');
	}
	return next;
};

export const createSimfile = async (db: D1Database, data: SimfileInsert): Promise<SimfileRow> => {
	const now = new Date().toISOString();
	const displayId = data.display_id ?? null;
	const result = await db
		.prepare(
			`INSERT INTO simfiles (title, artist, bpm, user_id, is_published, display_id, download_url, preview_url, video_preview_url, publish_date, created_at, updated_at)
			 SELECT ?, ?, ?, ?, ?,
				CASE
					WHEN ? IS NULL OR ? = 0 THEN COALESCE((SELECT MAX(display_id) FROM simfiles WHERE user_id = ?), 0) + 1
					ELSE ?
				END,
				?, ?, ?, ?, ?, ?
			 RETURNING *`
		)
		.bind(
			data.title ?? '',
			data.artist ?? '',
			data.bpm,
			data.user_id,
			data.is_published ?? 0,
			displayId,
			displayId,
			data.user_id,
			displayId,
			data.download_url ?? null,
			data.preview_url ?? null,
			data.video_preview_url ?? null,
			data.publish_date ?? now,
			now,
			now
		)
		.first<SimfileRow>();

	if (!result) throw new Error('Failed to create simfile');
	return result;
};

export const updateSimfile = async (
	db: D1Database,
	id: number,
	data: SimfileUpdate
): Promise<SimfileRow> => {
	const fields: string[] = [];
	const params: unknown[] = [];

	const addField = (name: string, value: unknown) => {
		if (value !== undefined) {
			fields.push(`${name} = ?`);
			params.push(value);
		}
	};

	addField('title', data.title);
	addField('artist', data.artist);
	addField('bpm', data.bpm);
	addField('is_published', data.is_published);
	addField('display_id', data.display_id);
	addField('download_url', data.download_url);
	addField('preview_url', data.preview_url);
	addField('video_preview_url', data.video_preview_url);
	addField('publish_date', data.publish_date);

	if (fields.length === 0) throw new Error('No fields to update');

	// Always update updated_at
	fields.push('updated_at = ?');
	params.push(new Date().toISOString());

	params.push(id);

	const result = await db
		.prepare(`UPDATE simfiles SET ${fields.join(', ')} WHERE id = ? RETURNING *`)
		.bind(...params)
		.first<SimfileRow>();

	if (!result) throw new Error('Simfile not found');
	return result;
};

export const deleteSimfile = async (db: D1Database, id: number): Promise<void> => {
	// Explicitly delete children first since D1 doesn't guarantee FK cascade PRAGMA applies.
	// Order matters: scores -> chart_scores (both keyed off dtx_files via subqueries) must
	// run before dtx_files is deleted, since they resolve simfile -> chart via dtx_files.id.
	//
	// Compatibility: scores and chart_scores are introduced by 0002_scores.sql. A D1
	// that only has 0001_initial_schema.sql applied (e.g. a fresh local `wrangler dev`
	// database before `wrangler d1 migrations apply` has run) would fail the batch with
	// "no such table: scores", breaking both direct simfile deletion and the
	// createSimfileWithDtx rollback path. Probe sqlite_master once and only include the
	// child DELETEs when their tables exist; the dtx_files/simfiles DELETEs always run.
	const tableCheck = await db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('scores', 'chart_scores')"
		)
		.all<{ name: string }>();
	const existing = new Set(tableCheck.results.map((r) => r.name));

	const statements: ReturnType<D1Database['prepare']>[] = [];
	if (existing.has('scores')) {
		statements.push(
			db
				.prepare(
					'DELETE FROM scores WHERE chart_score_id IN (SELECT id FROM chart_scores WHERE chart_id IN (SELECT id FROM dtx_files WHERE simfile_id = ?))'
				)
				.bind(id)
		);
	}
	if (existing.has('chart_scores')) {
		statements.push(
			db
				.prepare(
					'DELETE FROM chart_scores WHERE chart_id IN (SELECT id FROM dtx_files WHERE simfile_id = ?)'
				)
				.bind(id)
		);
	}
	statements.push(db.prepare('DELETE FROM dtx_files WHERE simfile_id = ?').bind(id));
	statements.push(db.prepare('DELETE FROM simfiles WHERE id = ?').bind(id));

	const results = await db.batch(statements);
	const simfileResult = results[results.length - 1];
	if (simfileResult.meta.changes === 0) throw new Error('Simfile not found');
};

// ---------------------------------------------------------------------------
// DTX Files
// ---------------------------------------------------------------------------

export const createDtxFiles = async (
	db: D1Database,
	files: DtxFileInsert[]
): Promise<DtxFileRow[]> => {
	if (files.length === 0) return [];

	// Use batched inserts to reduce latency and round-trips to D1
	const statements = files.map((f) =>
		db
			.prepare(
				'INSERT INTO dtx_files (label, level, simfile_id) VALUES (?, ?, ?) RETURNING *'
			)
			.bind(f.label ?? '', f.level ?? 0, f.simfile_id)
	);
	const batchResults = await db.batch(statements);
	const results: DtxFileRow[] = [];
	for (let i = 0; i < batchResults.length; i++) {
		const result = batchResults[i] as { results?: unknown[] };
		const row = (result.results?.[0] ?? null) as DtxFileRow | null;
		if (!row) {
			throw new Error(`Failed to insert dtx_file for simfile_id=${files[i]?.simfile_id}`);
		}
		results.push(row);
	}
	return results;
};

// ---------------------------------------------------------------------------
// User Profiles
// ---------------------------------------------------------------------------

export const getUserProfile = async (
	db: D1Database,
	userId: string
): Promise<UserProfileRow | null> => {
	return db
		.prepare('SELECT * FROM user_profiles WHERE user_id = ?')
		.bind(userId)
		.first<UserProfileRow>();
};

export const upsertUserProfile = async (
	db: D1Database,
	data: UserProfileInsert
): Promise<UserProfileRow> => {
	const result = await db
		.prepare(
			`INSERT INTO user_profiles (user_id, username) VALUES (?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET username = excluded.username
			 RETURNING *`
		)
		.bind(data.user_id, data.username)
		.first<UserProfileRow>();

	if (!result) throw new Error('Failed to upsert user profile');
	return result;
};

export const updateUserProfile = async (
	db: D1Database,
	userId: string,
	data: UserProfileUpdate
): Promise<UserProfileRow | null> => {
	if (!data.username) return getUserProfile(db, userId);

	return db
		.prepare('UPDATE user_profiles SET username = ? WHERE user_id = ? RETURNING *')
		.bind(data.username, userId)
		.first<UserProfileRow>();
};

// ---------------------------------------------------------------------------
// Chart Scores
// ---------------------------------------------------------------------------

/**
 * Atomic chart-score replacement: upserts the chart_scores aggregate row and
 * replaces all its scores in a single D1 batch (one transaction), so no partial
 * replacement can commit if any statement fails. The delete and inserts resolve
 * chart_score_id via a subquery on (user_id, chart_id) since D1's batch API
 * cannot pipe one statement's RETURNING output into the next.
 *
 * Returns the upserted ChartScoreRow (from the first statement's RETURNING).
 */
export const upsertChartScoreAndReplaceScores = async (
	db: D1Database,
	params: {
		chartId: number;
		userId: string;
		playCount: number;
		clearCount: number;
		scores: ScoreInsert[];
	}
): Promise<ChartScoreRow> => {
	const now = new Date().toISOString();
	const { chartId, userId, playCount, clearCount, scores } = params;

	// The subquery resolves the chart_score_id at execution time within the
	// transaction, so the delete/inserts always target the upserted row. The
	// EXISTS check mirrors the first statement's visibility gate: it requires
	// the chart to still exist in dtx_files AND remain visible to the caller
	// (published OR owned by them). If the chart is deleted — or unpublished
	// by its owner and the caller is a non-owner — between the visibility
	// check in score.ts and this batch (TOCTOU), the subquery returns NULL
	// even when a chart_scores row already exists from a prior upload, so the
	// DELETE and INSERT-score statements are true no-ops (not partial writes
	// that replace scores while leaving a stale aggregate).
	const resolveChartScoreId = `(SELECT id FROM chart_scores WHERE user_id = ? AND chart_id = ? AND EXISTS (SELECT 1 FROM dtx_files d JOIN simfiles s ON s.id = d.simfile_id WHERE d.id = chart_scores.chart_id AND (s.is_published = 1 OR s.user_id = ?)))`;

	const statements = [
		db
			.prepare(
				`INSERT INTO chart_scores
					(chart_id, user_id, play_count, clear_count, created_at, updated_at)
				 SELECT ?, ?, ?, ?, ?, ?
				 FROM dtx_files d JOIN simfiles s ON s.id = d.simfile_id
				 WHERE d.id = ? AND (s.is_published = 1 OR s.user_id = ?)
				 ON CONFLICT(user_id, chart_id) DO UPDATE SET
					play_count = excluded.play_count,
					clear_count = excluded.clear_count,
					updated_at = excluded.updated_at
				 RETURNING *`
			)
			// The trailing chartId + userId gate the upsert on the chart still
			// being VISIBLE to the caller at write time (TOCTOU: a chart
			// deleted, or unpublished by its owner while the caller is a
			// non-owner, between the visibility check in score.ts and this
			// batch would otherwise orphan/alter a chart_scores row, since D1
			// does not reliably enforce FK cascades — see 0002_scores.sql). If
			// the chart is no longer visible, the SELECT returns 0 rows, the
			// upsert is a no-op, RETURNING yields nothing, and the function
			// throws — caught by the caller's allSettled as a "write failed"
			// skip. The resolveChartScoreId subquery carries the same
			// visibility gate, so the DELETE and INSERT-score statements are
			// also no-ops — no partial write commits.
			.bind(chartId, userId, playCount, clearCount, now, now, chartId, userId),
		db
			.prepare(`DELETE FROM scores WHERE chart_score_id = ${resolveChartScoreId}`)
			.bind(userId, chartId, userId),
		...scores.map((s) =>
			db
				.prepare(
					`INSERT INTO scores
						(chart_score_id, is_best, score, achievement_rate, rank_label,
						 full_combo, cleared, max_combo, perfect, great, good, poor, miss,
						 performed_at, display_order)
					 SELECT ${resolveChartScoreId}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?`
				)
				.bind(
					userId,
					chartId,
					userId,
					s.is_best ? 1 : 0,
					s.score ?? null,
					s.achievement_rate ?? null,
					s.rank_label ?? null,
					s.full_combo ? 1 : 0,
					s.cleared ? 1 : 0,
					s.max_combo ?? null,
					s.perfect ?? null,
					s.great ?? null,
					s.good ?? null,
					s.poor ?? null,
					s.miss ?? null,
					s.performed_at ?? null,
					s.display_order ?? null
				)
		)
	];

	const batchResults = await db.batch(statements);
	const chartScore = (batchResults[0] as { results?: unknown[] }).results?.[0] as
		| ChartScoreRow
		| undefined;
	if (!chartScore) throw new Error('Failed to upsert chart_score');
	return chartScore;
};

export const getUserChartScore = async (
	db: D1Database,
	userId: string,
	chartId: number
): Promise<{ chartScore: ChartScoreRow; scores: ScoreRow[] } | null> => {
	const chartScore = await db
		.prepare('SELECT * FROM chart_scores WHERE user_id = ? AND chart_id = ? LIMIT 1')
		.bind(userId, chartId)
		.first<ChartScoreRow>();
	if (!chartScore) return null;
	const { results } = await db
		.prepare(
			`SELECT * FROM scores WHERE chart_score_id = ?
			 ORDER BY is_best DESC, display_order ASC`
		)
		.bind(chartScore.id)
		.all<ScoreRow>();
	return { chartScore, scores: results ?? [] };
};

export const listUserScoredSimfiles = async (
	db: D1Database,
	options: { userId: string; page?: number; pageSize?: number }
): Promise<{ data: SimfileWithDtxFiles[]; count: number }> => {
	const pageRaw = options.page ?? 1;
	const pageSizeRaw = options.pageSize ?? 20;
	const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
	const pageSize = Number.isFinite(pageSizeRaw)
		? Math.min(100, Math.max(1, Math.trunc(pageSizeRaw)))
		: 20;
	const offset = (page - 1) * pageSize;

	// Count distinct scored simfiles without fetching all IDs into memory.
	// Apply the visibility filter: a simfile is visible if it is published or
	// owned by the caller. This prevents an unpublish from leaking a simfile's
	// title/artist to someone who previously scored it.
	const countRow = await db
		.prepare(
			`SELECT COUNT(DISTINCT d.simfile_id) AS cnt
			 FROM chart_scores cs
			 JOIN dtx_files d ON d.id = cs.chart_id
			 JOIN simfiles s ON s.id = d.simfile_id
			 WHERE cs.user_id = ? AND (s.is_published = 1 OR s.user_id = ?)`
		)
		.bind(options.userId, options.userId)
		.first<{ cnt: number }>();
	const count = countRow?.cnt ?? 0;
	if (count === 0) return { data: [], count: 0 };

	// Page at the SQL level: only fetch the IDs for the requested page.
	const { results: idRows } = await db
		.prepare(
			`SELECT d.simfile_id AS simfile_id
			 FROM chart_scores cs
			 JOIN dtx_files d ON d.id = cs.chart_id
			 JOIN simfiles s ON s.id = d.simfile_id
			 WHERE cs.user_id = ? AND (s.is_published = 1 OR s.user_id = ?)
			 GROUP BY d.simfile_id
			 ORDER BY MAX(cs.updated_at) DESC, d.simfile_id DESC
			 LIMIT ? OFFSET ?`
		)
		.bind(options.userId, options.userId, pageSize, offset)
		.all<{ simfile_id: number }>();

	const pageIds = (idRows ?? []).map((r) => r.simfile_id);
	if (pageIds.length === 0) return { data: [], count };
	const placeholders = pageIds.map(() => '?').join(',');

	// The simfile fetch does NOT re-apply the visibility filter: the paged ID
	// query above already filtered by (is_published = 1 OR user_id = ?), so
	// every ID in pageIds is already visible to the caller. Re-filtering here
	// would be redundant (and would silently drop a simfile if it were
	// unpublished between the two queries — but that TOCTOU window is
	// acceptable: the simfile was visible when the page was computed, and the
	// next page request will exclude it).
	const { results: simfileRows } = await db
		.prepare(`SELECT * FROM simfiles WHERE id IN (${placeholders})`)
		.bind(...pageIds)
		.all<SimfileRow>();

	const { results: dtxRows } = await db
		.prepare(
			`SELECT id, label, level, simfile_id FROM dtx_files WHERE simfile_id IN (${placeholders})`
		)
		.bind(...pageIds)
		.all<DtxFileRow>();

	// Preserve the recency order from the paged ID query (MAX(updated_at) DESC)
	// instead of falling back to id ordering.
	const simfileById = new Map((simfileRows ?? []).map((r) => [r.id, r]));
	const data = pageIds
		.map((id) => simfileById.get(id))
		.filter((row): row is SimfileRow => !!row)
		.map((row) =>
			toSimfileWithDtx(
				row,
				(dtxRows ?? [])
					.filter((d) => d.simfile_id === row.id)
					.map((d) => ({ id: d.id, level: d.level, label: d.label }))
			)
		);

	return { data, count };
};

/**
 * Batched sibling of getUserChartScore: fetches the caller's chart_scores +
 * their scores for many charts at once. Two D1 queries per 99-chart chunk
 * (one for the aggregate rows, one for all their scores), so a scored-simfiles
 * page does not fan out into 2 queries per chart. D1 limits each statement to
 * 100 bound parameters; the userId bind leaves 99 slots per chunk.
 * Returned map is keyed by chart_id; scores are best-first then display_order.
 */
export const listUserChartScores = async (
	db: D1Database,
	userId: string,
	chartIds: number[]
): Promise<Map<number, { chartScore: ChartScoreRow; scores: ScoreRow[] }>> => {
	const result = new Map<number, { chartScore: ChartScoreRow; scores: ScoreRow[] }>();
	// Deduplicate so repeated IDs don't waste bind slots or produce duplicate rows.
	const uniqueChartIds = [...new Set(chartIds)];
	if (uniqueChartIds.length === 0) return result;

	// D1 limits each statement to 100 bound parameters. The chart_scores query
	// also binds userId, so each chunk can hold at most 99 chart IDs.
	const CHUNK_SIZE = 99;
	const chartScores: ChartScoreRow[] = [];
	for (let i = 0; i < uniqueChartIds.length; i += CHUNK_SIZE) {
		const chunk = uniqueChartIds.slice(i, i + CHUNK_SIZE);
		const placeholders = chunk.map(() => '?').join(',');
		const { results } = await db
			.prepare(
				`SELECT * FROM chart_scores WHERE user_id = ? AND chart_id IN (${placeholders})`
			)
			.bind(userId, ...chunk)
			.all<ChartScoreRow>();
		chartScores.push(...(results ?? []));
	}
	if (chartScores.length === 0) return result;

	// Chunk the score query by chart_score_id, staying within the 100-param limit.
	const scoreRows: ScoreRow[] = [];
	for (let i = 0; i < chartScores.length; i += CHUNK_SIZE) {
		const chunk = chartScores.slice(i, i + CHUNK_SIZE);
		const placeholders = chunk.map(() => '?').join(',');
		const { results } = await db
			.prepare(
				`SELECT * FROM scores WHERE chart_score_id IN (${placeholders})
				 ORDER BY is_best DESC, display_order ASC`
			)
			.bind(...chunk.map((c) => c.id))
			.all<ScoreRow>();
		scoreRows.push(...(results ?? []));
	}

	const scoresByChartScoreId = new Map<number, ScoreRow[]>();
	for (const s of scoreRows) {
		const list = scoresByChartScoreId.get(s.chart_score_id);
		if (list) list.push(s);
		else scoresByChartScoreId.set(s.chart_score_id, [s]);
	}

	for (const cs of chartScores) {
		result.set(cs.chart_id, {
			chartScore: cs,
			scores: scoresByChartScoreId.get(cs.id) ?? []
		});
	}
	return result;
};
