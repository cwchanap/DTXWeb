import { json } from '@sveltejs/kit';
import { getDb, listSimfiles, createSimfile, createDtxFiles } from '$lib/server/db';
import { toSimfileWithDtx } from '@dtx/common';
import logger from '$lib/server/logger';

/** GET /api/chart — List charts (paginated, filtered) */
export async function GET({
	url,
	platform,
	locals
}: {
	url: URL;
	platform: App.Platform;
	locals: App.Locals;
}) {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const db = getDb(platform);
		const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
		const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20)));
		const search = url.searchParams.get('search') || undefined;
		const scope = url.searchParams.get('scope') ?? 'mine';

		const { data, count } = await listSimfiles(db, {
			userId: scope === 'mine' ? user.id : undefined,
			publishedOnly: scope === 'published',
			search,
			page,
			pageSize
		});

		return json({ data, count });
	} catch (error) {
		logger.error('Error listing charts:', error);
		return json({ error: 'Failed to list charts' }, { status: 500 });
	}
}

/** POST /api/chart — Create a new chart */
export async function POST({
	request,
	platform,
	locals
}: {
	request: Request;
	platform: App.Platform;
	locals: App.Locals;
}) {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	try {
		const db = getDb(platform);
		const body = await request.json();

		const simfile = await createSimfile(db, {
			title: body.title ?? '',
			artist: body.artist ?? '',
			bpm: body.bpm,
			user_id: user.id,
			is_published: body.isPublished ? 1 : 0,
			display_id: body.displayId ?? null,
			download_url: body.downloadUrl ?? null,
			video_preview_url: body.videoPreviewUrl ?? null,
			publish_date: body.publishDate
		});

		// Insert dtx_files if provided (accepts either "dtx_files" or "levels" key)
		let dtxFiles: { level: number; label: string }[] = [];
		const dtxInput = body.dtx_files ?? body.levels;
		if (Array.isArray(dtxInput) && dtxInput.length > 0) {
			const created = await createDtxFiles(
				db,
				dtxInput.map((l: { label: string; level: number }) => ({
					label: l.label,
					level: l.level,
					simfile_id: simfile.id
				}))
			);
			dtxFiles = created.map((d) => ({ level: d.level, label: d.label }));
		}

		return json(toSimfileWithDtx(simfile, dtxFiles), { status: 201 });
	} catch (error) {
		logger.error('Error creating chart:', error);
		return json(
			{
				error: 'Failed to create chart',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
}
