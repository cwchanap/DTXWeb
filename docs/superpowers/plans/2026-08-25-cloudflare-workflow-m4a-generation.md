# Cloudflare Workflow-Backed M4A Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an Apple-playable AAC-LC `bgm.m4a` derivative for every canonical server BGM with an upload-triggered Cloudflare Workflow and one scale-to-zero FFmpeg Container, then prove and backfill the production catalog before Virgo HPA-85 cuts over.

**Architecture:** Keep the actual uploaded top-level `bgm.ogg` key as source-of-truth, matching its basename case-insensitively. The upload route captures R2 identity and schedules an idempotent Workflow; the Workflow streams source bytes through one internal Container, stages outside the simfile prefix, re-checks source identity, and publishes lower-case `{id}/bgm.m4a` only when current. `Simfile.files` is the publication seam; generic audio discovery remains incidental. Raw ZIP collection removes only redundant generated M4A.

**Tech Stack:** TypeScript, Bun 1.3.9, Vitest, Better Auth, Cloudflare Workers, Workflows, Containers, Durable Objects, R2, Wrangler 4.123+, Zod, FFmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md`

**Validated against:** `main@9ec68aac5db82e027432841938f92824e8687f80` after Better Auth/D1 PR #240.

## Global Constraints

- Deliver HPA-311 production code/tests/config/backfill in **one implementation PR**.
- Canonical source identity is top-level basename `bgm.ogg`, **case-insensitive**, while preserving the actual R2 source key.
- Generated destination is always lower-case `{simfileId}/bgm.m4a`.
- Reject direct top-level `bgm.m4a` uploads case-insensitively.
- Missing/false `BGM_M4A_GENERATION_ENABLED` means disabled; canonical source upload is rejected when disabled.
- Generation-only `Env` bindings are optional so unrelated test fixtures do not need fake Workflow/Container objects; explicitly enabled generation with a missing binding fails loudly.
- Trigger only canonical top-level BGM, never nested/sample OGG files.
- Profile is `aac-lc-192k-v1`: AAC-LC, 192 kbps, no video, preserve source sample rate/channels, `+faststart`.
- Stage at `_generated/bgm-m4a-v1/{simfileId}/{sha256(sourceEtag)[0..23]}.m4a`.
- Publish `audio/mp4` with `Cache-Control: public, max-age=300, must-revalidate` and source/profile custom metadata.
- Keep audio stream-only in Worker orchestration; no whole-audio `arrayBuffer()`/`bytes()`/`text()` calls.
- Use one-item `createBatch()` with deterministic upload identity; success retention `1 day`, error retention `7 days`.
- Retry transient transcode failures twice, 30-second exponential delay, 30-minute step timeout; invalid media is non-retryable.
- One `basic` Container, `max_instances: 1`, one-minute idle sleep, internet disabled, one FFmpeg process at a time.
- Preserve current Better Auth request/session behavior, Wrangler auth vars, package exports/scripts/dependencies, and `/api/auth/*` dispatch.
- Keep GraphQL schema/codegen unchanged; `Simfile.files` already exposes R2 keys.
- Keep `packages/common/src/lib/server/zipBuilder.ts` unchanged.
- `pre-prod-prod-data` cannot mutate canonical source/derivative keys.
- No Queue, R2 event notification, D1 job state, public job API, generic media framework, iOS package endpoint, client transcoder, or OGG decoder.
- Virgo HPA-85 remains a separate PR blocked on both production catalog gates.

---

## File Map

### Create

- `packages/dtx-api/src/services/bgmM4a.ts` — canonical identity, profile, keys, payload schema, deterministic IDs, public URL helper.
- `packages/dtx-api/src/services/bgmM4a.test.ts` — case/identity/schema/helper tests.
- `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.ts` — enabled/binding guard + one-item `createBatch()`.
- `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.test.ts` — trigger/idempotency/config tests.
- `packages/dtx-api/src/services/bgmM4aGeneration.ts` — inspect/transcode/publish/cleanup/error classification.
- `packages/dtx-api/src/services/bgmM4aGeneration.test.ts` — R2/Container stream and stale-source tests.
- `packages/dtx-api/src/workflows/generateBgmM4a.ts` — thin Workers-only Workflow wrapper.
- `packages/dtx-api/src/containers/bgmTranscoder.ts` — Cloudflare Container class.
- `packages/dtx-api/container/bgm-transcoder/Dockerfile`
- `packages/dtx-api/container/bgm-transcoder/server.ts`
- `packages/dtx-api/container/bgm-transcoder/smoke.sh`
- `packages/dtx-api/src/scripts/backfill-bgm-m4a.ts`
- `packages/dtx-api/src/scripts/backfill-bgm-m4a.test.ts`

### Modify

- `packages/dtx-api/src/env.ts`
- `packages/dtx-api/src/services/uploads.ts`
- `packages/dtx-api/src/services/uploads.test.ts`
- `packages/dtx-api/src/rest/upload.ts`
- `packages/dtx-api/src/rest/upload.test.ts`
- `packages/dtx-api/src/index.ts`
- `packages/dtx-api/src/index.test.ts`
- `packages/dtx-api/src/services/r2Enrichment.ts`
- `packages/dtx-api/src/services/r2Enrichment.test.ts`
- `packages/dtx-api/src/services/downloads.ts`
- `packages/dtx-api/src/services/downloads.test.ts` — **existing file; extend, never replace**.
- `packages/dtx-api/package.json`
- `packages/dtx-api/wrangler.jsonc`
- `bun.lock`

### Intentionally unchanged

- `packages/common/src/lib/server/zipBuilder.ts`
- GraphQL schema/generated clients
- D1 migrations/schema
- Better Auth application behavior

---

## Task 1: Lock canonical BGM identity and expose R2 upload identity

**Files:** create `bgmM4a.ts`, `bgmM4a.test.ts`; modify `env.ts`, `uploads.ts`, `uploads.test.ts`.

**Produces:** shared canonical helpers; `GenerateBgmM4aPayload`; `UploadedObject`; `UploadResult`; optional generation flag.

- [ ] **Step 1: Write RED canonical-identity tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  BGM_TRANSCODE_PROFILE,
  bgmDerivativeKey,
  bgmM4aPayloadSchema,
  bgmStagingKey,
  buildPublicR2Url,
  buildUploadWorkflowInstanceId,
  isCanonicalBgmDerivativeKey,
  isCanonicalBgmSourceKey
} from './bgmM4a';

describe('BGM identity', () => {
  it('matches top-level canonical names case-insensitively', () => {
    expect(isCanonicalBgmSourceKey('42/bgm.ogg', 42)).toBe(true);
    expect(isCanonicalBgmSourceKey('42/BGM.OGG', 42)).toBe(true);
    expect(isCanonicalBgmSourceKey('42/assets/bgm.ogg', 42)).toBe(false);
    expect(isCanonicalBgmSourceKey('42/song.ogg', 42)).toBe(false);
    expect(isCanonicalBgmDerivativeKey('42/BgM.M4A', 42)).toBe(true);
    expect(isCanonicalBgmDerivativeKey('42/assets/bgm.m4a', 42)).toBe(false);
  });

  it('validates the actual case-preserved source key', () => {
    expect(bgmM4aPayloadSchema.parse({
      simfileId: 42,
      sourceKey: '42/BGM.OGG',
      profile: BGM_TRANSCODE_PROFILE
    }).sourceKey).toBe('42/BGM.OGG');
  });

  it('always publishes lower-case derivative and stages by ETag', async () => {
    expect(bgmDerivativeKey(42)).toBe('42/bgm.m4a');
    expect(await bgmStagingKey(42, 'etag-1')).toMatch(
      /^_generated\/bgm-m4a-v1\/42\/[0-9a-f]{24}\.m4a$/
    );
  });

  it('builds encoded public URLs and deterministic upload IDs', async () => {
    expect(buildPublicR2Url('https://files.example/', '42/My Song.ogg')).toBe(
      'https://files.example/42/My%20Song.ogg'
    );
    expect(await buildUploadWorkflowInstanceId(42, 'same')).toBe(
      await buildUploadWorkflowInstanceId(42, 'same')
    );
  });
});
```

Run:

```bash
cd packages/dtx-api
bun test src/services/bgmM4a.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the shared contract**

```ts
import { z } from 'zod';

export const BGM_SOURCE_FILENAME = 'bgm.ogg';
export const BGM_DERIVATIVE_FILENAME = 'bgm.m4a';
export const BGM_TRANSCODE_PROFILE = 'aac-lc-192k-v1' as const;

const isCanonicalTopLevel = (key: string, simfileId: number, filename: string): boolean => {
  const prefix = `${simfileId}/`;
  if (!key.startsWith(prefix)) return false;
  const suffix = key.slice(prefix.length);
  return !suffix.includes('/') && suffix.toLowerCase() === filename;
};

export const isCanonicalBgmSourceKey = (key: string, id: number) =>
  isCanonicalTopLevel(key, id, BGM_SOURCE_FILENAME);
export const isCanonicalBgmDerivativeKey = (key: string, id: number) =>
  isCanonicalTopLevel(key, id, BGM_DERIVATIVE_FILENAME);
export const bgmDerivativeKey = (id: number) => `${id}/${BGM_DERIVATIVE_FILENAME}`;

const shortSha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
};

export const bgmStagingKey = async (id: number, etag: string) =>
  `_generated/bgm-m4a-v1/${id}/${await shortSha256(etag)}.m4a`;
export const buildUploadWorkflowInstanceId = async (id: number, etag: string) =>
  `bgm-m4a-v1-${id}-${await shortSha256(etag)}`;
export const buildBackfillWorkflowInstanceId = async (id: number, uploaded: string) =>
  `bgm-m4a-v1-backfill-${id}-${await shortSha256(`${BGM_TRANSCODE_PROFILE}:${uploaded}`)}`;
export const buildPublicR2Url = (base: string, key: string) =>
  `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;

export const bgmM4aPayloadSchema = z.object({
  simfileId: z.number().int().positive(),
  sourceKey: z.string().min(1),
  expectedSourceEtag: z.string().min(1).optional(),
  expectedSourceVersion: z.string().min(1).optional(),
  profile: z.literal(BGM_TRANSCODE_PROFILE)
}).superRefine((payload, ctx) => {
  if (!isCanonicalBgmSourceKey(payload.sourceKey, payload.simfileId)) {
    ctx.addIssue({ code: 'custom', message: 'sourceKey must be top-level bgm.ogg' });
  }
});

export type GenerateBgmM4aPayload = z.infer<typeof bgmM4aPayloadSchema>;
```

- [ ] **Step 3: Make only the generation flag optional in `Env`**

Add without changing Better Auth fields:

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
```

Do **not** edit unrelated `makeEnv()` fixtures just to add the flag. Missing means disabled.

- [ ] **Step 4: Write RED upload contract tests**

Extend current `uploads.test.ts` and its Better Auth-era `makeEnv()` as-is:

```ts
it('rejects generated derivative names case-insensitively', async () => {
  mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
  const result = await uploadSimfileFile(
    makeEnv({ BGM_M4A_GENERATION_ENABLED: 'true' }),
    { id: 'u1' }, '42', makeFile(10, 'BGM.M4A'), makeBucket()
  );
  expect(result.response.status).toBe(409);
});

it('rejects canonical source when generation is disabled', async () => {
  mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
  const result = await uploadSimfileFile(
    makeEnv(), { id: 'u1' }, '42', makeFile(10, 'BGM.OGG'), makeBucket()
  );
  expect(result.response.status).toBe(409);
});

it('returns R2 identity without changing the public JSON body', async () => {
  mockedGetOwner.mockResolvedValue({ user_id: 'u1', is_published: 0 });
  const bucket = { put: vi.fn(async () => ({
    key: '42/BGM.OGG', etag: 'etag-42', version: 'version-42', size: 2048
  })) } as unknown as R2Bucket;
  const result = await uploadSimfileFile(
    makeEnv({ BGM_M4A_GENERATION_ENABLED: 'true' }),
    { id: 'u1' }, '42', makeFile(2048, 'BGM.OGG'), bucket
  );
  expect(result.uploadedObject).toEqual({
    simfileId: 42,
    key: '42/BGM.OGG',
    etag: 'etag-42',
    version: 'version-42',
    size: 2048
  });
  expect(await result.response.json()).toMatchObject({ file: { key: '42/BGM.OGG' } });
});
```

Run and verify RED on the current bare `Response` API:

```bash
bun test src/services/bgmM4a.test.ts src/services/uploads.test.ts
```

- [ ] **Step 5: Refactor `uploadSimfileFile()` minimally**

Add:

```ts
export type UploadedObject = {
  simfileId: number;
  key: string;
  etag: string;
  version: string;
  size: number;
};
export type UploadResult = { response: Response; uploadedObject?: UploadedObject };
```

Build `key = `${simfileId}/${sanitized}``, then before `bucket.put`:

```ts
if (isCanonicalBgmDerivativeKey(key, simfileId)) {
  return { response: json(409, { error: 'bgm.m4a is generated by the server' }) };
}
if (isCanonicalBgmSourceKey(key, simfileId) && env.BGM_M4A_GENERATION_ENABLED !== 'true') {
  return { response: json(409, { error: 'BGM generation is disabled in this environment' }) };
}
```

Wrap every existing error response as `{ response }`. On success return the existing JSON response plus `uploadedObject` from the R2 `put()` result.

- [ ] **Step 6: Verify Task 1**

```bash
bun test src/services/bgmM4a.test.ts src/services/uploads.test.ts
bun run check
```

Expected: PASS.

Commit:

```bash
git add packages/dtx-api/src/env.ts packages/dtx-api/src/services/bgmM4a.ts \
  packages/dtx-api/src/services/bgmM4a.test.ts packages/dtx-api/src/services/uploads.ts \
  packages/dtx-api/src/services/uploads.test.ts
git commit -m "feat(api): lock BGM derivative upload contract"
```

---

## Task 2: Trigger one idempotent Workflow without regressing Better Auth

**Files:** create trigger service/tests; modify `env.ts`, `rest/upload.ts`, `rest/upload.test.ts`, `index.test.ts`.

**Produces:** optional Workflow binding and `triggerBgmM4aGeneration()`.

- [ ] **Step 1: Add optional Workflow binding and RED trigger tests**

```ts
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
```

Test:

```ts
it('starts canonical mixed-case source with actual key/identity', async () => {
  const createBatch = vi.fn(async () => [{ id: 'wf-1' }]);
  const env = {
    BGM_M4A_GENERATION_ENABLED: 'true',
    BGM_M4A_WORKFLOW: { createBatch }
  } as unknown as Env;
  expect(await triggerBgmM4aGeneration(env, {
    simfileId: 42, key: '42/BGM.OGG', etag: 'e1', version: 'v1', size: 10
  })).toBe('started');
  expect(createBatch.mock.calls[0][0][0]).toMatchObject({
    params: {
      simfileId: 42,
      sourceKey: '42/BGM.OGG',
      expectedSourceEtag: 'e1',
      expectedSourceVersion: 'v1',
      profile: 'aac-lc-192k-v1'
    },
    retention: { successRetention: '1 day', errorRetention: '7 days' }
  });
});

it('does not trigger nested OGG', async () => { /* pass 42/assets/bgm.ogg; expect not-bgm */ });
it('fails loudly when enabled but Workflow binding is missing', async () => {
  await expect(triggerBgmM4aGeneration(
    { BGM_M4A_GENERATION_ENABLED: 'true' } as Env,
    { simfileId: 42, key: '42/bgm.ogg', etag: 'e', version: 'v', size: 1 }
  )).rejects.toThrow('BGM_M4A_WORKFLOW');
});
```

Run:

```bash
bun test src/services/bgmM4aWorkflowTrigger.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 2: Implement trigger helper**

