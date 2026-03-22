import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';
import { getDb, getSimfileOwner } from '$lib/server/db';
import { listAllR2Objects } from '$lib/server/r2';
import { fetchR2Entries, buildZip } from '$lib/server/zipBuilder';
import { tryConsumeRateLimit } from '$lib/server/rateLimiter';

const MAX_BULK_IDS = 20;

export const POST = async ({
	request,
	platform,
	locals
}: {
	request: Request;
	platform: App.Platform;
	locals: App.Locals;
}) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const payload = body as Record<string, unknown>;
	const ids = payload.ids;

	if (!Array.isArray(ids) || ids.length === 0) {
		return json({ error: 'ids must be a non-empty array' }, { status: 400 });
	}

	if (ids.length > MAX_BULK_IDS) {
		return json(
			{ error: `Cannot download more than ${MAX_BULK_IDS} charts at once` },
			{ status: 400 }
		);
	}

	for (const id of ids) {
		if (
			typeof id !== 'number' ||
			!Number.isInteger(id) ||
			id <= 0 ||
			!Number.isSafeInteger(id)
		) {
			return json({ error: 'All ids must be positive integers' }, { status: 400 });
		}
	}

	try {
		const db = getDb(platform);
		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.error('DTXFILE_BUCKET binding not available');
			return json({ error: 'Bucket not available' }, { status: 500 });
		}

		const user = locals.user;

		// Resolve which IDs are accessible: published OR owned by the authenticated user
		const simfileResults = await Promise.all(
			(ids as number[]).map(async (id) => {
				const simfile = await getSimfileOwner(db, id);
				if (!simfile) return null;
				if (simfile.is_published || (user && simfile.user_id === user.id)) return id;
				return null;
			})
		);
		const accessibleIds = simfileResults.filter((id): id is number => id !== null);

		if (accessibleIds.length === 0) {
			return json(
				{ error: 'No accessible charts found for the provided ids' },
				{ status: 404 }
			);
		}

		// List all objects per simfile for rate limit size estimation
		const objectsPerSimfile = await Promise.all(
			accessibleIds.map((id) => listAllR2Objects(bucket, `${id}/`))
		);

		const estimatedBytes = objectsPerSimfile.flat().reduce((sum, obj) => sum + obj.size, 0);

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

		logger.info(`Bulk downloading ${accessibleIds.length} simfiles for IP ${ip}`);

		// Fetch file contents for each simfile, nested under chart-{id}/ in the ZIP
		const entriesPerSimfile = await Promise.all(
			accessibleIds.map((id, i) =>
				fetchR2Entries(bucket, objectsPerSimfile[i], `${id}/`, `chart-${id}`)
			)
		);

		const allEntries = entriesPerSimfile.flat();

		if (allEntries.length === 0) {
			return json({ error: 'No files found for the requested charts' }, { status: 404 });
		}

		const zip = await buildZip(allEntries);

		return new Response(zip, {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': 'attachment; filename="drumery-charts.zip"',
				'Content-Length': String(zip.byteLength)
			}
		});
	} catch (error) {
		logger.error('Bulk download error:', error);
		return json(
			{
				error: 'Internal server error',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
