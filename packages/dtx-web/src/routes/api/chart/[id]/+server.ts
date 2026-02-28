import { json } from '@sveltejs/kit';
import { getDb, getSimfile, getSimfileOwner, updateSimfile } from '$lib/server/db';
import logger from '$lib/server/logger';

/** GET /api/chart/[id] — Get chart detail */
export async function GET({
	params,
	platform,
	locals
}: {
	params: { id: string };
	platform: App.Platform;
	locals: App.Locals;
}) {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = Number(params.id);
	if (!Number.isSafeInteger(id)) return json({ error: 'Invalid chart ID' }, { status: 400 });

	try {
		const db = getDb(platform);
		const simfile = await getSimfile(db, id);

		if (!simfile) return json({ error: 'Chart not found' }, { status: 404 });

		// Only owner or published charts are accessible
		if (simfile.user_id !== user.id && !simfile.is_published) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		return json(simfile);
	} catch (error) {
		logger.error('Error getting chart:', error);
		return json({ error: 'Failed to get chart' }, { status: 500 });
	}
}

/** PATCH /api/chart/[id] — Update chart */
export async function PATCH({
	params,
	request,
	platform,
	locals
}: {
	params: { id: string };
	request: Request;
	platform: App.Platform;
	locals: App.Locals;
}) {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = Number(params.id);
	if (!Number.isSafeInteger(id)) return json({ error: 'Invalid chart ID' }, { status: 400 });

	try {
		const db = getDb(platform);

		// Verify ownership
		const owner = await getSimfileOwner(db, id);
		if (!owner) return json({ error: 'Chart not found' }, { status: 404 });
		if (owner.user_id !== user.id) return json({ error: 'Forbidden' }, { status: 403 });

		const body = await request.json();

		// Map API fields to DB fields, converting boolean to integer
		const updateData: Record<string, unknown> = {};
		if (body.title !== undefined) updateData.title = body.title;
		if (body.artist !== undefined) updateData.artist = body.artist;
		if (body.bpm !== undefined) updateData.bpm = body.bpm;
		if (body.is_published !== undefined) updateData.is_published = body.is_published ? 1 : 0;
		if (body.isPublished !== undefined) updateData.is_published = body.isPublished ? 1 : 0;
		if (body.display_id !== undefined) updateData.display_id = body.display_id;
		if (body.displayId !== undefined) updateData.display_id = body.displayId;
		if (body.download_url !== undefined) updateData.download_url = body.download_url;
		if (body.downloadUrl !== undefined) updateData.download_url = body.downloadUrl;
		if (body.publish_date !== undefined) updateData.publish_date = body.publish_date;
		if (body.publishDate !== undefined) updateData.publish_date = body.publishDate;
		if (body.video_preview_url !== undefined)
			updateData.video_preview_url = body.video_preview_url;
		if (body.videoPreviewUrl !== undefined) updateData.video_preview_url = body.videoPreviewUrl;

		const updated = await updateSimfile(db, id, updateData);
		return json(updated);
	} catch (error) {
		logger.error('Error updating chart:', error);
		return json(
			{
				error: 'Failed to update chart',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
}