```ts
export const triggerBgmM4aGeneration = async (
  env: Env,
  uploaded: UploadedObject
): Promise<'disabled' | 'not-bgm' | 'started' | 'duplicate'> => {
  if (env.BGM_M4A_GENERATION_ENABLED !== 'true') return 'disabled';
  if (!isCanonicalBgmSourceKey(uploaded.key, uploaded.simfileId)) return 'not-bgm';
  if (!env.BGM_M4A_WORKFLOW) throw new Error('BGM_M4A_WORKFLOW binding missing');

  const id = await buildUploadWorkflowInstanceId(uploaded.simfileId, uploaded.etag);
  const created = await env.BGM_M4A_WORKFLOW.createBatch([{
    id,
    params: {
      simfileId: uploaded.simfileId,
      sourceKey: uploaded.key,
      expectedSourceEtag: uploaded.etag,
      expectedSourceVersion: uploaded.version,
      profile: BGM_TRANSCODE_PROFILE
    },
    retention: { successRetention: '1 day', errorRetention: '7 days' }
  }]);
  return created.length === 0 ? 'duplicate' : 'started';
};
```

- [ ] **Step 3: Update route tests around the current Better Auth fixture**

Keep all current `resolveAuthSession()` tests, including trusted cookie `Origin`, Bearer-without-Origin, and unsafe-cookie Origin rejection. Do not add `verifyToken`/Supabase mocks.

