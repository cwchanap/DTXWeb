import type { R2Bucket } from '@cloudflare/workers-types';
import logger from '$lib/server/logger';

export interface R2ObjectMeta {
	key: string;
	size: number;
	uploaded: Date;
}

/**
 * Lists all R2 objects under a prefix using cursor-based pagination.
 * Throws if the pagination cursor is missing or repeating (broken R2 state).
 */
export const listAllR2Objects = async (
	bucket: R2Bucket,
	prefix: string
): Promise<R2ObjectMeta[]> => {
	const allObjects: R2ObjectMeta[] = [];
	let cursor: string | undefined;
	let isTruncated = true;

	while (isTruncated) {
		const listResult = await bucket.list({ prefix, limit: 1000, cursor });
		const objects = listResult.objects ?? [];
		const mappedObjects = objects.map((obj) => ({
			key: obj.key,
			size: obj.size,
			uploaded: obj.uploaded
		}));
		allObjects.push(...mappedObjects);

		isTruncated = listResult.truncated === true;
		if (isTruncated) {
			const nextCursor = (listResult as { cursor?: string }).cursor;
			if (!nextCursor || nextCursor === cursor) {
				logger.warn(`R2 list truncated without valid cursor for prefix "${prefix}"`);
				throw new Error('R2 pagination cursor unavailable');
			}
			cursor = nextCursor;
		}
	}

	return allObjects;
};
