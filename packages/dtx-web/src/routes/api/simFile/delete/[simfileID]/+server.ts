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
		// Authentication is handled by hooks.server.ts
		// locals.user is set for both cookie session and Bearer token auth
		const user = locals.user;

		if (!user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { simfileID } = params;

		if (!simfileID) {
			return json({ error: 'SimFile ID is required' }, { status: 400 });
		}

		// Validate and parse the simfileID
		if (!/^\d+$/.test(simfileID)) {
			return json({ error: 'Invalid SimFile ID' }, { status: 400 });
		}
		const id = Number(simfileID);
		if (!Number.isSafeInteger(id)) {
			return json({ error: 'Invalid SimFile ID' }, { status: 400 });
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
				`Unauthorized delete attempt: user ${user.id} tried to delete simfile ${simfileID} owned by ${simfile.user_id}`
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
		// Increased limit to handle larger simfiles, though extremely large file counts
		// (>10000 files per simfile) may still require a different approach.
		const listResult = await bucket.list({ prefix: `${simfileID}/`, limit: 10000 });

		const objects = listResult.objects ?? [];
		if (objects.length === 0) {
			logger.info(`No files found for simfile: ${simfileID}`);
		}

		const isTruncated = listResult.truncated === true;
		if (isTruncated) {
			logger.warn(
				`File list was truncated for simfile ${simfileID}. Some files may not have been deleted.`
			);
		}

		// Delete all files using Promise.allSettled to handle partial failures
		const deleteResults = await Promise.allSettled(
			objects.map((obj) => bucket.delete(obj.key))
		);

		// Separate successful from failed deletions
		const successfulDeletions = deleteResults.filter((r) => r.status === 'fulfilled');
		const failedDeletions = deleteResults.filter((r) => r.status === 'rejected');

		if (failedDeletions.length > 0) {
			const failedKeys = objects
				.filter((_, i) => deleteResults[i]?.status === 'rejected')
				.map((obj) => obj.key);
			const failedDetails = deleteResults
				.map((result, index) => {
					if (result.status === 'rejected') {
						const reason =
							result.reason instanceof Error
								? result.reason.message
								: typeof result.reason === 'string'
									? result.reason
									: JSON.stringify(result.reason);
						return {
							key: objects[index]?.key,
							reason
						};
					}
					return null;
				})
				.filter(
					(
						entry
					): entry is {
						key: string | undefined;
						reason: string;
					} => entry !== null
				);
			logger.error(`Failed to delete ${failedDeletions.length} files:`, {
				failedKeys,
				errors: failedDetails
			});
		}

		logger.info(
			`Deleted ${successfulDeletions.length}/${objects.length} files for simfile: ${simfileID}`
		);

		const totalFiles = objects.length;
		const message =
			totalFiles === 0
				? 'No files to delete'
				: failedDeletions.length === 0 && !isTruncated
					? 'Files deleted successfully'
					: isTruncated
						? 'File list was truncated; some files may not have been deleted'
						: `Some files failed to delete (${failedDeletions.length}/${totalFiles})`;

		if (failedDeletions.length > 0 || isTruncated) {
			return json(
				{
					message,
					deleted: successfulDeletions.length,
					failed: failedDeletions.length,
					total: totalFiles
				},
				{ status: 500 }
			);
		}

		const { error: deleteError } = await locals.supabase.from('simfiles').delete().eq('id', id);

		if (deleteError) {
			logger.error('Failed to delete simfile record:', deleteError);
			return json({ error: 'Failed to delete simfile record' }, { status: 500 });
		}

		return json({
			message,
			deleted: successfulDeletions.length,
			failed: failedDeletions.length,
			total: totalFiles
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
