# Cloudflare Workflow-Backed M4A Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an Apple-playable AAC-LC `bgm.m4a` derivative for every canonical server BGM with an upload-triggered Cloudflare Workflow and one scale-to-zero FFmpeg Container, then prove and backfill the production catalog before Virgo HPA-85 cuts over.

**Architecture:** Keep the actual uploaded top-level `bgm.ogg` key as source-of-truth, matching its basename case-insensitively. The upload route captures R2 identity and schedules an idempotent Workflow; the Workflow streams source bytes through one internal Container, stages outside the simfile prefix, re-checks source identity, and publishes lower-case `{id}/bgm.m4a` only when current. `Simfile.files` is the publication seam; generic audio discovery remains incidental. Raw ZIP collection removes only redundant generated M4A.

**Tech Stack:** TypeScript, Bun 1.3.9, Vitest, Better Auth, Cloudflare Workers, Workflows, Containers, Durable Objects, R2, Wrangler 4.123+, Zod, FFmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md`

**Validated against:** `main@9ec68aac5db82e027432841938f92824e8687f80` after Better Auth/D1 PR #240 and Cloudflare platform docs current through 2026-08-26.

## Global Constraints

- One HPA-311 implementation PR.
- Canonical source is top-level basename `bgm.ogg`, case-insensitive; preserve the actual R2 source key.
- Generated destination is always lower-case `{simfileId}/bgm.m4a`.
- Reject direct top-level `bgm.m4a` uploads case-insensitively.
- Missing/false `BGM_M4A_GENERATION_ENABLED` means disabled; canonical source upload is rejected when disabled.
- Generation-only `Env` bindings are optional so unrelated test fixtures do not need fake Workflow/Container objects; explicitly enabled generation with a missing binding fails loudly.
- Trigger only canonical top-level BGM, never nested/sample OGG files.
- Profile `aac-lc-192k-v1`: AAC-LC, 192 kbps, no video, preserve sample rate/channels, `+faststart`.
- Stage at `_generated/bgm-m4a-v1/{simfileId}/{sha256(sourceEtag)[0..23]}.m4a`.
- Publish `audio/mp4` with `public, max-age=300, must-revalidate` plus source/profile metadata.
- Worker orchestration is stream-only; no whole-audio buffering.
- One-item `createBatch()`, deterministic upload identity, success retention `1 day`, error retention `7 days`.
- Retry transient transcode failures twice with 30-second exponential delay and 30-minute timeout; invalid media is non-retryable.
- One `basic` Container (1/4 vCPU, 1 GiB memory, 4 GB disk), `max_instances: 1`, one-minute idle sleep, internet disabled, one FFmpeg process at a time.
- Preserve current Better Auth behavior/config/package scripts and `/api/auth/*` routing.
- Keep GraphQL schema/codegen and `packages/common/src/lib/server/zipBuilder.ts` unchanged.
- Keep current Worker compatibility date; `2025-01-01` already satisfies Workflows' `2024-10-22` minimum.
- `pre-prod-prod-data` cannot mutate canonical source/derivative keys.
- No Queue, R2 event notification, D1 job state, public job API, generic media framework, iOS package endpoint, client transcoder, or OGG decoder.
- Virgo HPA-85 remains separate and blocked on both production catalog gates.

---

## File Map

### Create

- `packages/dtx-api/src/services/bgmM4a.ts`
- `packages/dtx-api/src/services/bgmM4a.test.ts`
- `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.ts`
- `packages/dtx-api/src/services/bgmM4aWorkflowTrigger.test.ts`
- `packages/dtx-api/src/services/bgmM4aGeneration.ts`
- `packages/dtx-api/src/services/bgmM4aGeneration.test.ts`
- `packages/dtx-api/src/workflows/generateBgmM4a.ts`
- `packages/dtx-api/src/containers/bgmTranscoder.ts`
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
- `packages/dtx-api/src/services/downloads.test.ts` — existing file; extend it.
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

**Produces:** canonical key helpers, profile/schema/ID helpers, `UploadedObject`, `UploadResult`, optional generation flag.

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
    const parsed = bgmM4aPayloadSchema.parse({
      simfileId: 42,
      sourceKey: '42/BGM.OGG',
      profile: BGM_TRANSCODE_PROFILE
    });
    expect(parsed.sourceKey).toBe('42/BGM.OGG');
  });

  it('publishes lower-case derivative and stages by ETag', async () => {
    expect(bgmDerivativeKey(42)).toBe('42/bgm.m4a');
    expect(await bgmStagingKey(42, 'etag-1')).toMatch(
      /^_generated\/bgm-m4a-v1\/42\/[0-9a-f]{24}\.m4a$/
    );
  });

  it('builds encoded URLs and deterministic upload IDs', async () => {
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

Expected: FAIL because `bgmM4a.ts` does not exist.

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

- [ ] **Step 3: Add optional generation flag without rewriting unrelated fixtures**

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
```

- [ ] **Step 4: Write RED upload contract tests**

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

Run:

```bash
bun test src/services/bgmM4a.test.ts src/services/uploads.test.ts
```

Expected: helper tests PASS, upload tests FAIL because the service still returns `Response` and has no guards.

- [ ] **Step 5: Refactor upload result and guards**

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

Before `bucket.put`:

```ts
if (isCanonicalBgmDerivativeKey(key, simfileId)) {
  return { response: json(409, { error: 'bgm.m4a is generated by the server' }) };
}
if (isCanonicalBgmSourceKey(key, simfileId) && env.BGM_M4A_GENERATION_ENABLED !== 'true') {
  return { response: json(409, { error: 'BGM generation is disabled in this environment' }) };
}
```

Wrap existing error responses as `{ response }`. On successful R2 PUT return the unchanged JSON response plus `uploadedObject` from the R2 result.

- [ ] **Step 6: Verify and commit Task 1**

```bash
bun test src/services/bgmM4a.test.ts src/services/uploads.test.ts
bun run check
git add src/env.ts src/services/bgmM4a.ts src/services/bgmM4a.test.ts \
  src/services/uploads.ts src/services/uploads.test.ts
git commit -m "feat(api): lock BGM derivative upload contract"
```

Expected: tests/typecheck PASS.

---

## Task 2: Trigger one idempotent Workflow without regressing Better Auth

**Files:** create trigger service/tests; modify `env.ts`, `rest/upload.ts`, `rest/upload.test.ts`, `index.test.ts`.

- [ ] **Step 1: Add optional Workflow binding and RED trigger tests**

```ts
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
```

```ts
it('starts canonical mixed-case source with actual key/identity', async () => {
  const createBatch = vi.fn(async () => [{ id: 'wf-1' }]);
  const env = {
    BGM_M4A_GENERATION_ENABLED: 'true',
    BGM_M4A_WORKFLOW: { createBatch }
  } as unknown as Env;
  const outcome = await triggerBgmM4aGeneration(env, {
    simfileId: 42, key: '42/BGM.OGG', etag: 'e1', version: 'v1', size: 10
  });
  expect(outcome).toBe('started');
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

it('does not trigger nested OGG', async () => {
  const createBatch = vi.fn();
  const env = {
    BGM_M4A_GENERATION_ENABLED: 'true',
    BGM_M4A_WORKFLOW: { createBatch }
  } as unknown as Env;
  const outcome = await triggerBgmM4aGeneration(env, {
    simfileId: 42, key: '42/assets/bgm.ogg', etag: 'e', version: 'v', size: 1
  });
  expect(outcome).toBe('not-bgm');
  expect(createBatch).not.toHaveBeenCalled();
});

it('fails loudly when enabled but Workflow binding is missing', async () => {
  await expect(triggerBgmM4aGeneration(
    { BGM_M4A_GENERATION_ENABLED: 'true' } as Env,
    { simfileId: 42, key: '42/bgm.ogg', etag: 'e', version: 'v', size: 1 }
  )).rejects.toThrow('BGM_M4A_WORKFLOW');
});
```

Run `bun test src/services/bgmM4aWorkflowTrigger.test.ts`; expected RED because the service does not exist.

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

- [ ] **Step 3: Update current Better Auth upload-route tests**

Keep the existing `resolveAuthSession()` mock, `validAuthSession()` helper, trusted cookie+Origin test, Bearer-without-Origin test, and unsafe-cookie Origin rejection tests.

Change only the upload mock/result shape and add trigger assertions:

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

Keep cache-purge URL encoding, now driven by `uploadedObject.key`.

- [ ] **Step 4: Consume structured upload metadata in `routeUpload()`**

```ts
const { response, uploadedObject } = await uploadSimfileFile(
  env, auth.user, simFileId, file, env.DTXFILE_BUCKET
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

- [ ] **Step 5: Update `index.test.ts` mock to the new return type**

```ts
uploadSimfileFile: vi.fn(async () => ({
  response: Response.json({ ok: true }),
  uploadedObject: undefined
}))
```

Do not change Better Auth router assertions.

- [ ] **Step 6: Run focused + full package gates and commit**

```bash
bun test src/services/bgmM4aWorkflowTrigger.test.ts src/services/uploads.test.ts \
  src/rest/upload.test.ts src/index.test.ts
bun run test
bun run check
git add src/env.ts src/services/bgmM4aWorkflowTrigger.ts \
  src/services/bgmM4aWorkflowTrigger.test.ts src/rest/upload.ts src/rest/upload.test.ts \
  src/index.test.ts
git commit -m "feat(api): trigger BGM conversion workflow"
```

Expected: all `dtx-api` tests and typecheck PASS.

---

## Task 3: Add the scale-to-zero FFmpeg Container

**Files:** create Container class/Docker/server/smoke; modify `package.json`, `bun.lock`.

- [ ] **Step 1: Add dependency without replacing current package state**

```bash
cd packages/dtx-api
bun add @cloudflare/containers
```

Preserve Better Auth/Drizzle dependencies, auth scripts, and `./auth-migration` export.

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

- [ ] **Step 4: Implement serialized streaming HTTP service**

Create `container/bgm-transcoder/server.ts` with these concrete helpers:

```ts
import { createReadStream, createWriteStream } from 'node:fs';
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
  ffmpegTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
};

const run = (command: string, args: string[]) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
```

For the handler:

```ts
if (request.method !== 'POST' || new URL(request.url).pathname !== '/transcode/ogg-to-m4a') {
  return new Response('Not Found', { status: 404 });
}
if (!request.body) return new Response('Missing OGG body', { status: 422 });

return runSerialized(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dtx-bgm-'));
  const input = join(directory, 'input.ogg');
  const output = join(directory, 'output.m4a');
  try {
    await pipeline(Readable.fromWeb(request.body as never), createWriteStream(input));
    const ffmpeg = await run('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error',
      '-i', input, '-map', '0:a:0', '-vn',
      '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k',
      '-movflags', '+faststart', output
    ]);
    if (ffmpeg.code !== 0) {
      await rm(directory, { recursive: true, force: true });
      return new Response('Invalid OGG media', { status: 422 });
    }

    const probe = await run('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', output
    ]);
    if (probe.code !== 0 || probe.stdout.trim() !== 'aac') {
      await rm(directory, { recursive: true, force: true });
      return new Response('No AAC audio stream', { status: 422 });
    }

    const nodeStream = createReadStream(output);
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    nodeStream.once('close', () => void rm(directory, { recursive: true, force: true }));
    return new Response(body, { headers: { 'content-type': 'audio/mp4' } });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    console.error(error);
    return new Response('Transcode failed', { status: 500 });
  }
});
```

When implementing, also attach cleanup to response-stream cancellation so a client disconnect does not leave the temp directory behind; keep that cancellation wrapper local to this file rather than adding a generic stream abstraction.

- [ ] **Step 5: Add deterministic Docker smoke**

`container/bgm-transcoder/smoke.sh` must:

```bash
#!/usr/bin/env bash
set -euo pipefail

image='dtx-bgm-transcoder-smoke'
name="dtx-bgm-transcoder-smoke-$$"
tmp="$(mktemp -d)"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT

docker build -t "$image" -f container/bgm-transcoder/Dockerfile container/bgm-transcoder
docker run -d --name "$name" -p 18080:8080 "$image" >/dev/null
docker exec "$name" ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:duration=1' -c:a libvorbis /tmp/input.ogg
docker cp "$name:/tmp/input.ogg" "$tmp/input.ogg"
curl --fail --silent --show-error --data-binary @"$tmp/input.ogg" \
  -H 'content-type: audio/ogg' http://127.0.0.1:18080/transcode/ogg-to-m4a \
  -o "$tmp/output.m4a"
docker cp "$tmp/output.m4a" "$name:/tmp/output.m4a"
test "$(docker exec "$name" ffprobe -v error -select_streams a:0 \
  -show_entries stream=codec_name -of default=nw=1:nk=1 /tmp/output.m4a | tr -d '\r')" = 'aac'
```

Add package script:

```json
"smoke:bgm-transcoder": "bash container/bgm-transcoder/smoke.sh"
```

- [ ] **Step 6: Verify and commit Task 3**

```bash
bun run smoke:bgm-transcoder
bun run check
git add package.json ../../bun.lock src/containers/bgmTranscoder.ts container/bgm-transcoder
git commit -m "feat(api): add BGM transcoder container"
```

Expected: smoke validates AAC; typecheck PASS.

---

## Task 4: Implement source-safe stream-only generation operations

**Files:** create `bgmM4aGeneration.ts` + tests; modify `env.ts`.

- [ ] **Step 1: Add optional Container binding**

```ts
BGM_TRANSCODER?: DurableObjectNamespace;
```

- [ ] **Step 2: Write RED inspect tests**

Add tests that assert the actual key `42/BGM.OGG` is HEADed unchanged; missing/expected-identity mismatch returns `superseded`; matching derivative metadata returns `cached`; stale lower-case derivative is deleted/purged before returning `generate`.

- [ ] **Step 3: Implement inspect using actual source key**

```ts
export type BgmSourceState = { etag: string; version: string };

const source = await env.DTXFILE_BUCKET.head(payload.sourceKey);
if (!source) return { status: 'superseded' } as const;
if (payload.expectedSourceEtag && source.etag !== payload.expectedSourceEtag) {
  return { status: 'superseded' } as const;
}
if (payload.expectedSourceVersion && source.version !== payload.expectedSourceVersion) {
  return { status: 'superseded' } as const;
}
```

Inspect destination with `bgmDerivativeKey(payload.simfileId)`; compare custom metadata source ETag/profile for cache hit.

- [ ] **Step 4: Write RED stream/error tests**

```ts
it('streams source to Container and Container output to staging', async () => {
  const sourceBody = new ReadableStream<Uint8Array>();
  const forbiddenArrayBuffer = vi.fn(async () => { throw new Error('must not buffer'); });
  mockedBucket.get.mockResolvedValue({
    etag: 'e1', version: 'v1', body: sourceBody, arrayBuffer: forbiddenArrayBuffer
  });
  mockedContainer.fetch.mockImplementation(async (request: Request) => {
    expect(request.body).toBeInstanceOf(ReadableStream);
    return new Response(new ReadableStream<Uint8Array>());
  });

  await transcodeBgmToStaging(env, payload, { etag: 'e1', version: 'v1' });

  expect(forbiddenArrayBuffer).not.toHaveBeenCalled();
  expect(mockedBucket.put).toHaveBeenCalledWith(
    expect.stringMatching(/^_generated\/bgm-m4a-v1\/42\//),
    expect.any(ReadableStream),
    expect.anything()
  );
});

it('classifies permanent media failures', () => {
  expect(classifyBgmWorkflowError(new PermanentBgmTranscodeError('bad media')))
    .toBe('non-retryable');
  expect(classifyBgmWorkflowError(new Error('R2 failed'))).toBe('retryable');
});
```

Also test Container HTTP 422 throws `PermanentBgmTranscodeError`.

- [ ] **Step 5: Implement stream-only transcode**

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
if (response.status === 422) throw new PermanentBgmTranscodeError('Invalid BGM media');
if (!response.ok || !response.body) throw new Error(`BGM transcode failed: ${response.status}`);
await env.DTXFILE_BUCKET.put(stagingKey, response.body, {
  httpMetadata: { contentType: 'audio/mp4' }
});
```

Do not add `duplex: 'half'` unless the actual Workers compiler/runtime requires it; current Cloudflare Workers accepts `ReadableStream` request bodies. Never replace streaming with `arrayBuffer()`.

- [ ] **Step 6: Write RED guarded-publish tests**

Assert source change after staging deletes staging and performs no canonical PUT. Success must PUT a `ReadableStream` with:

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

- [ ] **Step 7: Implement guarded publish/cleanup, verify, commit**

Re-HEAD actual source key, compare ETag/version, GET staging, stream to lower-case derivative, purge, clean staging. Cleanup catches/logs delete failure without replacing the primary error.

```bash
bun test src/services/bgmM4aGeneration.test.ts
bun run check
git add src/env.ts src/services/bgmM4aGeneration.ts src/services/bgmM4aGeneration.test.ts
git commit -m "feat(api): implement source-safe BGM generation"
```

Expected: PASS.

---

## Task 5: Wire Workflow and Wrangler resources without breaking Better Auth

**Files:** create Workflow wrapper; modify `index.ts`, `index.test.ts`, `wrangler.jsonc`, `package.json`.

- [ ] **Step 1: Add explicit resources to all environments**

Production resource shape:

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

Repeat non-inheritable bindings for `pre-prod` and `pre-prod-prod-data` with distinct Workflow names. Append `BGM_M4A_GENERATION_ENABLED` to current vars: prod/pre-prod `true`, prod-data `false`. Preserve every existing Better Auth URL/cookie/Google/D1/R2/KV value. Keep compatibility date unchanged; the current date already satisfies Workflows' minimum.

- [ ] **Step 2: Run RED production dry-run**

```bash
bun run build
```

Expected: FAIL because Wrangler references classes not yet exported.

- [ ] **Step 3: Implement thin Workers-only Workflow wrapper**

Use Zod validation in one `step.do`, inspect in one step, transcode with exact retry/timeout config, publish in one step, and deterministic cleanup on terminal failure. Convert only classified permanent errors:

```ts
if (classifyBgmWorkflowError(error) === 'non-retryable') {
  throw new NonRetryableError(error instanceof Error ? error.message : String(error));
}
throw error;
```

Do not add `@cloudflare/vitest-plugin`.

- [ ] **Step 4: Export classes without restructuring `index.ts`**

```ts
export { BgmTranscoderContainer } from './containers/bgmTranscoder';
export { GenerateBgmM4aWorkflow } from './workflows/generateBgmM4a';
```

Preserve current default fetch handler and `/api/auth/*` dispatch.

- [ ] **Step 5: Keep Node `index.test.ts` runnable**

If Workers-only imports are not resolvable under Node Vitest, hoist these mocks before importing `./index`:

```ts
vi.mock('./containers/bgmTranscoder', () => ({ BgmTranscoderContainer: class {} }));
vi.mock('./workflows/generateBgmM4a', () => ({ GenerateBgmM4aWorkflow: class {} }));
```

Keep existing Better Auth router tests unchanged.

- [ ] **Step 6: Append environment dry-run/typegen scripts**

```json
"build:preprod": "wrangler deploy --dry-run --env pre-prod --outdir=dist/pre-prod",
"build:preprod:prod-data": "wrangler deploy --dry-run --env pre-prod-prod-data --outdir=dist/pre-prod-prod-data",
"cf-typegen:preprod": "wrangler types --env pre-prod --env-interface CloudflareBindings",
"cf-typegen:preprod:prod-data": "wrangler types --env pre-prod-prod-data --env-interface CloudflareBindings"
```

Preserve current auth scripts/exports/dependencies.

- [ ] **Step 7: Run full package/runtime gates and commit**

```bash
bun run test
bun run check
bun run build
bun run build:preprod
bun run build:preprod:prod-data
bun run cf-typegen >/dev/null
bun run cf-typegen:preprod >/dev/null
bun run cf-typegen:preprod:prod-data >/dev/null
git add src/workflows/generateBgmM4a.ts src/index.ts src/index.test.ts wrangler.jsonc package.json
git commit -m "feat(api): deploy BGM generation workflow"
```

Expected: all `dtx-api` tests/checks and all three Wrangler dry-runs/typegens PASS.

---

## Task 6: Characterize M4A discovery and keep raw ZIPs lean

**Files:** modify existing `r2Enrichment.ts/test.ts`, `downloads.ts/downloads.test.ts`.

- [ ] **Step 1: Characterize generic M4A fallback**

```ts
const audioExts = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'];
```

Add tests proving M4A-only top-level audio can populate `discoverCatalogFiles().downloadUrl` and OGG remains ahead of M4A. State in test names/comments that this is generic fallback discovery; Virgo publication is `Simfile.files`.

- [ ] **Step 2: Add RED ZIP assertions to the existing test file**

```ts
it('omits canonical generated M4A when canonical OGG exists regardless of case', async () => {
  mockedListAll.mockResolvedValue([
    { key: '42/BGM.OGG', size: 100, uploaded: new Date() },
    { key: '42/bgm.m4a', size: 90, uploaded: new Date() },
    { key: '42/a.dtx', size: 10, uploaded: new Date() }
  ]);
  mockedCreateZipSources.mockReturnValue([]);

  await collectZipSources({} as R2Bucket, [42]);

  expect(mockedCreateZipSources.mock.calls[0][0]).toEqual([
    expect.objectContaining({ key: '42/BGM.OGG' }),
    expect.objectContaining({ key: '42/a.dtx' })
  ]);
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

Keep all existing access/concurrency tests and mocks.

- [ ] **Step 3: Filter before existing `createZipSources()`**

```ts
const hasCanonicalSource = objects.some((object) =>
  isCanonicalBgmSourceKey(object.key, id)
);
const zipObjects = hasCanonicalSource
  ? objects.filter((object) => !isCanonicalBgmDerivativeKey(object.key, id))
  : objects;
```

Pass `zipObjects` to `createZipSources()`. Do not touch `zipBuilder.ts`.

- [ ] **Step 4: Verify and commit Task 6**

```bash
bun test src/services/r2Enrichment.test.ts src/services/downloads.test.ts \
  src/rest/downloadSimfile.test.ts src/rest/downloadBulk.test.ts
bun run check
git add src/services/r2Enrichment.ts src/services/r2Enrichment.test.ts \
  src/services/downloads.ts src/services/downloads.test.ts
git commit -m "feat(api): expose M4A without duplicating raw ZIP audio"
```

Expected: PASS.

---

## Task 7: Add non-vacuous catalog audit and sequential backfill

**Files:** create `backfill-bgm-m4a.ts/test.ts`; modify `package.json`.

- [ ] **Step 1: Write RED selection/audit tests**

```ts
const rows: PublishedSimfile[] = [
  { id: '42', files: [{ key: '42/BGM.OGG', uploaded: '2026-08-01T00:00:00Z' }] },
  { id: '43', files: [
    { key: '43/bgm.ogg', uploaded: '2026-08-01T00:00:00Z' },
    { key: '43/bgm.m4a', uploaded: '2026-08-01T00:01:00Z' }
  ] },
  { id: '44', files: [{ key: '44/song.ogg', uploaded: '2026-08-01T00:00:00Z' }] },
  { id: '45', files: [{ key: '45/assets/bgm.ogg', uploaded: '2026-08-01T00:00:00Z' }] }
];

expect(selectMissingM4a(rows).map((row) => row.id)).toEqual(['42']);
const audit = auditPublishedCatalog(rows);
expect(audit.topLevelAudioFilenameHistogram).toMatchObject({
  'bgm.ogg': 2,
  'bgm.m4a': 1,
  'song.ogg': 1
});
expect(audit.topLevelAudioWithoutCanonicalBgmOgg).toBe(1);
expect(audit.missingM4aAmongCanonicalBgmOgg).toBe(1);
```

- [ ] **Step 2: Implement complete public GraphQL pagination**

```graphql
query PublishedSimfiles($page: Int!, $pageSize: Int!) {
  simfiles(scope: PUBLISHED, page: $page, pageSize: $pageSize) {
    count
    data { id files { key uploaded } }
  }
}
```

Use page size 100; reject non-2xx/GraphQL errors; never operate on a partial catalog. No auth is required for `PUBLISHED`.

- [ ] **Step 3: Preserve actual source key in backfill selection**

Use `isCanonicalBgmSourceKey(file.key, Number(row.id))` to find the source and the derivative helper to detect any case variant. Backfill only source-present/derivative-absent rows. The Workflow payload uses the exact stored source key.

- [ ] **Step 4: Implement histogram and counters**

Top-level non-preview full-track extensions:

```ts
const FULL_TRACK_EXTS = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'];
```

Print:

```text
published total
audio-bearing published rows
with canonical bgm.ogg
with canonical bgm.m4a
top-level audio without canonical bgm.ogg
missing bgm.m4a among canonical bgm.ogg
lower-cased top-level audio filename histogram
mode: dry-run|execute|check
```

Counters are per simfile row; histogram is per file.

- [ ] **Step 5: Write/implement deterministic REST creation and polling**

Build backfill instance ID from simfile ID + canonical source `uploaded` timestamp. Params:

```ts
{
  simfileId: Number(row.id),
  sourceKey: actualSource.key,
  profile: BGM_TRANSCODE_PROFILE
}
```

POST to Cloudflare Workflows REST, then poll every five seconds until `complete`, `errored`, or `terminated`. Map complete output status to `ready`, `cached`, or `superseded`; errors/termination map to `errored`. Execute sequentially and exit nonzero on first `errored`.

- [ ] **Step 6: Implement dry-run and `--check` modes**

Default dry-run prints audit/histogram and makes no Workflow mutation. `--check` also makes no mutation and exits nonzero unless:

```text
top-level audio without canonical bgm.ogg = 0
missing bgm.m4a among canonical bgm.ogg = 0
```

If the catalog contains top-level audio but zero canonical BGM sources, the first condition fails rather than reporting vacuous readiness.

- [ ] **Step 7: Verify and commit Task 7**

Add:

```json
"backfill:bgm-m4a": "bun run src/scripts/backfill-bgm-m4a.ts"
```

Run:

```bash
bun test src/scripts/backfill-bgm-m4a.test.ts
DTX_GRAPHQL_URL=https://api.pre-prod.dtx.hapadona.com/graphql bun run backfill:bgm-m4a
bun run check
git add src/scripts/backfill-bgm-m4a.ts src/scripts/backfill-bgm-m4a.test.ts package.json
git commit -m "feat(api): add BGM M4A backfill tool"
```

Expected: tests PASS; default command prints dry-run audit and creates no Workflow instance.

---

## Task 8: Full verification, rollout, backfill, and Virgo gate

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

Expected: PASS. If root verification shows an unrelated baseline failure, reproduce it on current `main` and record the exact command/failure without weakening HPA-311 tests.

- [ ] **Step 2: Verify forbidden architecture is absent**

```bash
git diff main...HEAD --name-only
git diff main...HEAD -- packages/common/src/lib/server/zipBuilder.ts
git diff main...HEAD -- packages/dtx-api/d1-migrations packages/dtx-api/dist/schema.graphql
```

Require no Queue/R2 event binding/public generation route/job-state table/GraphQL schema change and no `zipBuilder.ts` change.

- [ ] **Step 3: Deploy/smoke pre-prod**

```bash
bun run deploy:api:preprod
```

Use either Better Auth cookie + exact trusted `Origin`, or current opaque desktop Bearer auth. Upload at least one `BGM.OGG`. Verify upload returns before Workflow completion; Workflow reaches `ready`; lower-case M4A appears with exact metadata/cache policy; identical re-upload is idempotent; replacing source during conversion cannot publish older staging.

- [ ] **Step 4: Validate Apple media compatibility**

```bash
afinfo /tmp/bgm.m4a
```

Require AAC in M4A/MP4. Exercise Virgo's existing `AVAudioPlayer(contentsOf:)` smoke path and require `prepareToPlay()` success. Play one representative chart and record synchronization; do not add timing offset without measurement.

- [ ] **Step 5: Prove prod-data environment cannot mutate canonical BGM**

Through authenticated `pre-prod-prod-data`, mixed-case `BGM.OGG` and `BGM.M4A` uploads both return 409. Confirm production R2 identity unchanged.

- [ ] **Step 6: Deploy production and inspect the pre-backfill audit**

```bash
bun run deploy:api
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a
```

Record histogram/counters. If `top-level audio without canonical bgm.ogg` is nonzero, stop the Virgo gate and resolve those source names explicitly; do not waive the contract.

- [ ] **Step 7: Execute sequential backfill**

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
BGM_WORKFLOW_NAME=dtx-api-bgm-m4a \
  bun run --filter=dtx-api backfill:bgm-m4a --execute
```

Require every candidate to reach `ready`, `cached`, or `superseded`; fix/re-upload an errored source before proceeding.

- [ ] **Step 8: Run the non-vacuous production gate**

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a --check
```

Release gate:

```text
top-level audio without canonical bgm.ogg: 0
missing bgm.m4a among canonical bgm.ogg: 0
```

- [ ] **Step 9: Verify GraphQL/raw ZIP**

For one BGM-bearing published simfile, `Simfile.files` includes actual canonical OGG key + lower-case `bgm.m4a`; raw `/downloads/{id}` contains OGG but not redundant M4A. If an M4A-only row exists, raw ZIP retains it.

- [ ] **Step 10: Record evidence and unblock Virgo only when both gates pass**

Record:

```text
dtx-api tests/typecheck: PASS
Wrangler prod/pre-prod/prod-data dry runs: PASS
Container smoke/ffprobe: PASS
Pre-prod Workflow + AVAudioPlayer smoke: PASS
Production non-canonical top-level-audio rows: 0
Production canonical BGM rows missing M4A: 0
```

Keep HPA-311 blocking HPA-85 until both production counters are zero. If Task 8 found an HPA-311 defect, commit only that fix in the same implementation PR; otherwise do not create an empty verification commit.

---

## Completion Checklist

- [ ] Better Auth upload/session and Worker routing remain covered.
- [ ] Generation-only `Env` fields avoid unrelated fixture churn.
- [ ] Canonical BGM matching is case-insensitive everywhere; actual source key is preserved.
- [ ] Destination is stable lower-case `bgm.m4a`.
- [ ] Trigger is idempotent and fail-loud when enabled but unbound.
- [ ] Worker orchestration is stream-only.
- [ ] Invalid media is non-retryable; transient errors use approved retry policy.
- [ ] Source identity is checked before transcode and before publish.
- [ ] Existing `downloads.test.ts` is extended, not replaced.
- [ ] Generic `.m4a` discovery is characterized but not described as publication.
- [ ] `Simfile.files` remains the Virgo publication seam.
- [ ] Raw ZIP omits only redundant canonical generated M4A.
- [ ] Backfill prints filename histogram + non-vacuous counters.
- [ ] Production has zero top-level full-track rows outside canonical BGM naming.
- [ ] Production canonical BGM rows all have M4A.
- [ ] Virgo HPA-85 stays blocked until both gates pass.
