import { json } from '@sveltejs/kit';
import {
	logger,
	getClientIp,
	tryConsumeRateLimit,
	listAllR2Objects,
	buildZipStream,
	createZipSources,
	validateZipSources,
	getSimfileOwner
} from '@dtx/common/server';
import { getDb } from '$lib/server/db';

export const GET = async ({
	params,
	platform,
	locals,
	request
}: {
	params: { simfileID: string };
	platform: App.Platform;
	locals: App.Locals;
	request: Request;
}) => {
	const { simfileID } = params;

	if (!simfileID) {
		return json({ error: 'SimFile ID is required' }, { status: 400 });
	}

	if (!/^\d+$/.test(simfileID)) {
		return json({ error: 'Invalid SimFile ID' }, { status: 400 });
	}

	const id = Number(simfileID);
	if (!Number.isSafeInteger(id)) {
		return json({ error: 'Invalid SimFile ID' }, { status: 400 });
	}

	const canonicalId = String(id);

	try {
		const db = getDb(platform);
		const simfile = await getSimfileOwner(db, id);

		if (!simfile) {
			return json({ error: 'Simfile not found' }, { status: 404 });
		}

		const user = locals.user;

		if (!simfile.is_published && !user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		if (user && simfile.user_id !== user.id && !simfile.is_published) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}

		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		const objects = await listAllR2Objects(bucket, `${canonicalId}/`);

		const sources = createZipSources(objects, `${canonicalId}/`, '');

		if (sources.length === 0) {
			return json({ error: 'No files found for this chart' }, { status: 404 });
		}

		const estimatedBytes = sources.reduce((sum, src) => sum + src.size, 0);

		// Rate limiting — skipped in local dev when KV binding is absent
		const kv = platform?.env?.RATE_LIMIT;
		const ip = getClientIp(request);

		if (!kv) {
			logger.warn('RATE_LIMIT KV binding not available; rate limiting is disabled');
		} else {
			if (!ip) {
				return json(
					{ error: 'Unable to determine client IP for rate limiting.' },
					{ status: 400 }
				);
			}

			const { allowed } = await tryConsumeRateLimit(
				kv,
				`${platform?.env?.RATE_LIMIT_ENV ?? 'prod'}:${ip}`,
				estimatedBytes
			);
			if (!allowed) {
				return json(
					{ error: 'Rate limit exceeded. Please try again later.' },
					{ status: 429 }
				);
			}
		}

		logger.info(`Downloading ${sources.length} files for simfile: ${canonicalId}`);

		await validateZipSources(bucket, sources);

		return new Response(buildZipStream(bucket, sources), {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="chart-${canonicalId}.zip"`,
				'Cache-Control': 'private, no-store'
			}
		});
	} catch (error) {
		logger.error(`Download error for simfile ${simfileID}:`, error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
