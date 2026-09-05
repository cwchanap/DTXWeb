import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import { workerLogger } from '@dtx/common/server';
import type { Env } from '../env';
import {
	BGM_TRANSCODE_STEP_CONFIG,
	generateBgmM4aPayloadSchema,
	type GenerateBgmM4aPayload
} from '../services/bgmM4a';
import {
	classifyBgmTranscodeError,
	inspectBgmM4aGeneration,
	transcodeAndPublishBgmM4a
} from '../services/bgmM4aGeneration';

export class GenerateBgmM4aWorkflow extends WorkflowEntrypoint<Env, GenerateBgmM4aPayload> {
	async run(event: WorkflowEvent<GenerateBgmM4aPayload>, step: WorkflowStep) {
		// The upload service binding delivers a parsed object, but the REST API
		// (backfill and wrangler trigger) delivers `params` as a JSON-encoded
		// string. Accept both before validating.
		const rawPayload = event.payload;
		const payload = generateBgmM4aPayloadSchema.parse(
			typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload
		);

		const inspection = await step.do('inspect BGM source and derivative', async () =>
			inspectBgmM4aGeneration(this.env, payload)
		);

		if (inspection.status !== 'generate') {
			return { status: inspection.status };
		}

		return step.do('transcode and publish BGM M4A', BGM_TRANSCODE_STEP_CONFIG, async () => {
			try {
				return await transcodeAndPublishBgmM4a(
					this.env,
					payload,
					inspection.source,
					workerLogger
				);
			} catch (error) {
				if (classifyBgmTranscodeError(error) === 'non-retryable') {
					throw new NonRetryableError(
						error instanceof Error ? error.message : String(error)
					);
				}
				throw error;
			}
		});
	}
}
