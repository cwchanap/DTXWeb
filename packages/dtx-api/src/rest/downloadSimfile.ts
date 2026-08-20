import { getClientIp, tryConsumeRateLimit } from '@dtx/common/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { resolveAuthSession } from '../auth/session';
import {
	resolveAccessibleSimfiles,
	collectZipSources,
	buildValidatedZipResponse
} from '../services/downloads';
import type { Env } from '../env';

const jsonError = (status: number, message: string) =>
	new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const routeDownloadSimfile = async (
	request: Request,
	env: Env,
	_ctx: ExecutionContext,
	rawId: string
): Promise<Response> => {
	if (!/^\d+$/.test(rawId)) {
		return jsonError(400, 'Invalid SimFile ID');
	}
	const id = Number(rawId);
	if (!Number.isSafeInteger(id)) {
		return jsonError(400, 'Invalid SimFile ID');
	}

	const auth = await resolveAuthSession(request, env);
	const user = auth?.user ?? null;

	if (!user && env.PUBLIC_ENABLE_BLOG_DOWNLOAD !== 'true') {
		return jsonError(401, 'Unauthorized');
	}

	const access = await resolveAccessibleSimfiles(env.DB, [id], user);
	if (access.missing.length > 0) return jsonError(404, 'Simfile not found');
	if (access.unauthorized.length > 0) return jsonError(401, 'Unauthorized');
	if (access.forbidden.length > 0) return jsonError(403, 'Forbidden');

	const { sources, estimatedBytes } = await collectZipSources(env.DTXFILE_BUCKET, [id], {
		flatSingle: true
	});

	if (sources.length === 0) {
		return jsonError(404, 'No files found for this chart');
	}

	const ip = getClientIp(request);
	if (!ip) {
		return jsonError(400, 'Unable to determine client IP for rate limiting.');
	}
	const { allowed } = await tryConsumeRateLimit(
		env.RATE_LIMIT_API,
		`${env.RATE_LIMIT_ENV}:downloads:${ip}`,
		estimatedBytes
	);
	if (!allowed) {
		return jsonError(429, 'Rate limit exceeded. Please try again later.');
	}

	const response = await buildValidatedZipResponse(env.DTXFILE_BUCKET, sources, {
		filename: `chart-${id}.zip`
	});

	return response;
};
