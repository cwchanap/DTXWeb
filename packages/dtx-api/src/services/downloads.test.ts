import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAccessibleSimfiles, collectZipSources } from './downloads';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

vi.mock('@dtx/common/server', async () => {
	const actual = await vi.importActual<typeof import('@dtx/common/server')>('@dtx/common/server');
	return {
		...actual,
		getSimfileOwner: vi.fn(),
		listAllR2Objects: vi.fn(),
		createZipSources: vi.fn()
	};
});

const { getSimfileOwner, listAllR2Objects, createZipSources } = await import('@dtx/common/server');
const mockedGetOwner = vi.mocked(getSimfileOwner);
const mockedListAll = vi.mocked(listAllR2Objects);
const mockedCreateZipSources = vi.mocked(createZipSources);

beforeEach(() => {
	mockedGetOwner.mockReset();
	mockedListAll.mockReset();
	mockedCreateZipSources.mockReset();
});

describe('resolveAccessibleSimfiles', () => {
	it('classifies all four statuses correctly', async () => {
		mockedGetOwner.mockImplementation(async (_db, id) => {
			if (id === 1) return { user_id: 'u1', is_published: 1 };
			if (id === 2) return { user_id: 'u1', is_published: 0 };
			if (id === 3) return { user_id: 'someone', is_published: 0 };
			return null;
		});

		const result = await resolveAccessibleSimfiles({} as D1Database, [1, 2, 3, 4], {
			id: 'u1'
		} as { id: string });
		expect(result.accessible.sort()).toEqual([1, 2]);
		expect(result.unauthorized).toEqual([]);
		expect(result.forbidden).toEqual([3]);
		expect(result.missing).toEqual([4]);
	});

	it('marks unpublished + non-owner as unauthorized when no user is provided', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 0 });
		const result = await resolveAccessibleSimfiles({} as D1Database, [5], null);
		expect(result.unauthorized).toEqual([5]);
		expect(result.forbidden).toEqual([]);
	});

	it('treats published as accessible regardless of user', async () => {
		mockedGetOwner.mockResolvedValue({ user_id: 'someone', is_published: 1 });
		const result = await resolveAccessibleSimfiles({} as D1Database, [6], null);
		expect(result.accessible).toEqual([6]);
	});
});

describe('collectZipSources', () => {
	const fakeObjects = [{ key: '42/a.dtx', size: 100, uploaded: new Date() }];

	beforeEach(() => {
		mockedListAll.mockResolvedValue(fakeObjects);
		mockedCreateZipSources.mockReturnValue([
			{ objectKey: '42/a.dtx', size: 100, path: 'a.dtx' }
		]);
	});

	it('uses chart-{id} prefix by default for single simfile (bulk behavior)', async () => {
		await collectZipSources({} as R2Bucket, [42]);
		expect(mockedCreateZipSources).toHaveBeenCalledWith(fakeObjects, '42/', 'chart-42');
	});

	it('uses empty prefix when flatSingle is true and single simfile', async () => {
		await collectZipSources({} as R2Bucket, [42], { flatSingle: true });
		expect(mockedCreateZipSources).toHaveBeenCalledWith(fakeObjects, '42/', '');
	});

	it('uses chart-{id} prefix for multiple simfiles even with flatSingle', async () => {
		mockedListAll.mockResolvedValue([{ key: '1/a.dtx', size: 50, uploaded: new Date() }]);
		await collectZipSources({} as R2Bucket, [1, 2], { flatSingle: true });
		expect(mockedCreateZipSources).toHaveBeenCalledTimes(2);
		expect(mockedCreateZipSources).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			'1/',
			'chart-1'
		);
		expect(mockedCreateZipSources).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			'2/',
			'chart-2'
		);
	});

	it('limits concurrent R2 list calls', async () => {
		// Use slow mocks to observe concurrency. Track max concurrent calls.
		let inFlight = 0;
		let maxInFlight = 0;
		mockedListAll.mockImplementation(async () => {
			inFlight++;
			if (inFlight > maxInFlight) maxInFlight = inFlight;
			// Yield to let other calls start
			await new Promise((r) => setTimeout(r, 10));
			inFlight--;
			return [{ key: '1/a.dtx', size: 50, uploaded: new Date() }];
		});
		mockedCreateZipSources.mockReturnValue([{ objectKey: '1/a.dtx', size: 50, path: 'a.dtx' }]);

		// 8 IDs but concurrency should be capped at 4
		await collectZipSources({} as R2Bucket, [1, 2, 3, 4, 5, 6, 7, 8]);
		expect(maxInFlight).toBeLessThanOrEqual(4);
		expect(mockedListAll).toHaveBeenCalledTimes(8);
	});

	it('returns empty result for empty simfileIds', async () => {
		const result = await collectZipSources({} as R2Bucket, []);
		expect(result.sources).toEqual([]);
		expect(result.sourcesBySimfile).toEqual([]);
		expect(result.estimatedBytes).toBe(0);
		expect(mockedListAll).not.toHaveBeenCalled();
	});

	const zipInputKeys = (): string[] =>
		(mockedCreateZipSources.mock.calls[0][0] as Array<{ key: string }>).map(
			(object) => object.key
		);

	it('keeps music.ogg and drops canonical bgm.m4a when both exist', async () => {
		mockedListAll.mockResolvedValue([
			{ key: '42/music.ogg', size: 200, uploaded: new Date() },
			{ key: '42/bgm.m4a', size: 150, uploaded: new Date() },
			{ key: '42/chart.dtx', size: 50, uploaded: new Date() }
		]);

		await collectZipSources({} as R2Bucket, [42]);

		expect(zipInputKeys()).toEqual(expect.arrayContaining(['42/music.ogg', '42/chart.dtx']));
		expect(zipInputKeys()).not.toContain('42/bgm.m4a');
	});

	it('keeps song.mp3 and drops canonical bgm.m4a when both exist', async () => {
		mockedListAll.mockResolvedValue([
			{ key: '42/song.mp3', size: 200, uploaded: new Date() },
			{ key: '42/bgm.m4a', size: 150, uploaded: new Date() }
		]);

		await collectZipSources({} as R2Bucket, [42]);

		expect(zipInputKeys()).toContain('42/song.mp3');
		expect(zipInputKeys()).not.toContain('42/bgm.m4a');
	});

	it('retains canonical bgm.m4a when it is the only full-track audio', async () => {
		mockedListAll.mockResolvedValue([{ key: '42/bgm.m4a', size: 150, uploaded: new Date() }]);

		await collectZipSources({} as R2Bucket, [42]);

		expect(zipInputKeys()).toContain('42/bgm.m4a');
	});

	it('does not treat nested sample audio as an authored full-track source', async () => {
		mockedListAll.mockResolvedValue([
			{ key: '42/assets/kick.ogg', size: 20, uploaded: new Date() },
			{ key: '42/bgm.m4a', size: 150, uploaded: new Date() }
		]);

		await collectZipSources({} as R2Bucket, [42]);

		expect(zipInputKeys()).toEqual(
			expect.arrayContaining(['42/assets/kick.ogg', '42/bgm.m4a'])
		);
	});
});
