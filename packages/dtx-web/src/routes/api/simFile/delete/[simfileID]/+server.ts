import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';

export async function DELETE({
	params,
	platform
}: {
	params: { simfileID: string };
	platform: App.Platform;
}) {
	try {
		const { simfileID } = params;

		if (!simfileID) {
			return json({ error: 'SimFile ID is required' }, { status: 400 });
		}

		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// List all files with the simfileID prefix
		// Note: R2 Workers API doesn't support cursor-based pagination natively.
		// The limit parameter can be increased if needed (default is typically 1000).
		const listResult = await bucket.list({ prefix: `${simfileID}/`, limit: 1000 });

		if (!listResult.objects || listResult.objects.length === 0) {
			logger.info(`No files found for simfile: ${simfileID}`);
			return json({ message: 'No files to delete', deleted: 0 });
		}

		// Delete all files using Promise.allSettled to handle partial failures
		const deleteResults = await Promise.allSettled(
			listResult.objects.map((obj) => bucket.delete(obj.key))
		);

		// Separate successful from failed deletions
		const successfulDeletions = deleteResults.filter((r) => r.status === 'fulfilled');
		const failedDeletions = deleteResults.filter((r) => r.status === 'rejected');

		if (failedDeletions.length > 0) {
			const failedKeys = listResult.objects
				.filter((_, i) => deleteResults[i]?.status === 'rejected')
				.map((obj) => obj.key);
			logger.error(`Failed to delete ${failedDeletions.length} files:`, failedKeys);
		}

		logger.info(
			`Deleted ${successfulDeletions.length}/${listResult.objects.length} files for simfile: ${simfileID}`
		);

		return json({
			message: 'Files deleted successfully',
			deleted: successfulDeletions.length,
			failed: failedDeletions.length,
			total: listResult.objects.length
		});
	} catch (error) {
		logger.error('Delete error:', error);
		return json(
			{
				error: 'Internal server error',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
}
