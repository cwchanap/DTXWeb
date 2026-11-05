import type { R2Bucket } from '@cloudflare/workers-types';
import { workerLogger } from './workerLogger';

export const FULL_TRACK_AUDIO_EXTENSIONS = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'] as const;

export const r2FileName = (key: string): string => key.split('/').at(-1) ?? '';

export const isTopLevelR2Key = (key: string, prefix: string): boolean =>
	key.startsWith(prefix) && !key.slice(prefix.length).includes('/');

export const isTopLevelNamedR2Key = (key: string, prefix: string, filename: string): boolean =>
	isTopLevelR2Key(key, prefix) && r2FileName(key).toLowerCase() === filename.toLowerCase();

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
			if (r2FileName(object.key).toLowerCase() === 'preview.mp3') return false;
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

export const isPreviewKey = (key: string): boolean => {
	const filename = key.slice(key.lastIndexOf('/') + 1);
	return PREVIEW_FILENAMES.has(filename);
};

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
				workerLogger.warn(`R2 list truncated without valid cursor for prefix "${prefix}"`);
				throw new Error('R2 pagination cursor unavailable');
			}
			cursor = nextCursor;
		}
	}

	return allObjects;
};
