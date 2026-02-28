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
import { toSimfileWithDtx } from '@dtx/common';

// Re-export for convenience
export type { SimfileWithDtxFiles };

/** Get the D1 database binding from the platform env, throwing if unavailable. */
export const getDb = (platform: App.Platform | undefined): D1Database => {
	const db = platform?.env?.DB;
	if (!db) throw new Error('D1 database binding (DB) not available');
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
): Promise<{ user_id: string; is_published: number } | null> => {
	return db
		.prepare('SELECT user_id, is_published FROM simfiles WHERE id = ?')
		.bind(id)
		.first<{ user_id: string; is_published: number }>();
};

export interface ListSimfilesOptions {
	userId?: string;
	publishedOnly?: boolean;
	search?: string;
	page?: number;
	pageSize?: number;
}

export const listSimfiles = async (
	db: D1Database,
	opts: ListSimfilesOptions
): Promise<{ data: SimfileWithDtxFiles[]; count: number }> => {
	const conditions: string[] = [];
	const params: unknown[] = [];

	if (opts.userId && !opts.publishedOnly) {
		conditions.push('s.user_id = ?');
		params.push(opts.userId);
	}
	if (opts.publishedOnly) {
		conditions.push('s.is_published = 1');
	}
	if (opts.search) {
		conditions.push('(s.title LIKE ? OR s.artist LIKE ?)');
		const pattern = `%${opts.search}%`;
		params.push(pattern, pattern);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
	const page = opts.page ?? 1;
	const pageSize = opts.pageSize ?? 20;
	const offset = (page - 1) * pageSize;

	// Count query
	const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM simfiles s ${where}`);
	const countRow = await countStmt.bind(...params).first<{ cnt: number }>();
	const count = countRow?.cnt ?? 0;

	// Data query
	const dataStmt = db.prepare(
		`SELECT s.* FROM simfiles s ${where} ORDER BY s.publish_date DESC LIMIT ? OFFSET ?`
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
	excludeIds?: number[];
	limit?: number;
}

export const searchSimfiles = async (
	db: D1Database,
	opts: SearchSimfilesOptions
): Promise<SimfileRow[]> => {
	const conditions: string[] = ['(title LIKE ? OR artist LIKE ?)'];
	const pattern = `%${opts.query}%`;
	const params: unknown[] = [pattern, pattern];

	if (opts.excludeIds && opts.excludeIds.length > 0) {
		const placeholders = opts.excludeIds.map(() => '?').join(',');
		conditions.push(`id NOT IN (${placeholders})`);
		params.push(...opts.excludeIds);
	}

	const limit = opts.limit ?? 8;
	const where = conditions.join(' AND ');

	return (
		await db
			.prepare(
				`SELECT id, title, artist, bpm, is_published FROM simfiles WHERE ${where} LIMIT ?`
			)
			.bind(...params, limit)
			.all<SimfileRow>()
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
	// CASCADE on dtx_files FK handles child deletion
	await db.prepare('PRAGMA foreign_keys = ON').run();
	await db.prepare('DELETE FROM simfiles WHERE id = ?').bind(id).run();
};

// ---------------------------------------------------------------------------
// DTX Files
// ---------------------------------------------------------------------------

export const createDtxFiles = async (
	db: D1Database,
	files: DtxFileInsert[]
): Promise<DtxFileRow[]> => {
	if (files.length === 0) return [];

	const results: DtxFileRow[] = [];
	for (const f of files) {
		const row = await db
			.prepare(
				'INSERT INTO dtx_files (label, level, simfile_id) VALUES (?, ?, ?) RETURNING *'
			)
			.bind(f.label ?? '', f.level ?? 0, f.simfile_id)
			.first<DtxFileRow>();
		if (row) results.push(row);
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
