import { json } from '@sveltejs/kit';
import { z } from 'zod';
import logger from '$lib/server/logger';

// Validation schema for upload form data
const uploadSchema = z.object({
	file: z.instanceof(File),
	simFileId: z.string().min(1, 'SimFile ID is required')
});

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
		// Check if user is authenticated via cookie (web app) or bearer token (desktop app)
		const { session: cookieSession } = await locals.safeGetSession();

		let user = cookieSession?.user;

		// If no cookie session, check for bearer token (desktop app)
		if (!user) {
			const authHeader = request.headers.get('Authorization');
			if (authHeader?.startsWith('Bearer ')) {
				const token = authHeader.replace('Bearer ', '');
				// Validate the token using Supabase
				const { data: userData, error: userError } =
					await locals.supabase.auth.getUser(token);
				if (userError || !userData.user) {
					return json({ error: 'Unauthorized' }, { status: 401 });
				}
				user = userData.user;
			} else {
				return json({ error: 'Unauthorized' }, { status: 401 });
			}
		}

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

		logger.info(`Uploading file: ${validatedFile.name} for simFile: ${validatedSimFileId}`);

		// Verify that the user owns this simfile
		const { data: simfile, error: simfileError } = await locals.supabase
			.from('simfiles')
			.select('user_id')
			.eq('id', parseInt(validatedSimFileId, 10))
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
				`Unauthorized upload attempt: user ${user.id} tried to upload to simfile ${validatedSimFileId} owned by ${simfile.user_id}`
			);
			return json({ error: 'Forbidden' }, { status: 403 });
		}

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
