import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';

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

		// Verify that the user owns this simfile
		const { data: simfile, error: simfileError } = await locals.supabase
			.from('simfiles')
			.select('user_id')
			.eq('id', id)
			.maybeSingle();

		if (simfileError) {
			logger.error('Failed to query simfile:', simfileError);
			return json({ error: 'Failed to verify ownership' }, { status: 500 });
		}

		if (!simfile) {
			return json({ error: 'Simfile not found' }, { status: 404 });
		}

		// Check if the authenticated user is the owner of the simfile
		if (simfile.user_id !== user.id) {
			logger.warn(
				`Unauthorized list attempt: user ${user.id} tried to list files for simfile ${canonicalSimfileId} owned by ${simfile.user_id}`
			);
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		logger.info(`Listing files for simfile: ${canonicalSimfileId}`);

		// Access the R2 bucket binding directly (same as other APIs)
		const bucket = platform?.env?.DTXFILE_BUCKET_PREPROD ?? platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// List objects using R2 bucket binding with simfileID as prefix
		const objects = await bucket.list({ prefix: `${canonicalSimfileId}/` });

		// Extract file names from the response (same logic as before)
		const files = (objects.objects || [])
			.map((file) => {
				// Remove the prefix from the key to get just the filename
				const key = file.key || '';
				const fileName = key.replace(`${canonicalSimfileId}/`, '');

				return {
					fileName,
					key,
					size: file.size,
					lastModified: file.uploaded
				};
			})
			.filter((file) => file.fileName !== ''); // Filter out the directory itself if it appears

		return json({
			files
		});
	} catch (error) {
		logger.error('Error listing files:', error);
		return json({ error: 'Failed to list files' }, { status: 500 });
	}
}
