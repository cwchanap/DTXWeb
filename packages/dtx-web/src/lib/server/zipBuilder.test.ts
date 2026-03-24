import { describe, it, expect, vi } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { fetchR2Entries } from './zipBuilder';
import type { R2ObjectMeta } from './r2';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
			{ key: '42/../secret.txt', size: 32, uploaded: new Date() },
			{ key: '42/folder\\evil.dtx', size: 32, uploaded: new Date() },
			{ key: '42/C:/evil.dtx', size: 32, uploaded: new Date() },
			{ key: '42//double-slash.dtx', size: 32, uploaded: new Date() }
		];

		const entries = await fetchR2Entries(bucket, objects, '42/', 'chart-42');

		expect(entries).toHaveLength(1);
		expect(entries[0].path).toBe('chart-42/file.dtx');
		expect(entries[0].data.byteLength).toBeGreaterThan(0);
		expect(bucket.get).toHaveBeenCalledTimes(1);
		expect(bucket.get).toHaveBeenCalledWith('42/file.dtx');
	});
});
