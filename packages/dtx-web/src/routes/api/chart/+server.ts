import { json } from '@sveltejs/kit';
import { getDb, listSimfiles, createSimfile, createDtxFiles, deleteSimfile } from '$lib/server/db';
import { toSimfileWithDtx } from '@dtx/common';
import logger from '$lib/server/logger';
import { hasR2Objects } from '$lib/server/r2';

/** GET /api/chart — List charts (paginated, filtered) */
export const GET = async ({
	url,
	platform,
	locals
}: {
	url: URL;
	platform: App.Platform;
	locals: App.Locals;
}) => {
	const user = locals.user;
	const scope = url.searchParams.get('scope') ?? 'mine';
	if (scope !== 'mine' && scope !== 'published') {
		return json({ error: 'Invalid scope' }, { status: 400 });
	}

	if (scope === 'mine' && !user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const pageRaw = Number(url.searchParams.get('page') ?? '1');
		if (!Number.isInteger(pageRaw) || pageRaw < 1) {
			return json({ error: 'Invalid page' }, { status: 400 });
		}

		const pageSizeRaw = Number(url.searchParams.get('pageSize') ?? '20');
		if (!Number.isInteger(pageSizeRaw) || pageSizeRaw < 1 || pageSizeRaw > 100) {
			return json({ error: 'Invalid pageSize' }, { status: 400 });
		}

		const page = Math.max(1, pageRaw);
		const pageSize = Math.min(100, Math.max(1, pageSizeRaw));

		const db = getDb(platform);
		const search = url.searchParams.get('search') || undefined;

		const { data, count } = await listSimfiles(db, {
			userId: scope === 'mine' ? user?.id : undefined,
			publishedOnly: scope === 'published',
			search,
			page,
			pageSize
		});

		if (scope !== 'published') {
			return json({ data, count });
		}

		const bucket = platform?.env?.DTXFILE_BUCKET;
		if (!bucket) {
			logger.warn('DTXFILE_BUCKET binding not available for chart upload enrichment');
			return json({
				data: data.map((chart) => ({ ...chart, has_uploaded_files: false })),
				count
			});
		}

		const chartsWithUploadAvailability = await Promise.all(
			data.map(async (chart) => {
				const prefix = `${chart.id}/`;
				let hasUploadedFiles = false;

				try {
					hasUploadedFiles = await hasR2Objects(bucket, prefix);
				} catch (error) {
					logger.warn('Failed to determine chart upload availability', {
						chartId: chart.id,
						prefix,
						error
					});
				}

				return {
					...chart,
					has_uploaded_files: hasUploadedFiles
				};
			})
		);

		return json({ data: chartsWithUploadAvailability, count });
	} catch (error) {
		logger.error('Error listing charts:', error);
		return json({ error: 'Failed to list charts' }, { status: 500 });
	}
};

/** POST /api/chart — Create a new chart */
export const POST = async ({
	request,
	platform,
	locals
}: {
	request: Request;
	platform: App.Platform;
	locals: App.Locals;
}) => {
	const user = locals.user;
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

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
	if (typeof payload.bpm !== 'number' || !Number.isFinite(payload.bpm)) {
		return json({ error: 'Invalid bpm' }, { status: 400 });
	}

	if (payload.isPublished !== undefined && typeof payload.isPublished !== 'boolean') {
		return json({ error: 'Invalid isPublished' }, { status: 400 });
	}
	const isPublished = payload.isPublished === undefined ? false : payload.isPublished;

	if (
		payload.displayId !== undefined &&
		payload.displayId !== null &&
		(typeof payload.displayId !== 'number' || !Number.isSafeInteger(payload.displayId))
	) {
		return json({ error: 'Invalid displayId' }, { status: 400 });
	}

	if (
		payload.downloadUrl !== undefined &&
		payload.downloadUrl !== null &&
		typeof payload.downloadUrl !== 'string'
	) {
		return json({ error: 'Invalid downloadUrl' }, { status: 400 });
	}

	if (
		payload.videoPreviewUrl !== undefined &&
		payload.videoPreviewUrl !== null &&
		typeof payload.videoPreviewUrl !== 'string'
	) {
		return json({ error: 'Invalid videoPreviewUrl' }, { status: 400 });
	}

	if (payload.publishDate !== undefined) {
		if (
			typeof payload.publishDate !== 'string' ||
			Number.isNaN(Date.parse(payload.publishDate))
		) {
			return json({ error: 'Invalid publishDate' }, { status: 400 });
		}
	}

	const dtxInput = payload.dtx_files ?? payload.levels;
	if (dtxInput !== undefined) {
		if (!Array.isArray(dtxInput)) {
			return json({ error: 'Invalid dtx files payload' }, { status: 400 });
		}

		for (const entry of dtxInput) {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
				return json({ error: 'Invalid dtx files payload' }, { status: 400 });
			}
			const candidate = entry as Record<string, unknown>;
			if (typeof candidate.label !== 'string') {
				return json({ error: 'Invalid dtx file label' }, { status: 400 });
			}
			if (typeof candidate.level !== 'number' || !Number.isFinite(candidate.level)) {
				return json({ error: 'Invalid dtx file level' }, { status: 400 });
			}
		}
	}

	try {
		const db = getDb(platform);

		const simfile = await createSimfile(db, {
			title: typeof payload.title === 'string' ? payload.title : '',
			artist: typeof payload.artist === 'string' ? payload.artist : '',
			bpm: payload.bpm,
			user_id: user.id,
			is_published: isPublished ? 1 : 0,
			display_id: (payload.displayId as number | null | undefined) ?? null,
			download_url: (payload.downloadUrl as string | null | undefined) ?? null,
			video_preview_url: (payload.videoPreviewUrl as string | null | undefined) ?? null,
			publish_date: payload.publishDate as string | undefined
		});

		// Insert dtx_files if provided (accepts either "dtx_files" or "levels" key)
		let dtxFiles: { level: number; label: string }[] = [];
		if (Array.isArray(dtxInput) && dtxInput.length > 0) {
			try {
				const created = await createDtxFiles(
					db,
					dtxInput.map((entry) => {
						const item = entry as { label: string; level: number };
						return {
							label: item.label,
							level: item.level,
							simfile_id: simfile.id
						};
					})
				);
				dtxFiles = created.map((d) => ({ level: d.level, label: d.label }));
			} catch (createDtxError) {
				try {
					await deleteSimfile(db, simfile.id);
				} catch (deleteError) {
					logger.error('Failed cleanup after createDtxFiles error:', {
						simfileId: simfile.id,
						deleteError
					});
				}
				throw createDtxError;
			}
		}

		return json(toSimfileWithDtx(simfile, dtxFiles), { status: 201 });
	} catch (error) {
		logger.error('Error creating chart:', error);
		return json(
			{
				error: 'Failed to create chart',
				message: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
