import { yoga } from './schema';
import { healthz } from './rest/healthz';
import { routeDownloadSimfile } from './rest/downloadSimfile';
import { routeDownloadBulk } from './rest/downloadBulk';
import { routeUpload } from './rest/upload';
import { routeSetDef } from './rest/setDef';
import { routeLocalR2 } from './rest/localR2';
import { handlePreflight, withCors } from './lib/cors';
import { createAuth } from './auth/auth';
import type { Env } from './env';

export { BgmTranscoderContainer } from './containers/bgmTranscoder';
export { GenerateBgmM4aWorkflow } from './workflows/generateBgmM4a';

const downloadSimfilePattern = /^\/downloads\/([^/]+)$/;
const setDefPattern = /^\/simfiles\/([^/]+)\/set\.def$/;
// Local-only R2 passthrough. `toPublicR2Url` encodes each path segment, so the
// key is recovered by decoding each segment and rejoining with `/`.
const localR2Pattern = /^\/local-r2\/(.+)$/;

const methodNotAllowed = (allow: string) =>
	new Response('Method Not Allowed', { status: 405, headers: { Allow: allow } });

const internalError = () =>
	new Response(JSON.stringify({ error: 'Internal Server Error' }), {
		status: 500,
		headers: { 'content-type': 'application/json' }
	});

const safeRoute = async (fn: () => Promise<Response>, path: string): Promise<Response> => {
	try {
		return await fn();
	} catch (err) {
		console.error(`Unhandled error in route handler [${path}]:`, err);
		return internalError();
	}
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const preflight = handlePreflight(request, env);
		if (preflight) return preflight;

		const url = new URL(request.url);

		if (url.pathname.startsWith('/api/auth/') && ['GET', 'POST'].includes(request.method)) {
			const response = await createAuth(env).handler(request);
			return withCors(response, request, env);
		}

		if (url.pathname === '/healthz') {
			return request.method === 'GET'
				? withCors(healthz(request, env), request, env)
				: withCors(methodNotAllowed('GET'), request, env);
		}

		if (url.pathname === '/graphql') {
			const response = await yoga.fetch(request, { env, ctx });
			return withCors(response, request, env);
		}

		if (url.pathname === '/downloads/bulk') {
			if (request.method !== 'POST') return withCors(methodNotAllowed('POST'), request, env);
			return withCors(
				await safeRoute(() => routeDownloadBulk(request, env), url.pathname),
				request,
				env
			);
		}

		const downloadMatch = downloadSimfilePattern.exec(url.pathname);
		if (downloadMatch) {
			if (request.method !== 'GET') return withCors(methodNotAllowed('GET'), request, env);
			return withCors(
				await safeRoute(
					() => routeDownloadSimfile(request, env, ctx, downloadMatch[1]),
					url.pathname
				),
				request,
				env
			);
		}

		if (url.pathname === '/upload') {
			if (request.method !== 'POST') return withCors(methodNotAllowed('POST'), request, env);
			return withCors(
				await safeRoute(() => routeUpload(request, env, ctx), url.pathname),
				request,
				env
			);
		}

		const setDefMatch = setDefPattern.exec(url.pathname);
		if (setDefMatch) {
			if (request.method !== 'GET') return withCors(methodNotAllowed('GET'), request, env);
			return withCors(
				await safeRoute(() => routeSetDef(env, setDefMatch[1]), url.pathname),
				request,
				env
			);
		}

		// Local-only R2 passthrough: serves seeded/local-only chart objects so
		// PUBLIC_SIMFILE_BUCKET_URL resolves to the local Miniflare bucket.
		// Never registered in production or pre-production.
		if (env.RATE_LIMIT_ENV === 'local') {
			const localR2Match = localR2Pattern.exec(url.pathname);
			if (localR2Match) {
				if (request.method !== 'GET')
					return withCors(methodNotAllowed('GET'), request, env);
				// Malformed percent-encoding (e.g. `/local-r2/%`) makes
				// `decodeURIComponent` throw `URIError` before `safeRoute` can
				// catch it; treat an undecodable key as a missing object.
				let key: string;
				try {
					key = localR2Match[1]
						.split('/')
						.map((segment) => decodeURIComponent(segment))
						.join('/');
				} catch {
					return withCors(new Response('Not Found', { status: 404 }), request, env);
				}
				return withCors(
					await safeRoute(() => routeLocalR2(env, key), url.pathname),
					request,
					env
				);
			}
		}

		return withCors(new Response('Not Found', { status: 404 }), request, env);
	}
} satisfies ExportedHandler<Env>;
