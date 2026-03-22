import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';
import { getDb, getSimfileOwner } from '$lib/server/db';
import { listAllR2Objects } from '$lib/server/r2';
import { fetchR2Entries, buildZip } from '$lib/server/zipBuilder';
import { tryConsumeRateLimit } from '$lib/server/rateLimiter';

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
		const estimatedBytes = objects.reduce((sum, obj) => sum + obj.size, 0);

		// Rate limiting — skipped in local dev when KV binding is absent
		const kv = platform?.env?.RATE_LIMIT;
		const ip = (
			request.headers.get('cf-connecting-ip') ??
			request.headers.get('x-forwarded-for') ??
			'unknown'
		)
			.split(',')[0]
			.trim();

		if (kv) {
			const { allowed } = await tryConsumeRateLimit(kv, ip, estimatedBytes);
			if (!allowed) {
				return json(
					{ error: 'Rate limit exceeded. Please try again later.' },
					{ status: 429 }
				);
			}
		}

		logger.info(`Downloading ${objects.length} files for simfile: ${canonicalId}`);

		const entries = await fetchR2Entries(bucket, objects, `${canonicalId}/`, '');

		if (entries.length === 0) {
			return json({ error: 'No files found for this chart' }, { status: 404 });
		}

		const zip = await buildZip(entries);

		return new Response(zip, {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="chart-${canonicalId}.zip"`,
				'Content-Length': String(zip.byteLength)
			}
		});
	} catch (error) {
		logger.error('Download error:', error);
		return json(
			{
				error: 'Internal server error',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
