import { getContainer, type Container } from '@cloudflare/containers';
import type { WorkerLogger } from '@dtx/common/server';
import type { Env } from '../env';
import { toPublicR2Url } from '../lib/r2Files';
import {
	BGM_TRANSCODE_PROFILE,
	bgmDerivativeKey,
	resolveSelectedAuthoredSource,
	type GenerateBgmM4aPayload
} from './bgmM4a';
import { purgeCacheForFile } from './uploads';

export type BgmSourceIdentity = {
	etag: string;
	version: string;
	uploaded: string;
};

export type BgmTranscodeErrorClassification = 'non-retryable' | 'retryable';

export class PermanentBgmTranscodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PermanentBgmTranscodeError';
	}
}

export const classifyBgmTranscodeError = (error: unknown): BgmTranscodeErrorClassification =>
	error instanceof PermanentBgmTranscodeError ||
	(error instanceof Response && error.status === 422)
		? 'non-retryable'
		: 'retryable';

export type InspectBgmM4aGenerationResult =
	{ status: 'superseded' | 'cached' } | { status: 'generate'; source: BgmSourceIdentity };

export type TranscodeAndPublishBgmM4aResult = {
	status: 'ready' | 'superseded';
};

const sourceIdentityMatches = (
	source: { etag: string; version: string; uploaded: Date } | null,
	expected: BgmSourceIdentity
): boolean =>
	source !== null &&
	source.etag === expected.etag &&
	source.version === expected.version &&
	source.uploaded.toISOString() === expected.uploaded;

const derivativeUrl = (env: Env, key: string): string =>
	toPublicR2Url(env.PUBLIC_SIMFILE_BUCKET_URL, key);

const cancelResponseBody = async (response: Response, logger: WorkerLogger): Promise<void> => {
	if (!response.body) return;

	try {
		await response.body.cancel();
	} catch (error) {
		logger.warn('Failed to cancel BGM transcoder response body', { error: String(error) });
	}
};

export const inspectBgmM4aGeneration = async (
	env: Env,
	payload: GenerateBgmM4aPayload,
	logger: WorkerLogger
): Promise<InspectBgmM4aGenerationResult> => {
	const bucket = env.DTXFILE_BUCKET;
	const selected = await resolveSelectedAuthoredSource(bucket, payload.simfileId);
	if (selected?.key !== payload.sourceKey) return { status: 'superseded' };

	const source = await bucket.head(payload.sourceKey);
	if (!source || source.uploaded.toISOString() !== payload.sourceUploaded) {
		return { status: 'superseded' };
	}
	if (payload.expectedSourceEtag !== undefined && source.etag !== payload.expectedSourceEtag) {
		return { status: 'superseded' };
	}
	if (
		payload.expectedSourceVersion !== undefined &&
		source.version !== payload.expectedSourceVersion
	) {
		return { status: 'superseded' };
	}

	const capturedSource: BgmSourceIdentity = {
		etag: source.etag,
		version: source.version,
		uploaded: source.uploaded.toISOString()
	};
	const outputKey = bgmDerivativeKey(payload.simfileId);
	const derivative = await bucket.head(outputKey);
	if (
		derivative?.customMetadata?.['source-etag'] === capturedSource.etag &&
		derivative.customMetadata['transcode-profile'] === BGM_TRANSCODE_PROFILE
	) {
		return { status: 'cached' };
	}

	if (derivative) {
		await bucket.delete(outputKey);
		await purgeCacheForFile(env, derivativeUrl(env, outputKey), logger);
	}

	return { status: 'generate', source: capturedSource };
};

export const transcodeAndPublishBgmM4a = async (
	env: Env,
	payload: GenerateBgmM4aPayload,
	sourceIdentity: BgmSourceIdentity,
	logger: WorkerLogger
): Promise<TranscodeAndPublishBgmM4aResult> => {
	if (!env.BGM_TRANSCODER) {
		throw new Error('BGM_TRANSCODER binding is required to transcode BGM audio');
	}

	const bucket = env.DTXFILE_BUCKET;
	const source = await bucket.get(payload.sourceKey);
	if (!source || !sourceIdentityMatches(source, sourceIdentity)) return { status: 'superseded' };

	const response = await getContainer(
		env.BGM_TRANSCODER as unknown as DurableObjectNamespace<Container>
	).fetch('http://container/transcode/to-m4a', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/octet-stream'
		},
		body: source.body as unknown as BodyInit
	});
	if (response.status === 422) {
		await cancelResponseBody(response, logger);
		throw new PermanentBgmTranscodeError('BGM source does not contain processable audio');
	}
	if (!response.ok) {
		await cancelResponseBody(response, logger);
		throw new Error(`BGM transcoder returned HTTP ${response.status}`);
	}
	if (!response.body) {
		throw new Error('BGM transcoder returned an empty response body');
	}

	const selected = await resolveSelectedAuthoredSource(bucket, payload.simfileId);
	if (selected?.key !== payload.sourceKey) {
		await cancelResponseBody(response, logger);
		return { status: 'superseded' };
	}

	const currentSource = await bucket.head(payload.sourceKey);
	if (!sourceIdentityMatches(currentSource, sourceIdentity)) {
		await cancelResponseBody(response, logger);
		return { status: 'superseded' };
	}

	const outputKey = bgmDerivativeKey(payload.simfileId);
	const outputBody = response.body as unknown as Parameters<typeof bucket.put>[1];
	await bucket.put(outputKey, outputBody, {
		httpMetadata: {
			contentType: 'audio/mp4',
			cacheControl: 'public, max-age=300, must-revalidate'
		},
		customMetadata: {
			'source-key': payload.sourceKey,
			'source-etag': sourceIdentity.etag,
			'source-version': sourceIdentity.version,
			'source-uploaded': sourceIdentity.uploaded,
			'transcode-profile': BGM_TRANSCODE_PROFILE
		}
	});
	await purgeCacheForFile(env, derivativeUrl(env, outputKey), logger);

	return { status: 'ready' };
};
