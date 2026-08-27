import type { R2Bucket } from '@cloudflare/workers-types';
import { listAllR2Objects } from '@dtx/common/server';
import { z } from 'zod';
import { isTopLevelNamedR2Key, selectTopLevelFullTrackObject } from '../lib/r2Files';

export const BGM_DERIVATIVE_FILENAME = 'bgm.m4a';
export const BGM_TRANSCODE_PROFILE = 'aac-lc-192k-v1' as const;

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
