import { yoga } from './schema';
import { healthz } from './rest/healthz';
import { handlePreflight, withCors } from './lib/cors';
import type { Env } from './env';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const preflight = handlePreflight(request, env);
		if (preflight) return preflight;

		const url = new URL(request.url);

		if (url.pathname === '/healthz') {
			return withCors(healthz(request, env), request, env);
		}

		if (url.pathname === '/graphql') {
			const response = await yoga.fetch(request, { env, ctx });
			return withCors(response, request, env);
		}

		return withCors(new Response('Not Found', { status: 404 }), request, env);
	}
} satisfies ExportedHandler<Env>;
