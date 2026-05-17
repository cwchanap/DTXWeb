import { json, type RequestEvent } from '@sveltejs/kit';
import {
	logger,
	getClientIp,
	tryConsumeRateLimit,
	listAllR2Objects,
	buildZipStream,
	createZipSources,
	validateZipSources
} from '@dtx/common/server';
import { getDb, getSimfileOwner } from '$lib/server/db';

const MAX_BULK_IDS = 20;

const parseRequestedIds = (rawIds: unknown): number[] | null => {
	if (!Array.isArray(rawIds) || rawIds.length === 0) {
		return null;
	}

	const parsedIds: number[] = [];

	for (const rawId of rawIds) {
		if (typeof rawId === 'number') {
			if (!Number.isInteger(rawId) || rawId <= 0 || !Number.isSafeInteger(rawId)) {
				return null;
			}

			parsedIds.push(rawId);
			continue;
		}

		if (typeof rawId === 'string' && /^\d+$/.test(rawId)) {
			const parsedId = Number(rawId);
			if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
				return null;
			}

			parsedIds.push(parsedId);
			continue;
		}

		return null;
	}

	return parsedIds;
};

const parseRequestBody = async (request: Request): Promise<Record<string, unknown>> => {
	const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();

	if (
		contentType === 'application/x-www-form-urlencoded' ||
		contentType === 'multipart/form-data'
	) {
		const formData = await request.formData();
		return { ids: formData.getAll('ids') };
	}

	const body = await request.json();
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new Error('Invalid request body');
	}

	return body as Record<string, unknown>;
};

const anonymizeIp = (ip: string): string => {
	const octets = ip.split('.');
	if (octets.length === 4) {
		return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
	}

	if (ip.includes(':')) {
		return `${ip.split(':').slice(0, 4).join(':')}:*`;
	}

	return 'redacted';
};

export const POST = async (event: RequestEvent) => {
	const { request, platform, locals } = event;
	let payload: Record<string, unknown>;
	try {
		payload = await parseRequestBody(request);
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	if (!Array.isArray(payload.ids) || payload.ids.length === 0) {
		return json({ error: 'ids must be a non-empty array' }, { status: 400 });
	}

	const rawIds = parseRequestedIds(payload.ids);

	if (!rawIds) {
		return json({ error: 'All ids must be positive integers' }, { status: 400 });
	}

	const ids = [...new Set(rawIds)];

	if (ids.length > MAX_BULK_IDS) {
		return json(
			{ error: `Cannot download more than ${MAX_BULK_IDS} charts at once` },
			{ status: 400 }
		);
	}

	const requestUrl = new URL(request.url);
	const validateOnly = requestUrl.searchParams.get('validate') === '1';

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
			ids.map(async (id) => {
				const simfile = await getSimfileOwner(db, id);
				if (!simfile) return { id, status: 'not_found' as const };
				if (simfile.is_published === 1 || (user && simfile.user_id === user.id)) {
					return { id, status: 'accessible' as const };
				}
				return { id, status: user ? ('forbidden' as const) : ('unauthorized' as const) };
			})
		);
		const accessibleIds = simfileResults
			.filter((result) => result.status === 'accessible')
			.map((result) => result.id);
		const unauthorizedIds = simfileResults
			.filter((result) => result.status === 'unauthorized')
			.map((result) => result.id);
		const forbiddenIds = simfileResults
			.filter((result) => result.status === 'forbidden')
			.map((result) => result.id);
		const missingIds = simfileResults
			.filter((result) => result.status === 'not_found')
			.map((result) => result.id);

		if (unauthorizedIds.length > 0) {
			return json({ error: 'Unauthorized', ids: unauthorizedIds }, { status: 401 });
		}

		if (forbiddenIds.length > 0) {
			return json({ error: 'Forbidden', ids: forbiddenIds }, { status: 403 });
		}

		if (missingIds.length > 0) {
			return json({ error: 'Simfile not found', ids: missingIds }, { status: 404 });
		}

		// List all objects per simfile and filter through createZipSources
		const objectsPerSimfile = await Promise.all(
			accessibleIds.map((id) => listAllR2Objects(bucket, `${id}/`))
		);

		const filteredSourcesPerSimfile = accessibleIds.map((id, i) =>
			createZipSources(objectsPerSimfile[i], `${id}/`, `chart-${id}`)
		);

		const estimatedBytes = filteredSourcesPerSimfile
			.flat()
			.reduce((sum, src) => sum + src.size, 0);
		const missingUploadIds = filteredSourcesPerSimfile
			.map((sources, index) => (sources.length === 0 ? accessibleIds[index] : null))
			.filter((id): id is number => id !== null);

		if (missingUploadIds.length > 0) {
			return json(
				{
					error: 'Some selected charts do not have uploaded files available.',
					ids: missingUploadIds
				},
				{ status: 400 }
			);
		}

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
				estimatedBytes,
				undefined,
				!validateOnly
			);
			if (!allowed) {
				return json(
					{ error: 'Rate limit exceeded. Please try again later.' },
					{ status: 429 }
				);
			}
		}

		const allSources = filteredSourcesPerSimfile.flat();

		if (validateOnly) {
			return json({ ok: true, fileCount: allSources.length });
		}

		if (allSources.length === 0) {
			return json({ error: 'No files found for the requested charts' }, { status: 404 });
		}

		const requestId = request.headers.get('cf-ray') ?? request.headers.get('x-request-id');
		logger.info(`Bulk downloading ${accessibleIds.length} simfiles`, {
			anonymizedIp: ip ? anonymizeIp(ip) : 'redacted',
			...(requestId ? { requestId } : {})
		});

		await validateZipSources(bucket, allSources);

		return new Response(buildZipStream(bucket, allSources), {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': 'attachment; filename="drumery-charts.zip"'
			}
		});
	} catch (error) {
		logger.error(`Bulk download error for ids [${ids.join(',')}]:`, error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
