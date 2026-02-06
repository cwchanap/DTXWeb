import { json } from '@sveltejs/kit';
import { z } from 'zod';
import logger from '$lib/server/logger';

// Validation schema for upload form data
const uploadSchema = z.object({
	file: z.instanceof(File),
	simFileId: z.string().min(1, 'SimFile ID is required')
});

// Helper function to sanitize filename for safe storage keys
const sanitizeFilename = (filename: string): string => {
	// Remove path traversal sequences and path separators
	let sanitized = filename
		.replace(/\.\.[/\\]/g, '') // Remove ../ and ..\
		.replace(/[/\\]/g, '_') // Replace path separators with underscore
		.replace(/[^a-zA-Z0-9._-]/g, '_'); // Allow only alphanumeric, dots, hyphens, underscores

	// Truncate to reasonable max length (255 chars for most filesystems)
	const MAX_LENGTH = 255;
	if (sanitized.length > MAX_LENGTH) {
		const ext = sanitized.slice(sanitized.lastIndexOf('.'));
		const nameWithoutExt = sanitized.slice(0, sanitized.lastIndexOf('.'));
		sanitized = nameWithoutExt.slice(0, MAX_LENGTH - ext.length) + ext;
	}

	// Fallback if result is empty or just dots
	if (!sanitized || sanitized.match(/^[._-]*$/)) {
		sanitized = `file_${Date.now()}`;
	}

	return sanitized;
};

export async function POST({
	request,
	platform,
	locals
}: {
	request: Request;
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

		// Validate simFileId format (must be digits only)
		if (!/^\d+$/.test(validatedSimFileId)) {
			return json({ error: 'Invalid SimFile ID' }, { status: 400 });
		}

		const simfileIdValue = Number(validatedSimFileId);
		if (!Number.isSafeInteger(simfileIdValue)) {
			return json({ error: 'Invalid SimFile ID' }, { status: 400 });
		}
		const canonicalSimfileId = String(simfileIdValue);

		logger.info(`Uploading file: ${validatedFile.name} for simFile: ${canonicalSimfileId}`);

		// Verify that the user owns this simfile
		const { data: simfile, error: simfileError } = await locals.supabase
			.from('simfiles')
			.select('user_id')
			.eq('id', simfileIdValue)
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
				`Unauthorized upload attempt: user ${user.id} tried to upload to simfile ${canonicalSimfileId} owned by ${simfile.user_id}`
			);
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		// Access the R2 bucket binding directly (same as worker approach)
		const bucket = platform?.env?.DTXFILE_BUCKET_PREPROD ?? platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// Create the key path using sanitized filename to prevent path traversal
		const sanitizedFilename = sanitizeFilename(validatedFile.name);
		const key = `${canonicalSimfileId}/${sanitizedFilename}`;

		// Upload using R2 bucket binding (same as worker approach)
		const result = await bucket.put(key, await validatedFile.arrayBuffer(), {
			httpMetadata: {
				contentType: validatedFile.type,
				cacheControl: 'public, max-age=31536000'
			}
		});

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
