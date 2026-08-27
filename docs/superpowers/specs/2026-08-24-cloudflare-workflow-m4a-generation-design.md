# Cloudflare Workflow-Backed M4A Generation Design

**Date:** 2026-08-24  
**Revalidated:** 2026-08-26 against `main@9ec68aac5db82e027432841938f92824e8687f80`  
**Status:** Approved  
**Repository:** `cwchanap/DTXWeb`  
**Tracking:** HPA-311  
**Blocks:** Virgo HPA-85

## Context

Virgo persists server BGM locally and plays it with `AVAudioPlayer`. The authored backing track is OGG Vorbis, which is not a safe native Apple playback format for that path.

DTXWeb already has the seams needed for a small server-side derivative pipeline:

- `packages/dtx-api/src/services/uploads.ts` streams uploads into R2;
- `packages/dtx-api/src/rest/upload.ts` owns authenticated upload orchestration and `waitUntil()` post-response work;
- `Simfile.files` exposes the R2 object list;
- `packages/dtx-api/src/services/r2Enrichment.ts` characterizes generic top-level audio;
- `packages/dtx-api/src/services/downloads.ts` owns DTX-specific ZIP source collection;
- `packages/common/src/lib/server/zipBuilder.ts` stays format-agnostic.

PR #240 moved API authentication to Better Auth + D1. HPA-311 preserves that current auth/runtime configuration.

## Goals

- Keep OGG as the authored/source-of-truth BGM.
- Generate one AAC-LC M4A derivative asynchronously after canonical BGM upload.
- Publish stable lower-case `{simfileId}/bgm.m4a` so `Simfile.files` advertises it without GraphQL changes.
- Make conversion durable, retryable, idempotent, and safe against concurrent source replacement.
- Backfill and audit the published catalog before Virgo HPA-85 cuts over.

## Non-goals

- Client-side transcoding or an OGG decoder.
- Codec negotiation or generic media-variant/job frameworks.
- Queue/R2 event notifications.
- D1/Durable Object job-state tables.
- A public job-status or iOS package endpoint.
- Conversion of previews, nested drum samples, or arbitrary OGG files.
- Better Auth or GraphQL redesign.

## Architecture

Use an **upload-triggered Cloudflare Workflow** and one scale-to-zero **Cloudflare Container** running FFmpeg.

```text
canonical top-level BGM upload
        |
        v
source stored in R2 under actual uploaded case
        |
        v
GenerateBgmM4aWorkflow
        |
        +--> capture source ETag/version
        +--> stream R2 source -> FFmpeg Container -> R2 staging
        +--> re-check source ETag/version
        |
        v
publish lower-case {id}/bgm.m4a
        |
        v
Simfile.files advertises derivative
        |
        v
Virgo downloads M4A
```

The Workflow owns durability/retries. The Container only performs stateless OGG-to-M4A conversion.

## Canonical identity

### Source

Canonical source identity is **top-level basename `bgm.ogg`, case-insensitive**.

Canonical for simfile 42:

```text
42/bgm.ogg
42/BGM.OGG
42/Bgm.Ogg
```

Not canonical:

```text
42/assets/bgm.ogg
42/song.ogg
42/audio/music.ogg
```

R2 keys are case-sensitive. The Workflow therefore receives and reuses the **actual uploaded key**; it never rewrites `42/BGM.OGG` into a nonexistent lower-case source path.

One helper owns this rule for upload guards, Workflow triggering/validation, source inspection, ZIP filtering, and backfill/audit selection.

### Derivative

Generated destination is always:

```text
{id}/bgm.m4a
```

Direct user uploads whose top-level basename equals `bgm.m4a` case-insensitively are rejected with `409 Conflict` so no competing case variants can exist.

### Staging

```text
_generated/bgm-m4a-v1/{simfileId}/{sha256(sourceEtag)[0..23]}.m4a
```

Staging stays outside `{simfileId}/` so incomplete media never appears in `Simfile.files` or normal ZIP discovery.

## Upload contract

Extend `uploadSimfileFile()` without changing its public JSON response:

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

Before R2 mutation:

1. reject case-insensitive canonical derivative uploads;
2. reject canonical source uploads when generation is not enabled;
3. leave every other upload unchanged.

`routeUpload()` keeps current Better Auth `resolveAuthSession()` behavior. After a successful upload it schedules cache purge and, for canonical source only, Workflow creation with `ctx.waitUntil()`.

Generation failure never rolls back the source upload.

## Generation-only environment bindings

