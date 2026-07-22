import type { D1Database } from '@cloudflare/workers-types';
import { createSimfile, createDtxFiles, deleteSimfile, type SimfileRow } from '@dtx/common/server';

export type CreateSimfileArgs = {
	userId: string;
	title: string;
	artist: string;
	bpm: number;
	isPublished: boolean;
	displayId: number | null;
	downloadUrl: string | null;
	previewUrl: string | null;
	videoPreviewUrl: string | null;
	publishDate?: string;
	dtxFiles: { label: string; level: number }[];
};

export type CreateSimfileResult = {
	simfile: SimfileRow;
	dtxFiles: { id?: number; label: string; level: number }[];
};

/**
 * Normalize a raw incoming `dtx_files.level` to the encoded storage contract.
 *
 * The canonical storage form is an encoded integer on the ×10 scale (e.g. 50 ==
 * 5.0) or ×100 scale (> 100, e.g. 550 == 5.5). Pre-b2ccaaab desktop clients
 * stored the raw #DLEVEL display-scale value (e.g. 5) directly, and those rows
 * are decoded by `normalizeCloudLevel` / `formatLevel` as 0.05 (×100 scale) —
 * failing auto-matching and displaying "0.05" for a real level-5 chart. D1
 * migration 0004 multiplies legacy rows by 100, but already-installed old
 * clients keep writing raw values after the migration runs; this guard at the
 * API write boundary normalizes such legacy inputs so old clients cannot
 * reintroduce charts that the new matchers/formatters misinterpret.
 *
 * - Bare integer 1–9 → ×100 (legacy display-scale value; 5 → 500 → 5.0).
 *   DTX levels range 0.1–9.99, so 1–9 on the ×100 scale (0.01–0.09) is below
 *   the minimum — unambiguously legacy, not an intentional sub-0.1 level.
 * - Integer ≥ 10, 0, or non-integer → left as-is (already encoded, the column
 *   default, or a stray display-scale decimal that `formatLevel` handles).
 */
const normalizeLegacyLevel = (level: number): number =>
	Number.isInteger(level) && level >= 1 && level <= 9 ? level * 100 : level;

export const createSimfileWithDtx = async (
	db: D1Database,
	args: CreateSimfileArgs
): Promise<CreateSimfileResult> => {
	const simfile = await createSimfile(db, {
		title: args.title,
		artist: args.artist,
		bpm: args.bpm,
		user_id: args.userId,
		is_published: args.isPublished ? 1 : 0,
		display_id: args.displayId,
		download_url: args.downloadUrl,
		preview_url: args.previewUrl,
		video_preview_url: args.videoPreviewUrl,
		publish_date: args.publishDate
	});

	if (args.dtxFiles.length === 0) {
		return { simfile, dtxFiles: [] };
	}

	try {
		const created = await createDtxFiles(
			db,
			args.dtxFiles.map((f) => ({
				label: f.label,
				level: normalizeLegacyLevel(f.level),
				simfile_id: simfile.id
			}))
		);
		return {
			simfile,
			dtxFiles: created.map((d) => ({ id: d.id, label: d.label, level: d.level }))
		};
	} catch (err) {
		try {
			await deleteSimfile(db, simfile.id);
		} catch (rollbackErr) {
			// Attach rollback error as cause so both errors are visible during triage.
			if (err instanceof Error) {
				err.cause = rollbackErr;
			}
		}
		throw err;
	}
};
