import type { R2Bucket, Workflow } from '@cloudflare/workers-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { BGM_TRANSCODE_PROFILE, type GenerateBgmM4aPayload } from './bgmM4a';
import { triggerBgmM4aWorkflow } from './bgmM4aWorkflowTrigger';
import type { UploadedObject } from './uploads';

const uploaded: UploadedObject = {
	simfileId: 42,
	key: '42/music.ogg',
	etag: 'etag-1',
	version: 'version-1',
	uploaded: '2026-08-27T05:00:00.123Z',
	size: 1234
};

const makeBucket = (keys: string[] = []): R2Bucket =>
	({
		list: vi.fn(async () => ({
			objects: keys.map((key, index) => ({
				key,
				size: index + 1,
				uploaded: new Date('2026-08-27T04:00:00.000Z')
			})),
			truncated: false
		}))
	}) as unknown as R2Bucket;

const createBatch = vi.fn();

const makeEnv = (
	enabled?: string,
	keys: string[] = [],
	workflow: Workflow<GenerateBgmM4aPayload> | null = {
		createBatch
	} as unknown as Workflow<GenerateBgmM4aPayload>
): Env =>
	({
		BGM_M4A_GENERATION_ENABLED: enabled,
		BGM_M4A_WORKFLOW: workflow ?? undefined,
		DTXFILE_BUCKET: makeBucket(keys)
	}) as unknown as Env;

beforeEach(() => {
	createBatch.mockReset().mockResolvedValue([{}]);
});

describe('triggerBgmM4aWorkflow', () => {
	it.each([undefined, 'false', 'unexpected'])(
		'returns disabled without listing or triggering when the flag is %s',
		async (enabled) => {
			const env = makeEnv(enabled, [uploaded.key]);

			await expect(triggerBgmM4aWorkflow(env, uploaded)).resolves.toBe('disabled');
			expect(env.DTXFILE_BUCKET.list).not.toHaveBeenCalled();
			expect(createBatch).not.toHaveBeenCalled();
		}
	);

	it.each(['42/assets/music.ogg', '42/chart.dtx', '42/bgm.m4a', '42/BGM.M4A'])(
		'returns not-source without listing for ineligible key %s',
		async (key) => {
			const env = makeEnv('true', [key]);

			await expect(triggerBgmM4aWorkflow(env, { ...uploaded, key })).resolves.toBe(
				'not-source'
			);
			expect(env.DTXFILE_BUCKET.list).not.toHaveBeenCalled();
			expect(createBatch).not.toHaveBeenCalled();
		}
	);

	it('triggers the Workflow when the uploaded audio is the selected authored source', async () => {
		const env = makeEnv('true', [uploaded.key]);

		await expect(triggerBgmM4aWorkflow(env, uploaded)).resolves.toBe('triggered');
		expect(env.DTXFILE_BUCKET.list).toHaveBeenCalledWith({
			prefix: '42/',
			limit: 1000,
			cursor: undefined
		});
		expect(createBatch).toHaveBeenCalledWith([
			{
				id: 'bgm-m4a-v1-42-1787806800123',
				params: {
					simfileId: 42,
					sourceKey: uploaded.key,
					sourceUploaded: uploaded.uploaded,
					expectedSourceEtag: uploaded.etag,
					expectedSourceVersion: uploaded.version,
					profile: BGM_TRANSCODE_PROFILE
				},
				retention: {
					successRetention: '1 day',
					errorRetention: '7 days'
				}
			}
		]);
	});

	it('returns not-source when another authored object remains selected', async () => {
		const lowerPriorityUpload = { ...uploaded, key: '42/music.mp3' };
		const env = makeEnv('true', ['42/music.ogg', lowerPriorityUpload.key]);

		await expect(triggerBgmM4aWorkflow(env, lowerPriorityUpload)).resolves.toBe('not-source');
		expect(env.DTXFILE_BUCKET.list).toHaveBeenCalledOnce();
		expect(createBatch).not.toHaveBeenCalled();
	});

	it('throws when generation is enabled and the selected source has no Workflow binding', async () => {
		const env = makeEnv('true', [uploaded.key], null);

		await expect(triggerBgmM4aWorkflow(env, uploaded)).rejects.toThrow(
			'BGM_M4A_WORKFLOW binding is required when BGM generation is enabled'
		);
	});

	it('returns duplicate when createBatch omits the retained instance', async () => {
		createBatch.mockResolvedValue([]);
		const env = makeEnv('true', [uploaded.key]);

		await expect(triggerBgmM4aWorkflow(env, uploaded)).resolves.toBe('duplicate');
	});
});
