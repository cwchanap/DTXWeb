import type {
	SimfileRow,
	SimfileInsert,
	SimfileUpdate,
	DtxFileRow,
	DtxFileInsert,
	UserProfileRow,
	UserProfileInsert,
	UserProfileUpdate,
	SimfileWithDtxFiles
} from '@dtx/common';
import type { D1Database } from '@cloudflare/workers-types';
import { toSimfileWithDtx } from '@dtx/common';

// Re-export for convenience
export type { SimfileWithDtxFiles };

/**
 * Mock D1Database for local development when Cloudflare bindings are not available.
 * This allows local development to continue without requiring wrangler dev.
 */
const createMockD1Database = (): D1Database => {
	const createMockStmt = () => {
		const stmt = {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			bind: (..._args: unknown[]) => stmt,
			first: async () => null,
			all: async () => ({ results: [] }),
			run: async () => ({ success: true, meta: { changes: 0, duration: 0 } }),
			raw: async () => ({ results: [] })
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

/** Get the D1 database binding from the platform env, providing a mock for local dev. */
export const getDb = (platform: App.Platform | undefined): D1Database => {
	const db = platform?.env?.DB;
	if (!db) {
		// Provide a fallback for local development (vite dev) when Cloudflare bindings are not available
		console.warn(
			'D1 database binding (DB) not available. Using mock database for local development. Use `bun run wrangler:dev` for full database functionality.'
		);
		return createMockD1Database();
	}
	return db;
};

// ---------------------------------------------------------------------------
// Simfiles
// ---------------------------------------------------------------------------

export const getSimfile = async (
	db: D1Database,
	id: number
): Promise<SimfileWithDtxFiles | null> => {
	const row = await db
		.prepare('SELECT * FROM simfiles WHERE id = ?')
		.bind(id)
		.first<SimfileRow>();
	if (!row) return null;

	const dtx = await db
		.prepare('SELECT level, label FROM dtx_files WHERE simfile_id = ?')
		.bind(id)
		.all<{ level: number; label: string }>();

	return toSimfileWithDtx(row, dtx.results);
};

export const getSimfileOwner = async (
	db: D1Database,
	id: number
): Promise<{ user_id: string; is_published: 0 | 1 } | null> => {
	return db
		.prepare('SELECT user_id, is_published FROM simfiles WHERE id = ?')
		.bind(id)
		.first<{ user_id: string; is_published: 0 | 1 }>();
};

export interface ListSimfilesOptions {
	userId?: string;
	publishedOnly?: boolean;
	search?: string;
	page?: number;
	pageSize?: number;
}

const escapeLikePattern = (value: string): string =>
	value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

export const listSimfiles = async (
	db: D1Database,
	opts: ListSimfilesOptions
): Promise<{ data: SimfileWithDtxFiles[]; count: number }> => {
	const conditions: string[] = [];
	const params: unknown[] = [];

	if (opts.userId) {
		conditions.push('s.user_id = ?');
		params.push(opts.userId);
	}
	if (opts.publishedOnly) {
		conditions.push('s.is_published = 1');
	}
	if (opts.search) {
		conditions.push("(s.title LIKE ? ESCAPE '\\' OR s.artist LIKE ? ESCAPE '\\')");
		const pattern = `%${escapeLikePattern(opts.search)}%`;
		params.push(pattern, pattern);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	const pageRaw = opts.page ?? 1;
	const pageSizeRaw = opts.pageSize ?? 20;
	const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
	const pageSize = Number.isFinite(pageSizeRaw)
		? Math.min(100, Math.max(1, Math.trunc(pageSizeRaw)))
		: 20;
	const offset = (page - 1) * pageSize;

	// Count query
	const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM simfiles s ${where}`);
	const countRow = await countStmt.bind(...params).first<{ cnt: number }>();
	const count = countRow?.cnt ?? 0;

	// Data query - only select public-safe fields when listing published charts
	const selectFields = opts.publishedOnly
		? 's.id, s.title, s.artist, s.bpm, s.is_published, s.display_id, s.download_url, s.preview_url, s.video_preview_url, s.publish_date, s.created_at, s.updated_at'
		: 's.*';
	const dataStmt = db.prepare(
		`SELECT ${selectFields} FROM simfiles s ${where} ORDER BY s.publish_date DESC LIMIT ? OFFSET ?`
	);
	const rows = await dataStmt.bind(...params, pageSize, offset).all<SimfileRow>();

	if (rows.results.length === 0) {
		return { data: [], count };
	}

	// Batch-fetch dtx_files for all returned simfiles
	const ids = rows.results.map((r) => r.id);
	const placeholders = ids.map(() => '?').join(',');
	const dtxRows = await db
		.prepare(
			`SELECT simfile_id, level, label FROM dtx_files WHERE simfile_id IN (${placeholders})`
		)
		.bind(...ids)
		.all<{ simfile_id: number; level: number; label: string }>();

	const dtxMap = new Map<number, { level: number; label: string }[]>();
	for (const d of dtxRows.results) {
		const arr = dtxMap.get(d.simfile_id) ?? [];
		arr.push({ level: d.level, label: d.label });
		dtxMap.set(d.simfile_id, arr);
	}

	const data = rows.results.map((r) => toSimfileWithDtx(r, dtxMap.get(r.id) ?? []));
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
	const conditions: string[] = ["(title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\')"];
	const pattern = `%${escapeLikePattern(opts.query)}%`;
	const params: unknown[] = [pattern, pattern];

	// Restrict to published charts or owned by the user
	if (opts.userId) {
		conditions.push('(is_published = 1 OR user_id = ?)');
		params.push(opts.userId);
	} else {
		// If no userId provided, only show published charts
		conditions.push('is_published = 1');
	}

	if (opts.excludeIds && opts.excludeIds.length > 0) {
		const placeholders = opts.excludeIds.map(() => '?').join(',');
		conditions.push(`id NOT IN (${placeholders})`);
		params.push(...opts.excludeIds);
	}

	const limitRaw = opts.limit ?? 8;
	const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.trunc(limitRaw))) : 8;
	const where = conditions.join(' AND ');

	return (
		await db
			.prepare(
				`SELECT id, title, artist, bpm, is_published FROM simfiles WHERE ${where} LIMIT ?`
			)
			.bind(...params, limit)
			.all<SearchSimfileResult>()
	).results;
};

export const createSimfile = async (db: D1Database, data: SimfileInsert): Promise<SimfileRow> => {
	const now = new Date().toISOString();
	const result = await db
		.prepare(
			`INSERT INTO simfiles (title, artist, bpm, user_id, is_published, display_id, download_url, preview_url, video_preview_url, publish_date, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 RETURNING *`
		)
		.bind(
			data.title ?? '',
			data.artist ?? '',
			data.bpm,
			data.user_id,
			data.is_published ?? 0,
			data.display_id ?? null,
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
	// Explicitly delete children first since D1 doesn't guarantee FK cascade PRAGMA applies
	const [, simfileResult] = await db.batch([
		db.prepare('DELETE FROM dtx_files WHERE simfile_id = ?').bind(id),
		db.prepare('DELETE FROM simfiles WHERE id = ?').bind(id)
	]);
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
