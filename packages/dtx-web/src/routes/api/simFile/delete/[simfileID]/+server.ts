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

		// List all files with the canonical simfileID prefix
		// Use the normalized numeric ID (not the raw route param) for consistency with upload/list
		// Loop through all batches using cursor-based pagination
		let allObjects: { key: string }[] = [];
		let cursor: string | undefined;
		let isTruncated = true;

		while (isTruncated) {
			const listResult = await bucket.list({
				prefix: `${id}/`,
				limit: 10000,
				cursor
			});

			const objects = listResult.objects ?? [];
			allObjects = allObjects.concat(objects);

			isTruncated = listResult.truncated === true;
			if (isTruncated) {
				const nextCursor = (listResult as { cursor?: string }).cursor;

				if (!nextCursor || nextCursor === cursor) {
					logger.error(
						`Invalid R2 pagination state while deleting simfile ${simfileID}: truncated response without a valid next cursor`
					);
					return json(
						{
							error: 'Failed to list all files for deletion',
							message:
								'File listing was truncated but pagination cursor was invalid; some files may not have been deleted'
						},
						{ status: 500 }
					);
				}

				cursor = nextCursor;
			} else {
				cursor = undefined;
			}

			if (isTruncated) {
				logger.info(
					`File list truncated for simfile ${simfileID}, continuing with cursor...`
				);
			}
		}

		if (allObjects.length === 0) {
			logger.info(`No files found for simfile: ${simfileID}`);
		}

		// Delete all files using Promise.allSettled to handle partial failures
		const deleteResults = await Promise.allSettled(
			allObjects.map((obj) => bucket.delete(obj.key))
		);

		// Separate successful from failed deletions
		const successfulDeletions = deleteResults.filter((r) => r.status === 'fulfilled');
		const failedDeletions = deleteResults.filter((r) => r.status === 'rejected');

		if (failedDeletions.length > 0) {
			const failedKeys = allObjects
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
							key: allObjects[index]?.key,
							reason
						};
					}
					return null;
				})
				.filter(
					(
						entry
					): entry is {
						key: string;
						reason: string;
					} => entry !== null && entry.key !== undefined
				);
			logger.error(`Failed to delete ${failedDeletions.length} files:`, {
				failedKeys,
				errors: failedDetails
			});
		}

		logger.info(
			`Deleted ${successfulDeletions.length}/${allObjects.length} files for simfile: ${simfileID}`
		);

		const totalFiles = allObjects.length;

		// Always delete the DB record even if some files failed to delete
		// to avoid broken references in the database
		const { error: deleteError } = await locals.supabase.from('simfiles').delete().eq('id', id);

		if (deleteError) {
			// NOTE: At this point, all associated R2 files have already been deleted.
			// If the database deletion fails, the system will be left with a
			// dangling simfile record that no longer has backing files. This is a
			// known, non-transactional edge case between object storage and the DB.
			logger.error('Failed to delete simfile record after deleting R2 files:', {
				error: deleteError,
				simfileID: id,
				totalFiles,
				deletedFiles: successfulDeletions.length,
				failedFiles: failedDeletions.length
			});
			return json(
				{
					error: 'Failed to delete simfile record after deleting R2 files',
					message:
						'Database record could not be deleted. Files may have been partially deleted.',
					partialDeletion: true,
					deleted: successfulDeletions.length,
					failed: failedDeletions.length,
					total: totalFiles
				},
				{ status: 500 }
			);
		}

		const message =
			totalFiles === 0
				? 'No files to delete'
				: failedDeletions.length === 0
					? 'Files deleted successfully'
					: `Some files failed to delete (${failedDeletions.length}/${totalFiles})`;

		// Return 200 if DB record was deleted, even if some files failed
		// Include partialDeletion flag to indicate files may remain in storage
		return json({
			message,
			deleted: successfulDeletions.length,
			failed: failedDeletions.length,
			total: totalFiles,
			partialDeletion: failedDeletions.length > 0
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
