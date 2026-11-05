import type { R2Bucket } from '@cloudflare/workers-types';
import { workerLogger } from './workerLogger';

export const FULL_TRACK_AUDIO_EXTENSIONS = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'] as const;

export const r2FileName = (key: string): string => key.split('/').at(-1) ?? '';

export const isTopLevelR2Key = (key: string, prefix: string): boolean =>
	key.startsWith(prefix) && !key.slice(prefix.length).includes('/');

const hasR2FileName = (key: string, filename: string): boolean =>
	r2FileName(key).toLowerCase() === filename.toLowerCase();

export const isTopLevelNamedR2Key = (key: string, prefix: string, filename: string): boolean =>
	isTopLevelR2Key(key, prefix) && hasR2FileName(key, filename);

const trimTrailingSlashes = (value: string): string => {
	let end = value.length;
	while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
	return value.slice(0, end);
};

export const toPublicR2Url = (base: string, key: string): string =>
	`${trimTrailingSlashes(base)}/${key.split('/').map(encodeURIComponent).join('/')}`;

export const selectTopLevelFullTrackObject = <T extends { key: string }>(
	objects: readonly T[],
	prefix: string,
	exclude?: (object: T) => boolean
): T | undefined =>
	objects
		.filter((object) => {
			if (!isTopLevelR2Key(object.key, prefix)) return false;
			if (isPreviewMp3Key(object.key)) return false;
			if (exclude?.(object)) return false;

			const lowerKey = object.key.toLowerCase();
			return FULL_TRACK_AUDIO_EXTENSIONS.some((extension) => lowerKey.endsWith(extension));
		})
		.sort((a, b) => {
			const aKey = a.key.toLowerCase();
			const bKey = b.key.toLowerCase();
			const aExtension = FULL_TRACK_AUDIO_EXTENSIONS.findIndex((extension) =>
				aKey.endsWith(extension)
			);
			const bExtension = FULL_TRACK_AUDIO_EXTENSIONS.findIndex((extension) =>
				bKey.endsWith(extension)
			);
			return aExtension - bExtension || a.key.localeCompare(b.key);
		})[0];

const PREVIEW_FILENAMES = new Set(['preview.jpg', 'preview.mp3']);

export const isPreviewMp3Key = (key: string): boolean => hasR2FileName(key, 'preview.mp3');

export const isPreviewKey = (key: string): boolean =>
	PREVIEW_FILENAMES.has(r2FileName(key).toLowerCase());

export interface R2ObjectMeta {
	key: string;
	size: number;
	uploaded: Date;
}

// Bounds R2 list calls when an adapter keeps returning `truncated: true`
// with fresh cursors. R2 returns up to 1000 objects per page, so 1000
// pages covers ~1M objects under a prefix — far beyond any legitimate
// simfile listing.
const MAX_R2_LIST_PAGES = 1000;

/**
 * Yields each page of R2 objects under a prefix using cursor-based pagination.
 * Consumers can stop iterating early (e.g. on the first matching object);
 * the generator stops fetching pages once iteration ends.
 * Throws if the pagination cursor is missing, repeats any previously seen
 * cursor (broken R2 state), or the page count exceeds MAX_R2_LIST_PAGES.
 */
export const listR2ObjectPages = async function* (
	bucket: R2Bucket,
	prefix: string
): AsyncGenerator<R2ObjectMeta[]> {
	let cursor: string | undefined;
	const seenCursors = new Set<string>();
	let pages = 0;

	while (true) {
		if (++pages > MAX_R2_LIST_PAGES) {
			workerLogger.warn(`R2 list exceeded ${MAX_R2_LIST_PAGES} pages for prefix "${prefix}"`);
			throw new Error('R2 pagination exceeded maximum page count');
		}
		const listResult = await bucket.list({ prefix, limit: 1000, cursor });
		yield (listResult.objects ?? []).map((obj) => ({
			key: obj.key,
			size: obj.size,
			uploaded: obj.uploaded
		}));

		if (!listResult.truncated) return;

		const nextCursor = listResult.cursor;
		if (!nextCursor || seenCursors.has(nextCursor)) {
			workerLogger.warn(`R2 list truncated without valid cursor for prefix "${prefix}"`);
			throw new Error('R2 pagination cursor unavailable');
		}
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}
};

/**
 * Lists all R2 objects under a prefix using cursor-based pagination.
 * Throws if the pagination cursor is missing, repeats any previously seen
 * cursor (broken R2 state), or the page count exceeds MAX_R2_LIST_PAGES.
 */
export const listAllR2Objects = async (
	bucket: R2Bucket,
	prefix: string
): Promise<R2ObjectMeta[]> => {
	const allObjects: R2ObjectMeta[] = [];
	for await (const page of listR2ObjectPages(bucket, prefix)) {
		allObjects.push(...page);
	}
	return allObjects;
};
