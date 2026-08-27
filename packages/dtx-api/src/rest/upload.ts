import { workerLogger } from '@dtx/common/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { resolveAuthSession } from '../auth/session';
import { uploadSimfileFile, purgeCacheForFile } from '../services/uploads';
import type { Env } from '../env';
import { toPublicR2Url } from '../lib/r2Files';

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

	const { response, uploadedObject } = await uploadSimfileFile(
		env,
		auth.user,
		simFileId,
		file,
		env.DTXFILE_BUCKET
	);

	if (response.status === 200 && uploadedObject && env.PUBLIC_SIMFILE_BUCKET_URL) {
		const fileUrl = toPublicR2Url(env.PUBLIC_SIMFILE_BUCKET_URL, uploadedObject.key);
		ctx.waitUntil(
			purgeCacheForFile(env, fileUrl, workerLogger).catch((err: unknown) => {
				workerLogger.error('Unexpected error in cache purge', {
					error: String(err)
				});
				return false;
			})
		);
	}

	return response;
};