Change `uploadSimfileFile` mock to `UploadResult`, mock `triggerBgmM4aGeneration`, and add:

```ts
mockedUpload.mockResolvedValue({
  response: Response.json({ file: { key: '42/BGM.OGG' } }),
  uploadedObject: {
    simfileId: 42, key: '42/BGM.OGG', etag: 'e1', version: 'v1', size: 10
  }
});
await routeUpload(request, makeEnv(), ctx);
expect(mockedTrigger).toHaveBeenCalledWith(
  expect.anything(), expect.objectContaining({ key: '42/BGM.OGG', etag: 'e1' })
);
```

Also keep the existing cache-purge URL-encoding assertion, now driven by `uploadedObject.key` rather than response parsing.

- [ ] **Step 4: Update `routeUpload()` to consume structured metadata**

```ts
const { response, uploadedObject } = await uploadSimfileFile(
  env, auth.user, simFileId, file, env.DTXFILE_BUCKET
);

if (uploadedObject) {
  const fileUrl = buildPublicR2Url(env.PUBLIC_SIMFILE_BUCKET_URL, uploadedObject.key);
  ctx.waitUntil(purgeCacheForFile(env, fileUrl, workerLogger).catch(/* existing logging */));
  ctx.waitUntil(triggerBgmM4aGeneration(env, uploadedObject).catch((error: unknown) => {
    workerLogger.error('Failed to trigger BGM M4A generation', {
      simfileId: uploadedObject.simfileId,
      sourceKey: uploadedObject.key,
      error: String(error)
    });
    return 'not-bgm' as const;
  }));
}
return response;
```

