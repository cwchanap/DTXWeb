import type { Env } from '../env';

const textError = (status: number, message: string) => new Response(message, { status });

/**
 * Public passthrough for a simfile's set.def file, read from R2.
 * Unauthenticated by design — matches the editor's prior direct R2 read.
 */
export const routeSetDef = async (env: Env, rawId: string): Promise<Response> => {
	if (!/^\d+$/.test(rawId)) {
		return textError(400, 'Invalid SimFile ID');
	}

	const object = await env.DTXFILE_BUCKET.get(`${rawId}/set.def`);
	if (!object) {
		return textError(404, `SimFile ${rawId} not found`);
	}

	return new Response(await object.arrayBuffer(), {
		headers: { 'content-type': 'application/octet-stream' }
	});
};
