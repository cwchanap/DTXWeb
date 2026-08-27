# Cloudflare Workflow-Backed M4A Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an Apple-playable AAC-LC `bgm.m4a` derivative for every canonical uploaded `bgm.ogg` using a durable Cloudflare Workflow and one scale-to-zero FFmpeg Container, then backfill the published catalog before Virgo HPA-85 cuts over to M4A-only playback.

**Architecture:** Keep `{simfileId}/bgm.ogg` as the authored source of truth and reserve `{simfileId}/bgm.m4a` as a server-generated derivative. The authenticated upload route starts an idempotent Workflow after a successful canonical OGG upload; the Workflow captures R2 source identity, streams the source through one internal Container, stages the M4A outside the simfile prefix, re-checks source identity, and publishes only when the source is still current. Existing GraphQL file listing advertises the completed derivative automatically; raw ZIP downloads suppress only the redundant M4A when the canonical OGG is present.

**Tech Stack:** TypeScript, Bun 1.3.9, Vitest, Cloudflare Workers, Cloudflare Workflows, Cloudflare Containers, Durable Objects, R2, Wrangler 4.123+, Zod, FFmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md`

## Global Constraints

- Deliver all HPA-311 production code, tests, deployment configuration, backfill tooling, and verification in **one implementation PR**.
- Keep `{simfileId}/bgm.ogg` as the canonical authored source and `{simfileId}/bgm.m4a` as a server-generated AAC-LC derivative.
- Reject direct uploads to exact top-level `{simfileId}/bgm.m4a` with `409 Conflict`.
- When `BGM_M4A_GENERATION_ENABLED !== "true"`, reject exact top-level `{simfileId}/bgm.ogg` with `409 Conflict` before mutating R2.
- Trigger generation only for exact top-level `{simfileId}/bgm.ogg`; never trigger for nested/sample OGG files.
- Use transcode profile `aac-lc-192k-v1`: AAC-LC, 192 kbps, no video, preserve source sample rate/channels, `+faststart`.
- Stage at `_generated/bgm-m4a-v1/{simfileId}/{sha256(sourceEtag)[0..23]}.m4a`; staging must remain outside the simfile prefix.
- Publish `{simfileId}/bgm.m4a` as `audio/mp4` with `Cache-Control: public, max-age=300, must-revalidate` and source/profile custom metadata.
- Upload-trigger payloads provide expected source ETag/version; backfill payloads omit them so Workflow Step 1 captures the current R2 source state.
- Use deterministic Workflow instance IDs and one-item `createBatch()` for upload-trigger idempotency.
- Set instance retention to success `1 day`, error `7 days`.
- Keep large audio bytes in HTTP/R2 streams; do not return audio through ordinary Workflow step outputs.
- Retry transient Container/R2 failures twice with 30-second exponential backoff and a 30-minute transcode-step timeout; map invalid media to `NonRetryableError`.
- Use one `basic` Container instance initially (`max_instances: 1`), sleep after one minute idle, internet disabled, and serialize FFmpeg processes inside the Container.
- Keep the Container credential-free; Worker bindings own all R2 reads/writes.
- Keep GraphQL schema/codegen unchanged.
- Preserve OGG-first generic full-track discovery by inserting `.m4a` immediately after `.ogg`.
- Raw ZIPs omit top-level `bgm.m4a` only when top-level `bgm.ogg` is also present; do not put this DTX-specific rule in generic `zipBuilder.ts`.
- Configure production and `pre-prod` generation enabled; configure `pre-prod-prod-data` generation disabled and reject canonical OGG writes there.
- Do not add Queue, R2 event notifications, D1 job state, Durable Object job state, a public job-status API, an iOS package endpoint, client-side transcoding, an OGG decoder, or a generic media-variant framework.
- Do not add backward-compatibility migration for Virgo local OGG downloads; Virgo HPA-85 remains a separate PR blocked on the backend rollout/backfill gate.
- Use the approved legacy `new_sqlite_classes` Durable Object migration shape from the spec for this ticket; do not convert unrelated Wrangler lifecycle config to the newer declarative `exports` mechanism.
- Keep the repository's existing Node Vitest setup. Do not introduce `@cloudflare/vitest-plugin` just to unit-test the thin Workers-only Workflow wrapper; test pure/service orchestration with Node Vitest and validate the wrapper with Wrangler dry-run builds.

---

## File Structure

### Create

- `packages/dtx-api/src/services/bgmM4a.ts` — filename/profile constants, payload schema, key/URL/instance-ID helpers.
- `packages/dtx-api/src/services/bgmM4a.test.ts` — pure contract/helper tests.
- `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.ts` — exact upload-trigger selection and one-item idempotent Workflow invocation.
- `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.test.ts` — upload-trigger tests.
- `packages/dtx-api/src/services/bgmM4aGeneration.ts` — R2 inspection, Container call, staging, stale-source protection, publish, cleanup.
- `packages/dtx-api/src/services/bgmM4aGeneration.test.ts` — orchestration tests with R2/Container mocks.
- `packages/dtx-api/src/workflows/generateBgmM4a.ts` — thin Workers-runtime durable Workflow step wrapper.
- `packages/dtx-api/src/containers/bgmTranscoder.ts` — Cloudflare `Container` subclass.
- `packages/dtx-api/container/bgm-transcoder/Dockerfile` — Bun + FFmpeg/ffprobe image.
- `packages/dtx-api/container/bgm-transcoder/server.ts` — internal OGG→M4A HTTP service, one FFmpeg process at a time.
- `packages/dtx-api/container/bgm-transcoder/smoke.sh` — local Docker conversion/ffprobe smoke without a committed binary fixture.
- `packages/dtx-api/src/services/downloads.test.ts` — service-level raw ZIP source filtering tests.
- `packages/dtx-api/src/scripts/backfill-bgm-m4a.ts` — dry-run-first published-catalog audit/backfill operator script that waits for terminal Workflow outcomes.
- `packages/dtx-api/src/scripts/backfill-bgm-m4a.test.ts` — catalog selection, deterministic backfill identity, REST body, and outcome parsing tests.

### Modify

- `packages/dtx-api/src/env.ts` — generation flag, Workflow binding, Container Durable Object binding types.
- `packages/dtx-api/src/services/uploads.ts` — reserve generated key, gate canonical OGG by environment, return structured R2 metadata.
- `packages/dtx-api/src/services/uploads.test.ts` — upload contracts and structured result coverage.
- `packages/dtx-api/src/rest/upload.ts` — consume structured upload result; schedule purge and generation without reparsing JSON.
- `packages/dtx-api/src/rest/upload.test.ts` — post-response Workflow scheduling and no-trigger cases.
- `packages/dtx-api/src/services/r2Enrichment.ts` — add `.m4a` to full-track discovery after `.ogg`.
- `packages/dtx-api/src/services/r2Enrichment.test.ts` — M4A recognition plus OGG precedence.
- `packages/dtx-api/src/services/downloads.ts` — filter redundant generated top-level M4A before generic ZIP source creation.
- `packages/dtx-api/src/index.ts` — export Workflow and Container classes alongside the existing fetch handler.
- `packages/dtx-api/package.json` — `@cloudflare/containers`, Container smoke, backfill, and environment dry-run scripts.
- `packages/dtx-api/wrangler.jsonc` — Workflow, Container, Durable Object, migration, and explicit environment bindings/flags.
- `bun.lock` — resolved `@cloudflare/containers` dependency.

### Intentionally unchanged

- `packages/common/src/lib/server/zipBuilder.ts` — keep generic ZIP machinery format-agnostic.
- GraphQL schema and generated client types — `Simfile.files` already exposes R2 keys.
- D1 migrations/schema — no job/media state is persisted in D1.

---

### Task 1: Lock the BGM contract and make uploads return R2 identity

**Files:**
- Create: `packages/dtx-api/src/services/bgmM4a.ts`
- Create: `packages/dtx-api/src/services/bgmM4a.test.ts`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/src/services/uploads.ts`
- Modify: `packages/dtx-api/src/services/uploads.test.ts`

**Interfaces:**
- Produces `BGM_SOURCE_FILENAME`, `BGM_DERIVATIVE_FILENAME`, `BGM_TRANSCODE_PROFILE`, `GenerateBgmM4aPayload`, `bgmSourceKey()`, `bgmDerivativeKey()`, `bgmStagingKey()`, `isCanonicalBgmSourceKey()`, `isCanonicalBgmDerivativeKey()`, `buildUploadWorkflowInstanceId()`, `buildBackfillWorkflowInstanceId()`, and `buildPublicR2Url()`.
- Produces `UploadedObject` and `UploadResult` from `uploadSimfileFile()` for Task 2.
- Adds `BGM_M4A_GENERATION_ENABLED` to `Env`; binding types are added in Tasks 2 and 4.

