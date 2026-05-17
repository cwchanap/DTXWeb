import type { R2Bucket } from '@cloudflare/workers-types';
import { isPreviewKey, type R2ObjectMeta } from './r2';
import logger from './logger';

export interface ZipEntry {
	path: string;
	data: ArrayBuffer;
}

export interface ZipSource {
	path: string;
	objectKey: string;
	size: number;
}

const MAX_CONCURRENT_R2_FETCHES = 4;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_GENERAL_PURPOSE_FLAGS = ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG;
const ZIP_STORE_COMPRESSION = 0;
const ZIP_MAX_32BIT_VALUE = 0xffffffff;
const ZIP_MAX_16BIT_VALUE = 0xffff;
const textEncoder = new TextEncoder();

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < table.length; i += 1) {
		let crc = i;
		for (let j = 0; j < 8; j += 1) {
			crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
		}
		table[i] = crc >>> 0;
	}
	return table;
})();

const isSafeFilename = (filename: string): boolean => {
	if (!filename || filename.startsWith('/') || filename.startsWith('\\')) {
		return false;
	}

	const segments = filename.split('/');
	return segments.every(
		(segment) =>
			segment.length > 0 &&
			segment !== '.' &&
			segment !== '..' &&
			!segment.includes('\\') &&
			!/^[A-Za-z]:$/.test(segment)
	);
};

const toZipPath = (objectKey: string, keyPrefix: string, pathPrefix: string): string | null => {
	const filename = objectKey.startsWith(keyPrefix) ? objectKey.slice(keyPrefix.length) : '';
	if (!isSafeFilename(filename)) {
		return null;
	}

	return pathPrefix ? `${pathPrefix}/${filename}` : filename;
};

const updateCrc32 = (crc: number, chunk: Uint8Array): number => {
	let next = crc >>> 0;
	for (const byte of chunk) {
		next = crcTable[(next ^ byte) & 0xff] ^ (next >>> 8);
	}
	return next >>> 0;
};

const createLocalFileHeader = (pathBytes: Uint8Array): Uint8Array => {
	const header = new Uint8Array(30 + pathBytes.length);
	const view = new DataView(header.buffer);
	view.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
	view.setUint16(4, ZIP_VERSION, true);
	view.setUint16(6, ZIP_GENERAL_PURPOSE_FLAGS, true);
	view.setUint16(8, ZIP_STORE_COMPRESSION, true);
	view.setUint16(10, 0, true);
	view.setUint16(12, 0, true);
	view.setUint32(14, 0, true);
	view.setUint32(18, 0, true);
	view.setUint32(22, 0, true);
	view.setUint16(26, pathBytes.length, true);
	view.setUint16(28, 0, true);
	header.set(pathBytes, 30);
	return header;
};

const createDataDescriptor = (crc32: number, size: number): Uint8Array => {
	const descriptor = new Uint8Array(16);
	const view = new DataView(descriptor.buffer);
	view.setUint32(0, ZIP_DATA_DESCRIPTOR_SIGNATURE, true);
	view.setUint32(4, crc32 >>> 0, true);
	view.setUint32(8, size >>> 0, true);
	view.setUint32(12, size >>> 0, true);
	return descriptor;
};

