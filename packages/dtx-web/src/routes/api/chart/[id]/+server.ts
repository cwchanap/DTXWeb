import { json } from '@sveltejs/kit';
import { getDb, getSimfile, getSimfileOwner, updateSimfile } from '$lib/server/db';
import { logger } from '@dtx/common/server';

/** GET /api/chart/[id] — Get chart detail */
export const GET = async ({
	params,
	platform,
	locals
}: {
	params: { id: string };
	platform: App.Platform;
	locals: App.Locals;
}) => {
	const user = locals.user;

	const id = Number(params.id);
	if (!Number.isSafeInteger(id)) return json({ error: 'Invalid chart ID' }, { status: 400 });

	try {
		const db = getDb(platform);
		const simfile = await getSimfile(db, id);

		if (!simfile) return json({ error: 'Chart not found' }, { status: 404 });
		if (simfile.is_published) return json(simfile);
		if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

		// Unpublished charts are only accessible by owner
		if (simfile.user_id !== user.id) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		return json(simfile);
	} catch (error) {
		logger.error('Error getting chart:', error);
		return json({ error: 'Failed to get chart' }, { status: 500 });
	}
};

/** PATCH /api/chart/[id] — Update chart */
export const PATCH = async ({
	params,
	request,
	platform,
	locals
}: {
	params: { id: string };
	request: Request;
	platform: App.Platform;
	locals: App.Locals;
}) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const id = Number(params.id);
	if (!Number.isSafeInteger(id)) return json({ error: 'Invalid chart ID' }, { status: 400 });

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const payload = body as Record<string, unknown>;

	try {
		const db = getDb(platform);

		// Verify ownership
		const owner = await getSimfileOwner(db, id);
		if (!owner) return json({ error: 'Chart not found' }, { status: 404 });
		if (owner.user_id !== user.id) return json({ error: 'Forbidden' }, { status: 403 });

		// Map API fields to DB fields, converting boolean to integer
		const updateData: Record<string, unknown> = {};
		if (payload.title !== undefined) {
			if (typeof payload.title !== 'string') {
				return json({ error: 'Invalid title' }, { status: 400 });
			}
			updateData.title = payload.title;
		}
		if (payload.artist !== undefined) {
			if (typeof payload.artist !== 'string') {
				return json({ error: 'Invalid artist' }, { status: 400 });
			}
			updateData.artist = payload.artist;
		}
		if (payload.bpm !== undefined) {
			if (typeof payload.bpm !== 'number' || !Number.isFinite(payload.bpm)) {
				return json({ error: 'Invalid bpm' }, { status: 400 });
			}
			updateData.bpm = payload.bpm;
		}
		if (payload.is_published !== undefined) {
			if (typeof payload.is_published !== 'boolean') {
				return json({ error: 'Invalid is_published' }, { status: 400 });
			}
			updateData.is_published = payload.is_published ? 1 : 0;
		}
		if (payload.isPublished !== undefined) {
			if (typeof payload.isPublished !== 'boolean') {
				return json({ error: 'Invalid isPublished' }, { status: 400 });
			}
			updateData.is_published = payload.isPublished ? 1 : 0;
		}
		if (payload.display_id !== undefined) {
			if (
				payload.display_id !== null &&
				(typeof payload.display_id !== 'number' ||
					!Number.isSafeInteger(payload.display_id))
			) {
				return json({ error: 'Invalid display_id' }, { status: 400 });
			}
			updateData.display_id = payload.display_id;
		}
		if (payload.displayId !== undefined) {
			if (
				payload.displayId !== null &&
				(typeof payload.displayId !== 'number' || !Number.isSafeInteger(payload.displayId))
			) {
				return json({ error: 'Invalid displayId' }, { status: 400 });
			}
			updateData.display_id = payload.displayId;
		}
		if (payload.download_url !== undefined) {
			if (payload.download_url !== null && typeof payload.download_url !== 'string') {
				return json({ error: 'Invalid download_url' }, { status: 400 });
			}
			updateData.download_url = payload.download_url;
		}
		if (payload.downloadUrl !== undefined) {
			if (payload.downloadUrl !== null && typeof payload.downloadUrl !== 'string') {
				return json({ error: 'Invalid downloadUrl' }, { status: 400 });
			}
			updateData.download_url = payload.downloadUrl;
		}
		if (payload.publish_date !== undefined) {
			if (
				typeof payload.publish_date !== 'string' ||
				Number.isNaN(Date.parse(payload.publish_date))
			) {
				return json({ error: 'Invalid publish_date' }, { status: 400 });
			}
			updateData.publish_date = payload.publish_date;
		}
		if (payload.publishDate !== undefined) {
			if (
				typeof payload.publishDate !== 'string' ||
				Number.isNaN(Date.parse(payload.publishDate))
			) {
				return json({ error: 'Invalid publishDate' }, { status: 400 });
			}
			updateData.publish_date = payload.publishDate;
		}
		if (payload.video_preview_url !== undefined) {
			if (
				payload.video_preview_url !== null &&
				typeof payload.video_preview_url !== 'string'
			) {
				return json({ error: 'Invalid video_preview_url' }, { status: 400 });
			}
			updateData.video_preview_url = payload.video_preview_url;
		}
		if (payload.videoPreviewUrl !== undefined) {
			if (payload.videoPreviewUrl !== null && typeof payload.videoPreviewUrl !== 'string') {
				return json({ error: 'Invalid videoPreviewUrl' }, { status: 400 });
			}
			updateData.video_preview_url = payload.videoPreviewUrl;
		}
		if (payload.preview_url !== undefined) {
			if (payload.preview_url !== null && typeof payload.preview_url !== 'string') {
				return json({ error: 'Invalid preview_url' }, { status: 400 });
			}
			updateData.preview_url = payload.preview_url;
		}
		if (payload.previewUrl !== undefined) {
			if (payload.previewUrl !== null && typeof payload.previewUrl !== 'string') {
				return json({ error: 'Invalid previewUrl' }, { status: 400 });
			}
			updateData.preview_url = payload.previewUrl;
		}

		const updated = await updateSimfile(db, id, updateData);
		// Fetch the full record with dtx_files and apply type conversion
		const full = await getSimfile(db, updated.id);
		if (!full) {
			logger.error('Updated chart not found after update', { id: updated.id });
			return json({ error: 'Failed to load updated chart' }, { status: 500 });
		}
		return json(full);
	} catch (error) {
		logger.error('Error updating chart:', error);
		if (error instanceof Error && error.message.includes('No fields to update')) {
			return json({ error: 'Bad Request', message: error.message }, { status: 400 });
		}
		return json(
			{ error: 'Failed to update chart', message: 'Internal server error' },
			{ status: 500 }
		);
	}
};