- [ ] **Step 1: Write the failing pure contract tests**

Create `packages/dtx-api/src/services/bgmM4a.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	BGM_TRANSCODE_PROFILE,
	bgmDerivativeKey,
	bgmM4aPayloadSchema,
	bgmSourceKey,
	bgmStagingKey,
	buildBackfillWorkflowInstanceId,
	buildPublicR2Url,
	buildUploadWorkflowInstanceId,
	isCanonicalBgmDerivativeKey,
	isCanonicalBgmSourceKey
} from './bgmM4a';

describe('BGM M4A contract', () => {
	it('matches only exact top-level canonical BGM keys', () => {
		expect(isCanonicalBgmSourceKey('42/bgm.ogg', 42)).toBe(true);
		expect(isCanonicalBgmSourceKey('42/assets/bgm.ogg', 42)).toBe(false);
		expect(isCanonicalBgmSourceKey('42/kick.ogg', 42)).toBe(false);
		expect(isCanonicalBgmDerivativeKey('42/bgm.m4a', 42)).toBe(true);
		expect(isCanonicalBgmDerivativeKey('42/assets/bgm.m4a', 42)).toBe(false);
	});

	it('accepts upload and backfill payload shapes but rejects non-canonical sources', () => {
		expect(
			bgmM4aPayloadSchema.parse({
				simfileId: 42,
				sourceKey: '42/bgm.ogg',
				expectedSourceEtag: 'etag-42',
				expectedSourceVersion: 'version-42',
				profile: BGM_TRANSCODE_PROFILE
			})
		).toMatchObject({ expectedSourceEtag: 'etag-42' });
		expect(
			bgmM4aPayloadSchema.parse({
				simfileId: 42,
				sourceKey: '42/bgm.ogg',
				profile: BGM_TRANSCODE_PROFILE
			})
		).toMatchObject({ simfileId: 42 });
		expect(() =>
			bgmM4aPayloadSchema.parse({
				simfileId: 42,
				sourceKey: '42/assets/bgm.ogg',
				profile: BGM_TRANSCODE_PROFILE
			})
		).toThrow();
	});

	it('builds stable public URLs and profile-versioned identities', async () => {
		expect(buildPublicR2Url('https://files.example/', '42/my song.m4a')).toBe(
			'https://files.example/42/my%20song.m4a'
		);
		expect(await buildUploadWorkflowInstanceId(42, 'etag-1')).toBe(
			await buildUploadWorkflowInstanceId(42, 'etag-1')
		);
		expect(await buildUploadWorkflowInstanceId(42, 'etag-1')).not.toBe(
			await buildUploadWorkflowInstanceId(42, 'etag-2')
		);
		expect(await buildBackfillWorkflowInstanceId(42, '2026-08-25T00:00:00.000Z')).not.toBe(
			await buildBackfillWorkflowInstanceId(42, '2026-08-26T00:00:00.000Z')
		);
	});

	it('derives canonical and staging keys from one contract', async () => {
		expect(bgmSourceKey(42)).toBe('42/bgm.ogg');
		expect(bgmDerivativeKey(42)).toBe('42/bgm.m4a');
		expect(await bgmStagingKey(42, 'etag-1')).toMatch(
			/^_generated\/bgm-m4a-v1\/42\/[0-9a-f]{24}\.m4a$/
		);
	});
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd packages/dtx-api
bun test src/services/bgmM4a.test.ts
```

Expected: FAIL because `./bgmM4a` does not exist.

- [ ] **Step 3: Implement the shared contract helpers**

Create `packages/dtx-api/src/services/bgmM4a.ts`:

```ts
import { z } from 'zod';

export const BGM_SOURCE_FILENAME = 'bgm.ogg';
export const BGM_DERIVATIVE_FILENAME = 'bgm.m4a';
export const BGM_TRANSCODE_PROFILE = 'aac-lc-192k-v1' as const;
const GENERATED_PREFIX = '_generated/bgm-m4a-v1';

export const bgmSourceKey = (simfileId: number) => `${simfileId}/${BGM_SOURCE_FILENAME}`;
export const bgmDerivativeKey = (simfileId: number) => `${simfileId}/${BGM_DERIVATIVE_FILENAME}`;
export const isCanonicalBgmSourceKey = (key: string, simfileId: number) =>
	key === bgmSourceKey(simfileId);
export const isCanonicalBgmDerivativeKey = (key: string, simfileId: number) =>
	key === bgmDerivativeKey(simfileId);

const shortSha256 = async (value: string): Promise<string> => {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 24);
};

export const bgmStagingKey = async (simfileId: number, sourceEtag: string) =>
	`${GENERATED_PREFIX}/${simfileId}/${await shortSha256(sourceEtag)}.m4a`;

export const buildUploadWorkflowInstanceId = async (simfileId: number, sourceEtag: string) =>
	`bgm-m4a-v1-${simfileId}-${await shortSha256(sourceEtag)}`;

export const buildBackfillWorkflowInstanceId = async (simfileId: number, uploaded: string) =>
	`bgm-m4a-v1-backfill-${simfileId}-${await shortSha256(`${BGM_TRANSCODE_PROFILE}:${uploaded}`)}`;

export const buildPublicR2Url = (base: string, key: string) => {
	const normalized = base.replace(/\/$/, '');
	return `${normalized}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

export const bgmM4aPayloadSchema = z
	.object({
		simfileId: z.number().int().positive(),
		sourceKey: z.string().min(1),
		expectedSourceEtag: z.string().min(1).optional(),
		expectedSourceVersion: z.string().min(1).optional(),
		profile: z.literal(BGM_TRANSCODE_PROFILE)
	})
	.superRefine((payload, ctx) => {
		if (payload.sourceKey !== bgmSourceKey(payload.simfileId)) {
			ctx.addIssue({ code: 'custom', message: 'sourceKey must be the canonical bgm.ogg key' });
		}
	});

export type GenerateBgmM4aPayload = z.infer<typeof bgmM4aPayloadSchema>;
```

- [ ] **Step 4: Add the generation flag and failing upload contract tests**

In `packages/dtx-api/src/env.ts`, add:

```ts
BGM_M4A_GENERATION_ENABLED: 'true' | 'false';
```

Update touched `makeEnv()` test fixtures to default to `BGM_M4A_GENERATION_ENABLED: 'true'`.

Extend `packages/dtx-api/src/services/uploads.test.ts`:

```ts
it('rejects direct canonical bgm.m4a upload', async () => {
	mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
	const result = await uploadSimfileFile(
		makeEnv(),
		{ id: 'u1' },
		'42',
		makeFile(1024, 'bgm.m4a'),
		makeBucket()
	);
	expect(result.response.status).toBe(409);
});

it('rejects canonical bgm.ogg when generation is disabled', async () => {
	mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
	const result = await uploadSimfileFile(
		makeEnv({ BGM_M4A_GENERATION_ENABLED: 'false' }),
		{ id: 'u1' },
		'42',
		makeFile(1024, 'bgm.ogg'),
		makeBucket()
	);
	expect(result.response.status).toBe(409);
});

it('returns R2 identity separately while preserving the public JSON response', async () => {
	mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
	const bucket = {
		put: vi.fn(async () => ({
			key: '42/bgm.ogg', etag: 'etag-42', version: 'version-42', size: 2048
		}))
	} as unknown as R2Bucket;
	const result = await uploadSimfileFile(
		makeEnv(),
		{ id: 'u1' },
		'42',
		makeFile(2048, 'bgm.ogg'),
		bucket
	);
	expect(result.response.status).toBe(200);
	expect(result.uploadedObject).toEqual({
		simfileId: 42,
		key: '42/bgm.ogg',
		etag: 'etag-42',
		version: 'version-42',
		size: 2048
	});
	expect(await result.response.json()).toMatchObject({ file: { key: '42/bgm.ogg' } });
});
```

Change existing upload-service assertions from `response.status` to `result.response.status`.

- [ ] **Step 5: Run upload tests and verify RED on the old return type/guards**

```bash
cd packages/dtx-api
bun test src/services/bgmM4a.test.ts src/services/uploads.test.ts
```

Expected: helper tests PASS; upload tests FAIL because `uploadSimfileFile()` still returns a bare `Response` and permits the reserved/generation-disabled keys.

- [ ] **Step 6: Refactor `uploadSimfileFile()` minimally**

In `packages/dtx-api/src/services/uploads.ts`, add:

```ts
export type UploadedObject = {
	simfileId: number;
	key: string;
	etag: string;
	version: string;
	size: number;
};

