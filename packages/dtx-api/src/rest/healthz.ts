import type { Env } from '../env';

declare const __BUILD_SHA__: string | undefined;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const healthz = (_request: Request, _env: Env): Response =>
	new Response(
		JSON.stringify({
			ok: true,
			service: 'dtx-api',
			version: '0.0.1',
			buildSha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'dev'
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
