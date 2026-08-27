import type { R2Bucket } from '@cloudflare/workers-types';
import { describe, expect, it, vi } from 'vitest';
import {
	BGM_DERIVATIVE_FILENAME,
	BGM_TRANSCODE_PROFILE,
	bgmDerivativeKey,
	buildBgmWorkflowInstanceId,
	generateBgmM4aPayloadSchema,
	isCanonicalBgmDerivativeKey,
	resolveSelectedAuthoredSource
} from './bgmM4a';

const uploaded = new Date('2026-08-27T05:00:00.123Z');

const makeBucket = (keys: string[]): R2Bucket =>
	({
		list: vi.fn(async () => ({
			objects: keys.map((key, index) => ({ key, size: index + 1, uploaded })),
			truncated: false
		}))
	}) as unknown as R2Bucket;

describe('BGM derivative contract', () => {
	it('defines the canonical key and transcode profile', () => {
		expect(BGM_DERIVATIVE_FILENAME).toBe('bgm.m4a');
		expect(BGM_TRANSCODE_PROFILE).toBe('aac-lc-192k-v1');
		expect(bgmDerivativeKey(42)).toBe('42/bgm.m4a');
	});

	it('matches only the canonical top-level derivative case-insensitively', () => {
		expect(isCanonicalBgmDerivativeKey('42/BGM.M4A', 42)).toBe(true);
		expect(isCanonicalBgmDerivativeKey('42/assets/bgm.m4a', 42)).toBe(false);
		expect(isCanonicalBgmDerivativeKey('7/bgm.m4a', 42)).toBe(false);
	});
});

describe('buildBgmWorkflowInstanceId', () => {
	it('uses the source upload epoch milliseconds', () => {
		expect(buildBgmWorkflowInstanceId(42, uploaded.toISOString())).toBe(
			`bgm-m4a-v1-42-${uploaded.getTime()}`
		);
	});

	it('rejects an invalid upload timestamp', () => {
		expect(() => buildBgmWorkflowInstanceId(42, 'not-a-date')).toThrow(
			'Invalid source uploaded timestamp'
		);
	});
});

describe('generateBgmM4aPayloadSchema', () => {
	const validPayload = {
		simfileId: 42,
		sourceKey: '42/music.m4a',
		sourceUploaded: uploaded.toISOString(),
		expectedSourceEtag: 'etag-1',
		expectedSourceVersion: 'version-1',
		profile: 'aac-lc-192k-v1'
	};

	it('accepts a top-level supported authored source payload', () => {
		expect(generateBgmM4aPayloadSchema.safeParse(validPayload).success).toBe(true);
	});

	it.each(['42/bgm.m4a', '42/BGM.M4A'])(
		'rejects canonical generated source key %s',
		(sourceKey) => {
			expect(
				generateBgmM4aPayloadSchema.safeParse({ ...validPayload, sourceKey }).success
			).toBe(false);
		}
	);

	it.each(['42/assets/music.ogg', '42/music.aac', '7/music.ogg', 'preview.mp3'])(
		'rejects source key that is not supported top-level audio for the simfile: %s',
		(sourceKey) => {
			expect(
				generateBgmM4aPayloadSchema.safeParse({ ...validPayload, sourceKey }).success
			).toBe(false);
		}
	);
});

describe('resolveSelectedAuthoredSource', () => {
	it('lists the simfile prefix and excludes canonical generated bgm.m4a', async () => {
		const bucket = makeBucket(['42/bgm.m4a', '42/music.m4a']);

		const selected = await resolveSelectedAuthoredSource(bucket, 42);

		expect(bucket.list).toHaveBeenCalledWith({
			prefix: '42/',
			limit: 1000,
			cursor: undefined
		});
		expect(selected).toEqual({ key: '42/music.m4a', size: 2, uploaded });
	});

	it('returns null when no top-level authored full track exists', async () => {
		const bucket = makeBucket(['42/bgm.m4a', '42/assets/music.ogg']);

		expect(await resolveSelectedAuthoredSource(bucket, 42)).toBeNull();
	});
});
