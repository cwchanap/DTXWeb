import { getClientIp, tryConsumeRateLimit } from '@dtx/common/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { verifyToken } from '../auth/verifyToken';
import { resolveAccessibleSimfiles, buildSimfileZipResponse } from '../services/downloads';
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

	const auth = await verifyToken(request, env);
	const user = auth?.user ?? null;

	if (!user && env.PUBLIC_ENABLE_BLOG_DOWNLOAD !== 'true') {
		return jsonError(401, 'Unauthorized');
	}

	const access = await resolveAccessibleSimfiles(env.DB, [id], user);
	if (access.missing.length > 0) return jsonError(404, 'Simfile not found');
	if (access.unauthorized.length > 0) return jsonError(401, 'Unauthorized');
	if (access.forbidden.length > 0) return jsonError(403, 'Forbidden');

	const ip = getClientIp(request);
	if (ip) {
		const { allowed } = await tryConsumeRateLimit(
			env.RATE_LIMIT_API,
			`${env.RATE_LIMIT_ENV}:single:${ip}`,
			0
		);
		if (!allowed) {
			return jsonError(429, 'Rate limit exceeded. Please try again later.');
		}
	}

	const { response } = await buildSimfileZipResponse(env.DTXFILE_BUCKET, [id], {
		filename: `chart-${id}.zip`
	});
	return response;
};