export type UploadResult = {
	response: Response;
	uploadedObject?: UploadedObject;
};
```

Change the return type to `Promise<UploadResult>` and wrap every existing error response as `{ response: json(...) }`.

After sanitization and ownership validation, before `bucket.put`, add:

```ts
if (sanitized === BGM_DERIVATIVE_FILENAME) {
	return { response: json(409, { error: 'bgm.m4a is generated by the server' }) };
}
if (sanitized === BGM_SOURCE_FILENAME && env.BGM_M4A_GENERATION_ENABLED !== 'true') {
	return { response: json(409, { error: 'BGM generation is disabled in this environment' }) };
}
```

On successful `bucket.put`, preserve the existing JSON response body and additionally return:

```ts
return {
	response: json(200, {
		message: 'File uploaded successfully',
		file: {
			fileName: file.name,
			key,
			size: file.size,
			contentType: file.type || 'application/octet-stream',
			status: 'Uploaded'
		}
	}),
	uploadedObject: {
		simfileId,
		key,
		etag: result.etag,
		version: result.version,
		size: result.size
	}
};
```

- [ ] **Step 7: Run focused tests and typecheck**

```bash
cd packages/dtx-api
bun test src/services/bgmM4a.test.ts src/services/uploads.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add packages/dtx-api/src/env.ts \
  packages/dtx-api/src/services/bgmM4a.ts \
  packages/dtx-api/src/services/bgmM4a.test.ts \
  packages/dtx-api/src/services/uploads.ts \
  packages/dtx-api/src/services/uploads.test.ts
git commit -m "feat(api): lock BGM derivative upload contract"
```

---

### Task 2: Trigger one idempotent Workflow after canonical OGG upload

**Files:**
- Create: `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.ts`
- Create: `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.test.ts`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/src/rest/upload.ts`
- Modify: `packages/dtx-api/src/rest/upload.test.ts`

**Interfaces:**
- Consumes `UploadedObject`, `GenerateBgmM4aPayload`, and Task 1 key/identity helpers.
- Produces `triggerBgmM4aGeneration(env, uploadedObject): Promise<'disabled' | 'not-bgm' | 'started' | 'duplicate'>`.
- Adds `Env.BGM_M4A_WORKFLOW: Workflow<GenerateBgmM4aPayload>`.

- [ ] **Step 1: Add the Workflow binding type and failing trigger tests**

In `packages/dtx-api/src/env.ts`, import `Workflow` from `@cloudflare/workers-types` and add:

```ts
BGM_M4A_WORKFLOW: Workflow<GenerateBgmM4aPayload>;
```

Create `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { triggerBgmM4aGeneration } from './bgmM4aWorkflowTrigger';

const uploaded = {
	simfileId: 42,
	key: '42/bgm.ogg',
	etag: 'etag-42',
	version: 'version-42',
	size: 1234
};

const makeEnv = (createBatch = vi.fn(async () => [{ id: 'wf-1' }])) =>
	({
		BGM_M4A_GENERATION_ENABLED: 'true',
		BGM_M4A_WORKFLOW: { createBatch }
	}) as unknown as Env;

describe('triggerBgmM4aGeneration', () => {
	it('starts exactly one retained instance for canonical bgm.ogg', async () => {
		const createBatch = vi.fn(async () => [{ id: 'wf-1' }]);
		const result = await triggerBgmM4aGeneration(makeEnv(createBatch), uploaded);
		expect(result).toBe('started');
		expect(createBatch).toHaveBeenCalledTimes(1);
		expect(createBatch.mock.calls[0][0]).toHaveLength(1);
		expect(createBatch.mock.calls[0][0][0]).toMatchObject({
			params: {
				simfileId: 42,
				sourceKey: '42/bgm.ogg',
				expectedSourceEtag: 'etag-42',
				expectedSourceVersion: 'version-42',
				profile: 'aac-lc-192k-v1'
			},
			retention: { successRetention: '1 day', errorRetention: '7 days' }
		});
	});

	it('treats an empty createBatch result as a retained duplicate', async () => {
		const result = await triggerBgmM4aGeneration(makeEnv(vi.fn(async () => [])), uploaded);
		expect(result).toBe('duplicate');
	});

	it('does not start for nested/sample OGG', async () => {
		const createBatch = vi.fn();
		const result = await triggerBgmM4aGeneration(makeEnv(createBatch), {
			...uploaded,
			key: '42/assets/kick.ogg'
		});
		expect(result).toBe('not-bgm');
		expect(createBatch).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run trigger test and verify RED**

```bash
cd packages/dtx-api
bun test src/services/bgmM4aWorkflowTrigger.test.ts
```

Expected: FAIL because the trigger service does not exist.

- [ ] **Step 3: Implement the trigger helper**

Create `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.ts`:

```ts
import type { Env } from '../env';
import type { UploadedObject } from './uploads';
import {
	BGM_TRANSCODE_PROFILE,
	buildUploadWorkflowInstanceId,
	isCanonicalBgmSourceKey
} from './bgmM4a';

export type BgmTriggerOutcome = 'disabled' | 'not-bgm' | 'started' | 'duplicate';

export const triggerBgmM4aGeneration = async (
	env: Env,
	uploaded: UploadedObject
): Promise<BgmTriggerOutcome> => {
	if (env.BGM_M4A_GENERATION_ENABLED !== 'true') return 'disabled';
	if (!isCanonicalBgmSourceKey(uploaded.key, uploaded.simfileId)) return 'not-bgm';

	const id = await buildUploadWorkflowInstanceId(uploaded.simfileId, uploaded.etag);
	const created = await env.BGM_M4A_WORKFLOW.createBatch([
		{
			id,
			params: {
				simfileId: uploaded.simfileId,
				sourceKey: uploaded.key,
				expectedSourceEtag: uploaded.etag,
				expectedSourceVersion: uploaded.version,
				profile: BGM_TRANSCODE_PROFILE
			},
			retention: { successRetention: '1 day', errorRetention: '7 days' }
		}
	]);
	return created.length === 0 ? 'duplicate' : 'started';
};
```

- [ ] **Step 4: Convert upload-route mocks to the structured result and add scheduling tests**

Mock `triggerBgmM4aGeneration` from `../services/bgmM4aWorkflowTrigger`. Change the upload mock to return a structured `UploadResult`. Add:

```ts
it('schedules BGM generation after canonical bgm.ogg upload', async () => {
	mockedVerify.mockResolvedValue({ user: { id: 'u1' }, session: {} } as never);
	mockedUpload.mockResolvedValue({
		response: new Response(JSON.stringify({ file: { key: '42/bgm.ogg' } }), { status: 200 }),
		uploadedObject: {
			simfileId: 42,
			key: '42/bgm.ogg',
			etag: 'etag-42',
			version: 'version-42',
			size: 10
		}
	});
	const ctx = makeCtx();
	await routeUpload(multipartReq(), makeEnv(), ctx);
	expect(mockedTrigger).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ key: '42/bgm.ogg', etag: 'etag-42' })
	);
	expect(ctx.waitUntil).toHaveBeenCalled();
});

it('does not parse the response body to discover the uploaded R2 key', async () => {
	mockedVerify.mockResolvedValue({ user: { id: 'u1' }, session: {} } as never);
	const response = new Response('not-json', { status: 200 });
	mockedUpload.mockResolvedValue({
		response,
		uploadedObject: {
			simfileId: 42,
			key: '42/my song.dtx',
			etag: 'etag',
			version: 'version',
			size: 10
		}
	});
	await routeUpload(multipartReq(), makeEnv(), makeCtx());
	expect(mockedPurge).toHaveBeenCalledWith(
		expect.anything(),
		'https://files.example/42/my%20song.dtx',
		expect.anything()
	);
});
```

- [ ] **Step 5: Run route tests and verify RED on old response parsing**

```bash
cd packages/dtx-api
bun test src/services/bgmM4aWorkflowTrigger.test.ts src/rest/upload.test.ts
```

Expected: trigger tests PASS; route tests FAIL because `routeUpload()` still expects a bare `Response` and reparses JSON.

- [ ] **Step 6: Simplify `routeUpload()` around structured metadata**

Use:

```ts
const { response, uploadedObject } = await uploadSimfileFile(
	env,
	auth.user,
	simFileId,
	file,
	env.DTXFILE_BUCKET
);

