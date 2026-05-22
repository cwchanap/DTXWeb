import { listAllR2Objects, isPreviewKey, type R2ObjectMeta } from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';

export type R2FileEntry = {
	key: string;
	size: number;
	uploaded: string;
};

export const enrichFiles = async (bucket: R2Bucket, simfileId: number): Promise<R2FileEntry[]> => {
	const prefix = `${simfileId}/`;
	const objects = await listAllR2Objects(bucket, prefix);
	return objects
		.filter((obj: R2ObjectMeta) => obj.key.length > prefix.length && !isPreviewKey(obj.key))
		.map((obj: R2ObjectMeta) => ({
			key: obj.key,
			size: obj.size,
			uploaded:
				obj.uploaded instanceof Date ? obj.uploaded.toISOString() : String(obj.uploaded)
		}));
};

export const enrichHasUploadedFiles = async (
	bucket: R2Bucket,
	simfileId: number
): Promise<boolean> => {
	const prefix = `${simfileId}/`;
	let cursor: string | undefined;
	let truncated: boolean;
	const MAX_PAGES = 1000;
	let pages = 0;
	do {
		if (++pages > MAX_PAGES) {
			throw new Error(
				`R2 pagination exceeded MAX_PAGES in enrichHasUploadedFiles for simfile ${simfileId}`
			);
		}
		const listed = await bucket.list({ prefix, cursor });
		for (const obj of listed.objects) {
			if (obj.key.length > prefix.length && !isPreviewKey(obj.key)) {
				return true;
			}
		}
		truncated = listed.truncated;
		if (truncated) {
			const nextCursor = (listed as { cursor?: string }).cursor;
			if (!nextCursor || nextCursor === cursor) {
				throw new Error(
					`R2 pagination stalled in enrichHasUploadedFiles for simfile ${simfileId}`
				);
			}
			cursor = nextCursor;
		}
	} while (truncated);
	return false;
};
