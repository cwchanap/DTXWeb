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
				level: f.level,
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
