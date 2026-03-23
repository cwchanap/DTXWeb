import type { R2Bucket } from '@cloudflare/workers-types';
import JSZip from 'jszip';
import type { R2ObjectMeta } from '$lib/server/r2';

export interface ZipEntry {
	path: string;
	data: ArrayBuffer;
}

const MAX_CONCURRENT_R2_FETCHES = 4;

/**
 * Fetches the body of each R2 object and returns ZipEntry records.
 * Objects whose key yields an empty filename after stripping the keyPrefix are skipped.
 * Objects that R2 returns null for (deleted between list and get) are silently skipped.
 *
 * @param pathPrefix if non-empty, files are nested under this folder in the ZIP
 */
export const fetchR2Entries = async (
	bucket: R2Bucket,
	objects: R2ObjectMeta[],
	keyPrefix: string,
	pathPrefix: string
): Promise<ZipEntry[]> => {
	const entries: Array<ZipEntry | null> = new Array(objects.length).fill(null);
	let nextIndex = 0;

	const fetchEntry = async (obj: R2ObjectMeta): Promise<ZipEntry | null> => {
		const filename = obj.key.startsWith(keyPrefix) ? obj.key.slice(keyPrefix.length) : '';
		if (!filename || filename.includes('..') || filename.startsWith('/')) return null;

		const r2obj = await bucket.get(obj.key);
		if (!r2obj) return null;

		const data = await r2obj.arrayBuffer();
		const path = pathPrefix ? `${pathPrefix}/${filename}` : filename;
		return { path, data } satisfies ZipEntry;
	};

	const workerCount = Math.min(MAX_CONCURRENT_R2_FETCHES, objects.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < objects.length) {
				const currentIndex = nextIndex;
				nextIndex += 1;
				entries[currentIndex] = await fetchEntry(objects[currentIndex]);
			}
		})
	);

	return entries.filter((e): e is ZipEntry => e !== null);
};

/** Builds an in-memory ZIP archive from the provided entries. */
export const buildZip = async (entries: ZipEntry[]): Promise<Uint8Array> => {
	const zip = new JSZip();
	for (const entry of entries) {
		zip.file(entry.path, entry.data);
	}
	return zip.generateAsync({ type: 'uint8array' });
};
