import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';

export async function GET({
	request,
	params,
	platform,
	locals
}: {
	request: Request;
	params: { simfileID: string };
	platform: App.Platform;
	locals: App.Locals;
}) {
	const { simfileID } = params;

	if (!simfileID) {
		return json({ error: 'SimfileID is required' }, { status: 400 });
	}

	try {
		const { session: cookieSession } = await locals.safeGetSession();
		let user = cookieSession?.user;

		if (!user) {
			const authHeader = request.headers.get('Authorization');
			if (authHeader?.startsWith('Bearer ')) {
				const token = authHeader.replace('Bearer ', '');
				const { data: userData, error: userError } =
					await locals.supabase.auth.getUser(token);
				if (userError || !userData.user) {
					return json({ error: 'Unauthorized' }, { status: 401 });
				}
				user = userData.user;
			} else {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
		}

		if (!user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// Verify that the user owns this simfile
		const { data: simfile, error: simfileError } = await locals.supabase
			.from('simfiles')
			.select('user_id')
			.eq('id', parseInt(simfileID, 10))
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
				`Unauthorized list attempt: user ${user.id} tried to list files for simfile ${simfileID} owned by ${simfile.user_id}`
			);
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		logger.info(`Listing files for simfile: ${simfileID}`);

		// Access the R2 bucket binding directly (same as other APIs)
		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// List objects using R2 bucket binding with simfileID as prefix
		const objects = await bucket.list({ prefix: simfileID + '/' });

		// Extract file names from the response (same logic as before)
		const files = (objects.objects || [])
			.map((file) => {
				// Remove the prefix from the key to get just the filename
				const key = file.key || '';
				const fileName = key.replace(`${simfileID}/`, '');

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
