import { workerLogger } from '@dtx/common/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { resolveAuthSession } from '../auth/session';
import { uploadSimfileFile, purgeCacheForFile } from '../services/uploads';
import type { Env } from '../env';

const jsonError = (status: number, message: string) =>
	new Response(JSON.stringify({ error: message }), {
		status,
		headers: { 'content-type': 'application/json' }
	});

export const routeUpload = async (
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> => {
	const auth = await resolveAuthSession(request, env);
	if (!auth?.user) return jsonError(401, 'Unauthorized');

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return jsonError(400, 'Invalid multipart body');
	}

	const file = formData.get('file');
	const simFileId = formData.get('simFileId');
	if (!(file instanceof File) || typeof simFileId !== 'string') {
		return jsonError(400, 'Missing required form fields: file, simFileId');
	}

	const response = await uploadSimfileFile(env, auth.user, simFileId, file, env.DTXFILE_BUCKET);

	if (response.status === 200) {
		try {
			const cloned = response.clone();
			const body = (await cloned.json()) as { file?: { key?: string } };
			const key = body.file?.key;
			if (key && env.PUBLIC_SIMFILE_BUCKET_URL) {
				const base = env.PUBLIC_SIMFILE_BUCKET_URL.replace(/\/$/, '');
				// Encode each path segment so special characters (spaces, #, ?, non-ASCII)
				// match the URL clients actually request from the public bucket.
				const encodedKey = key.split('/').map(encodeURIComponent).join('/');
				const fileUrl = `${base}/${encodedKey}`;
				ctx.waitUntil(
					purgeCacheForFile(env, fileUrl, workerLogger).catch((err: unknown) => {
						workerLogger.error('Unexpected error in cache purge', {
							error: String(err)
						});
						return false;
					})
				);
			}
		} catch {
			// response body wasn't JSON or didn't include a key; skip purge gracefully
		}
	}

	return response;
};
