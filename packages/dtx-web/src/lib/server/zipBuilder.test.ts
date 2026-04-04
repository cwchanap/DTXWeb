import { describe, it, expect, vi } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import JSZip from 'jszip';
import { buildZipStream, createZipSources, fetchR2Entries, validateZipSources } from './zipBuilder';
import type { R2ObjectMeta } from './r2';

const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_GENERAL_PURPOSE_UTF8_AND_DESCRIPTOR_FLAGS = 0x0808;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readStream = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	let done = false;

	while (!done) {
		const { done: streamDone, value } = await reader.read();
		done = streamDone;
		if (done || !value) {
			break;
		}

		chunks.push(value);
		totalLength += value.byteLength;
	}

	const merged = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return merged;
};

const findSignatureOffset = (bytes: Uint8Array, signature: number) => {
	for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
		const value = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
		if (value === signature) {
			return offset;
		}
	}

	return -1;
};

describe('fetchR2Entries', () => {
	it('limits concurrent R2 fetches while preserving entry order', async () => {
		let activeFetches = 0;
		let maxConcurrentFetches = 0;

		const bucket = {
			get: vi.fn(async (key: string) => {
				activeFetches += 1;
				maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);

				return {
					arrayBuffer: async () => {
						await wait(5);
						activeFetches -= 1;
						return new TextEncoder().encode(key).buffer;
					}
				};
			})
		} as unknown as R2Bucket;

		const objects: R2ObjectMeta[] = Array.from({ length: 10 }, (_, index) => ({
			key: `42/file-${index}.dtx`,
			size: 32,
			uploaded: new Date()
		}));

		const entries = await fetchR2Entries(bucket, objects, '42/', 'chart-42');

		expect(entries).toHaveLength(10);
		expect(entries.map((entry) => entry.path)).toEqual(
			objects.map((obj) => `chart-42/${obj.key.slice('42/'.length)}`)
		);
		expect(maxConcurrentFetches).toBeLessThanOrEqual(4);
	});

	it('skips unsafe filenames when building ZIP entries', async () => {
		const bucket = {
			get: vi.fn(async (key: string) => ({
				arrayBuffer: async () => new TextEncoder().encode(key).buffer
			}))
		} as unknown as R2Bucket;

		const objects: R2ObjectMeta[] = [
			{ key: '42/file.dtx', size: 32, uploaded: new Date() },
			{ key: '42/hi:hat.wav', size: 32, uploaded: new Date() },
			{ key: '42/../secret.txt', size: 32, uploaded: new Date() },
			{ key: '42/folder\\evil.dtx', size: 32, uploaded: new Date() },
			{ key: '42/C:/evil.dtx', size: 32, uploaded: new Date() },
			{ key: '42//double-slash.dtx', size: 32, uploaded: new Date() }
		];

		const entries = await fetchR2Entries(bucket, objects, '42/', 'chart-42');

		expect(entries).toHaveLength(2);
		expect(entries.map((entry) => entry.path)).toEqual([
			'chart-42/file.dtx',
			'chart-42/hi:hat.wav'
		]);
		expect(entries[0].data.byteLength).toBeGreaterThan(0);
		expect(entries[1].data.byteLength).toBeGreaterThan(0);
		expect(bucket.get).toHaveBeenCalledTimes(2);
		expect(bucket.get).toHaveBeenCalledWith('42/file.dtx');
		expect(bucket.get).toHaveBeenCalledWith('42/hi:hat.wav');
	});
});

