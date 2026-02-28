import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';
import { getDb, getSimfileOwner } from '$lib/server/db';

export async function GET({
	params,
	platform,
	locals
}: {
	params: { simfileID: string };
	platform: App.Platform;
	locals: App.Locals;
}) {
	const { simfileID } = params;

	if (!simfileID) {
		return json({ error: 'SimfileID is required' }, { status: 400 });
	}

	// Validate simfileID is a valid integer
	if (!/^\d+$/.test(simfileID)) {
		return json({ error: 'Invalid SimFile ID' }, { status: 400 });
	}
	const id = Number(simfileID);
	if (!Number.isSafeInteger(id)) {
		return json({ error: 'Invalid SimFile ID' }, { status: 400 });
	}
	const canonicalSimfileId = String(id);

	try {
		// Authentication is handled by hooks.server.ts
		// locals.user is set for both cookie session and Bearer token auth
		const user = locals.user;

		if (!user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// Verify that the user owns this simfile OR the simfile is published via D1
		const db = getDb(platform);
		const simfile = await getSimfileOwner(db, id);

		if (!simfile) {
			return json({ error: 'Simfile not found' }, { status: 404 });
		}

		// Allow access if user is owner OR simfile is published
		if (simfile.user_id !== user.id && !simfile.is_published) {
			logger.warn(
				`Unauthorized list attempt: user ${user.id} tried to list files for unpublished simfile ${canonicalSimfileId} owned by ${simfile.user_id}`
			);
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		logger.info(`Listing files for simfile: ${canonicalSimfileId}`);

		// Access the R2 bucket binding directly (same as other APIs)
		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// List all files with pagination (R2 returns a limited number of objects per call)
		let allObjects: { key: string; size: number; uploaded: Date }[] = [];
		let cursor: string | undefined;
		let isTruncated = true;

		while (isTruncated) {
			const listResult = await bucket.list({
				prefix: `${canonicalSimfileId}/`,
				limit: 1000,
				cursor
			});

			const objects = listResult.objects ?? [];
			allObjects = allObjects.concat(objects);

			isTruncated = listResult.truncated === true;
			if (isTruncated) {
				const nextCursor = (listResult as { cursor?: string }).cursor;
				if (!nextCursor || nextCursor === cursor) {
					logger.warn(
						`Truncated R2 list response without valid cursor for simfile ${canonicalSimfileId}`
					);
					isTruncated = false;
					// Return error to indicate incomplete results - caller should retry
					return json(
						{ error: 'Failed to list all files: pagination cursor unavailable' },
						{ status: 500 }
					);
				} else {
					cursor = nextCursor;
				}
			}
		}

		// Extract file names from the response
		const files = allObjects
			.map((file) => {
				const key = file.key || '';
				const fileName = key.replace(`${canonicalSimfileId}/`, '');
				return {
					fileName,
					key,
					size: file.size,
					lastModified: file.uploaded
				};
			})
			.filter((file) => file.fileName !== '');

		return json({ files });
	} catch (error) {
		logger.error('Error listing files:', error);
		return json({ error: 'Failed to list files' }, { status: 500 });
	}
}
