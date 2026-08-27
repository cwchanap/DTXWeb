import { getSimfileOwner, type WorkerLogger } from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';
import { sanitizeFilename } from '../lib/sanitizeFilename';
import type { Env } from '../env';
import { BGM_DERIVATIVE_FILENAME, isCanonicalBgmDerivativeKey } from './bgmM4a';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export type UploadedObject = {
	simfileId: number;
	key: string;
	etag: string;
	version: string;
	uploaded: string;
	size: number;
};

export type UploadResult = {
	response: Response;
	uploadedObject?: UploadedObject;
};

export const purgeCacheForFile = async (
	env: Env,
	fileUrl: string,
	logger: WorkerLogger
): Promise<boolean> => {
	if (!env.CLOUDFLARE_ZONE_ID || !env.CLOUDFLARE_API_TOKEN) {
		logger.warn(
			'Cloudflare cache purge skipped: CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN not configured'
		);
		return false;
	}
	try {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/purge_cache`,
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ files: [fileUrl] })
			}
		);
		if (!response.ok) {
			logger.error(`Failed to purge cache for ${fileUrl}: ${response.status}`);
			return false;
		}
		const result = (await response.json()) as { success?: boolean };
		if (result.success) {
			logger.info(`Successfully purged cache for: ${fileUrl}`);
			return true;
		}
		return false;
	} catch (err) {
		logger.error(`Error purging cache for ${fileUrl}`, { error: String(err) });
		return false;
	}
};

export const uploadSimfileFile = async (
	env: Env,
	user: { id: string } | null,
	simfileIdRaw: string,
	file: File,
	bucket: R2Bucket
): Promise<UploadResult> => {
	if (!user) return { response: json(401, { error: 'Unauthorized' }) };

	if (!/^\d+$/.test(simfileIdRaw)) {
		return { response: json(400, { error: 'Invalid SimFile ID' }) };
	}
	const simfileId = Number(simfileIdRaw);
	if (!Number.isSafeInteger(simfileId)) {
		return { response: json(400, { error: 'Invalid SimFile ID' }) };
	}

	if (file.size > MAX_FILE_SIZE) {
		return { response: json(400, { error: 'File too large (max 50MB)' }) };
	}

	const owner = await getSimfileOwner(env.DB, simfileId);
	if (!owner) return { response: json(404, { error: 'Simfile not found' }) };
	if (owner.user_id !== user.id) return { response: json(403, { error: 'Forbidden' }) };

	const sanitized = sanitizeFilename(file.name);
	const key = `${simfileId}/${sanitized}`;
	if (isCanonicalBgmDerivativeKey(key, simfileId)) {
		return {
			response: json(409, {
				error: `${BGM_DERIVATIVE_FILENAME} is reserved for generated audio`
			})
		};
	}

	// Pass the file's ReadableStream directly to R2 to avoid buffering
	// the entire file into memory (50 MB file would consume the Workers memory budget).
	// DOM ReadableStream and Workers ReadableStream are structurally identical at runtime
	// but have incompatible type definitions — cast to bridge the gap.
	const body = file.stream() as unknown as Parameters<typeof bucket.put>[1];
	const result = await bucket.put(key, body, {
		httpMetadata: {
			contentType: file.type || 'application/octet-stream',
			cacheControl: 'public, max-age=31536000'
		}
	});

	if (!result) {
		return { response: json(500, { error: 'Failed to upload file' }) };
	}

	const { etag, version, uploaded, size } = result;
	if (
		typeof result.key !== 'string' ||
		typeof etag !== 'string' ||
		typeof version !== 'string' ||
		!(uploaded instanceof Date) ||
		!Number.isFinite(uploaded.getTime()) ||
		typeof size !== 'number' ||
		!Number.isFinite(size)
	) {
		return { response: json(500, { error: 'Failed to read uploaded file identity' }) };
	}

	return {
		response: json(200, {
			message: 'File uploaded successfully',
			file: {
				fileName: file.name,
				key,
				size: file.size,
				contentType: file.type || 'application/octet-stream',
				status: 'Uploaded'
			}
		}),
		uploadedObject: {
			simfileId,
			key: result.key,
			etag,
			version,
			uploaded: uploaded.toISOString(),
			size
		}
	};
};
