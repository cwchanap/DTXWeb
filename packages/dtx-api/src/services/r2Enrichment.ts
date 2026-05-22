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
		.filter((obj: R2ObjectMeta) => obj.key.length > prefix.length)
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
	do {
		const listed = await bucket.list({ prefix, cursor });
		for (const obj of listed.objects) {
			if (obj.key.length > prefix.length && !isPreviewKey(obj.key)) {
				return true;
			}
		}
		truncated = listed.truncated;
		cursor = listed.cursor;
	} while (truncated);
	return false;
};

const MAX_CONCURRENT_R2_CHECKS = 4;

export const enrichHasUploadedFilesBatch = async (
	bucket: R2Bucket,
	simfileIds: number[]
): Promise<Map<number, boolean>> => {
	const result = new Map<number, boolean>();
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < simfileIds.length) {
			const idx = nextIndex++;
			const id = simfileIds[idx];
			try {
				result.set(id, await enrichHasUploadedFiles(bucket, id));
			} catch {
				result.set(id, false);
			}
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_CHECKS, simfileIds.length) }, () =>
			worker()
		)
	);

	return result;
};