Keep generation fields optional in the hand-written `Env` type to avoid rewriting unrelated test fixtures:

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
BGM_TRANSCODER?: DurableObjectNamespace;
```

Semantics:

- missing/non-`true` flag = disabled;
- enabled + missing Workflow binding = fail loudly/log trigger error;
- Workflow reaching transcode + missing Container binding = fail loudly;
- deployed prod/pre-prod always bind both resources explicitly.

## Workflow identity and payload

Upload instance ID:

```text
bgm-m4a-v1-{simfileId}-{sha256(sourceEtag)[0..23]}
```

Use one-item `createBatch()` because it is idempotent for retained duplicate IDs.

Retention:

```ts
{
  successRetention: '1 day',
  errorRetention: '7 days'
}
```

Payload:

```ts
type GenerateBgmM4aPayload = {
  simfileId: number;
  sourceKey: string; // actual case-preserved canonical key
  expectedSourceEtag?: string;
  expectedSourceVersion?: string;
  profile: 'aac-lc-192k-v1';
};
```

Zod validates canonical source identity at runtime. Upload triggers supply expected ETag/version. Backfill omits them so Workflow Step 1 captures current source state.

## Workflow steps

### Step 1 — inspect

- HEAD actual `sourceKey`.
- Missing or expected identity mismatch -> `superseded`.
- Capture only ETag/version.
- HEAD lower-case destination.
- Matching source ETag/profile metadata -> `cached`.
- Otherwise delete stale destination and best-effort purge before conversion.

### Step 2 — transcode

- GET actual source key.
- Recheck ETag/version.
- Stream source body directly into the Container request.
- Stream Container response directly into deterministic staging R2.
- Return metadata only, never audio bytes.

Retry contract:

```ts
{
  retries: {
    limit: 2,
    delay: '30 seconds',
    backoff: 'exponential'
  },
  timeout: '30 minutes'
}
```

Invalid/no-audio/FFmpeg decode errors are non-retryable. Container startup, R2, and 5xx failures remain retryable.

### Step 3 — publish

- HEAD actual source key again.
- ETag/version mismatch -> delete staging and `superseded`.
- Otherwise stream staging into lower-case `{id}/bgm.m4a`.
- Best-effort purge destination.
- Delete staging and return `ready`.

Terminal failures perform best-effort staging cleanup without replacing the original error.

## Published derivative metadata

```text
Content-Type:  audio/mp4
Cache-Control: public, max-age=300, must-revalidate
```

Custom metadata:

```text
source-key:         <actual source key>
source-etag:        <captured ETag>
source-version:     <captured version>
transcode-profile:  aac-lc-192k-v1
```

## Streaming invariant

Worker orchestration is stream-only:

```text
R2 ReadableStream
  -> Container request
  -> Container response ReadableStream
  -> staging R2 put
  -> staging ReadableStream
  -> canonical R2 put
```

No whole-audio `arrayBuffer()`, `bytes()`, `text()`, or equivalent buffering is allowed.

Cloudflare Workers accepts `ReadableStream` request bodies directly. Do not add Node-specific `duplex: 'half'` unless the actual Workers compiler/runtime requires it; never solve such a failure by buffering the 50 MiB source.

## FFmpeg Container

```ts
export class BgmTranscoderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
}
```

Initial resource contract:

```text
instance_type: basic
max_instances: 1
```

Current Cloudflare sizing for `basic` is 1/4 vCPU, 1 GiB memory, and 4 GB disk. This leaves ample temporary-disk headroom for the existing 50 MiB upload limit. Pre-prod smoke remains the sizing proof; increase only the instance type if real conversion evidence requires it.

The Container serializes requests internally so only one FFmpeg process runs at a time and receives no R2 credentials.

HTTP contract:

```http
POST /transcode/ogg-to-m4a
Content-Type: audio/ogg

