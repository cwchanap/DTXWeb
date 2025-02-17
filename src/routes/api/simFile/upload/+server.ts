import { PutObjectCommand } from '@aws-sdk/client-s3';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { DTXFILE_BUCKET_NAME } from '@/constant';
import path from 'path';
import s3 from '$lib/server/s3Client';
import logger from '$lib/server/logger';

// Define validation schema for multiple files
const formSchema = z.object({
    files: z.array(z.instanceof(File)).min(1, 'At least one file is required'),
    simFileId: z.string()
});

export async function POST({ request }: { request: Request }) {
    logger.info('Uploading files');
    const formData = await request.formData();

    // Get all files from formData
    const files = Array.from(formData.getAll('files')) as File[];
    const simFileId = formData.get('simFileId') as string;

    // Validate form data
    const validationResult = formSchema.safeParse({ files, simFileId });
    if (!validationResult.success) {
        return json({ error: validationResult.error.format() }, { status: 400 });
    }

    try {
        const uploadResults = await Promise.all(
            files.map(async (file) => {
                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                await s3.send(
                    new PutObjectCommand({
                        Bucket: DTXFILE_BUCKET_NAME,
                        Key: path.join(simFileId, file.name),
                        Body: buffer,
                        ContentType: file.type
                    })
                );

                return { fileName: file.name, status: 'Uploaded' };
            })
        );

        return json({ message: 'Files uploaded successfully', files: uploadResults });
    } catch (error) {
        logger.error('Upload error:', error);
        return json({ error: 'File upload failed' }, { status: 500 });
    }
}
