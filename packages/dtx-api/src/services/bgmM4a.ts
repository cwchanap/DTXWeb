import type { R2Bucket } from '@cloudflare/workers-types';
import { listAllR2Objects } from '@dtx/common/server';
import { z } from 'zod';
import { isTopLevelNamedR2Key, selectTopLevelFullTrackObject } from '../lib/r2Files';

export const BGM_DERIVATIVE_FILENAME = 'bgm.m4a';
export const BGM_TRANSCODE_PROFILE = 'aac-lc-192k-v1' as const;

// Retry contract for the transcode-and-publish Workflow step. Single source of
// truth: generateBgmM4a.ts passes BGM_TRANSCODE_STEP_CONFIG to step.do, and the
// backfill operator derives its polling horizon from BGM_TRANSCODE_WORST_CASE_MS
// so --execute cannot give up before the Workflow exhausts legitimate retries.
// Durations are milliseconds (the Workflow API accepts number for delay/timeout).
export const BGM_TRANSCODE_STEP_RETRY_LIMIT = 2;
export const BGM_TRANSCODE_STEP_RETRY_DELAY_MS = 30 * 1000;
export const BGM_TRANSCODE_STEP_BACKOFF = 'exponential' as const;
export const BGM_TRANSCODE_STEP_TIMEOUT_MS = 30 * 60 * 1000;

export const BGM_TRANSCODE_STEP_CONFIG = {
	retries: {
		limit: BGM_TRANSCODE_STEP_RETRY_LIMIT,
		delay: BGM_TRANSCODE_STEP_RETRY_DELAY_MS,
		backoff: BGM_TRANSCODE_STEP_BACKOFF
	},
	timeout: BGM_TRANSCODE_STEP_TIMEOUT_MS
} as const;

// Upper bound on wall-clock duration one Workflow instance can spend in the
// transcode-and-publish step before reaching a terminal status. `timeout` is
// applied per attempt; the step is attempted up to RETRY_LIMIT + 1 times (the
// Cloudflare docs describe `retries.limit` ambiguously as both "total attempts"
// and "retry count", so limit + 1 is the conservative reading covering both).
// Exponential backoff adds delay * (2^limit - 1) of retry-to-retry wait time.
export const BGM_TRANSCODE_WORST_CASE_MS =
	(BGM_TRANSCODE_STEP_RETRY_LIMIT + 1) * BGM_TRANSCODE_STEP_TIMEOUT_MS +
	(BGM_TRANSCODE_STEP_BACKOFF === 'exponential'
		? BGM_TRANSCODE_STEP_RETRY_DELAY_MS * (2 ** BGM_TRANSCODE_STEP_RETRY_LIMIT - 1)
		: BGM_TRANSCODE_STEP_RETRY_DELAY_MS * BGM_TRANSCODE_STEP_RETRY_LIMIT);

export const bgmDerivativeKey = (id: number): string => `${id}/${BGM_DERIVATIVE_FILENAME}`;

export const isCanonicalBgmDerivativeKey = (key: string, id: number): boolean =>
	isTopLevelNamedR2Key(key, `${id}/`, BGM_DERIVATIVE_FILENAME);

export const buildBgmWorkflowInstanceId = (id: number, uploaded: string): string => {
	const epochMs = Date.parse(uploaded);
	if (!Number.isFinite(epochMs)) throw new Error('Invalid source uploaded timestamp');
	return `bgm-m4a-v1-${id}-${epochMs}`;
};

export const generateBgmM4aPayloadSchema = z
	.object({
		simfileId: z.number().int(),
		sourceKey: z.string(),
		sourceUploaded: z.string(),
		expectedSourceEtag: z.string().optional(),
		expectedSourceVersion: z.string().optional(),
		profile: z.literal(BGM_TRANSCODE_PROFILE)
	})
	.superRefine((payload, context) => {
		const selected = selectTopLevelFullTrackObject(
			[{ key: payload.sourceKey }],
			`${payload.simfileId}/`,
			(object) => isCanonicalBgmDerivativeKey(object.key, payload.simfileId)
		);
		if (!selected) {
			context.addIssue({
				code: 'custom',
				path: ['sourceKey'],
				message: 'sourceKey must be a top-level supported authored audio key'
			});
		}
	});

export type GenerateBgmM4aPayload = z.infer<typeof generateBgmM4aPayloadSchema>;

export const resolveSelectedAuthoredSource = async (bucket: R2Bucket, simfileId: number) => {
	const objects = await listAllR2Objects(bucket, `${simfileId}/`);
	return (
		selectTopLevelFullTrackObject(objects, `${simfileId}/`, (object) =>
			isCanonicalBgmDerivativeKey(object.key, simfileId)
		) ?? null
	);
};