<streamed OGG>
```

Success is `200 audio/mp4` with a streamed M4A body. Invalid media is `422`; transient/internal failures are 5xx.

Encoding:

```text
AAC-LC
192 kbps
MPEG-4/M4A
no video
preserve sample rate/channels
+faststart
```

The service verifies one AAC stream with `ffprobe` before returning success and cleans unique temp files when response streaming completes/cancels.

## Wrangler and Better Auth integration

HPA-311 appends Workflow/Container/Durable Object bindings and generation vars to the current `wrangler.jsonc`. It preserves Better Auth URLs/cookies/Google config, D1/R2/KV bindings, package auth scripts/exports, `/api/auth/*`, and the default fetch handler.

Bindings are non-inheritable, so production, `pre-prod`, and `pre-prod-prod-data` declare resources explicitly.

```text
prod:               generation=true
pre-prod:           generation=true
pre-prod-prod-data: generation=false
```

The existing Worker compatibility date `2025-01-01` already satisfies the current Workflows requirement of `2024-10-22` or later. Do not bundle an unrelated compatibility-date bump into HPA-311.

## Publication and generic discovery

**Virgo publication path is `Simfile.files`.** No GraphQL schema/codegen change is needed.

Separately, generic `r2Enrichment.ts` audio precedence becomes:

```ts
['.ogg', '.m4a', '.mp3', '.wav', '.flac']
```

This only characterizes generic full-track fallback behavior; it is not how Virgo discovers the generated derivative.

## Raw ZIP behavior

Inside `collectZipSources()` before `createZipSources()`:

```text
canonical OGG + canonical M4A -> omit M4A
M4A without canonical OGG    -> keep M4A
```

Matching is case-insensitive using the shared helper. Existing `downloads.test.ts` is extended; `zipBuilder.ts` is unchanged.

## Catalog audit and backfill

Use one explicit operator script:

```text
packages/dtx-api/src/scripts/backfill-bgm-m4a.ts
```

It pages public `simfiles(scope: PUBLISHED)` and reads `id` plus `files { key uploaded }`.

For each row it:

- finds actual canonical source key case-insensitively;
- detects canonical derivative case-insensitively;
- backfills only source-present/derivative-absent rows;
- sends actual source key to the Workflow;
- starts/polls instances sequentially when `--execute` is supplied.

Default mode is dry-run.

The audit also prints a lower-cased histogram of every top-level non-preview audio filename using current full-track extensions (`ogg`, `m4a`, `mp3`, `wav`, `flac`) plus these counters:

```text
published total
with top-level audio
with canonical bgm.ogg
with canonical bgm.m4a
top-level audio without canonical bgm.ogg
missing bgm.m4a among canonical bgm.ogg
```

## Virgo HPA-85 release gate

Production must satisfy **both**:

```text
top-level audio without canonical bgm.ogg: 0
missing bgm.m4a among canonical bgm.ogg: 0
```

This prevents historical names such as `song.ogg` or `music.ogg` from producing a vacuous zero-missing result. The audit measures the contract; it does not silently rename files.

## Testing and rollout

Use existing Node Vitest for pure/service behavior. Keep the Workers-only Workflow wrapper out of Node imports; test permanent/retryable classification in a pure helper and verify the wrapper/config with Wrangler dry-run builds.

Required coverage includes:

- case-insensitive canonical source/derivative matching;
- upload guards and structured R2 identity;
- current Better Auth cookie/Bearer upload behavior;
- idempotent trigger and missing-binding errors;
- source `cached`/`superseded` behavior;
- stream-only R2 -> Container -> R2 operations;
- output metadata/cache policy;
- generic `.m4a` characterization;
- existing ZIP tests plus redundant-M4A filtering;
- backfill selection, histogram, non-vacuous counters, REST polling.

Run full `dtx-api` tests/typecheck after Task 2 and Workflow wiring, not only at final rollout.

Deployment order:

1. implement HPA-311 in one PR;
2. deploy/smoke pre-prod;
3. validate generated media with `afinfo` + Virgo `AVAudioPlayer` path;
4. prove `pre-prod-prod-data` cannot mutate canonical BGM;
5. deploy production;
6. run dry-run audit and resolve non-canonical top-level audio explicitly;
7. execute sequential backfill;
8. rerun non-vacuous audit gate;
9. only then unblock Virgo HPA-85.

## Acceptance criteria

- [ ] Canonical source is top-level `bgm.ogg` case-insensitively and actual R2 key is preserved.
- [ ] Direct canonical derivative uploads are rejected case-insensitively.
- [ ] Generation-disabled environments cannot replace canonical source.
- [ ] Upload starts one idempotent Workflow without waiting for conversion.
- [ ] Enabled but missing bindings fail loudly.
- [ ] Workflow produces valid AAC-LC lower-case `{id}/bgm.m4a`.
- [ ] Source replacement during conversion cannot publish stale output.
- [ ] Worker orchestration never buffers full audio.
- [ ] `Simfile.files` exposes generated M4A without schema/codegen changes.
- [ ] Existing ZIP behavior/tests remain intact except redundant derivative filtering.
- [ ] Better Auth and current Wrangler/package runtime state are preserved.
- [ ] Production histogram/audit is non-vacuous.
- [ ] `top-level audio without canonical bgm.ogg = 0`.
- [ ] `missing bgm.m4a among canonical bgm.ogg = 0`.
- [ ] Generated media plays through `AVAudioPlayer` with acceptable rhythm synchronization.

## KISS guardrails

- One logical source contract.
- One generated derivative.
- One Workflow + one small Container.
- One deterministic staging convention.
- No job DB, Queue, public generation API, client fallback, or media framework.
- One DTXWeb implementation PR; Virgo remains separate.

## Platform references

- Cloudflare Workflows: <https://developers.cloudflare.com/workflows/>
- Workflow Workers API / `createBatch()`: <https://developers.cloudflare.com/workflows/build/workers-api/>
- Workflow rules/retries: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
- Cloudflare Containers: <https://developers.cloudflare.com/containers/>
- Containers Wrangler configuration: <https://developers.cloudflare.com/workers/wrangler/configuration/#containers>
- Containers instance types: <https://developers.cloudflare.com/containers/platform-details/limits/#instance-types>
- Workers Request: <https://developers.cloudflare.com/workers/runtime-apis/request/>
- Workers Streams: <https://developers.cloudflare.com/workers/runtime-apis/streams/>
- R2 Workers API: <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
