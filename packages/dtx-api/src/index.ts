import { yoga } from './schema';
import { healthz } from './rest/healthz';
import { routeDownloadSimfile } from './rest/downloadSimfile';
import { routeDownloadBulk } from './rest/downloadBulk';
import { routeUpload } from './rest/upload';
import { routeSetDef } from './rest/setDef';
import { handlePreflight, withCors } from './lib/cors';
import { createAuth } from './auth/auth';
import type { Env } from './env';

const downloadSimfilePattern = /^\/downloads\/([^/]+)$/;
const setDefPattern = /^\/simfiles\/([^/]+)\/set\.def$/;

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

		return withCors(new Response('Not Found', { status: 404 }), request, env);
	}
} satisfies ExportedHandler<Env>;
