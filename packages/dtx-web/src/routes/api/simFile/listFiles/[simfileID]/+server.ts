import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';

export async function GET({
	params,
	platform
}: {
	params: { simfileID: string };
	platform: App.Platform;
}) {
	const { simfileID } = params;

	if (!simfileID) {
		return json({ error: 'SimfileID is required' }, { status: 400 });
	}

	try {
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