if (uploadedObject) {
	const fileUrl = buildPublicR2Url(env.PUBLIC_SIMFILE_BUCKET_URL, uploadedObject.key);
	ctx.waitUntil(
		purgeCacheForFile(env, fileUrl, workerLogger).catch((error: unknown) => {
			workerLogger.error('Unexpected error in cache purge', { error: String(error) });
			return false;
		})
	);
	ctx.waitUntil(
		triggerBgmM4aGeneration(env, uploadedObject).catch((error: unknown) => {
			workerLogger.error('Failed to trigger BGM M4A generation', {
				simfileId: uploadedObject.simfileId,
				sourceKey: uploadedObject.key,
				error: String(error)
			});
			return 'not-bgm' as const;
		})
	);
}

return response;
```

Do not await either post-response side effect before returning the upload response.

- [ ] **Step 7: Run focused route/trigger tests and typecheck**

```bash
cd packages/dtx-api
bun test src/services/bgmM4aWorkflowTrigger.test.ts src/rest/upload.test.ts src/services/uploads.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add packages/dtx-api/src/env.ts \
  packages/dtx-api/src/services/bgmM4aWorkflowTrigger.ts \
  packages/dtx-api/src/services/bgmM4aWorkflowTrigger.test.ts \
  packages/dtx-api/src/rest/upload.ts \
  packages/dtx-api/src/rest/upload.test.ts
git commit -m "feat(api): trigger BGM conversion workflow"
```

---

### Task 3: Add the scale-to-zero FFmpeg Container

**Files:**
- Create: `packages/dtx-api/src/containers/bgmTranscoder.ts`
- Create: `packages/dtx-api/container/bgm-transcoder/Dockerfile`
- Create: `packages/dtx-api/container/bgm-transcoder/server.ts`
- Create: `packages/dtx-api/container/bgm-transcoder/smoke.sh`
- Modify: `packages/dtx-api/package.json`
- Modify: `bun.lock`

**Interfaces:**
- Produces exported `BgmTranscoderContainer` with port 8080, one-minute sleep, internet disabled.
- Produces internal `POST /transcode/ogg-to-m4a`: request `audio/ogg`, success `200 audio/mp4`, invalid-media `422`, internal failure `500`.
- Produces package script `smoke:bgm-transcoder` for Task 8 verification.

- [ ] **Step 1: Add the Cloudflare Containers dependency**

```bash
cd packages/dtx-api
bun add @cloudflare/containers
```

Expected: `packages/dtx-api/package.json` and root `bun.lock` change; no other package receives the dependency.

- [ ] **Step 2: Add the Container class wrapper**

Create `packages/dtx-api/src/containers/bgmTranscoder.ts`:

```ts
import { Container } from '@cloudflare/containers';

export class BgmTranscoderContainer extends Container {
	defaultPort = 8080;
	sleepAfter = '1m';
	enableInternet = false;
}
```

- [ ] **Step 3: Build the minimal FFmpeg image**

Create `packages/dtx-api/container/bgm-transcoder/Dockerfile`:

```dockerfile
FROM oven/bun:1.3.9-debian

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.ts ./server.ts
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
```

- [ ] **Step 4: Implement one-FFmpeg-process-at-a-time transcoding with streamed input/output**

Create `packages/dtx-api/container/bgm-transcoder/server.ts` with:

```ts
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

let ffmpegTail: Promise<void> = Promise.resolve();

const runSerialized = async <T>(work: () => Promise<T>): Promise<T> => {
	const previous = ffmpegTail;
	let release!: () => void;
	ffmpegTail = new Promise<void>((resolve) => (release = resolve));
	await previous;
	try {
		return await work();
	} finally {
		release();
	}
};

const run = (command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.once('error', reject);
		child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
	});

const responseBodyWithCleanup = (path: string, directory: string): ReadableStream<Uint8Array> => {
	const reader = Bun.file(path).stream().getReader();
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		cleaned = true;
		await rm(directory, { recursive: true, force: true });
	};
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
				await cleanup();
				return;
			}
			controller.enqueue(value);
		},
		async cancel(reason) {
			await reader.cancel(reason);
			await cleanup();
		}
	});
};
```

For `POST /transcode/ogg-to-m4a`:

```ts
const directory = await mkdtemp(join(tmpdir(), 'bgm-m4a-'));
const inputPath = join(directory, 'input.ogg');
const outputPath = join(directory, 'output.m4a');
try {
	if (!request.body) return new Response('Missing audio body', { status: 400 });
	await pipeline(Readable.fromWeb(request.body as never), createWriteStream(inputPath));

	const result = await runSerialized(async () => {
		const ffmpeg = await run('ffmpeg', [
			'-nostdin', '-hide_banner', '-loglevel', 'error',
			'-i', inputPath,
			'-map', '0:a:0', '-vn',
			'-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k',
			'-movflags', '+faststart',
			outputPath
		]);
		if (ffmpeg.code !== 0) return { status: 422 as const };
		const probe = await run('ffprobe', [
			'-v', 'error', '-select_streams', 'a:0',
			'-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1',
			outputPath
		]);
		return probe.code === 0 && probe.stdout.trim() === 'aac'
			? { status: 200 as const }
			: { status: 422 as const };
	});

	if (result.status === 422) {
		await rm(directory, { recursive: true, force: true });
		return new Response('Invalid OGG audio', { status: 422 });
	}
	return new Response(responseBodyWithCleanup(outputPath, directory), {
		status: 200,
		headers: { 'content-type': 'audio/mp4' }
	});
} catch (error) {
	await rm(directory, { recursive: true, force: true });
	console.error('BGM transcode failed', error);
	return new Response('Transcode failed', { status: 500 });
}
```

Return `404` for unknown paths and `405` for non-POST requests to the transcode path. Do not delete the output before the response body finishes; cleanup occurs on stream close/cancel.

- [ ] **Step 5: Add a binary-free Docker smoke script**

Create executable `packages/dtx-api/container/bgm-transcoder/smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE="dtx-bgm-transcoder-smoke"
CONTAINER="dtx-bgm-transcoder-smoke-$$"
TMP="$(mktemp -d)"
trap 'docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

docker build -t "$IMAGE" "$(dirname "$0")"
docker run --rm -v "$TMP:/work" "$IMAGE" \
  ffmpeg -nostdin -hide_banner -loglevel error \
  -f lavfi -i 'sine=frequency=880:duration=1' -c:a libvorbis /work/input.ogg

docker run -d --name "$CONTAINER" -p 18080:8080 "$IMAGE" >/dev/null
for _ in {1..30}; do
  if curl -fsS -X POST --data-binary @"$TMP/input.ogg" \
    -H 'Content-Type: audio/ogg' \
    http://127.0.0.1:18080/transcode/ogg-to-m4a \
    -o "$TMP/output.m4a"; then
    break
  fi
  sleep 1
done

docker run --rm -v "$TMP:/work" "$IMAGE" \
  sh -c "test \"\$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 /work/output.m4a)\" = aac"
```

Add to `packages/dtx-api/package.json`:

```json
"smoke:bgm-transcoder": "bash container/bgm-transcoder/smoke.sh"
```

- [ ] **Step 6: Run the Container smoke and API typecheck**

```bash
cd packages/dtx-api
bun run smoke:bgm-transcoder
bun run check
```

Expected: Docker image builds, the generated OGG returns an M4A, ffprobe reports `aac`, and TypeScript check passes.

- [ ] **Step 7: Commit Task 3**

```bash
git add packages/dtx-api/src/containers/bgmTranscoder.ts \
  packages/dtx-api/container/bgm-transcoder \
  packages/dtx-api/package.json bun.lock
git commit -m "feat(api): add BGM transcoder container"
```

---

### Task 4: Implement source-safe R2 → Container → staging → publish operations

**Files:**
- Create: `packages/dtx-api/src/services/bgmM4aGeneration.ts`
- Create: `packages/dtx-api/src/services/bgmM4aGeneration.test.ts`
- Modify: `packages/dtx-api/src/env.ts`

**Interfaces:**
- Adds `Env.BGM_TRANSCODER: DurableObjectNamespace`.
- Produces `BgmSourceState`, `InspectBgmResult`, `StageBgmResult`, `PermanentBgmTranscodeError`.
- Produces `inspectBgmGeneration()`, `transcodeBgmToStaging()`, `publishBgmFromStaging()`, and `cleanupBgmStaging()` for Task 5.

- [ ] **Step 1: Add the Container binding type**

In `packages/dtx-api/src/env.ts`, add:

```ts
BGM_TRANSCODER: DurableObjectNamespace;
```

- [ ] **Step 2: Write failing source-inspection tests**

Create `packages/dtx-api/src/services/bgmM4aGeneration.test.ts` with a bucket helper:

```ts
const makeEnv = (bucketOverrides: Record<string, unknown> = {}) =>
	({
		DTXFILE_BUCKET: {
			head: vi.fn(),
			get: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
			...bucketOverrides
		},
		BGM_TRANSCODER: {} as DurableObjectNamespace,
		PUBLIC_SIMFILE_BUCKET_URL: 'https://files.example'
	}) as unknown as Env;

