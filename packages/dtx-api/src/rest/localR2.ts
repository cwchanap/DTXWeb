import type { Env } from '../env';

const textError = (status: number, message: string) => new Response(message, { status });

/**
 * Local-only passthrough that streams an object from the bound R2 bucket so
 * catalog/preview URLs built from `PUBLIC_SIMFILE_BUCKET_URL` resolve to the
 * local Miniflare bucket instead of a remote one. `dev:seed` writes chart
 * objects into the local `DTXFILE_BUCKET`; without this endpoint every seeded
 * or newly uploaded local-only object would 404 because the bucket base URL
 * pointed at the remote pre-production public bucket.
 *
 * The router only registers this handler when `RATE_LIMIT_ENV === 'local'`,
 * so it is never reachable in production or pre-production.
 */
export const routeLocalR2 = async (env: Env, key: string): Promise<Response> => {
	if (!key) return textError(404, 'Not Found');

	const object = await env.DTXFILE_BUCKET.get(key);
	if (!object) return textError(404, 'Not Found');

	const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
	return new Response(await object.arrayBuffer(), {
		headers: {
			'content-type': contentType,
			'cache-control': 'no-store'
		}
	});
};
