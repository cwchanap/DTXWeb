import { getClientIp, tryConsumeRateLimit } from '@dtx/common/server';
import { resolveAuthSession, type ApiAuthSession } from '../auth/session';
import {
	resolveAccessibleSimfiles,
	collectZipSources,
	buildValidatedZipResponse
} from '../services/downloads';
import type { Env } from '../env';

const MAX_BULK_IDS = 20;

const jsonError = (status: number, message: string, extra: Record<string, unknown> = {}) =>
	new Response(JSON.stringify({ error: message, ...extra }), {
		status,
		headers: { 'content-type': 'application/json' }
	});

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

const parseIds = (raw: unknown): number[] | null => {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const out: number[] = [];
	for (const entry of raw) {
		if (typeof entry === 'number') {
			if (!Number.isSafeInteger(entry) || entry <= 0) return null;
			out.push(entry);
		} else if (typeof entry === 'string' && /^\d+$/.test(entry)) {
			const n = Number(entry);
			if (!Number.isSafeInteger(n) || n <= 0) return null;
			out.push(n);
		} else {
			return null;
		}
	}
	return out;
};

const parseRequestBody = async (request: Request): Promise<{ ids?: unknown }> => {
	const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();

	if (
		contentType === 'application/x-www-form-urlencoded' ||
		contentType === 'multipart/form-data'
	) {
		const formData = await request.formData();
		return { ids: formData.getAll('ids') };
	}

	const body = await request.json();
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new Error('Invalid request body');
	}
	return body as { ids?: unknown };
};

export const routeDownloadBulk = async (request: Request, env: Env): Promise<Response> => {
	const blogDownloadEnabled = env.PUBLIC_ENABLE_BLOG_DOWNLOAD === 'true';

	// When public downloads are disabled, reject anonymous requests before
	// parsing the body to avoid wasting CPU/memory on large payloads.
	let auth: ApiAuthSession | null = null;
	if (!blogDownloadEnabled) {
		auth = await resolveAuthSession(request, env);
		if (!auth?.user) {
			return jsonError(401, 'Unauthorized');
		}
	}

	let payload: { ids?: unknown };
	try {
		payload = await parseRequestBody(request);
	} catch {
		return jsonError(400, 'Invalid request body');
	}

	const ids = parseIds(payload.ids);
	if (!ids) return jsonError(400, 'ids must be a non-empty array of positive integers');

	const unique = [...new Set(ids)];
	if (unique.length > MAX_BULK_IDS) {
		return jsonError(400, `Cannot download more than ${MAX_BULK_IDS} charts at once`);
	}

	const validateOnly = new URL(request.url).searchParams.get('validate') === '1';

	// Reuse the early auth result when available; only verify the token
	// again when public downloads are enabled (anonymous access allowed,
	// but a valid token grants access to the user's private charts too).
	if (!auth) {
		auth = await resolveAuthSession(request, env);
	}
	const user = auth?.user ?? null;

	const access = await resolveAccessibleSimfiles(env.DB, unique, user);

	if (access.unauthorized.length > 0) {
		return jsonError(401, 'Unauthorized', { ids: access.unauthorized });
	}
	if (access.forbidden.length > 0) {
		return jsonError(403, 'Forbidden', { ids: access.forbidden });
	}
	if (access.missing.length > 0) {
		return jsonError(404, 'Simfile not found', { ids: access.missing });
	}

	const { sources, sourcesBySimfile, estimatedBytes } = await collectZipSources(
		env.DTXFILE_BUCKET,
		access.accessible
	);

	const missingUploadIds = sourcesBySimfile
		.filter(({ sources }) => sources.length === 0)
		.map(({ simfileId }) => simfileId);

	if (missingUploadIds.length > 0) {
		return jsonError(400, 'Some selected charts do not have uploaded files available.', {
			ids: missingUploadIds
		});
	}

	const ip = getClientIp(request);
	if (!ip) {
		return jsonError(400, 'Unable to determine client IP for rate limiting.');
	}
	const { allowed } = await tryConsumeRateLimit(
		env.RATE_LIMIT_API,
		`${env.RATE_LIMIT_ENV}:downloads:${ip}`,
		estimatedBytes,
		undefined,
		!validateOnly
	);
	if (!allowed) {
		return jsonError(429, 'Rate limit exceeded. Please try again later.');
	}

	if (validateOnly) {
		return json({ ok: true, fileCount: sources.length });
	}

	if (sources.length === 0) {
		return jsonError(404, 'No files found for the requested charts');
	}

	const response = await buildValidatedZipResponse(env.DTXFILE_BUCKET, sources, {
		filename: 'drumery-charts.zip'
	});

	return response;
};
