import type { WorkerLogger } from '@dtx/common/server';
import type { R2Bucket } from '@cloudflare/workers-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { BGM_TRANSCODE_PROFILE, type GenerateBgmM4aPayload } from './bgmM4a';
import {
	classifyBgmTranscodeError,
	inspectBgmM4aGeneration,
	PermanentBgmTranscodeError,
	transcodeAndPublishBgmM4a,
	type BgmSourceIdentity
} from './bgmM4aGeneration';

const { getContainerMock } = vi.hoisted(() => ({
	getContainerMock: vi.fn()
}));

vi.mock('@cloudflare/containers', () => ({
	getContainer: getContainerMock
}));

const payload: GenerateBgmM4aPayload = {
	simfileId: 42,
	sourceKey: '42/custom.flac',
	sourceUploaded: '2026-08-27T05:00:00.123Z',
	expectedSourceEtag: 'etag-1',
	expectedSourceVersion: 'version-1',
	profile: BGM_TRANSCODE_PROFILE
};

const capturedSource: BgmSourceIdentity = {
	etag: 'etag-1',
	version: 'version-1',
	uploaded: payload.sourceUploaded
};

const logger: WorkerLogger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn()
};

type ObjectIdentity = BgmSourceIdentity & {
	key: string;
	customMetadata?: Record<string, string>;
};

type BucketHarness = {
	bucket: R2Bucket;
	list: ReturnType<typeof vi.fn>;
	head: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
	put: ReturnType<typeof vi.fn>;
	deleteObject: ReturnType<typeof vi.fn>;
	sourceObject: Omit<ObjectIdentity, 'uploaded'> & {
		uploaded: Date;
		body: ReadableStream<Uint8Array>;
		arrayBuffer: ReturnType<typeof vi.fn>;
		bytes: ReturnType<typeof vi.fn>;
		text: ReturnType<typeof vi.fn>;
	};
};

const makeIdentity = (overrides: Partial<ObjectIdentity> = {}): ObjectIdentity => ({
	key: payload.sourceKey,
	...capturedSource,
	...overrides
});

const makeBucket = ({
	selectedKeys = [payload.sourceKey],
	source = makeIdentity(),
	getSource = makeIdentity(),
	derivative = null
}: {
	selectedKeys?: string[];
	source?: ObjectIdentity;
	getSource?: ObjectIdentity;
	derivative?: ObjectIdentity | null;
} = {}): BucketHarness => {
	const sourceBody = new ReadableStream<Uint8Array>();
	const sourceObject = {
		...getSource,
		uploaded: new Date(getSource.uploaded),
		body: sourceBody,
		arrayBuffer: vi.fn(),
		bytes: vi.fn(),
		text: vi.fn()
	};
	const list = vi.fn(async () => ({
		objects: selectedKeys.map((key) => ({
			key,
			size: 1,
			uploaded: new Date(capturedSource.uploaded)
		})),
		truncated: false
	}));
	const head = vi.fn(async (key: string) => {
		if (key === payload.sourceKey) {
			return { ...source, uploaded: new Date(source.uploaded) };
		}
		if (key === '42/bgm.m4a' && derivative) {
			return { ...derivative, uploaded: new Date(derivative.uploaded) };
		}
		return null;
	});
	const get = vi.fn(async (key: string) => (key === payload.sourceKey ? sourceObject : null));
	const put = vi.fn(async (key: string) => makeIdentity({ key }));
	const deleteObject = vi.fn(async () => undefined);

	return {
		bucket: {
			list,
			head,
			get,
			put,
			delete: deleteObject
		} as unknown as R2Bucket,
		list,
		head,
		get,
		put,
		deleteObject,
		sourceObject
	};
};

const makeEnv = (bucket: R2Bucket, overrides: Partial<Env> = {}): Env =>
	({
		DTXFILE_BUCKET: bucket,
		PUBLIC_SIMFILE_BUCKET_URL: 'https://cdn.example.test/simfiles/',
		BGM_TRANSCODER: {} as DurableObjectNamespace,
		...overrides
	}) as Env;

