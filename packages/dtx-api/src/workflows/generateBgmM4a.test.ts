import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import {
	BGM_TRANSCODE_PROFILE,
	BGM_TRANSCODE_STEP_CONFIG,
	type GenerateBgmM4aPayload
} from '../services/bgmM4a';
import { PermanentBgmTranscodeError } from '../services/bgmM4aGeneration';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';

const { inspectMock, transcodeMock } = vi.hoisted(() => ({
	inspectMock: vi.fn(),
	transcodeMock: vi.fn()
}));

vi.mock('cloudflare:workers', () => {
	class WorkerEntrypoint {
		protected ctx: unknown;
		protected env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	}
	class DurableObject {
		protected ctx: unknown;
		protected env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	}
	class WorkflowEntrypoint<EnvType = unknown> {
		protected ctx: ExecutionContext;
		protected env: EnvType;
		constructor(ctx: ExecutionContext, env: EnvType) {
			this.ctx = ctx;
			this.env = env;
		}
	}
	return { WorkerEntrypoint, DurableObject, WorkflowEntrypoint };
});

vi.mock('cloudflare:workflows', () => ({
	NonRetryableError: class NonRetryableError extends Error {
		constructor(message: string, name = 'NonRetryableError') {
			super(message);
			this.name = name;
		}
	}
}));

vi.mock('../services/bgmM4aGeneration', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../services/bgmM4aGeneration')>();
	return {
		...actual,
		inspectBgmM4aGeneration: inspectMock,
		transcodeAndPublishBgmM4a: transcodeMock
	};
});

const { GenerateBgmM4aWorkflow } = await import('./generateBgmM4a');
const { NonRetryableError } = await import('cloudflare:workflows');
const { workerLogger } = await import('@dtx/common/server');

const payload: GenerateBgmM4aPayload = {
	simfileId: 42,
	sourceKey: '42/music.ogg',
	sourceUploaded: '2026-08-27T05:00:00.123Z',
	expectedSourceEtag: 'etag-1',
	expectedSourceVersion: 'version-1',
	profile: BGM_TRANSCODE_PROFILE
};

const capturedSource = {
	etag: 'etag-1',
	version: 'version-1',
	uploaded: payload.sourceUploaded
};

const inspectStepName = 'inspect BGM source and derivative';
const transcodeStepName = 'transcode and publish BGM M4A';
const transcodeStepConfig = BGM_TRANSCODE_STEP_CONFIG;

type StepCall = { name: string; config?: unknown };

const makeStep = () => {
	const calls: StepCall[] = [];
	const step = {
		do: vi.fn(async (name: string, configOrCallback: unknown, maybeCallback?: unknown) => {
			const hasConfig = typeof configOrCallback !== 'function';
			calls.push({
				name,
				config: hasConfig ? configOrCallback : undefined
			});
			const callback = (
				hasConfig ? maybeCallback : configOrCallback
			) as () => Promise<unknown>;
			return callback();
		}),
		sleep: vi.fn(),
		sleepUntil: vi.fn(),
		waitForEvent: vi.fn()
	};
	return { step: step as unknown as WorkflowStep, calls };
};

const makeEnv = (): Env => ({}) as Env;

const makeCtx = (): ExecutionContext =>
	({
		waitUntil: vi.fn(),
		passThroughOnException: vi.fn()
	}) as unknown as ExecutionContext;

const runWorkflow = async (eventPayload: unknown, env = makeEnv()) => {
	const { step, calls } = makeStep();
	const workflow = new GenerateBgmM4aWorkflow(makeCtx(), env);
	const event = {
		payload: eventPayload,
		timestamp: new Date('2026-08-27T06:00:00.000Z'),
		instanceId: 'bgm-m4a-v1-42-1756267200123'
	} as WorkflowEvent<GenerateBgmM4aPayload>;
	const result = workflow.run(event, step);
	return { result, calls, env };
};

beforeEach(() => {
	inspectMock.mockReset();
	transcodeMock.mockReset();
});

describe('GenerateBgmM4aWorkflow', () => {
	it('rejects an invalid payload before any Workflow step', async () => {
		const { result, calls } = await runWorkflow({
			...payload,
			sourceKey: '42/bgm.m4a'
		});

		await expect(result).rejects.toThrow();
		expect(calls).toEqual([]);
		expect(inspectMock).not.toHaveBeenCalled();
		expect(transcodeMock).not.toHaveBeenCalled();
	});

	it('parses a JSON string payload delivered by the REST API trigger', async () => {
		inspectMock.mockResolvedValue({ status: 'cached' });
		const env = makeEnv();
		const { result, calls } = await runWorkflow(JSON.stringify(payload), env);

		await expect(result).resolves.toEqual({ status: 'cached' });
		expect(inspectMock).toHaveBeenCalledWith(env, payload);
		expect(calls).toEqual([{ name: inspectStepName, config: undefined }]);
	});

	it.each(['cached', 'superseded'] as const)(
		'returns %s from inspect without transcoding',
		async (status) => {
			inspectMock.mockResolvedValue({ status });
			const env = makeEnv();
			const { result, calls } = await runWorkflow(payload, env);

			await expect(result).resolves.toEqual({ status });
			expect(inspectMock).toHaveBeenCalledWith(env, payload);
			expect(transcodeMock).not.toHaveBeenCalled();
			expect(calls).toEqual([{ name: inspectStepName, config: undefined }]);
		}
	);

	it('transcodes with the captured source identity after inspect returns generate', async () => {
		inspectMock.mockResolvedValue({ status: 'generate', source: capturedSource });
		transcodeMock.mockResolvedValue({ status: 'ready' });
		const env = makeEnv();
		const { result, calls } = await runWorkflow(payload, env);

		await expect(result).resolves.toEqual({ status: 'ready' });
		expect(transcodeMock).toHaveBeenCalledWith(env, payload, capturedSource, workerLogger);
		expect(calls).toEqual([
			{ name: inspectStepName, config: undefined },
			{ name: transcodeStepName, config: transcodeStepConfig }
		]);
	});

	it('returns superseded from the transcode step without treating it as an error', async () => {
		inspectMock.mockResolvedValue({ status: 'generate', source: capturedSource });
		transcodeMock.mockResolvedValue({ status: 'superseded' });
		const { result } = await runWorkflow(payload);

		await expect(result).resolves.toEqual({ status: 'superseded' });
	});

	it('converts a permanent media error into a NonRetryableError', async () => {
		inspectMock.mockResolvedValue({ status: 'generate', source: capturedSource });
		transcodeMock.mockRejectedValue(new PermanentBgmTranscodeError('invalid media'));
		const { result } = await runWorkflow(payload);

		await expect(result).rejects.toBeInstanceOf(NonRetryableError);
		await result.catch((error: unknown) => {
			expect(error).toMatchObject({ message: 'invalid media' });
		});
	});

	it('rethrows a retryable transcode error unchanged', async () => {
		inspectMock.mockResolvedValue({ status: 'generate', source: capturedSource });
		const retryable = new Error('BGM transcoder returned HTTP 503');
		transcodeMock.mockRejectedValue(retryable);
		const { result } = await runWorkflow(payload);

		await expect(result).rejects.toBe(retryable);
	});
});
