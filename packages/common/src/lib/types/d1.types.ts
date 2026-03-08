// D1 database row types — replaces Supabase Database type for D1/SQLite schema.
// These types mirror the D1 schema in d1-migrations/0001_initial_schema.sql.
// SQLite booleans are stored as INTEGER (0/1), timestamps as TEXT (ISO 8601).

export interface SimfileRow {
	id: number;
	title: string;
	artist: string;
	bpm: number;
	user_id: string;
	is_published: 0 | 1; // SQLite boolean
	display_id: number | null;
	download_url: string | null;
	preview_url: string | null;
	video_preview_url: string | null;
	publish_date: string;
	created_at: string;
	updated_at: string;
}

export interface SimfileInsert {
	title?: string;
	artist?: string;
	bpm: number;
	user_id: string;
	is_published?: 0 | 1;
	display_id?: number | null;
	download_url?: string | null;
	preview_url?: string | null;
	video_preview_url?: string | null;
	publish_date?: string;
}

export interface SimfileUpdate {
	title?: string;
	artist?: string;
	bpm?: number;
	is_published?: 0 | 1;
	display_id?: number | null;
	download_url?: string | null;
	preview_url?: string | null;
	video_preview_url?: string | null;
	publish_date?: string;
}

export interface DtxFileRow {
	id: number;
	label: string;
	level: number;
	simfile_id: number;
}

export interface DtxFileInsert {
	label?: string;
	level?: number;
	simfile_id: number;
}

export interface UserProfileRow {
	id: number;
	user_id: string;
	username: string;
}

export interface UserProfileInsert {
	user_id: string;
	username: string;
}

export interface UserProfileUpdate {
	username?: string;
}

/** Simfile with joined dtx_files — the API-facing shape with boolean is_published */
export interface SimfileWithDtxFiles extends Omit<SimfileRow, 'is_published'> {
	is_published: boolean;
	dtx_files: { level: number; label: string }[];
}

/** Simfile with joined dtx_files — desktop-compatible shape matching old Supabase type */
export interface SimfileWithDtx extends Omit<SimfileRow, 'is_published'> {
	is_published: boolean;
	dtx_files: Partial<DtxFileRow>[];
}

/** Convert a raw D1 simfile row (integer booleans) to the API-facing shape */
export const toSimfileWithDtx = (
	row: SimfileRow,
	dtxFiles: { level: number; label: string }[]
): SimfileWithDtxFiles => ({
	...row,
	is_published: row.is_published === 1,
	dtx_files: dtxFiles
});
