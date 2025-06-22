import { json } from '@sveltejs/kit';
import { z } from 'zod';
import logger from '$lib/server/logger';

// Validation schema for simFileId parameter
const listSchema = z.object({
	simFileId: z.string().min(1, 'SimFile ID is required')
});

export async function GET({
	params,
	platform
}: {
	params: { simFileId: string };
	platform: App.Platform;
}) {
	try {
		// Validate the parameter
		const validation = listSchema.safeParse({ simFileId: params.simFileId });
		if (!validation.success) {
			logger.error('Validation failed:', validation.error);
			return json(
				{ error: 'Invalid simFile ID', details: validation.error.issues },
				{ status: 400 }
			);
		}

		const { simFileId } = validation.data;

		logger.info(`Listing files for simFile: ${simFileId}`);

		// Access the R2 bucket binding directly (same as worker approach)
		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// List objects using R2 bucket binding (same as worker approach)
		const objects = await bucket.list({ prefix: simFileId });

		// Return objects directly (same as worker response structure)
		return json(objects.objects);
	} catch (error) {
		logger.error('List bucket error:', error);
		return json(
			{
				error: 'Failed to list files',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
}
