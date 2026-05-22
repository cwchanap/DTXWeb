import { getClientIp, tryConsumeRateLimit } from '@dtx/common/server';
import { verifyToken } from '../auth/verifyToken';
import { resolveAccessibleSimfiles, buildSimfileZipResponse } from '../services/downloads';
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

export const routeDownloadBulk = async (request: Request, env: Env): Promise<Response> => {
	let payload: { ids?: unknown };
	try {
		const parsed = await request.json();
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return jsonError(400, 'Invalid request body');
		}
		payload = parsed as { ids?: unknown };
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

	const auth = await verifyToken(request, env);
	const user = auth?.user ?? null;

	if (!user && env.PUBLIC_ENABLE_BLOG_DOWNLOAD !== 'true') {
		return jsonError(401, 'Unauthorized');
	}

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

	const { response, sources, sourcesBySimfile, estimatedBytes } = await buildSimfileZipResponse(
		env.DTXFILE_BUCKET,
		access.accessible,
		{ filename: 'drumery-charts.zip' }
	);

	const missingUploadIds = sourcesBySimfile
		.filter(({ sources }) => sources.length === 0)
		.map(({ simfileId }) => simfileId);

	if (missingUploadIds.length > 0) {
		return jsonError(400, 'Some selected charts do not have uploaded files available.', {
			ids: missingUploadIds
		});
	}

	if (validateOnly) {
		return json({ ok: true, fileCount: sources.length });
	}

	if (sources.length === 0) {
		return jsonError(404, 'No files found for the requested charts');
	}

	const ip = getClientIp(request);
	if (ip) {
		const { allowed } = await tryConsumeRateLimit(
			env.RATE_LIMIT_API,
			`${env.RATE_LIMIT_ENV}:bulk:${ip}`,
			estimatedBytes
		);
		if (!allowed) {
			return jsonError(429, 'Rate limit exceeded. Please try again later.');
		}
	}

	return response;
};
