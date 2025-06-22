import { json } from '@sveltejs/kit';
import { z } from 'zod';
import logger from '$lib/server/logger';

// Validation schema for upload form data
const uploadSchema = z.object({
	file: z.instanceof(File),
	simFileId: z.string().min(1, 'SimFile ID is required')
});

export async function POST({ request, platform }: { request: Request; platform: App.Platform }) {
	try {
		// Parse the form data
		const formData = await request.formData();
		const file = formData.get('file') as File;
		const simFileId = formData.get('simFileId') as string;

		// Validate the input
		const validation = uploadSchema.safeParse({ file, simFileId });
		if (!validation.success) {
			logger.error('Validation failed:', validation.error);
			return json(
				{ error: 'Invalid input data', details: validation.error.issues },
				{ status: 400 }
			);
		}

		const { file: validatedFile, simFileId: validatedSimFileId } = validation.data;

		logger.info(`Uploading file: ${validatedFile.name} for simFile: ${validatedSimFileId}`);

		// Access the R2 bucket binding directly (same as worker approach)
		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// Create the key path (same as worker: simFileId/filename)
		const key = `${validatedSimFileId}/${validatedFile.name}`;

		// Upload using R2 bucket binding (same as worker approach)
		const result = await bucket.put(key, await validatedFile.arrayBuffer());

		if (!result) {
			logger.error('Failed to upload file to R2');
			return json({ error: 'Failed to upload file' }, { status: 500 });
		}

		logger.info(`Successfully uploaded file: ${validatedFile.name} to ${key}`);

		const uploadResult = {
			fileName: validatedFile.name,
			key,
			size: validatedFile.size,
			contentType: validatedFile.type,
			status: 'Uploaded'
		};

		return json({
			message: 'File uploaded successfully',
			file: uploadResult
		});
	} catch (error) {
		logger.error('Upload error:', error);
		return json(
			{
				error: 'Internal server error',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
}
