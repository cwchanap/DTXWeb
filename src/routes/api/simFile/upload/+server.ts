import { PutObjectCommand } from '@aws-sdk/client-s3';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { DTXFILE_BUCKET_NAME } from '@/constant';
import path from 'path';
import s3 from '$lib/server/s3Client';
import logger from '$lib/server/logger';

// Define validation schema for multiple files
const formSchema = z.object({
	file: z.instanceof(File),
	simFileId: z.string()
});

export async function POST({ request }: { request: Request }) {
	logger.info('Uploading file');
	const formData = await request.formData();

	// Get file from formData
	const file = formData.get('file') as File;
	const simFileId = formData.get('simFileId') as string;

	// Validate form data
	const validationResult = formSchema.safeParse({ file, simFileId });
	if (!validationResult.success) {
		return json({ error: validationResult.error.format() }, { status: 400 });
	}

	try {
		// Process the single file
		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		logger.info('Uploading file:', file.name);
		await s3.send(
			new PutObjectCommand({
				Bucket: DTXFILE_BUCKET_NAME,
				Key: path.join(simFileId, file.name),
				Body: buffer,
				ContentType: file.type
			})
		);

		const uploadResult = { fileName: file.name, status: 'Uploaded' };
		return json({ message: 'File uploaded successfully', file: uploadResult });
	} catch (error) {
		logger.error('Upload error:', error);
		return json({ error: 'File upload failed' }, { status: 500 });
	}
}