No response-body cloning/parsing remains.

- [ ] **Step 5: Update `index.test.ts` upload mock**

Its current mock also returns a bare `Response`. Change only that mock to:

```ts
uploadSimfileFile: vi.fn(async () => ({
  response: Response.json({ ok: true }),
  uploadedObject: undefined
}))
```

Do not change Better Auth router tests.

- [ ] **Step 6: Run focused then full package gates**

```bash
bun test src/services/bgmM4aWorkflowTrigger.test.ts src/services/uploads.test.ts src/rest/upload.test.ts src/index.test.ts
bun run test
bun run check
```

Expected: all PASS. This full package run catches every caller/mock affected by the `UploadResult` return type.

Commit Task 2.

---

## Task 3: Add the scale-to-zero FFmpeg Container

**Files:** create Container class/Docker/server/smoke; modify `package.json`, `bun.lock`.

- [ ] **Step 1: Add only the Container dependency**

```bash
cd packages/dtx-api
bun add @cloudflare/containers
```

Preserve current Better Auth/Drizzle dependencies, scripts, and `./auth-migration` export.

- [ ] **Step 2: Add Container class**

```ts
import { Container } from '@cloudflare/containers';
export class BgmTranscoderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
}
```

- [ ] **Step 3: Add Docker image**

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

- [ ] **Step 4: Implement serialized Container HTTP service**

`POST /transcode/ogg-to-m4a` must:

1. reject other method/path with 404/405;
2. create a unique temp directory;
3. stream request body to `input.ogg` using Node stream `pipeline()`;
4. run the exact FFmpeg profile from the spec;
5. return 422 when FFmpeg/ffprobe says invalid/no AAC audio;
6. validate output with `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1` and require `aac`;
7. return the output as a streamed `Response` with `audio/mp4`;
8. clean the temp directory after the response stream closes/cancels;
9. serialize work through a promise tail so only one FFmpeg process runs at a time.

Do not load input/output files into JS buffers.

- [ ] **Step 5: Add deterministic local smoke**

