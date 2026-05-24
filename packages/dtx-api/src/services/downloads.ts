import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import {
	getSimfileOwner,
	listAllR2Objects,
	createZipSources,
	validateZipSources,
	buildZipStream,
	type ZipSource
} from '@dtx/common/server';

export type AccessResult = {
	accessible: number[];
	unauthorized: number[];
	forbidden: number[];
	missing: number[];
};

export const resolveAccessibleSimfiles = async (
	db: D1Database,
	ids: number[],
	user: { id: string } | null
): Promise<AccessResult> => {
	const accessible: number[] = [];
	const unauthorized: number[] = [];
	const forbidden: number[] = [];
	const missing: number[] = [];

	await Promise.all(
		ids.map(async (id) => {
			const owner = await getSimfileOwner(db, id);
			if (!owner) {
				missing.push(id);
				return;
			}
			if (owner.is_published === 1 || (user && owner.user_id === user.id)) {
				accessible.push(id);
				return;
			}
			if (user) {
				forbidden.push(id);
			} else {
				unauthorized.push(id);
			}
		})
	);

	return { accessible, unauthorized, forbidden, missing };
};

export type ZipStreamOptions = {
	filename: string;
};

export type SimfileZipSources = {
	simfileId: number;
	sources: ZipSource[];
};

export type CollectedZipSources = {
	sources: ZipSource[];
	sourcesBySimfile: SimfileZipSources[];
	estimatedBytes: number;
};

export type CollectZipSourcesOptions = {
	/**
	 * When true and only one simfile is selected, omit the `chart-{id}/` prefix
	 * so files sit at the ZIP root. The bulk endpoint should NOT set this — it
	 * always nests under `chart-{id}/` for consistent layout regardless of count.
	 */
	flatSingle?: boolean;
};

/**
 * Maximum number of concurrent R2 list calls when collecting ZIP sources.
 * Keeps R2 fan-out bounded even if the caller passes many simfile IDs.
 */
const MAX_CONCURRENT_R2_LIST = 4;

/**
 * Phase 1: List R2 objects and collect ZIP sources.
 * This issues R2 list calls (one per simfile) with bounded concurrency
 * but does NOT validate individual objects with HEAD requests — callers
 * can check rate limits, validation-only mode, etc. before committing
 * to HEAD checks.
 */
export const collectZipSources = async (
	bucket: R2Bucket,
	simfileIds: number[],
	opts: CollectZipSourcesOptions = {}
): Promise<CollectedZipSources> => {
	const objectsPerSimfile: Awaited<ReturnType<typeof listAllR2Objects>>[] = new Array(
		simfileIds.length
	);

	if (simfileIds.length > 0) {
		let nextIndex = 0;
		const worker: () => Promise<void> = async () => {
			while (nextIndex < simfileIds.length) {
				const idx = nextIndex++;
				objectsPerSimfile[idx] = await listAllR2Objects(bucket, `${simfileIds[idx]}/`);
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(MAX_CONCURRENT_R2_LIST, simfileIds.length) }, () =>
				worker()
			)
		);
	}

	const sourcesBySimfile = simfileIds.map((id, i) => ({
		simfileId: id,
		sources: createZipSources(
			objectsPerSimfile[i],
			`${id}/`,
			opts.flatSingle && simfileIds.length === 1 ? '' : `chart-${id}`
		)
	}));

	const sources = sourcesBySimfile.flatMap(({ sources }) => sources);

	const estimatedBytes = sources.reduce((sum, s) => sum + s.size, 0);

	return { sources, sourcesBySimfile, estimatedBytes };
};

/**
 * Phase 2: Validate sources with HEAD checks and build the streaming Response.
 * Only call this when the download is actually allowed — after rate limit
 * checks, validation-only exits, etc.
 */
export const buildValidatedZipResponse = (
	bucket: R2Bucket,
	sources: ZipSource[],
	opts: ZipStreamOptions
): Promise<Response> => {
	return validateZipSources(bucket, sources).then(() => {
		// Sanitize filename for Content-Disposition header to prevent injection.
		const safeName = opts.filename.replace(/[\r\n"]/g, '').trim();
		const fallbackName = safeName || `download_${Date.now()}.zip`;
		return new Response(buildZipStream(bucket, sources), {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${fallbackName}"`,
				'Cache-Control': 'private, no-store'
			}
		});
	});
};

/**
 * Convenience wrapper: collect + validate + respond in one call.
 * Use this when you don't need cheap-exit checks between phases.
 */
export const buildSimfileZipResponse = async (
	bucket: R2Bucket,
	simfileIds: number[],
	opts: ZipStreamOptions
): Promise<{
	response: Response;
	sources: ZipSource[];
	sourcesBySimfile: SimfileZipSources[];
	estimatedBytes: number;
}> => {
	const collected = await collectZipSources(bucket, simfileIds);
	const response = await buildValidatedZipResponse(bucket, collected.sources, opts);
	return { response, ...collected };
};