const payload: GenerateBgmM4aPayload = {
	simfileId: 42,
	sourceKey: '42/bgm.ogg',
	expectedSourceEtag: 'etag-42',
	expectedSourceVersion: 'version-42',
	profile: 'aac-lc-192k-v1'
};
```

Add concrete tests:

```ts
it('returns superseded when expected upload ETag no longer matches', async () => {
	const env = makeEnv({
		head: vi.fn(async (key: string) =>
			key === '42/bgm.ogg' ? { etag: 'new-etag', version: 'new-version' } : null
		)
	});
	expect(await inspectBgmGeneration(env, payload)).toEqual({ status: 'superseded' });
});

it('returns cached when derivative metadata matches the current source/profile', async () => {
	const env = makeEnv({
		head: vi.fn(async (key: string) => {
			if (key === '42/bgm.ogg') return { etag: 'etag-42', version: 'version-42' };
			if (key === '42/bgm.m4a') {
				return {
					customMetadata: {
						'source-etag': 'etag-42',
						'transcode-profile': 'aac-lc-192k-v1'
					}
				};
			}
			return null;
		})
	});
	expect(await inspectBgmGeneration(env, payload)).toEqual({
		status: 'cached',
		sourceState: { etag: 'etag-42', version: 'version-42' }
	});
});
```

- [ ] **Step 3: Run generation tests and verify RED**

```bash
cd packages/dtx-api
bun test src/services/bgmM4aGeneration.test.ts
```

Expected: FAIL because the generation service does not exist.

- [ ] **Step 4: Implement source inspection and stale-derivative removal**

Create `packages/dtx-api/src/services/bgmM4aGeneration.ts`:

```ts
export type BgmSourceState = { etag: string; version: string };
export type InspectBgmResult =
	| { status: 'cached'; sourceState: BgmSourceState }
	| { status: 'superseded' }
	| { status: 'generate'; sourceState: BgmSourceState };

export class PermanentBgmTranscodeError extends Error {}
```

`inspectBgmGeneration(env, payload)` must:

```ts
const source = await env.DTXFILE_BUCKET.head(payload.sourceKey);
if (!source) return { status: 'superseded' } as const;
if (payload.expectedSourceEtag && source.etag !== payload.expectedSourceEtag) {
	return { status: 'superseded' } as const;
}
if (payload.expectedSourceVersion && source.version !== payload.expectedSourceVersion) {
	return { status: 'superseded' } as const;
}
const sourceState = { etag: source.etag, version: source.version };
const destinationKey = bgmDerivativeKey(payload.simfileId);
const destination = await env.DTXFILE_BUCKET.head(destinationKey);
const metadata = destination?.customMetadata;
if (
	metadata?.['source-etag'] === sourceState.etag &&
	metadata?.['transcode-profile'] === payload.profile
) {
	return { status: 'cached', sourceState } as const;
}
if (destination) {
	await env.DTXFILE_BUCKET.delete(destinationKey);
	await purgeCacheForFile(
		env,
		buildPublicR2Url(env.PUBLIC_SIMFILE_BUCKET_URL, destinationKey),
		workerLogger
	);
}
return { status: 'generate', sourceState } as const;
```

- [ ] **Step 5: Add failing transcode/publish tests and mock `getContainer()`**

At test module scope:

```ts
vi.mock('@cloudflare/containers', () => ({ getContainer: vi.fn() }));
const { getContainer } = await import('@cloudflare/containers');
const mockedGetContainer = vi.mocked(getContainer);
```

Add:

```ts
it('maps a 422 container response to PermanentBgmTranscodeError', async () => {
	const sourceBody = new ReadableStream<Uint8Array>();
	const env = makeEnv({
		get: vi.fn(async () => ({
			etag: 'etag-42', version: 'version-42', body: sourceBody
		})),
		delete: vi.fn(async () => undefined)
	});
	mockedGetContainer.mockReturnValue({
		fetch: vi.fn(async () => new Response('bad ogg', { status: 422 }))
	} as never);
	await expect(
		transcodeBgmToStaging(env, payload, { etag: 'etag-42', version: 'version-42' })
	).rejects.toBeInstanceOf(PermanentBgmTranscodeError);
});

it('does not publish when source changes after staging', async () => {
	const put = vi.fn();
	const deleteObject = vi.fn(async () => undefined);
	const env = makeEnv({
		head: vi.fn(async () => ({ etag: 'new-etag', version: 'new-version' })),
		put,
		delete: deleteObject
	});
	const result = await publishBgmFromStaging(
		env,
		payload,
		{ etag: 'etag-42', version: 'version-42' },
		'_generated/bgm-m4a-v1/42/abc.m4a'
	);
	expect(result).toEqual({ status: 'superseded' });
	expect(put).not.toHaveBeenCalled();
	expect(deleteObject).toHaveBeenCalledWith('_generated/bgm-m4a-v1/42/abc.m4a');
});
```

Also add one success test whose staging `get()` returns a `ReadableStream`, whose canonical `put()` returns an R2 object, and which asserts exact `audio/mp4`, five-minute cache policy, and all four custom metadata keys.

- [ ] **Step 6: Implement streaming transcode to deterministic staging**

Use:

```ts
const source = await env.DTXFILE_BUCKET.get(payload.sourceKey);
if (!source?.body) return { status: 'superseded' } as const;
if (source.etag !== sourceState.etag || source.version !== sourceState.version) {
	return { status: 'superseded' } as const;
}

const stagingKey = await bgmStagingKey(payload.simfileId, sourceState.etag);
const container = getContainer(env.BGM_TRANSCODER, 'bgm-transcoder');
try {
	const response = await container.fetch(
		new Request('http://bgm-transcoder/transcode/ogg-to-m4a', {
			method: 'POST',
			headers: { 'content-type': 'audio/ogg' },
			body: source.body
		})
	);
	if (response.status >= 400 && response.status < 500) {
		throw new PermanentBgmTranscodeError(`BGM transcode rejected with ${response.status}`);
	}
	if (!response.ok || !response.body) {
		throw new Error(`BGM transcode failed with ${response.status}`);
	}
	const staged = await env.DTXFILE_BUCKET.put(stagingKey, response.body, {
		httpMetadata: { contentType: 'audio/mp4' }
	});
	if (!staged) throw new Error('Failed to persist staged BGM M4A');
	return { status: 'staged', stagingKey, size: staged.size, sourceState } as const;
} catch (error) {
	await cleanupBgmStaging(env, stagingKey);
	throw error;
}
```

- [ ] **Step 7: Implement guarded publish and idempotent cleanup**

Before publish, re-HEAD source and compare both ETag/version. If mismatched, delete staging and return `superseded`.

When current, GET staging and PUT canonical M4A with:

```ts
{
	httpMetadata: {
		contentType: 'audio/mp4',
		cacheControl: 'public, max-age=300, must-revalidate'
	},
	customMetadata: {
		'source-key': payload.sourceKey,
		'source-etag': sourceState.etag,
		'source-version': sourceState.version,
		'transcode-profile': payload.profile
	}
}
```

After successful canonical PUT, best-effort purge the public M4A URL, delete staging, and return:

```ts
{ status: 'ready', destinationKey, sourceEtag: sourceState.etag }
```

`cleanupBgmStaging()` catches/logs delete failures and never replaces the original error.

- [ ] **Step 8: Run generation tests and typecheck**

```bash
cd packages/dtx-api
bun test src/services/bgmM4aGeneration.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add packages/dtx-api/src/env.ts \
  packages/dtx-api/src/services/bgmM4aGeneration.ts \
  packages/dtx-api/src/services/bgmM4aGeneration.test.ts
git commit -m "feat(api): implement source-safe BGM generation"
```

---

### Task 5: Add the Workers-runtime Workflow wrapper and explicit Wrangler resources

**Files:**
- Create: `packages/dtx-api/src/workflows/generateBgmM4a.ts`
- Modify: `packages/dtx-api/src/index.ts`
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-api/package.json`

**Interfaces:**
- Consumes Task 4 pure/service operations.
- Produces exported `GenerateBgmM4aWorkflow` and `BgmTranscoderContainer` classes required by Wrangler.
- Produces binding names `BGM_M4A_WORKFLOW` and `BGM_TRANSCODER` in every deployed environment.

- [ ] **Step 1: Add Wrangler resources first to create a RED build gate**