`smoke.sh` builds the image, starts one container, creates a 1-second synthetic Vorbis OGG with the image's FFmpeg, POSTs it to port 8080, then runs host/container `ffprobe` against the returned M4A and requires `aac`. Use `trap` to stop/remove the test container and temp directory.

Add:

```json
"smoke:bgm-transcoder": "bash container/bgm-transcoder/smoke.sh"
```

- [ ] **Step 6: Verify Container boundary**

```bash
bun run smoke:bgm-transcoder
bun run check
```

Expected: smoke prints/validates `aac`; typecheck PASS.

Commit Task 3.

---

## Task 4: Implement source-safe stream-only generation operations

**Files:** create `bgmM4aGeneration.ts` + tests; modify `env.ts`.

**Produces:** inspect/transcode/publish/cleanup functions and Node-testable permanent-error classification.

- [ ] **Step 1: Add optional Container binding**

```ts
BGM_TRANSCODER?: DurableObjectNamespace;
```

Do not update unrelated `makeEnv()` fixtures.

- [ ] **Step 2: Write RED inspect tests**

Cover:

```text
actual source key 42/BGM.OGG is HEADed as-is
missing source -> superseded
expected ETag/version mismatch -> superseded
matching derivative metadata -> cached
stale derivative -> delete lower-case 42/bgm.m4a + purge, then generate
```

Source state type:

```ts
type BgmSourceState = { etag: string; version: string };
```

- [ ] **Step 3: Implement inspect**

Use `env.DTXFILE_BUCKET.head(payload.sourceKey)` and `bgmDerivativeKey(payload.simfileId)`. Never reconstruct a lower-case source key.

- [ ] **Step 4: Write RED stream/permanent-error tests**

```ts
it('passes R2 source as a stream and stages a stream without buffering', async () => {
  const sourceBody = new ReadableStream<Uint8Array>();
  const forbiddenArrayBuffer = vi.fn(async () => { throw new Error('must not buffer'); });
  // mock R2 get() object with body + forbiddenArrayBuffer
  // mock getContainer(...).fetch() to assert request.body is a ReadableStream
  // return Response with a ReadableStream body
  // assert bucket.put(stagingKey, expect.any(ReadableStream), ...)
  expect(forbiddenArrayBuffer).not.toHaveBeenCalled();
});

it('classifies invalid-media container response as permanent', async () => {
  // container returns 422; expect PermanentBgmTranscodeError
});

it('classifies only PermanentBgmTranscodeError as non-retryable', () => {
  expect(classifyBgmWorkflowError(new PermanentBgmTranscodeError('bad'))).toBe('non-retryable');
  expect(classifyBgmWorkflowError(new Error('r2'))).toBe('retryable');
});
```

- [ ] **Step 5: Implement stream-only transcode**

Key contract:

```ts
const source = await env.DTXFILE_BUCKET.get(payload.sourceKey);
if (!source?.body) return { status: 'superseded' } as const;
if (source.etag !== sourceState.etag || source.version !== sourceState.version) {
  return { status: 'superseded' } as const;
}
if (!env.BGM_TRANSCODER) throw new Error('BGM_TRANSCODER binding missing');

const container = getContainer(env.BGM_TRANSCODER, 'bgm-transcoder');
const response = await container.fetch(new Request(
  'http://bgm-transcoder/transcode/ogg-to-m4a',
  { method: 'POST', headers: { 'content-type': 'audio/ogg' }, body: source.body }
));
```

Cloudflare Workers accepts `ReadableStream` as `Request.body`; do not add `duplex: 'half'` unless the Workers compiler/runtime requires it. Do not fall back to `arrayBuffer()`.

- [ ] **Step 6: Write RED guarded-publish tests**

Cover source changed after staging -> delete staging/no canonical PUT, and success -> canonical PUT receives a stream with exact metadata:

```ts
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
```

- [ ] **Step 7: Implement guarded publish and cleanup**

Re-HEAD actual source key, compare ETag/version, stream staging GET body into lower-case derivative PUT, purge, cleanup staging. Cleanup catches/logs delete failures and never replaces the original error.

- [ ] **Step 8: Verify Task 4**

```bash
bun test src/services/bgmM4aGeneration.test.ts
bun run check
```

Expected: PASS.

Commit Task 4.

---

## Task 5: Wire the Workflow and Wrangler resources without breaking current runtime/config

**Files:** create Workflow wrapper; modify `index.ts`, `index.test.ts`, `wrangler.jsonc`, `package.json`.

- [ ] **Step 1: Add Wrangler resources for each environment**

Top-level production:

```jsonc
"workflows": [{
  "binding": "BGM_M4A_WORKFLOW",
  "name": "dtx-api-bgm-m4a",
  "class_name": "GenerateBgmM4aWorkflow"
}],
"containers": [{
  "class_name": "BgmTranscoderContainer",
  "image": "./container/bgm-transcoder/Dockerfile",
  "max_instances": 1,
  "instance_type": "basic"
}],
"durable_objects": {
  "bindings": [{ "name": "BGM_TRANSCODER", "class_name": "BgmTranscoderContainer" }]
},
"migrations": [{
  "tag": "v1-bgm-transcoder",
  "new_sqlite_classes": ["BgmTranscoderContainer"]
}]
```

