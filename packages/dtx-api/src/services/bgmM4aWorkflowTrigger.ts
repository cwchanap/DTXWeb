import { FULL_TRACK_AUDIO_EXTENSIONS, isTopLevelR2Key } from '../lib/r2Files';
import type { Env } from '../env';
import {
	BGM_TRANSCODE_PROFILE,
	buildBgmWorkflowInstanceId,
	isCanonicalBgmDerivativeKey,
	resolveSelectedAuthoredSource
} from './bgmM4a';
import type { UploadedObject } from './uploads';

export type BgmM4aWorkflowTriggerResult = 'disabled' | 'not-source' | 'triggered' | 'duplicate';

export const triggerBgmM4aWorkflow = async (
	env: Env,
	uploaded: UploadedObject
): Promise<BgmM4aWorkflowTriggerResult> => {
	if (env.BGM_M4A_GENERATION_ENABLED !== 'true') return 'disabled';

	const prefix = `${uploaded.simfileId}/`;
	const lowerKey = uploaded.key.toLowerCase();
	if (
		!isTopLevelR2Key(uploaded.key, prefix) ||
		!FULL_TRACK_AUDIO_EXTENSIONS.some((extension) => lowerKey.endsWith(extension)) ||
		isCanonicalBgmDerivativeKey(uploaded.key, uploaded.simfileId)
	) {
		return 'not-source';
	}

	const selected = await resolveSelectedAuthoredSource(env.DTXFILE_BUCKET, uploaded.simfileId);
	if (selected?.key !== uploaded.key) return 'not-source';

	if (!env.BGM_M4A_WORKFLOW) {
		throw new Error('BGM_M4A_WORKFLOW binding is required when BGM generation is enabled');
	}

	const instances = await env.BGM_M4A_WORKFLOW.createBatch([
		{
			id: buildBgmWorkflowInstanceId(uploaded.simfileId, uploaded.uploaded),
			params: {
				simfileId: uploaded.simfileId,
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

	return instances.length === 0 ? 'duplicate' : 'triggered';
};