In top-level `packages/dtx-api/wrangler.jsonc`, add:

```jsonc
"workflows": [
  {
    "binding": "BGM_M4A_WORKFLOW",
    "name": "dtx-api-bgm-m4a",
    "class_name": "GenerateBgmM4aWorkflow"
  }
],
"containers": [
  {
    "class_name": "BgmTranscoderContainer",
    "image": "./container/bgm-transcoder/Dockerfile",
    "max_instances": 1,
    "instance_type": "basic"
  }
],
"durable_objects": {
  "bindings": [
    { "name": "BGM_TRANSCODER", "class_name": "BgmTranscoderContainer" }
  ]
},
"migrations": [
  { "tag": "v1-bgm-transcoder", "new_sqlite_classes": ["BgmTranscoderContainer"] }
],
```

Add production var:

```jsonc
"BGM_M4A_GENERATION_ENABLED": "true"
```

Repeat non-inheritable `workflows`, `containers`, `durable_objects`, and vars under `env.pre-prod` and `env.pre-prod-prod-data`. Use Workflow names:

```text
pre-prod:           dtx-api-pre-prod-bgm-m4a
pre-prod-prod-data: dtx-api-pre-prod-prod-data-bgm-m4a
```

Set pre-prod flag `true`, pre-prod-prod-data flag `false`. Add an environment-level `migrations` array for each named environment with `new_sqlite_classes: ["BgmTranscoderContainer"]` so each separate Worker provisions its own namespace.

- [ ] **Step 2: Run the production dry-run and verify RED**

```bash
cd packages/dtx-api
bun run build
```

Expected: FAIL because Wrangler configuration references `GenerateBgmM4aWorkflow`/`BgmTranscoderContainer` exports not yet present from `src/index.ts` (the Container class exists but is not exported from the Worker entrypoint).

- [ ] **Step 3: Implement the thin Workflow wrapper**

Create `packages/dtx-api/src/workflows/generateBgmM4a.ts`:

```ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Env } from '../env';
import { bgmM4aPayloadSchema, type GenerateBgmM4aPayload } from '../services/bgmM4a';
import {
	PermanentBgmTranscodeError,
	cleanupBgmStaging,
	inspectBgmGeneration,
	publishBgmFromStaging,
	transcodeBgmToStaging
} from '../services/bgmM4aGeneration';

export class GenerateBgmM4aWorkflow extends WorkflowEntrypoint<Env, GenerateBgmM4aPayload> {
	async run(event: WorkflowEvent<GenerateBgmM4aPayload>, step: WorkflowStep) {
		const payload = await step.do('validate BGM generation payload', async () => {
			const parsed = bgmM4aPayloadSchema.safeParse(event.payload);
			if (!parsed.success) throw new NonRetryableError(parsed.error.message);
			return parsed.data;
		});

		const inspected = await step.do('inspect BGM source and derivative', async () =>
			inspectBgmGeneration(this.env, payload)
		);
		if (inspected.status !== 'generate') return { status: inspected.status };

		let stagingKey: string | undefined;
		try {
			const staged = await step.do(
				'transcode BGM to M4A staging',
				{
					retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' },
					timeout: '30 minutes'
				},
				async () => {
					try {
						return await transcodeBgmToStaging(this.env, payload, inspected.sourceState);
					} catch (error) {
						if (error instanceof PermanentBgmTranscodeError) {
							throw new NonRetryableError(error.message);
						}
						throw error;
					}
				}
			);
			if (staged.status === 'superseded') return { status: 'superseded' };
			stagingKey = staged.stagingKey;
			return await step.do('publish current BGM derivative', async () =>
				publishBgmFromStaging(this.env, payload, staged.sourceState, staged.stagingKey)
			);
		} catch (error) {
			if (stagingKey) {
				await step.do('clean failed BGM staging', async () => {
					await cleanupBgmStaging(this.env, stagingKey!);
					return { cleaned: true };
				});
			}
			throw error;
		}
	}
}
```

Do not unit-import this Workers-only wrapper from the Node Vitest suite. Task 4 tests its orchestration seams; Wrangler builds verify runtime module resolution and class/config contracts.

- [ ] **Step 4: Export the Workflow and Container classes from `src/index.ts`**

Add:

```ts
export { BgmTranscoderContainer } from './containers/bgmTranscoder';
export { GenerateBgmM4aWorkflow } from './workflows/generateBgmM4a';
```

Keep the existing default fetch handler unchanged.

- [ ] **Step 5: Add explicit environment dry-run/typegen scripts**

In `packages/dtx-api/package.json`, add:

```json
"build:preprod": "wrangler deploy --dry-run --env pre-prod --outdir=dist/pre-prod",
"build:preprod:prod-data": "wrangler deploy --dry-run --env pre-prod-prod-data --outdir=dist/pre-prod-prod-data",
"cf-typegen:preprod": "wrangler types --env pre-prod --env-interface CloudflareBindings",
"cf-typegen:preprod:prod-data": "wrangler types --env pre-prod-prod-data --env-interface CloudflareBindings"
```

- [ ] **Step 6: Run typecheck and all three Wrangler dry runs**

```bash
cd packages/dtx-api
bun run check
bun run build
bun run build:preprod
bun run build:preprod:prod-data
bun run cf-typegen >/dev/null
bun run cf-typegen:preprod >/dev/null
bun run cf-typegen:preprod:prod-data >/dev/null
```

Expected: PASS. Docker must be available because Wrangler resolves the configured Container image during build/deploy checks.

- [ ] **Step 7: Commit Task 5**

```bash
git add packages/dtx-api/src/workflows/generateBgmM4a.ts \
  packages/dtx-api/src/index.ts \
  packages/dtx-api/wrangler.jsonc \
  packages/dtx-api/package.json
git commit -m "feat(api): deploy BGM generation workflow"
```

---

### Task 6: Make catalog discovery M4A-aware without bloating raw ZIP downloads

**Files:**
- Modify: `packages/dtx-api/src/services/r2Enrichment.ts`
- Modify: `packages/dtx-api/src/services/r2Enrichment.test.ts`
- Modify: `packages/dtx-api/src/services/downloads.ts`
- Create: `packages/dtx-api/src/services/downloads.test.ts`

**Interfaces:**
- `discoverCatalogFiles()` recognizes M4A but keeps OGG ahead of it for generic full-track discovery.
- `collectZipSources()` applies one DTX-specific pre-filter while generic `createZipSources()` remains untouched.

- [ ] **Step 1: Add failing catalog precedence tests**

Extend `r2Enrichment.test.ts`:

```ts
it('uses top-level m4a when it is the only full-track audio', async () => {
	const bucket = makeBucket([[
		{ key: '42/bgm.m4a', size: 1000, uploaded: new Date() }
	]]);
	const result = await discoverCatalogFiles(
		bucket,
		{ simfileId: 42, dtxFiles: [], publicBaseUrl: 'https://files.example' },
		silentLogger
	);
	expect(result.downloadUrl).toBe('https://files.example/42/bgm.m4a');
});

it('keeps ogg ahead of generated m4a for generic download discovery', async () => {
	const bucket = makeBucket([[
		{ key: '42/bgm.m4a', size: 900, uploaded: new Date() },
		{ key: '42/bgm.ogg', size: 1000, uploaded: new Date() }
	]]);
	const result = await discoverCatalogFiles(
		bucket,
		{ simfileId: 42, dtxFiles: [], publicBaseUrl: 'https://files.example' },
		silentLogger
	);
	expect(result.downloadUrl).toBe('https://files.example/42/bgm.ogg');
});
```

- [ ] **Step 2: Add failing raw ZIP source tests**