Append `BGM_M4A_GENERATION_ENABLED` to current `vars`:

```text
prod true
pre-prod true
pre-prod-prod-data false
```

Repeat non-inheritable Workflow/Container/DO bindings under each named environment with distinct Workflow names. Preserve every Better Auth URL/cookie/Google/D1/R2/KV value already in `wrangler.jsonc`.

- [ ] **Step 2: Verify RED dry-run before exports exist**

```bash
bun run build
```

Expected: FAIL because referenced Worker classes are not yet exported.

- [ ] **Step 3: Add thin Workflow wrapper**

Use `WorkflowEntrypoint`, `WorkflowEvent`, `WorkflowStep`, and `NonRetryableError`. Flow:

```text
validate payload with Zod
step.do inspect
return cached/superseded immediately
step.do transcode with retries/timeout
  classify PermanentBgmTranscodeError -> throw NonRetryableError
step.do publish
on terminal failure, step.do deterministic staging cleanup when staging key exists
```

The only Workers-specific conversion is:

```ts
if (classifyBgmWorkflowError(error) === 'non-retryable') {
  throw new NonRetryableError(error instanceof Error ? error.message : String(error));
}
throw error;
```

Do not add `@cloudflare/vitest-plugin`.

- [ ] **Step 4: Export Worker classes and preserve Better Auth handler**

Add named exports only:

```ts
export { BgmTranscoderContainer } from './containers/bgmTranscoder';
export { GenerateBgmM4aWorkflow } from './workflows/generateBgmM4a';
```

Do not restructure current default `fetch`, `/api/auth/*`, GraphQL, or REST routing.

- [ ] **Step 5: Keep Node `index.test.ts` runnable**

Because `index.test.ts` imports the Worker entrypoint, hoist mocks for the Workers-only named-export modules before the import if Node cannot resolve their Cloudflare runtime imports:

```ts
vi.mock('./containers/bgmTranscoder', () => ({ BgmTranscoderContainer: class {} }));
vi.mock('./workflows/generateBgmM4a', () => ({ GenerateBgmM4aWorkflow: class {} }));
```

Keep the current Better Auth route tests unchanged.

- [ ] **Step 6: Append dry-run scripts to current package scripts**

```json
"build:preprod": "wrangler deploy --dry-run --env pre-prod --outdir=dist/pre-prod",
"build:preprod:prod-data": "wrangler deploy --dry-run --env pre-prod-prod-data --outdir=dist/pre-prod-prod-data",
"cf-typegen:preprod": "wrangler types --env pre-prod --env-interface CloudflareBindings",
"cf-typegen:preprod:prod-data": "wrangler types --env pre-prod-prod-data --env-interface CloudflareBindings"
```

Do not replace Better Auth schema/migration scripts or package exports.

- [ ] **Step 7: Run full runtime/package gates now, not in Task 8 only**

```bash
bun run test
bun run check
bun run build
bun run build:preprod
bun run build:preprod:prod-data
bun run cf-typegen >/dev/null
bun run cf-typegen:preprod >/dev/null
bun run cf-typegen:preprod:prod-data >/dev/null
```

Expected: PASS. Docker must be available for configured Container build resolution.

Commit Task 5.

---

## Task 6: Characterize M4A discovery and keep raw ZIPs lean

**Files:** modify existing `r2Enrichment.ts/test.ts`, `downloads.ts/downloads.test.ts`.

- [ ] **Step 1: Add generic discovery characterization**

Change only:

```ts
const audioExts = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'];
```

Add tests:

```text
M4A-only top-level audio can populate discoverCatalogFiles().downloadUrl
OGG remains ahead of M4A when both exist
```

Document in the test/implementation that this is **generic fallback discovery**, not the Virgo publication path. Virgo sees generated M4A through `Simfile.files`.

- [ ] **Step 2: Add RED BGM ZIP assertions to the existing `downloads.test.ts`**

Do not create/overwrite the file. Keep existing access-control/concurrency tests and current mocks.

Use `mockedListAll` + `mockedCreateZipSources` to assert the pre-filtered input:

```ts
it('omits canonical generated M4A when canonical OGG exists regardless of case', async () => {
  mockedListAll.mockResolvedValue([
    { key: '42/BGM.OGG', size: 100, uploaded: new Date() },
    { key: '42/bgm.m4a', size: 90, uploaded: new Date() },
    { key: '42/a.dtx', size: 10, uploaded: new Date() }
  ]);
  mockedCreateZipSources.mockReturnValue([]);

  await collectZipSources({} as R2Bucket, [42]);

  expect(mockedCreateZipSources).toHaveBeenCalledWith(
    [
      expect.objectContaining({ key: '42/BGM.OGG' }),
      expect.objectContaining({ key: '42/a.dtx' })
    ],
    '42/',
    'chart-42'
  );
});

it('retains M4A when canonical OGG is absent', async () => {
  mockedListAll.mockResolvedValue([
    { key: '42/bgm.m4a', size: 90, uploaded: new Date() },
    { key: '42/a.dtx', size: 10, uploaded: new Date() }
  ]);
  await collectZipSources({} as R2Bucket, [42]);
  expect(mockedCreateZipSources.mock.calls[0][0]).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: '42/bgm.m4a' })])
  );
});
```

- [ ] **Step 3: Implement DTX-specific pre-filter in `collectZipSources()`**

