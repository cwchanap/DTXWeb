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

export const buildSimfileZipResponse = async (
	bucket: R2Bucket,
	simfileIds: number[],
	opts: ZipStreamOptions
): Promise<{ response: Response; sources: ZipSource[]; estimatedBytes: number }> => {
	const objectsPerSimfile = await Promise.all(
		simfileIds.map((id) => listAllR2Objects(bucket, `${id}/`))
	);

	const sources: ZipSource[] = simfileIds.flatMap((id, i) =>
		createZipSources(
			objectsPerSimfile[i],
			`${id}/`,
			simfileIds.length === 1 ? '' : `chart-${id}`
		)
	);

	const estimatedBytes = sources.reduce((sum, s) => sum + s.size, 0);

	await validateZipSources(bucket, sources);

	const response = new Response(buildZipStream(bucket, sources), {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${opts.filename}"`,
			'Cache-Control': 'private, no-store'
		}
	});

	return { response, sources, estimatedBytes };
};