Create `packages/dtx-api/src/services/downloads.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { collectZipSources } from './downloads';

const makeListBucket = (objects: Array<{ key: string; size: number; uploaded: Date }>) =>
	({
		list: vi.fn(async () => ({ objects, truncated: false }))
	}) as unknown as R2Bucket;

it('omits generated top-level bgm.m4a when canonical bgm.ogg exists', async () => {
	const result = await collectZipSources(
		makeListBucket([
			{ key: '42/basic.dtx', size: 10, uploaded: new Date() },
			{ key: '42/bgm.ogg', size: 100, uploaded: new Date() },
			{ key: '42/bgm.m4a', size: 90, uploaded: new Date() }
		]),
		[42],
		{ flatSingle: true }
	);
	expect(result.sources.map((source) => source.objectKey)).toEqual([
		'42/basic.dtx',
		'42/bgm.ogg'
	]);
});

it('keeps bgm.m4a when canonical bgm.ogg is absent', async () => {
	const result = await collectZipSources(
		makeListBucket([
			{ key: '42/basic.dtx', size: 10, uploaded: new Date() },
			{ key: '42/bgm.m4a', size: 90, uploaded: new Date() }
		]),
		[42],
		{ flatSingle: true }
	);
	expect(result.sources.map((source) => source.objectKey)).toContain('42/bgm.m4a');
});

it('does not remove nested sample m4a files', async () => {
	const result = await collectZipSources(
		makeListBucket([
			{ key: '42/bgm.ogg', size: 100, uploaded: new Date() },
			{ key: '42/assets/kick.m4a', size: 5, uploaded: new Date() }
		]),
		[42],
		{ flatSingle: true }
	);
	expect(result.sources.map((source) => source.objectKey)).toContain('42/assets/kick.m4a');
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

```bash
cd packages/dtx-api
bun test src/services/r2Enrichment.test.ts src/services/downloads.test.ts
```

Expected: M4A catalog test FAIL because `.m4a` is unknown; ZIP duplicate test FAIL because both top-level BGM files are included.

- [ ] **Step 4: Add M4A to the existing extension ordering**

Change exactly:

```ts
const audioExts = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'];
```

Do not change top-level-vs-nested selection logic.

- [ ] **Step 5: Filter only the redundant generated top-level sidecar before generic ZIP mapping**

In `downloads.ts`, add:

```ts
const withoutRedundantGeneratedBgm = <T extends { key: string }>(
	objects: T[],
	simfileId: number
): T[] => {
	if (!objects.some((object) => object.key === bgmSourceKey(simfileId))) return objects;
	const derivativeKey = bgmDerivativeKey(simfileId);
	return objects.filter((object) => object.key !== derivativeKey);
};
```

Pass the filtered array into `createZipSources()` inside `collectZipSources()`.

Do not modify `packages/common/src/lib/server/zipBuilder.ts`.

- [ ] **Step 6: Run focused and route download tests**

```bash
cd packages/dtx-api
bun test src/services/r2Enrichment.test.ts src/services/downloads.test.ts src/rest/downloadSimfile.test.ts src/rest/downloadBulk.test.ts
bun run check
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add packages/dtx-api/src/services/r2Enrichment.ts \
  packages/dtx-api/src/services/r2Enrichment.test.ts \
  packages/dtx-api/src/services/downloads.ts \
  packages/dtx-api/src/services/downloads.test.ts
git commit -m "feat(api): expose M4A without duplicating raw ZIP audio"
```

---

### Task 7: Add the one-time published-catalog audit/backfill script

**Files:**
- Create: `packages/dtx-api/src/scripts/backfill-bgm-m4a.ts`
- Create: `packages/dtx-api/src/scripts/backfill-bgm-m4a.test.ts`
- Modify: `packages/dtx-api/package.json`

**Interfaces:**
- Consumes GraphQL `simfiles(scope: PUBLISHED, page, pageSize) { count data { id files { key uploaded } } }`.
- Produces a dry-run audit by default and only starts Workflows with `--execute`.
- On `--execute`, starts candidates sequentially, polls each instance to a terminal state, and reports `ready`, `cached`, `superseded`, or `errored` before moving to the next candidate.
- Uses operator environment variables `DTX_GRAPHQL_URL`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `BGM_WORKFLOW_NAME`; no operator credentials enter deployed Worker config.

- [ ] **Step 1: Write failing catalog-selection, REST-body, and outcome tests**

Create `packages/dtx-api/src/scripts/backfill-bgm-m4a.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	buildWorkflowCreateBody,
	parseWorkflowOutcome,
	selectMissingM4a,
	type PublishedSimfile
} from './backfill-bgm-m4a';

const rows: PublishedSimfile[] = [
	{
		id: '42',
		files: [
			{ key: '42/bgm.ogg', uploaded: '2026-08-01T00:00:00.000Z' },
			{ key: '42/basic.dtx', uploaded: '2026-08-01T00:00:00.000Z' }
		]
	},
	{
		id: '43',
		files: [
			{ key: '43/bgm.ogg', uploaded: '2026-08-02T00:00:00.000Z' },
			{ key: '43/bgm.m4a', uploaded: '2026-08-02T00:01:00.000Z' }
		]
	}
];

it('selects only published rows with top-level OGG and no M4A', () => {
	expect(selectMissingM4a(rows).map((row) => row.id)).toEqual(['42']);
});

it('builds JSON-encoded Workflow params with deterministic identity and retention', async () => {
	const body = await buildWorkflowCreateBody(rows[0]);
	expect(body.instance_id).toMatch(/^bgm-m4a-v1-backfill-42-/);
	expect(body.instance_retention).toEqual({
		success_retention: '1 day',
		error_retention: '7 days'
	});
	expect(JSON.parse(body.params)).toEqual({
		simfileId: 42,
		sourceKey: '42/bgm.ogg',
		profile: 'aac-lc-192k-v1'
	});
});

it('maps completed Workflow output to the domain outcome', () => {
	expect(parseWorkflowOutcome({ status: 'complete', output: { status: 'ready' } })).toBe('ready');
	expect(parseWorkflowOutcome({ status: 'complete', output: { status: 'cached' } })).toBe('cached');
	expect(parseWorkflowOutcome({ status: 'complete', output: { status: 'superseded' } })).toBe(
		'superseded'
	);
	expect(parseWorkflowOutcome({ status: 'errored', output: null })).toBe('errored');
});
```

- [ ] **Step 2: Run the script test and verify RED**

```bash
cd packages/dtx-api
bun test src/scripts/backfill-bgm-m4a.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement typed catalog pagination and selection**

Use exactly:

```graphql
query PublishedSimfiles($page: Int!, $pageSize: Int!) {
  simfiles(scope: PUBLISHED, page: $page, pageSize: $pageSize) {
    count
    data {
      id
      files {
        key
        uploaded
      }
    }
  }
}
```

Define:

```ts
export type PublishedSimfile = {
	id: string;
	files: Array<{ key: string; uploaded: string }>;
};
```

Page with `pageSize = 100` until accumulated rows reach `count`. Throw on non-2xx GraphQL HTTP responses or GraphQL `errors`; never backfill a partial catalog.

`selectMissingM4a()` requires exact `${id}/bgm.ogg`, ignores nested-only OGG, and excludes rows already containing exact `${id}/bgm.m4a`.

- [ ] **Step 4: Implement deterministic instance creation**

Use the source OGG file's `uploaded` timestamp plus `buildBackfillWorkflowInstanceId()`; do not HEAD public R2 from the operator script.

Build:

```ts
{
	instance_id: await buildBackfillWorkflowInstanceId(Number(row.id), source.uploaded),
	params: JSON.stringify({
		simfileId: Number(row.id),
		sourceKey: `${row.id}/bgm.ogg`,
		profile: BGM_TRANSCODE_PROFILE
	}),
	instance_retention: {
		success_retention: '1 day',
		error_retention: '7 days'
	}
}
```

POST to:

```text
https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/workflows/{BGM_WORKFLOW_NAME}/instances
```

with Bearer authorization and JSON content type.

- [ ] **Step 5: Poll each started instance and report the terminal domain outcome**

After a successful POST, poll:

```text
GET /client/v4/accounts/{accountId}/workflows/{workflowName}/instances/{instanceId}
```

at five-second intervals until `status` is `complete`, `errored`, or `terminated`.

Implement:

```ts
export type BackfillOutcome = 'ready' | 'cached' | 'superseded' | 'errored';

export const parseWorkflowOutcome = (result: {
	status: string;
	output: unknown;
}): BackfillOutcome | null => {
	if (result.status === 'errored' || result.status === 'terminated') return 'errored';
	if (result.status !== 'complete') return null;
	const output =
		typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
	if (typeof output !== 'object' || output === null || !('status' in output)) return 'errored';
	const status = (output as { status?: unknown }).status;
	return status === 'ready' || status === 'cached' || status === 'superseded'
		? status
		: 'errored';
};
```

For each candidate, print `<simfileId>: <outcome>`. Stop immediately and exit nonzero on `errored`; otherwise continue to the next candidate. This keeps effective transcode concurrency at one without adding Queue/job state.

- [ ] **Step 6: Make dry-run the default operational mode**

`main()` prints:

```text
published total: <n>
with top-level bgm.ogg: <n>
with top-level bgm.m4a: <n>
missing bgm.m4a: <n>
mode: dry-run|execute
```

Without `--execute`, make no Workflow API calls and exit 0 after the audit.

