import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';

export async function DELETE({
	params,
	platform,
	locals
}: {
	params: { simfileID: string };
	platform: App.Platform;
	locals: App.Locals;
}) {
	try {
		// Check if user is authenticated
		const { session } = await locals.safeGetSession();
		if (!session || !session.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { simfileID } = params;

		if (!simfileID) {
			return json({ error: 'SimFile ID is required' }, { status: 400 });
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
		if (simfile.user_id !== session.user.id) {
			logger.warn(
				`Unauthorized delete attempt: user ${session.user.id} tried to delete simfile ${simfileID} owned by ${simfile.user_id}`
			);
			return json({ error: 'Forbidden' }, { status: 403 });
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
