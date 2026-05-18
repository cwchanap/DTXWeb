import type { Env } from '../env';

const cache = new Map<string, Set<string>>();

const getAllowedOrigins = (env: Env): Set<string> => {
	const raw = env.CORS_ALLOWED_ORIGINS;
	let set = cache.get(raw);
	if (!set) {
		set = new Set(
			raw
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		);
		cache.set(raw, set);
	}
	return set;
};

const baseHeaders = (): Record<string, string> => ({
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'authorization, content-type, x-requested-with',
	'Access-Control-Max-Age': '86400'
});

export const handlePreflight = (request: Request, env: Env): Response | null => {
	if (request.method !== 'OPTIONS') return null;

	const origin = request.headers.get('Origin');
	const headers: Record<string, string> = baseHeaders();

	if (origin && getAllowedOrigins(env).has(origin)) {
		headers['Access-Control-Allow-Origin'] = origin;
		headers['Vary'] = 'Origin';
		headers['Access-Control-Allow-Credentials'] = 'false';
	}

	return new Response(null, { status: 204, headers });
};

export const withCors = (response: Response, request: Request, env: Env): Response => {
	const origin = request.headers.get('Origin');
	if (!origin) return response;
	if (!getAllowedOrigins(env).has(origin)) return response;

	const headers = new Headers(response.headers);
	headers.set('Access-Control-Allow-Origin', origin);
	headers.set('Vary', 'Origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
