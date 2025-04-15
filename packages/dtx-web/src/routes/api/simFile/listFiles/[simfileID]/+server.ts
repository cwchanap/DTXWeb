import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { json } from '@sveltejs/kit';
import { DTXFILE_BUCKET_NAME } from '@/constant';
import s3 from '$lib/server/s3Client';
import logger from '$lib/server/logger';

export async function GET({ params }: { params: { simfileID: string } }) {
	const { simfileID } = params;

	if (!simfileID) {
		return json({ error: 'SimfileID is required' }, { status: 400 });
	}

	try {
		logger.info(`Listing files for simfile: ${simfileID}`);

		// Create the command to list objects with the simfileID as prefix
		const command = new ListObjectsV2Command({
			Bucket: DTXFILE_BUCKET_NAME,
			Prefix: simfileID + '/', // Add trailing slash to ensure we get only files in this directory
			Delimiter: '/' // Use delimiter to get only direct children
		});

		// Execute the command
		const response = await s3.send(command);

		// Extract file names from the response
		const files = (response.Contents || [])
			.map((file) => {
				// Remove the prefix from the key to get just the filename
				const key = file.Key || '';
				const fileName = key.replace(`${simfileID}/`, '');

				return {
					fileName,
					key,
					size: file.Size,
					lastModified: file.LastModified
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
