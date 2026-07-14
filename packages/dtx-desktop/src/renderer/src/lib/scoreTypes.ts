import type { CloudChart } from './scoreMatching';

export interface ScorePayload {
	isBest: boolean;
	score: number | null;
	achievementRate: number | null;
	rankLabel: string | null;
	fullCombo: boolean;
	cleared: boolean;
	maxCombo: number | null;
	perfect: number | null;
	great: number | null;
	good: number | null;
	poor: number | null;
	miss: number | null;
	performedAt: string | null;
	displayOrder: number | null;
}

export interface LocalChartData {
	difficultyLevel: number;
	difficultyLabel: string;
	drumLevel: number;
	fileHash: string;
	aggregate: { playCount: number; clearCount: number };
	best: ScorePayload | null;
	recent: ScorePayload[];
}

export interface DtxmaniaSong {
	title: string;
	artist: string;
	genre: string;
	charts: LocalChartData[];
}

export interface CloudSong {
	id: string;
	title: string;
	artist: string;
	is_published: boolean;
}

// ---------------------------------------------------------------------------
// API result envelopes (Rust → renderer IPC)
//
// The Rust backend (api.rs) wraps every IPC response in one of two shapes:
//   api_success: { success: true,  data: Value }
//   api_failure: { success: false, error: String }
// fetch_cloud_song is the one exception: it uses `cloudSongData` instead of
// `data` (api.rs:817-820). These envelope types are hoisted here so call
// sites don't re-declare them inline (drift risk). The generic `ApiResult<T>`
// covers the standard `data` envelope; `FetchCloudSongResult<T>` covers the
// `cloudSongData` variant.
// ---------------------------------------------------------------------------

/** Standard IPC envelope: `{ success, data?, error? }`. */
export interface ApiResult<T> {
	success: boolean;
	data?: T;
	error?: string;
}

/** A chart excluded from an upload batch (client-side dedup or server-side skip). */
export interface SkippedChart {
	chartId: string;
	reason: string;
}

/** Payload inside `UploadScoresResult.data` on success. */
export interface UploadScoresData {
	updatedCharts: number;
	insertedScores: number;
	skipped: SkippedChart[];
}

/** Raw `cloudSongData` shape returned by the `fetch_cloud_song` IPC command. */
export interface CloudSongData {
	id: number;
	title: string;
	artist: string;
	is_published: boolean;
}

/**
 * `fetch_cloud_song` envelope. Uses `cloudSongData` (not `data`) to match the
 * Rust side (api.rs:817-820). Generic over the payload shape so call sites
 * that need richer simfile fields (e.g. SongDetails.svelte) can substitute
 * their own type while sharing the envelope structure.
 */
export interface FetchCloudSongResult<T = CloudSongData> {
	success: boolean;
	cloudSongData?: T;
	error?: string;
}

/** `fetch_cloud_song_charts` envelope. */
export type FetchCloudSongChartsResult = ApiResult<CloudChart[]>;

/** `upload_scores` envelope. */
export type UploadScoresResult = ApiResult<UploadScoresData>;
