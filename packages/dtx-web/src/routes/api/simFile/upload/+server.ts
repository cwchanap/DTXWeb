import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { logger } from '@dtx/common/server';
import { getDb, getSimfileOwner } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';

// Validation schema for upload form data
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Purges the Cloudflare cache for a specific file URL after upload.
 * This ensures that when a file is overwritten, clients get the new version immediately
 * instead of being served stale content from the cache.
 */
export async function _purgeCacheForFile(fileUrl: string): Promise<boolean> {
	const zoneId = env.CLOUDFLARE_ZONE_ID;
	const apiToken = env.CLOUDFLARE_API_TOKEN;

	// If credentials aren't configured, skip cache purge (log warning)
	if (!zoneId || !apiToken) {
		logger.warn(
			'Cloudflare cache purge skipped: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not configured'
		);
		return false;
	}

	try {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiToken}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ files: [fileUrl] })
			}
		);

		if (!response.ok) {
			const errorText = await response.text();
			logger.error(`Failed to purge cache for ${fileUrl}: ${response.status} ${errorText}`);
			return false;
		}

		const result = (await response.json()) as { success?: boolean; errors?: string[] };
		if (result.success) {
			logger.info(`Successfully purged cache for: ${fileUrl}`);
			return true;
		} else {
			logger.error(`Cache purge failed for ${fileUrl}:`, result.errors);
			return false;
		}
	} catch (error) {
		logger.error(`Error purging cache for ${fileUrl}:`, error);
		return false;
	}
}

const uploadSchema = z.object({
	file: z.instanceof(File).refine((f) => f.size <= MAX_FILE_SIZE, 'File too large (max 50MB)'),
	simFileId: z.string().min(1, 'SimFile ID is required')
});

// Helper function to sanitize filename for safe storage keys
// Preserves directory structure and non-ASCII characters while preventing path traversal
export const _sanitizeFilename = (filename: string): string => {
	let sanitized = filename;

	// Iteratively remove path traversal sequences until the string stabilizes
	// This prevents bypass attacks like "....//path" which could reduce to "../path"
	let previousSanitized: string;
	do {
		previousSanitized = sanitized;
		sanitized = sanitized
			.replace(/\.\.(?:\/|\\)/g, '') // Remove ../ and ..\ patterns
			.replace(/^[/\\]+/, '') // Remove leading slashes/backslashes
			.replace(/[/\\]+$/, ''); // Remove trailing slashes/backslashes
	} while (sanitized !== previousSanitized);

	// Collapse runs of dots followed by slashes (e.g., "....//" -> "")
	sanitized = sanitized.replace(/\.{2,}([/\\]+)/g, '');

	// Normalize path separators to forward slash for consistency
	sanitized = sanitized.replace(/\\/g, '/');

	// Remove null bytes and control characters (security measure)
	// eslint-disable-next-line no-control-regex
	sanitized = sanitized.replace(/[\x00-\x1f]/g, '');

	// Truncate to reasonable max length (1024 chars for S3/object storage compatibility)
	// We allow longer paths since we're preserving directory structure
	const MAX_LENGTH = 1024;
	if (sanitized.length > MAX_LENGTH) {
		// Find the last path separator to try to preserve file extension
		const lastSlash = sanitized.lastIndexOf('/');
		const lastDot = sanitized.lastIndexOf('.');

		// Only treat as extension if dot exists after the last slash and is not at the start of filename
		if (lastDot > lastSlash && lastDot > lastSlash + 1) {
			const ext = sanitized.slice(lastDot);
			const nameWithoutExt = sanitized.slice(0, lastDot);
			const allowedNameLen = Math.max(0, MAX_LENGTH - ext.length);
			if (allowedNameLen > 0) {
				sanitized = nameWithoutExt.slice(0, allowedNameLen) + ext;
			} else {
				// Extension itself exceeds max length, truncate extension
				sanitized = ext.slice(0, MAX_LENGTH);
			}
		} else {
			// No extension or dot-first filename - truncate the whole string
			sanitized = sanitized.slice(0, MAX_LENGTH);
		}
	}

	// Fallback if result is empty or just dots/slashes
	if (!sanitized || sanitized.match(/^[./\\_-]*$/)) {
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

		// Verify that the user owns this simfile via D1
		const db = getDb(platform);
		const simfile = await getSimfileOwner(db, simfileIdValue);

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
		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		// Create the key path using sanitized filename to prevent path traversal
		const sanitizedFilename = _sanitizeFilename(validatedFile.name);
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

		// Purge the cache for this file to ensure clients get the new version
		// This is especially important when overwriting existing files
		const fileUrl = `${PUBLIC_SIMFILE_BUCKET_URL}/${key}`;
		// Fire-and-forget cache purge - don't block the response
		_purgeCacheForFile(fileUrl).catch((err: unknown) => {
			logger.error('Unexpected error in cache purge:', err);
		});

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