For each simfile's listed objects:

```ts
const hasCanonicalSource = objects.some((object) =>
  isCanonicalBgmSourceKey(object.key, id)
);
const zipObjects = hasCanonicalSource
  ? objects.filter((object) => !isCanonicalBgmDerivativeKey(object.key, id))
  : objects;
```

Pass `zipObjects` to existing `createZipSources()`. Do not touch `zipBuilder.ts`.

- [ ] **Step 4: Verify Task 6**

```bash
bun test src/services/r2Enrichment.test.ts src/services/downloads.test.ts \
  src/rest/downloadSimfile.test.ts src/rest/downloadBulk.test.ts
bun run check
```

Expected: PASS.

Commit Task 6.

---

## Task 7: Add a non-vacuous public-catalog audit and sequential backfill

**Files:** create script/tests; modify `package.json`.

**Produces:** dry-run audit/histogram, `--execute`, `--check`.

- [ ] **Step 1: Write RED selection and audit tests**

Define:

```ts
export type PublishedSimfile = {
  id: string;
  files: Array<{ key: string; uploaded: string }>;
};
```

Test rows including:

```text
42/BGM.OGG                 -> canonical source
43/bgm.ogg + 43/bgm.m4a    -> already ready
44/song.ogg                 -> top-level full-track but non-canonical
45/assets/bgm.ogg           -> nested sample/asset, not canonical/top-level full-track
```

Assertions:

```ts
expect(selectMissingM4a(rows).map((row) => row.id)).toEqual(['42']);
expect(audit.topLevelAudioFilenameHistogram).toMatchObject({
  'bgm.ogg': 2,
  'bgm.m4a': 1,
  'song.ogg': 1
});
expect(audit.topLevelAudioWithoutCanonicalBgmOgg).toBe(1);
expect(audit.missingM4aAmongCanonicalBgmOgg).toBe(1);
```

- [ ] **Step 2: Implement public GraphQL pagination**

Exact query:

```graphql
query PublishedSimfiles($page: Int!, $pageSize: Int!) {
  simfiles(scope: PUBLISHED, page: $page, pageSize: $pageSize) {
    count
    data {
      id
      files { key uploaded }
    }
  }
}
```

Use `pageSize = 100`, reject non-2xx or GraphQL `errors`, and never operate on a partial catalog. No auth header is required for `PUBLISHED` scope.

- [ ] **Step 3: Implement case-insensitive source/derivative selection preserving actual key**

`selectMissingM4a()` finds the actual source file with `isCanonicalBgmSourceKey(file.key, Number(row.id))`; it excludes rows with any case-insensitive canonical derivative. The Workflow payload uses the source file's exact stored key.

- [ ] **Step 4: Implement top-level audio histogram and non-vacuous counters**

Use lower-cased basenames and extensions:

```ts
const FULL_TRACK_EXTS = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'];
```

Exclude nested keys and `preview.mp3`. Print:

```text
published total: <n>
with top-level audio: <n>
with canonical bgm.ogg: <n>
with canonical bgm.m4a: <n>
top-level audio without canonical bgm.ogg: <n>
missing bgm.m4a among canonical bgm.ogg: <n>
filename histogram:
  bgm.ogg: <n>
  song.ogg: <n>
  ...
mode: dry-run|execute|check
```

The key release counters are row counts, not raw file counts.

- [ ] **Step 5: Write RED Workflow REST/poll tests**

`buildWorkflowCreateBody(row)` must use a deterministic backfill ID based on simfile ID + canonical source `uploaded` timestamp and send:

```ts
{
  simfileId: Number(row.id),
  sourceKey: actualSource.key,
  profile: BGM_TRANSCODE_PROFILE
}
```

No expected ETag/version for backfill; Workflow Step 1 captures current state.

Test terminal mapping:

```text
complete + output.ready       -> ready
complete + output.cached      -> cached
complete + output.superseded  -> superseded
errored/terminated            -> errored
```

- [ ] **Step 6: Implement sequential `--execute`**

POST instance to Cloudflare Workflows REST API, then poll that instance every five seconds until terminal before starting the next candidate. Print `<id>: <outcome>`. Exit nonzero immediately on `errored`.