const makeContainerResponse = (status = 200) => {
	const cancel = vi.fn();
	const body = new ReadableStream<Uint8Array>({ cancel });
	return {
		response: {
			ok: status >= 200 && status < 300,
			status,
			body,
			arrayBuffer: vi.fn(),
			bytes: vi.fn(),
			text: vi.fn()
		} as unknown as Response,
		body,
		cancel
	};
};

beforeEach(() => {
	getContainerMock.mockReset();
	vi.mocked(logger.info).mockReset();
	vi.mocked(logger.warn).mockReset();
	vi.mocked(logger.error).mockReset();
	vi.mocked(logger.debug).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('inspectBgmM4aGeneration', () => {
	it('captures the current payload source identity and generates when no derivative exists', async () => {
		const harness = makeBucket();

		await expect(inspectBgmM4aGeneration(makeEnv(harness.bucket), payload)).resolves.toEqual({
			status: 'generate',
			source: capturedSource
		});
		expect(harness.head).toHaveBeenNthCalledWith(1, payload.sourceKey);
		expect(harness.head).toHaveBeenNthCalledWith(2, '42/bgm.m4a');
		expect(harness.deleteObject).not.toHaveBeenCalled();
	});

	it('returns superseded when a different authored source is selected', async () => {
		const harness = makeBucket({
			selectedKeys: ['42/music.ogg', payload.sourceKey]
		});

		await expect(inspectBgmM4aGeneration(makeEnv(harness.bucket), payload)).resolves.toEqual({
			status: 'superseded'
		});
		expect(harness.head).not.toHaveBeenCalled();
	});

	it('HEADs the arbitrary payload source key without reconstructing a filename', async () => {
		const harness = makeBucket();

		await inspectBgmM4aGeneration(makeEnv(harness.bucket), payload);

		expect(harness.head).toHaveBeenCalledWith('42/custom.flac');
		expect(harness.head).not.toHaveBeenCalledWith('42/bgm.ogg');
	});

	it('returns superseded when the source upload timestamp differs', async () => {
		const harness = makeBucket({
			source: makeIdentity({ uploaded: '2026-08-27T05:00:01.123Z' })
		});

		await expect(inspectBgmM4aGeneration(makeEnv(harness.bucket), payload)).resolves.toEqual({
			status: 'superseded'
		});
	});

	it.each([
		['ETag', { etag: 'etag-2' }],
		['version', { version: 'version-2' }]
	])('returns superseded when the expected source %s differs', async (_field, sourceOverride) => {
		const harness = makeBucket({
			source: makeIdentity(sourceOverride)
		});

		await expect(inspectBgmM4aGeneration(makeEnv(harness.bucket), payload)).resolves.toEqual({
			status: 'superseded'
		});
	});

	it('returns cached when derivative source ETag, version, uploaded, and profile match', async () => {
		const harness = makeBucket({
			derivative: makeIdentity({
				key: '42/bgm.m4a',
				customMetadata: {
					'source-etag': capturedSource.etag,
					'source-version': capturedSource.version,
					'source-uploaded': capturedSource.uploaded,
					'transcode-profile': BGM_TRANSCODE_PROFILE
				}
			})
		});

		await expect(inspectBgmM4aGeneration(makeEnv(harness.bucket), payload)).resolves.toEqual({
			status: 'cached'
		});
		expect(harness.deleteObject).not.toHaveBeenCalled();
	});

	it.each([
		['source-version', { 'source-version': 'stale-version' }],
		['source-uploaded', { 'source-uploaded': '2026-08-27T04:00:00.000Z' }]
	])(
		'regenerates when the derivative ETag matches but %s is stale (re-uploaded identical bytes)',
		async (_field, staleMetadata) => {
			const harness = makeBucket({
				derivative: makeIdentity({
					key: '42/bgm.m4a',
					customMetadata: {
						'source-etag': capturedSource.etag,
						'source-uploaded': capturedSource.uploaded,
						'transcode-profile': BGM_TRANSCODE_PROFILE,
						...staleMetadata
					}
				})
			});

			await expect(
				inspectBgmM4aGeneration(makeEnv(harness.bucket), payload)
			).resolves.toEqual({
				status: 'generate',
				source: capturedSource
			});
			expect(harness.deleteObject).not.toHaveBeenCalled();
		}
	);

	it('keeps a stale derivative in place until publish overwrites it', async () => {
		const purgeFetch = vi.fn();
		vi.stubGlobal('fetch', purgeFetch);
		const harness = makeBucket({
			derivative: makeIdentity({
				key: '42/bgm.m4a',
				customMetadata: {
					'source-etag': 'stale-etag',
					'transcode-profile': BGM_TRANSCODE_PROFILE
				}
			})
		});
		const env = makeEnv(harness.bucket, {
			CLOUDFLARE_ZONE_ID: 'zone',
			CLOUDFLARE_API_TOKEN: 'token'
		});

		await expect(inspectBgmM4aGeneration(env, payload)).resolves.toEqual({
			status: 'generate',
			source: capturedSource
		});
		expect(harness.deleteObject).not.toHaveBeenCalled();
		expect(purgeFetch).not.toHaveBeenCalled();
	});
});

describe('classifyBgmTranscodeError', () => {
	it.each([
		[new PermanentBgmTranscodeError('invalid media'), 'non-retryable'],
		[new Response(null, { status: 422 }), 'non-retryable'],
		[new Response(null, { status: 500 }), 'retryable'],
		[new Error('R2 unavailable'), 'retryable']
	] as const)('classifies only permanent media failures as %s', (error, expected) => {
		expect(classifyBgmTranscodeError(error)).toBe(expected);
	});
});

describe('transcodeAndPublishBgmM4a', () => {
	it('throws loudly when the Container binding is missing', async () => {
		const harness = makeBucket();

		await expect(
			transcodeAndPublishBgmM4a(
				makeEnv(harness.bucket, { BGM_TRANSCODER: undefined }),
				payload,
				capturedSource,
				logger
			)
		).rejects.toThrow('BGM_TRANSCODER binding is required to transcode BGM audio');
		expect(harness.get).not.toHaveBeenCalled();
	});

	it('turns a Container 422 response into a permanent media error', async () => {
		const harness = makeBucket();
		const output = makeContainerResponse(422);
		getContainerMock.mockReturnValue({
			fetch: vi.fn().mockResolvedValue(output.response)
		});

		await expect(
			transcodeAndPublishBgmM4a(makeEnv(harness.bucket), payload, capturedSource, logger)
		).rejects.toBeInstanceOf(PermanentBgmTranscodeError);
		expect(classifyBgmTranscodeError(new PermanentBgmTranscodeError('bad media'))).toBe(
			'non-retryable'
		);
		expect(output.response.text).not.toHaveBeenCalled();
		expect(harness.put).not.toHaveBeenCalled();
	});

	it('leaves Container 5xx failures retryable', async () => {
		const harness = makeBucket();
		const output = makeContainerResponse(503);
		getContainerMock.mockReturnValue({
			fetch: vi.fn().mockResolvedValue(output.response)
		});

		const promise = transcodeAndPublishBgmM4a(
			makeEnv(harness.bucket),
			payload,
			capturedSource,
			logger
		);
		await expect(promise).rejects.toMatchObject({
			message: 'BGM transcoder returned HTTP 503'
		});
		await promise.catch((error: unknown) => {
			expect(classifyBgmTranscodeError(error)).toBe('retryable');
		});
		expect(harness.put).not.toHaveBeenCalled();
	});

	it('cancels output without publishing when another source wins during conversion', async () => {
		const harness = makeBucket();
		const output = makeContainerResponse();
		harness.list.mockResolvedValue({
			objects: [
				{
					key: '42/music.ogg',
					size: 1,
					uploaded: new Date(capturedSource.uploaded)
				},
				{
					key: payload.sourceKey,
					size: 1,
					uploaded: new Date(capturedSource.uploaded)
				}
			],
			truncated: false
		});
		getContainerMock.mockReturnValue({
			fetch: vi.fn().mockResolvedValue(output.response)
		});

		await expect(
			transcodeAndPublishBgmM4a(makeEnv(harness.bucket), payload, capturedSource, logger)
		).resolves.toEqual({ status: 'superseded' });
		expect(output.cancel).toHaveBeenCalledOnce();
		expect(harness.head).not.toHaveBeenCalled();
		expect(harness.put).not.toHaveBeenCalled();
	});

	it.each([
		['ETag', { etag: 'etag-2' }],
		['version', { version: 'version-2' }],
		['uploaded timestamp', { uploaded: '2026-08-27T05:00:01.123Z' }]
	])(
		'cancels output without publishing when source %s changes during conversion',
		async (_field, sourceOverride) => {
			const harness = makeBucket({
				source: makeIdentity(sourceOverride)
			});
			const output = makeContainerResponse();
			getContainerMock.mockReturnValue({
				fetch: vi.fn().mockResolvedValue(output.response)
			});

			await expect(
				transcodeAndPublishBgmM4a(makeEnv(harness.bucket), payload, capturedSource, logger)
			).resolves.toEqual({ status: 'superseded' });
			expect(output.cancel).toHaveBeenCalledOnce();
			expect(harness.put).not.toHaveBeenCalled();
		}
	);

	it('streams source through the Container and publishes exact metadata without buffering', async () => {
		const harness = makeBucket();
		const output = makeContainerResponse();
		const containerFetch = vi.fn().mockResolvedValue(output.response);
		const binding = {} as DurableObjectNamespace;
		getContainerMock.mockReturnValue({ fetch: containerFetch });
		const env = makeEnv(harness.bucket, { BGM_TRANSCODER: binding });

		await expect(
			transcodeAndPublishBgmM4a(env, payload, capturedSource, logger)
		).resolves.toEqual({ status: 'ready' });

		expect(harness.get).toHaveBeenCalledWith(payload.sourceKey);
		expect(harness.get).not.toHaveBeenCalledWith('42/bgm.ogg');
		expect(getContainerMock).toHaveBeenCalledWith(binding);
		expect(containerFetch).toHaveBeenCalledWith('http://container/transcode/to-m4a', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream'
			},
			body: harness.sourceObject.body
		});
		expect(harness.sourceObject.arrayBuffer).not.toHaveBeenCalled();
		expect(harness.sourceObject.bytes).not.toHaveBeenCalled();
		expect(harness.sourceObject.text).not.toHaveBeenCalled();
		expect(output.response.arrayBuffer).not.toHaveBeenCalled();
		expect(output.response.bytes).not.toHaveBeenCalled();
		expect(output.response.text).not.toHaveBeenCalled();
		expect(harness.put).toHaveBeenCalledWith('42/bgm.m4a', output.body, {
			httpMetadata: {
				contentType: 'audio/mp4',
				cacheControl: 'public, max-age=300, must-revalidate'
			},
			customMetadata: {
				'source-key': payload.sourceKey,
				'source-etag': capturedSource.etag,
				'source-version': capturedSource.version,
				'source-uploaded': capturedSource.uploaded,
				'transcode-profile': BGM_TRANSCODE_PROFILE
			}
		});
	});

	it('keeps a successful publish ready when cache purge fails', async () => {
		const purgeFetch = vi.fn().mockRejectedValue(new Error('purge unavailable'));
		vi.stubGlobal('fetch', purgeFetch);
		const harness = makeBucket();
		const output = makeContainerResponse();
		getContainerMock.mockReturnValue({
			fetch: vi.fn().mockResolvedValue(output.response)
		});
		const env = makeEnv(harness.bucket, {
			CLOUDFLARE_ZONE_ID: 'zone',
			CLOUDFLARE_API_TOKEN: 'token'
		});

		await expect(
			transcodeAndPublishBgmM4a(env, payload, capturedSource, logger)
		).resolves.toEqual({ status: 'ready' });
		expect(harness.put).toHaveBeenCalledOnce();
		expect(purgeFetch).toHaveBeenCalledOnce();
	});
});
