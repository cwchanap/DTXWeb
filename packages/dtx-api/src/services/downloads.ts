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
	const objectsPerSimfile = await Promise.all(
		simfileIds.map((id) => listAllR2Objects(bucket, `${id}/`))
	);

	const sourcesBySimfile = simfileIds.map((id, i) => ({
		simfileId: id,
		sources: createZipSources(
			objectsPerSimfile[i],
			`${id}/`,
			simfileIds.length === 1 ? '' : `chart-${id}`
		)
	}));

	const sources = sourcesBySimfile.flatMap(({ sources }) => sources);

	const estimatedBytes = sources.reduce((sum, s) => sum + s.size, 0);

	await validateZipSources(bucket, sources);

	// Sanitize filename for Content-Disposition header to prevent injection.
	const safeName = opts.filename.replace(/[\r\n"]/g, '').trim();
	const fallbackName = safeName || `download_${Date.now()}.zip`;
	const response = new Response(buildZipStream(bucket, sources), {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${fallbackName}"`,
			'Cache-Control': 'private, no-store'
		}
	});

	return { response, sources, sourcesBySimfile, estimatedBytes };
};