const createCentralDirectoryEntry = (
	pathBytes: Uint8Array,
	crc32: number,
	size: number,
	offset: number
): Uint8Array => {
	const entry = new Uint8Array(46 + pathBytes.length);
	const view = new DataView(entry.buffer);
	view.setUint32(0, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
	view.setUint16(4, ZIP_VERSION, true);
	view.setUint16(6, ZIP_VERSION, true);
	view.setUint16(8, ZIP_GENERAL_PURPOSE_FLAGS, true);
	view.setUint16(10, ZIP_STORE_COMPRESSION, true);
	view.setUint16(12, 0, true);
	view.setUint16(14, 0, true);
	view.setUint32(16, crc32 >>> 0, true);
	view.setUint32(20, size >>> 0, true);
	view.setUint32(24, size >>> 0, true);
	view.setUint16(28, pathBytes.length, true);
	view.setUint16(30, 0, true);
	view.setUint16(32, 0, true);
	view.setUint16(34, 0, true);
	view.setUint16(36, 0, true);
	view.setUint32(38, 0, true);
	view.setUint32(42, offset >>> 0, true);
	entry.set(pathBytes, 46);
	return entry;
};

const createEndOfCentralDirectory = (
	entriesCount: number,
	centralDirectorySize: number,
	offset: number
) => {
	const record = new Uint8Array(22);
	const view = new DataView(record.buffer);
	view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
	view.setUint16(4, 0, true);
	view.setUint16(6, 0, true);
	view.setUint16(8, entriesCount, true);
	view.setUint16(10, entriesCount, true);
	view.setUint32(12, centralDirectorySize >>> 0, true);
	view.setUint32(16, offset >>> 0, true);
	view.setUint16(20, 0, true);
	return record;
};

const ensureZip32Range = (value: number, label: string) => {
	if (!Number.isInteger(value) || value < 0 || value > ZIP_MAX_32BIT_VALUE) {
		throw new Error(`${label} exceeds ZIP32 limits`);
	}
};

export const createZipSources = (
	objects: R2ObjectMeta[],
	keyPrefix: string,
	pathPrefix: string
): ZipSource[] =>
	objects
		.filter((obj) => !isPreviewKey(obj.key))
		.flatMap((obj) => {
			const path = toZipPath(obj.key, keyPrefix, pathPrefix);
			if (!path) {
				return [];
			}

			return [
				{
					path,
					objectKey: obj.key,
					size: obj.size
				} satisfies ZipSource
			];
		});

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
		const path = toZipPath(obj.key, keyPrefix, pathPrefix);
		if (!path) return null;

		try {
			const r2obj = await bucket.get(obj.key);
			if (!r2obj) return null;

			const data = await r2obj.arrayBuffer();
			return { path, data } satisfies ZipEntry;
		} catch (error) {
			logger.warn(`Failed to fetch R2 object: ${obj.key}`, error);
			return null;
		}
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

export const validateZipSources = async (bucket: R2Bucket, sources: ZipSource[]): Promise<void> => {
	const headResults = await Promise.all(sources.map((source) => bucket.head(source.objectKey)));
	for (let i = 0; i < sources.length; i += 1) {
		if (!headResults[i]) {
			throw new Error(`Missing R2 object for ZIP source: ${sources[i].objectKey}`);
		}
	}
};

const zipChunks = async function* (
	bucket: R2Bucket,
	sources: ZipSource[]
): AsyncGenerator<Uint8Array> {
	let offset = 0;
	const centralDirectoryEntries: Array<{
		pathBytes: Uint8Array;
		crc32: number;
		size: number;
		offset: number;
	}> = [];

	for (const source of sources) {
		ensureZip32Range(source.size, `File size for ${source.path}`);

		let r2obj;
		try {
			r2obj = await bucket.get(source.objectKey);
		} catch (error) {
			logger.warn(`Failed to fetch R2 object: ${source.objectKey}`, error);
			throw new Error(`Failed to fetch R2 object for ZIP source: ${source.objectKey}`);
		}

		if (!r2obj) {
			throw new Error(`Missing R2 object for ZIP source: ${source.objectKey}`);
		}

		const pathBytes = textEncoder.encode(source.path);
		const localHeader = createLocalFileHeader(pathBytes);
		ensureZip32Range(offset, `ZIP offset for ${source.path}`);
		const localHeaderOffset = offset;
		yield localHeader;
		offset += localHeader.byteLength;

		let crc32 = 0xffffffff;
		let size = 0;

		if (r2obj.body) {
			const reader = r2obj.body.getReader();
			let streamDone = false;
			while (!streamDone) {
				const { done, value } = await reader.read();
				streamDone = done;
				if (streamDone) {
					break;
				}

				const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
				size += chunk.byteLength;
				ensureZip32Range(size, `Streamed size for ${source.path}`);
				crc32 = updateCrc32(crc32, chunk);
				yield chunk;
				offset += chunk.byteLength;
			}
		} else {
			const chunk = new Uint8Array(await r2obj.arrayBuffer());
			size = chunk.byteLength;
			ensureZip32Range(size, `Buffered size for ${source.path}`);
			crc32 = updateCrc32(crc32, chunk);
			yield chunk;
			offset += chunk.byteLength;
		}

		const finalizedCrc32 = (crc32 ^ 0xffffffff) >>> 0;
		const descriptor = createDataDescriptor(finalizedCrc32, size);
		yield descriptor;
		offset += descriptor.byteLength;

		centralDirectoryEntries.push({
			pathBytes,
			crc32: finalizedCrc32,
			size,
			offset: localHeaderOffset
		});
	}

	ensureZip32Range(offset, 'Central directory offset');
	const centralDirectoryOffset = offset;
	for (const entry of centralDirectoryEntries) {
		const record = createCentralDirectoryEntry(
			entry.pathBytes,
			entry.crc32,
			entry.size,
			entry.offset
		);
		yield record;
		offset += record.byteLength;
	}

	const centralDirectorySize = offset - centralDirectoryOffset;
	ensureZip32Range(centralDirectoryEntries.length, 'ZIP entry count');
	ensureZip32Range(centralDirectorySize, 'Central directory size');
	if (centralDirectoryEntries.length > ZIP_MAX_16BIT_VALUE) {
		throw new Error(
			`ZIP entry count ${centralDirectoryEntries.length} exceeds 16-bit field limit (${ZIP_MAX_16BIT_VALUE}); ZIP64 not supported`
		);
	}
	const endOfCentralDirectory = createEndOfCentralDirectory(
		centralDirectoryEntries.length,
		centralDirectorySize,
		centralDirectoryOffset
	);
	yield endOfCentralDirectory;
};

export const buildZipStream = (
	bucket: R2Bucket,
	sources: ZipSource[]
): ReadableStream<Uint8Array> => {
	const iterator = zipChunks(bucket, sources);
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { value, done } = await iterator.next();
			if (done) {
				controller.close();
			} else {
				controller.enqueue(value);
			}
		},
		cancel() {
			iterator.return(undefined);
		}
	});
};
