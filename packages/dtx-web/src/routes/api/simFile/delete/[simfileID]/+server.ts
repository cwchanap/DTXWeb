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
		const listResult = await bucket.list({ prefix: `${simfileID}/` });

		if (!listResult.objects || listResult.objects.length === 0) {
			logger.info(`No files found for simfile: ${simfileID}`);
			return json({ message: 'No files to delete', deleted: 0 });
		}

		// Delete all files
		const deletePromises = listResult.objects.map((obj) => bucket.delete(obj.key));
		await Promise.all(deletePromises);

		logger.info(`Deleted ${listResult.objects.length} files for simfile: ${simfileID}`);

		return json({
			message: 'Files deleted successfully',
			deleted: listResult.objects.length
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
