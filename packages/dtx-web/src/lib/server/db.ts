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
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import {
	type SQL,
	and,
	count as countRows,
	desc,
	eq,
	inArray,
	notInArray,
	or,
	sql
} from 'drizzle-orm';
import { dtxFiles, simfiles, userProfiles } from '$lib/server/db/schema';

// Re-export for convenience
export type { SimfileWithDtxFiles };

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
const createMockD1Database = (): D1Database => {
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

/** Get the D1 database binding from the platform env, providing a mock for local dev. */
export const getDb = (platform: App.Platform | undefined): D1Database => {
	const db = platform?.env?.DB;
	if (!db) {
		console.error(
			'CRITICAL: D1 database binding (DB) not available. All database reads will return empty data. ' +
				'Verify the DB binding is configured in wrangler.toml and the deployment environment. ' +
				'Use `bun run wrangler:dev` for full database functionality.'
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
		throw new Error('listSimfiles: count query returned no rows');
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
			level: dtxFiles.level,
			label: dtxFiles.label
		})
		.from(dtxFiles)
		.where(inArray(dtxFiles.simfileId, ids));

	const dtxMap = new Map<number, { level: number; label: string }[]>();
	for (const d of dtxRows) {
		const arr = dtxMap.get(d.simfile_id) ?? [];
		arr.push({ level: d.level, label: d.label });
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

	if (opts.excludeIds && opts.excludeIds.length > 0) {
		conditions.push(notInArray(simfiles.id, opts.excludeIds));
	}

	const limitRaw = opts.limit ?? 8;
	const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.trunc(limitRaw))) : 8;

	return orm
		.select({
			id: simfiles.id,
			title: simfiles.title,
			artist: simfiles.artist,
			bpm: simfiles.bpm,
			is_published: simfiles.isPublished
		})
		.from(simfiles)
		.where(and(...conditions))
		.limit(limit);
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