With `--execute`, require `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `BGM_WORKFLOW_NAME`, then start/poll candidates sequentially.

Add package script:

```json
"backfill:bgm-m4a": "bun run src/scripts/backfill-bgm-m4a.ts"
```

- [ ] **Step 7: Run unit tests and a safe pre-prod dry-run**

```bash
cd packages/dtx-api
bun test src/scripts/backfill-bgm-m4a.test.ts
DTX_GRAPHQL_URL=https://api.pre-prod.dtx.hapadona.com/graphql \
  bun run backfill:bgm-m4a
```

Expected: unit test PASS; script prints counts and `mode: dry-run` without creating Workflow instances.

- [ ] **Step 8: Commit Task 7**

```bash
git add packages/dtx-api/src/scripts/backfill-bgm-m4a.ts \
  packages/dtx-api/src/scripts/backfill-bgm-m4a.test.ts \
  packages/dtx-api/package.json
git commit -m "feat(api): add BGM M4A backfill tool"
```

---

### Task 8: Close HPA-311 with full verification, pre-prod proof, production backfill, and the Virgo gate

**Files:**
- Modify only if verification finds an HPA-311 bug in files owned by Tasks 1–7.
- Update the implementation PR description with recorded smoke/backfill evidence; do not create another implementation PR.

**Interfaces:**
- Consumes all Task 1–7 deliverables.
- Produces the backend rollout/backfill evidence required to unblock Virgo HPA-85.

- [ ] **Step 1: Run every focused dtx-api unit test**

```bash
cd packages/dtx-api
bun test \
  src/services/bgmM4a.test.ts \
  src/services/bgmM4aWorkflowTrigger.test.ts \
  src/services/bgmM4aGeneration.test.ts \
  src/services/uploads.test.ts \
  src/rest/upload.test.ts \
  src/services/r2Enrichment.test.ts \
  src/services/downloads.test.ts \
  src/rest/downloadSimfile.test.ts \
  src/rest/downloadBulk.test.ts \
  src/scripts/backfill-bgm-m4a.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package and repository static/test gates**

```bash
cd packages/dtx-api
bun run check
bun run test
bun run build
bun run build:preprod
bun run build:preprod:prod-data
bun run smoke:bgm-transcoder
cd ../..
bun run lint
bun run test
```

Expected: PASS. If the root suite exposes a pre-existing unrelated failure, reproduce the same failure on `main` and record the exact command/test in the PR; do not weaken HPA-311 tests.

- [ ] **Step 3: Verify no forbidden architecture slipped into the diff**

```bash
git diff main...HEAD --name-only
git grep -nE 'job_status|ios-package' -- packages/dtx-api/src || true
```

Confirm:

- no D1 migration was added;
- no Queue/R2 event binding was added;
- no public generation/status route was added;
- `packages/common/src/lib/server/zipBuilder.ts` is unchanged;
- GraphQL schema/generated client files are unchanged;
- all production work remains one HPA-311 implementation PR.

- [ ] **Step 4: Deploy and smoke pre-production**

```bash
bun run deploy:api:preprod
```

Use an existing owned pre-prod simfile and upload a real `bgm.ogg` through authenticated `/upload`. Verify:

1. upload returns success before the Workflow finishes;
2. the Workflow reaches `ready` or `cached`;
3. R2 contains `{simfileId}/bgm.m4a`;
4. custom metadata includes source ETag/version and `transcode-profile=aac-lc-192k-v1`;
5. public object is `audio/mp4` with a five-minute cache policy;
6. re-uploading identical bytes does not republish another derivative;
7. replacing the source during a deliberately paused/slow conversion cannot publish the older staged derivative.

- [ ] **Step 5: Validate generated media on the Apple playback path**

Download generated pre-prod M4A and run:

```bash
afinfo /tmp/bgm.m4a
```

Require AAC audio in an MPEG-4/M4A container.

Then open the same file through `AVAudioPlayer(contentsOf:)` (the existing Virgo HPA-85 smoke path is suitable) and require `prepareToPlay()` success. Play one representative rhythm chart and record whether chart/BGM synchronization remains acceptable.

Do not add a hardcoded timing offset unless measured evidence demonstrates a conversion-induced offset.

- [ ] **Step 6: Prove `pre-prod-prod-data` cannot mutate canonical BGM**

Build/deploy that environment only as needed for the upload guard; never intentionally start a Workflow against production R2:

```bash
bun run --filter=dtx-api build:preprod:prod-data
```

Through its authenticated upload route, attempt canonical `bgm.ogg` and `bgm.m4a`; both must return `409 Conflict`. Confirm production R2 ETag/version for those keys did not change.

- [ ] **Step 7: Deploy production and run dry-run → execute → dry-run backfill gates**

Deploy backend only after pre-prod proof is green:

```bash
bun run deploy:api
```

Audit:

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a
```

Record total published, top-level OGG count, current M4A count, and missing count.

Execute with operator credentials:

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
BGM_WORKFLOW_NAME=dtx-api-bgm-m4a \
  bun run --filter=dtx-api backfill:bgm-m4a --execute
```

The script waits for and prints each terminal `ready`/`cached`/`superseded` outcome and exits nonzero on `errored`.

After successful execution, audit again:

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a
```

Release gate:

```text
missing bgm.m4a: 0
```

If any source errors, fix/re-upload that source and rerun the explicit tool before unblocking Virgo HPA-85.

- [ ] **Step 8: Confirm raw ZIP and GraphQL contracts against production**

For one BGM-bearing published simfile:

- GraphQL `files` includes exact `{id}/bgm.ogg` and `{id}/bgm.m4a`.
- Raw `/downloads/{id}` ZIP contains `bgm.ogg` but not redundant top-level `bgm.m4a`.
- If a published M4A-only row exists, its raw ZIP still contains M4A.

- [ ] **Step 9: Record implementation evidence and Linear unblock state**

Add to the implementation PR:

```text
Focused dtx-api tests: PASS
Full repo tests: PASS
Wrangler prod/pre-prod/pre-prod-prod-data dry runs: PASS
Container smoke/ffprobe: PASS
Pre-prod Workflow + AVAudioPlayer smoke: PASS
Production backfill audit: missing bgm.m4a = 0
```

Leave HPA-311 blocking HPA-85 until the production audit reaches zero. Then add the backend PR and zero-mismatch result to Linear so the separate Virgo implementation can proceed.

- [ ] **Step 10: Commit verification fixes only if files changed**

If Task 8 required HPA-311 fixes:

```bash
git add packages/dtx-api bun.lock
git commit -m "fix(api): close BGM generation verification gaps"
```

If Task 8 required no file changes, do not create an empty commit.

---

## Implementation PR Completion Checklist

- [ ] HPA-311 remains one implementation PR.
- [ ] `bgm.ogg` upload remains the source of truth and successful upload is not rolled back by generation failure.
- [ ] Reserved/generated key rules are enforced before R2 mutation.
- [ ] One-item `createBatch()` uses deterministic upload identity and retention.
- [ ] Workflow step results contain metadata only, not audio bytes.
- [ ] Invalid media is non-retryable; transient failures use the approved retry/timeout values.
- [ ] Source ETag/version is checked before transcode and again before canonical publish.
- [ ] Generated object metadata/cache policy match the spec exactly.
- [ ] Container has no R2 credentials, internet is disabled, output is streamed, and only one FFmpeg process runs at a time.
- [ ] `.m4a` catalog support preserves OGG-first generic discovery.
- [ ] Raw ZIP rule lives in `dtx-api` and generic `zipBuilder.ts` remains unchanged.
- [ ] `pre-prod-prod-data` cannot write canonical OGG/M4A keys.
- [ ] Backfill remains an explicit operator script with dry-run default, sequential terminal outcome reporting, and no permanent admin API.
- [ ] Production published-catalog mismatch count is zero before Virgo HPA-85 is unblocked.
- [ ] No Queue, D1 job state, generic media abstraction, client transcode, or backward-compatibility migration was added.

## Cloudflare References Used by the Plan

- Workflows Workers API / `createBatch()` and retention: <https://developers.cloudflare.com/workflows/build/workers-api/>
- Workflows retry and `NonRetryableError` rules: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
- Workflows REST instance creation (`params` is JSON-encoded): <https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/create/>
- Workflows REST instance status/output: <https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/get/>
- Containers configuration and `new_sqlite_classes`: <https://developers.cloudflare.com/workers/wrangler/configuration/#containers>
- Containers instance types: <https://developers.cloudflare.com/containers/platform-details/limits/>
- Wrangler named environments / non-inheritable bindings: <https://developers.cloudflare.com/workers/wrangler/environments/>
- Durable Object environment migrations: <https://developers.cloudflare.com/durable-objects/reference/environments/>