Require operator env only in execute mode:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
BGM_WORKFLOW_NAME
```

`DTX_GRAPHQL_URL` is required in all modes.

- [ ] **Step 7: Implement `--check` release gate**

`--check` makes no Workflow mutations and exits nonzero unless both are zero:

```text
top-level audio without canonical bgm.ogg
missing bgm.m4a among canonical bgm.ogg
```

If any top-level audio exists but canonical BGM count is zero, the first condition necessarily fails. Songs with no top-level audio are not invented into the BGM contract.

- [ ] **Step 8: Append package script and verify**

```json
"backfill:bgm-m4a": "bun run src/scripts/backfill-bgm-m4a.ts"
```

Run:

```bash
bun test src/scripts/backfill-bgm-m4a.test.ts
DTX_GRAPHQL_URL=https://api.pre-prod.dtx.hapadona.com/graphql bun run backfill:bgm-m4a
bun run check
```

Expected: tests PASS; default script prints dry-run counts/histogram and creates no Workflow instance.

Commit Task 7.

---

## Task 8: Full verification, rollout, backfill, and Virgo gate

**Files:** production files only if verification finds an HPA-311 defect; PR/Linear metadata for evidence.

- [ ] **Step 1: Run complete local/package verification**

```bash
cd packages/dtx-api
bun run test
bun run check
bun run build
bun run build:preprod
bun run build:preprod:prod-data
bun run smoke:bgm-transcoder
cd ../..
bun run lint
bun run test
```

Expected: PASS. If root verification exposes a pre-existing unrelated failure, reproduce it on current `main` and record exact evidence; do not weaken HPA-311 tests.

- [ ] **Step 2: Verify forbidden architecture is absent**

```bash
git diff main...HEAD --name-only
git diff main...HEAD -- packages/common/src/lib/server/zipBuilder.ts
git diff main...HEAD -- packages/dtx-api/d1-migrations packages/dtx-api/dist/schema.graphql
```

Confirm no Queue/R2 event binding/public generation route/job-state table/GraphQL schema change and `zipBuilder.ts` unchanged.

- [ ] **Step 3: Deploy and smoke pre-prod**

```bash
bun run deploy:api:preprod
```

Upload a real canonical source using one current auth path:

- Better Auth cookie + `Origin` exactly equal to pre-prod `DTX_WEB_URL`; or
- opaque desktop Bearer session without `Origin`.

Use at least one mixed-case source filename (`BGM.OGG`) to prove canonical case handling. Verify upload returns before Workflow completion, Workflow reaches `ready`, lower-case `bgm.m4a` appears, metadata/cache policy match, identical re-upload is idempotent, and a deliberately changed source cannot publish an older staged result.

- [ ] **Step 4: Validate Apple media compatibility**

Download generated M4A:

```bash
afinfo /tmp/bgm.m4a
```

Require AAC in M4A/MP4. Initialize the same file with Virgo's existing `AVAudioPlayer(contentsOf:)` smoke path and require `prepareToPlay()` success. Play one representative chart and record synchronization result; do not invent a timing offset without measured evidence.

- [ ] **Step 5: Prove prod-data environment is non-mutating**

Build/deploy only as needed. Through authenticated `pre-prod-prod-data` upload, attempts to upload mixed-case canonical source (`BGM.OGG`) and derivative (`BGM.M4A`) must both return 409. Confirm production R2 identities did not change.

- [ ] **Step 6: Deploy production and run audit before backfill**

```bash
bun run deploy:api
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a
```

Record the complete filename histogram and counters. If `top-level audio without canonical bgm.ogg` is nonzero, stop the Virgo release gate and resolve those catalog/source names explicitly; do not call the M4A gate complete just because canonical-source count is zero.

- [ ] **Step 7: Execute sequential backfill**

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
BGM_WORKFLOW_NAME=dtx-api-bgm-m4a \
  bun run --filter=dtx-api backfill:bgm-m4a --execute
```

Require every candidate to reach `ready`, `cached`, or `superseded`; fix/re-upload any errored source before proceeding.

- [ ] **Step 8: Run the non-vacuous production gate**

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a --check
```

Release gate is exactly:

```text
top-level audio without canonical bgm.ogg: 0
missing bgm.m4a among canonical bgm.ogg: 0
```

- [ ] **Step 9: Verify production GraphQL and raw ZIP behavior**

For a BGM-bearing published simfile:

```text
Simfile.files includes actual canonical OGG key and lower-case bgm.m4a
raw /downloads/{id} ZIP includes OGG but omits redundant canonical M4A
```

If an M4A-only row exists, its raw ZIP still retains M4A.

- [ ] **Step 10: Record evidence and unblock Virgo only after both gates pass**

Update the implementation PR and HPA-311 with:

```text
dtx-api tests/typecheck: PASS
Wrangler prod/pre-prod/prod-data dry runs: PASS
Container smoke/ffprobe: PASS
Pre-prod Workflow + AVAudioPlayer smoke: PASS
Production non-canonical top-level-audio rows: 0
Production canonical BGM rows missing M4A: 0
```

Keep HPA-311 blocking HPA-85 until both production counters are zero.

---

## Completion Checklist

- [ ] Current Better Auth upload/session and Worker routing behavior remains covered.
- [ ] Generation-only Env fields do not force unrelated fixture churn.
- [ ] Canonical top-level BGM matching is case-insensitive everywhere.
- [ ] Actual source R2 key is preserved in payload/metadata.
- [ ] Generated destination is stable lower-case `bgm.m4a`.
- [ ] Upload trigger is idempotent and fail-loud when explicitly enabled but unbound.
- [ ] Worker orchestration is stream-only; no full audio buffers.
- [ ] Invalid media is non-retryable; transient errors use approved retry policy.
- [ ] Source identity is checked before transcode and before publish.
- [ ] Existing `downloads.test.ts` is extended, not replaced.
- [ ] Generic `.m4a` discovery is characterized but not described as publication.
- [ ] `Simfile.files` remains the Virgo publication seam.
- [ ] Raw ZIP omits only redundant canonical generated M4A.
- [ ] Backfill dry-run prints filename histogram and non-vacuous counters.
- [ ] Production has zero top-level full-track rows outside the canonical BGM contract.
- [ ] Production canonical BGM rows all have M4A.
- [ ] Virgo HPA-85 stays separate and blocked until both gates pass.