describe('buildZipStream', () => {
	it('streams ZIP contents directly from R2 object bodies', async () => {
		const files = new Map([
			['42/file.dtx', 'chart-body'],
			['42/hi:hat.wav', 'hat-body']
		]);
		const bucket = {
			get: vi.fn(async (key: string) => {
				const content = files.get(key);
				if (!content) {
					return null;
				}

				const encoded = new TextEncoder().encode(content);
				return {
					body: new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(encoded.subarray(0, 3));
							controller.enqueue(encoded.subarray(3));
							controller.close();
						}
					}),
					arrayBuffer: async () => encoded.buffer
				};
			})
		} as unknown as R2Bucket;

		const objects: R2ObjectMeta[] = Array.from(files.entries()).map(([key, value]) => ({
			key,
			size: value.length,
			uploaded: new Date()
		}));
		const zipBytes = await readStream(
			buildZipStream(bucket, createZipSources(objects, '42/', ''))
		);
		const zip = await JSZip.loadAsync(zipBytes);

		expect(await zip.file('file.dtx')?.async('string')).toBe('chart-body');
		expect(await zip.file('hi:hat.wav')?.async('string')).toBe('hat-body');
		expect(bucket.get).toHaveBeenCalledTimes(2);
	});

	it('sets UTF-8 and data descriptor flags for non-ASCII filenames', async () => {
		const files = new Map([['42/テスト.dtx', 'chart-body']]);
		const bucket = {
			get: vi.fn(async (key: string) => {
				const content = files.get(key);
				if (!content) {
					return null;
				}

				const encoded = new TextEncoder().encode(content);
				return {
					body: new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(encoded);
							controller.close();
						}
					}),
					arrayBuffer: async () => encoded.buffer
				};
			})
		} as unknown as R2Bucket;

		const objects: R2ObjectMeta[] = [
			{
				key: '42/テスト.dtx',
				size: 'chart-body'.length,
				uploaded: new Date()
			}
		];
		const zipBytes = await readStream(
			buildZipStream(bucket, createZipSources(objects, '42/', ''))
		);
		const localHeaderView = new DataView(
			zipBytes.buffer,
			zipBytes.byteOffset,
			zipBytes.byteLength
		);
		const centralDirectoryOffset = findSignatureOffset(
			zipBytes,
			ZIP_CENTRAL_DIRECTORY_SIGNATURE
		);

		expect(localHeaderView.getUint16(6, true)).toBe(
			ZIP_GENERAL_PURPOSE_UTF8_AND_DESCRIPTOR_FLAGS
		);
		expect(centralDirectoryOffset).toBeGreaterThanOrEqual(0);
		expect(
			new DataView(
				zipBytes.buffer,
				zipBytes.byteOffset + centralDirectoryOffset,
				46
			).getUint16(8, true)
		).toBe(ZIP_GENERAL_PURPOSE_UTF8_AND_DESCRIPTOR_FLAGS);
	});

	it('fails the ZIP stream when a listed R2 object is missing at fetch time', async () => {
		const bucket = {
			get: vi.fn(async () => null)
		} as unknown as R2Bucket;

		const objects: R2ObjectMeta[] = [
			{
				key: '42/file.dtx',
				size: 10,
				uploaded: new Date()
			}
		];

		await expect(
			readStream(buildZipStream(bucket, createZipSources(objects, '42/', '')))
		).rejects.toThrow('Missing R2 object for ZIP source: 42/file.dtx');
	});

	it('fails the ZIP stream when fetching a listed R2 object throws', async () => {
		const bucket = {
			get: vi.fn(async () => {
				throw new Error('bucket exploded');
			})
		} as unknown as R2Bucket;

		const objects: R2ObjectMeta[] = [
			{
				key: '42/file.dtx',
				size: 10,
				uploaded: new Date()
			}
		];

		await expect(
			readStream(buildZipStream(bucket, createZipSources(objects, '42/', '')))
		).rejects.toThrow('Failed to fetch R2 object for ZIP source: 42/file.dtx');
	});
});

describe('validateZipSources', () => {
	it('resolves when all objects exist in R2', async () => {
		const bucket = {
			head: vi.fn(async () => ({ key: '42/file.dtx', size: 10 }))
		} as unknown as R2Bucket;

		const sources = [{ path: 'file.dtx', objectKey: '42/file.dtx', size: 10 }];

		await expect(validateZipSources(bucket, sources)).resolves.toBeUndefined();
	});

	it('throws when an R2 object is missing', async () => {
		const bucket = {
			head: vi.fn(async () => null)
		} as unknown as R2Bucket;

		const sources = [{ path: 'file.dtx', objectKey: '42/file.dtx', size: 10 }];

		await expect(validateZipSources(bucket, sources)).rejects.toThrow(
			'Missing R2 object for ZIP source: 42/file.dtx'
		);
	});

	it('checks all sources concurrently', async () => {
		const keys = ['42/a.dtx', '42/b.dtx', '42/c.dtx'];
		let maxConcurrent = 0;
		let active = 0;

		const bucket = {
			head: vi.fn(async (key: string) => {
				active += 1;
				maxConcurrent = Math.max(maxConcurrent, active);
				await wait(5);
				active -= 1;
				return { key, size: 10 };
			})
		} as unknown as R2Bucket;

		const sources = keys.map((key) => ({ path: key.slice(4), objectKey: key, size: 10 }));
		await validateZipSources(bucket, sources);

		expect(bucket.head).toHaveBeenCalledTimes(3);
		expect(maxConcurrent).toBe(3);
	});
});
