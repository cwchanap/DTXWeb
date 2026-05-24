import { listAllR2Objects, isPreviewKey, type R2ObjectMeta } from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';

export type R2FileEntry = {
	key: string;
	size: number;
	uploaded: string;
};

/**
 * Maximum number of concurrent R2 list calls when batch-enriching
 * hasUploadedFiles for a list of simfiles. Matches the cap used in the
 * dtx-web REST endpoint (MAX_CONCURRENT_R2_CHECKS = 4).
 */
const MAX_CONCURRENT_R2_LIST = 4;

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

/**
 * Batch-enrich `files` for multiple simfiles with bounded concurrency.
 * Returns a Map of simfileId → R2FileEntry[].
 *
 * Mirrors batchEnrichHasUploadedFiles to avoid unbounded R2 fan-out
 * when GraphQL resolves `files` for a list of simfiles.
 */
export const batchEnrichFiles = async (
	bucket: R2Bucket,
	simfileIds: number[]
): Promise<Map<number, R2FileEntry[]>> => {
	const results = new Map<number, R2FileEntry[]>();
	if (simfileIds.length === 0) return results;

	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < simfileIds.length) {
			const idx = nextIndex++;
			const id = simfileIds[idx];
			results.set(id, await enrichFiles(bucket, id));
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_LIST, simfileIds.length) }, () => worker())
	);
	return results;
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

/**
 * Batch-enrich `hasUploadedFiles` for multiple simfiles with bounded
 * concurrency. Returns a Map of simfileId → boolean.
 *
 * This should be used by GraphQL resolvers that resolve `hasUploadedFiles`
 * for a list of simfiles, to avoid unbounded R2 list fan-out.
 */
export const batchEnrichHasUploadedFiles = async (
	bucket: R2Bucket,
	simfileIds: number[]
): Promise<Map<number, boolean>> => {
	const results = new Map<number, boolean>();
	if (simfileIds.length === 0) return results;

	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < simfileIds.length) {
			const idx = nextIndex++;
			const id = simfileIds[idx];
			results.set(id, await enrichHasUploadedFiles(bucket, id));
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(MAX_CONCURRENT_R2_LIST, simfileIds.length) }, () => worker())
	);
	return results;
};
