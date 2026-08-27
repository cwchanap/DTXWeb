# Cloudflare Workflow-Backed M4A Generation Design

**Date:** 2026-08-24  
**Revalidated:** 2026-08-26 against `main@9ec68aac5db82e027432841938f92824e8687f80`  
**Status:** Approved  
**Repository:** `cwchanap/DTXWeb`  
**Tracking:** HPA-311  
**Blocks:** Virgo HPA-85

## Context

Virgo's HPA-85 plan deliberately standardizes server BGM on one fixed `bgm.m4a` filename and keeps playback on the existing `AVAudioPlayer` path. DTXWeb therefore needs to publish one Apple-playable derivative per server song without adding client-side codec negotiation.

The authored backing track cannot be identified safely by renaming historical R2 objects to `bgm.ogg`. DTX files reference audio by filename through `#WAVxx`, and channel `01` is the BGM lane. Renaming `song.ogg` or `music.ogg` without rewriting the chart would break existing web/desktop playback.

DTXWeb already has a better source heuristic in `packages/dtx-api/src/services/r2Enrichment.ts`: generic full-track discovery prefers top-level audio over nested sample chips, then applies a stable extension priority. HPA-311 reuses that selection rule instead of inventing a filename migration.

Existing seams remain small:

- `packages/dtx-api/src/services/uploads.ts` streams uploads into R2;
- `packages/dtx-api/src/rest/upload.ts` owns authenticated upload orchestration and `waitUntil()` post-response work;
- `Simfile.files` exposes R2 objects to Virgo;
- `packages/dtx-api/src/services/r2Enrichment.ts` already distinguishes top-level full-track audio from nested samples;
- `packages/dtx-api/src/services/downloads.ts` owns DTX-specific ZIP source collection;
- `packages/common/src/lib/server/zipBuilder.ts` stays format-agnostic.

PR #240 moved API authentication to Better Auth + D1. HPA-311 preserves that current auth/runtime configuration.

## Goals

- Preserve historical backing-track filenames and chart references.
- Reuse one shared top-level full-track selector as the authored BGM source contract.
- Generate stable lower-case `{simfileId}/bgm.m4a` for Virgo regardless of the authored source filename/codec.
- Make conversion durable, retryable, idempotent, stream-only, and safe against source replacement.
- Keep ordinary local development and web E2E Docker-free.
- Reconcile the published catalog through the same public GraphQL surface Virgo uses before HPA-85 cuts over.

## Non-goals

- Renaming authored backing-track objects.
- Rewriting `.dtx` files to point at new filenames.
- Client codec negotiation or fallback.
- Client-side transcoding or an OGG decoder.
- A generic media-variant/job framework.
- Queue/R2 event notifications.
- D1/Durable Object job-state tables.
- A public generation/status endpoint.
- Better Auth or GraphQL redesign.
- Making `pre-prod-prod-data` generally read-only; it already points at writable production data and that broader policy is outside HPA-311.

## Architecture

Use an **upload-triggered Cloudflare Workflow** and one scale-to-zero **Cloudflare Container** running FFmpeg.

```text
authored top-level full-track upload
        |
        v
source stored at its original R2 key
        |
        v
resolve current top-level full-track source
        |
        v
GenerateBgmM4aWorkflow
        |
        +--> Step 1: inspect source + derivative metadata
        |
        +--> Step 2: stream source -> FFmpeg Container
                       -> re-check source
                       -> atomic R2 PUT {id}/bgm.m4a
        |
        v
Simfile.files advertises bgm.m4a
        |
        v
Virgo downloads one fixed M4A filename
```

The Workflow owns durability/retries. The Container only performs stateless audio-to-M4A conversion.

There is **no staging object**. A failed/retried transcode simply retranscodes. At current hobby-project volume this is cheaper than a second R2 round-trip, staging-key scheme, cleanup path, and orphan policy.

## Shared R2 file helpers

Avoid a third copy of the repository's "case-insensitive named top-level object" logic. Extract the reusable R2-file rules currently embedded in `r2Enrichment.ts` into a small dtx-api helper, for example `src/lib/r2Files.ts`:

- `r2FileName(key)`;
- `isTopLevelR2Key(key, prefix)`;
- `isTopLevelNamedR2Key(key, prefix, filename)` (case-insensitive filename);
- `toPublicR2Url(base, key)`;
- `selectTopLevelFullTrackObject(objects, prefix, options)`.

`r2Enrichment.ts` reuses these helpers for canonical `preview.mp3`, `set.def`, public URLs, and top-level full-track ranking instead of retaining separate copies.

### Full-track source selection

Supported top-level audio extensions are:

```text
.ogg
.m4a
.mp3
.wav
.flac
```

The selector:

1. excludes `preview.mp3`;
2. excludes nested objects;
3. excludes the generated canonical derivative `{id}/bgm.m4a` from authored-source candidates;
4. applies the existing extension priority and deterministic key ordering.

If no authored top-level full-track candidate exists, HPA-311 has no source to convert.

If a row contains only canonical `{id}/bgm.m4a`, it is already ready for Virgo and needs no source Workflow.

The derivative remains fixed even when the selected source is already Apple-playable. This is intentional: Virgo HPA-85 remains M4A-only instead of gaining MP3/WAV/M4A source selection/fallback logic.

## Published derivative

Generated destination is always exactly:

```text
{id}/bgm.m4a
```

Direct user uploads whose top-level basename equals `bgm.m4a` case-insensitively are rejected with `409 Conflict`. The generator owns that key.

HTTP metadata:

```text
Content-Type:  audio/mp4
Cache-Control: public, max-age=300, must-revalidate
```

Custom metadata:

```text
source-key:         <actual authored source key>
source-etag:        <captured ETag>
source-version:     <captured version>
source-uploaded:    <captured ISO timestamp>
transcode-profile:  aac-lc-192k-v1
```

The derivative path is mutable. Cache purge remains best effort; the five-minute TTL bounds stale CDN playback if purge fails.

## Upload contract

Extend `uploadSimfileFile()` without changing the public HTTP JSON body:

```ts
export type UploadedObject = {
  simfileId: number;
  key: string;
  etag: string;
  version: string;
  uploaded: string;
  size: number;
};

export type UploadResult = {
  response: Response;
  uploadedObject?: UploadedObject;
};
```

Before R2 mutation, reject only the reserved top-level `bgm.m4a` key case-insensitively.

Do **not** reject authored source uploads when generation is disabled. File-by-file chart uploads must not become half-written merely because derivative generation is unavailable in that environment.

After a successful upload, `routeUpload()` keeps current Better Auth behavior and schedules:

1. the existing public-R2 cache purge;
2. BGM source resolution / Workflow triggering.

The trigger path first performs a cheap top-level-audio candidate check. For a candidate upload it lists that simfile prefix, resolves the current selected authored source through the shared helper, and starts a Workflow only when the just-uploaded object is the selected source.

Generation failure never rolls back the authored upload.

## Generation flag and environments

Generation-only fields stay optional in the hand-written `Env` type so unrelated Node test fixtures do not need fake platform objects:

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
BGM_TRANSCODER?: DurableObjectNamespace;
```

Semantics:

- missing/non-`true` flag = generation disabled and uploads remain allowed;
- enabled + missing Workflow binding = fail loudly/log post-response trigger error;
- Workflow reaching transcode + missing Container binding = fail loudly;
- production/pre-prod bind resources explicitly and enable generation;
- `pre-prod-prod-data` sets generation false.

`pre-prod-prod-data` is **not** described as read-only. HPA-311 only guarantees it will not start M4A generation automatically. The production reconciliation step detects missing/older derivatives after any source changes.

## One Workflow instance identity

Upload and backfill use the same deterministic ID based on the R2 object's upload timestamp:

```text
bgm-m4a-v1-{simfileId}-{sourceUploadedEpochMillis}
```

R2 exposes `uploaded` both from `put()` and object listing, so both callers know the same value. The ID is synchronous, human-readable, and within Workflows' custom-ID constraints.

Use one-item `createBatch()` because retained duplicate IDs are skipped rather than failing. This prevents an operator backfill from starting a second Workflow for a source whose upload-triggered instance is already running.

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
  sourceKey: string;
  sourceUploaded: string;
  expectedSourceEtag?: string;
  expectedSourceVersion?: string;
  profile: 'aac-lc-192k-v1';
};
```

Upload triggers include expected ETag/version. Backfill omits them and lets Step 1 capture current R2 identity.

## Workflow: two steps

### Step 1 — inspect

- HEAD `sourceKey`.
- Missing source -> `superseded`.
- Expected ETag/version mismatch -> `superseded`.
- Capture `{ etag, version, uploaded }` as small metadata.
- HEAD lower-case `{id}/bgm.m4a`.
- Destination metadata matching source ETag + profile -> `cached`.
- Otherwise delete the stale derivative and best-effort purge it before conversion so Virgo cannot fetch audio for an older source.

### Step 2 — transcode and publish

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

Inside the step:

1. GET the actual authored source and require its ETag/version still match Step 1.
2. Stream its body directly into the Container.
3. The Container finishes FFmpeg + `ffprobe` before returning the response stream.
4. HEAD the authored source again **after conversion and before the canonical PUT**.
5. If identity changed, cancel the response stream and return `superseded`.
6. Otherwise stream the Container response directly into lower-case `{id}/bgm.m4a` with the metadata contract above.
7. Best-effort purge the public derivative URL and return `ready`.

Invalid/no-audio/FFmpeg decode errors are non-retryable. Container startup, R2, and 5xx failures remain retryable.

A step retry retranscodes. That is an intentional KISS tradeoff at this volume.

### Why no staging object

Staging did not close the source race: both designs still have a source check followed by a durable destination write. Removing staging deletes an extra PUT + GET + DELETE, SHA/key derivation, terminal cleanup, and orphan-object concern.

R2 single-object `put()` commits the new object only after the write succeeds and is strongly consistent. A failed streamed PUT does not expose a completed new derivative; stale derivatives are already removed in Step 1.

## Streaming invariant

Worker orchestration is stream-only:

```text
R2 source ReadableStream
  -> Container request
  -> Container response ReadableStream
  -> canonical R2 put()
```

No whole-audio `arrayBuffer()`, `bytes()`, `text()`, or equivalent buffering is allowed.

Cloudflare Workers accepts `ReadableStream` request bodies directly. Do not add Node-specific `duplex: 'half'` unless the actual Workers compiler/runtime requires it; never solve such a failure by buffering the source.

## FFmpeg Container

```ts
export class BgmTranscoderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
}
```

Initial sizing:

```text
instance_type: basic
max_instances: 1
```

Current `basic` resources are 1/4 vCPU, 1 GiB memory, and 4 GB disk. Pre-prod smoke is the sizing proof.

HTTP contract becomes source-format agnostic:

```http
POST /transcode/to-m4a
Content-Type: application/octet-stream

<streamed source audio>
```

The Container writes the stream to a unique temp input, lets FFmpeg probe the input format, emits AAC-LC M4A, verifies one AAC stream with `ffprobe`, then streams the result. Invalid media returns 422; transient/internal failures return 5xx. Requests are serialized so only one FFmpeg process runs at a time. The Container receives no R2 credentials.

Encoding profile:

```text
AAC-LC
192 kbps
MPEG-4/M4A
no video
preserve source sample rate/channels
+faststart
```

## Docker-free local development

Declaring a Container makes ordinary `wrangler dev` require a Docker-compatible daemon by default. HPA-311 must not impose that on routine app development or Web E2E.

Add top-level Wrangler local development configuration:

```jsonc
"dev": {
  "enable_containers": false
}
```

This setting is inherited by local named-environment development.

Also override `BGM_M4A_GENERATION_ENABLED=false` in local API dev commands and the Playwright API web-server command so local code never attempts to use a disabled Container.

Docker is required only for:

- the explicit Container smoke script;
- Wrangler deploy/build operations that build the Container image;
- developers intentionally opting into Container-local development.

Task 5 verifies the existing Web E2E API startup still works with Containers disabled.

## Wrangler and Better Auth integration

HPA-311 appends Workflow/Container/Durable Object resources to current production/pre-prod configuration and preserves Better Auth URLs/cookies/Google config, D1/R2/KV bindings, package auth scripts/exports, `/api/auth/*`, and the default fetch handler.

Keep the existing Worker compatibility date `2025-01-01`; it already satisfies the current Workflows minimum.

Generation flags:

```text
prod:               true
pre-prod:           true
pre-prod-prod-data: false
local dev/E2E:      false
```

No HPA-311 claim is made that `pre-prod-prod-data` cannot mutate production content generally.

## Publication and raw ZIP behavior

**Virgo publication path is `Simfile.files`.** No GraphQL schema/codegen change is needed.

The shared full-track selector is also reused by `r2Enrichment.ts`; adding `.m4a` to its supported extension list is therefore no longer an orphan characterization change—it supports historical authored M4A names while excluding the generated canonical derivative from authored-source selection.

Raw ZIP filtering uses source identity rather than a hard-coded OGG name:

```text
selected authored source + canonical bgm.m4a -> omit generated bgm.m4a
canonical bgm.m4a with no authored source     -> keep bgm.m4a
```

`packages/common/src/lib/server/zipBuilder.ts` remains unchanged.

## Catalog audit and backfill

Use one explicit operator script:

```text
packages/dtx-api/src/scripts/backfill-bgm-m4a.ts
```

It pages **public GraphQL** `simfiles(scope: PUBLISHED)` because the release gate should measure the same catalog surface Virgo consumes rather than an internal D1/R2-only view.

For each row it uses the same shared top-level full-track selector and reads `files { key uploaded }`.

Default dry-run prints:

```text
published total: <n>
audio-bearing rows: <n>
selected authored sources: <n>
canonical bgm.m4a rows: <n>
selected sources missing/older bgm.m4a: <n>
filename histogram:
  <lower-cased top-level audio filename>: <count>
mode: dry-run|execute|check
```

The histogram is informational; it does **not** force content renames.

### Execute mode

`--execute` reconciles every row with a selected authored source, not only rows missing M4A. This lets Workflow source metadata decide `cached` vs `ready` and repairs a derivative that may exist but correspond to an older/different source.

For each selected source:

1. build the one shared timestamp-based Workflow ID;
2. create the instance via the Workflows REST API;
3. if the ID already exists within retention, poll that existing ID instead of starting another source conversion;
4. poll to terminal state before moving to the next row.

`ready` and `cached` pass. `superseded` means the catalog changed during reconciliation and requires a rerun before release. `errored` fails immediately.

### Check mode

`--check` makes no Workflow mutations. It fails unless every selected authored source has canonical `bgm.m4a` with an R2 `uploaded` timestamp not older than the selected source.

The timestamp check is a public-catalog safety net. The stronger correctness proof is the immediately preceding successful `--execute`, where each Workflow compares source ETag/profile metadata.

## Rollout order

1. Tasks 1–5 implement upload/source selection, Container, direct transcode/publish, Workflow, Wrangler, and Docker-free dev behavior.
2. **Immediately after Task 5**, deploy pre-prod and execute a real Workflow before writing backfill REST parsing.
3. Record the actual Workflows instance-status/output payload shape.
4. Validate generated media with `afinfo` + Virgo's `AVAudioPlayer` path.
5. Complete ZIP behavior and build the operator audit/backfill against the observed API shape.
6. Deploy production.
7. Run dry-run audit.
8. Run sequential `--execute` reconciliation for every selected source.
9. Run `--check`.
10. Only then unblock Virgo HPA-85.

## Acceptance criteria

- [ ] No authored audio object or `.dtx` file is renamed to satisfy HPA-311.
- [ ] One shared top-level full-track selector is reused by catalog discovery, upload triggering, ZIP filtering, and backfill.
- [ ] Direct top-level `bgm.m4a` uploads are rejected case-insensitively.
- [ ] Generation-disabled environments still accept ordinary authored uploads and simply skip generation.
- [ ] Upload and backfill use the same timestamp-based Workflow instance ID.
- [ ] Upload starts a Workflow only when that upload is the currently selected authored source.
- [ ] Workflow has two durable steps: inspect, then transcode-and-publish.
- [ ] There is no staging R2 object or staging cleanup path.
- [ ] Worker orchestration never buffers full audio.
- [ ] Source replacement before canonical PUT returns `superseded` and cannot publish the older conversion.
- [ ] Local `wrangler dev`, `dev:local`, and Web E2E do not require Docker or invoke generation.
- [ ] `Simfile.files` exposes generated M4A without schema/codegen changes.
- [ ] Raw ZIP omits redundant generated M4A when an authored source exists.
- [ ] Pre-prod Workflow execution is proven before the backfill parser is implemented.
- [ ] Production `--execute` completes with only `ready`/`cached` outcomes.
- [ ] Production `--check` reports `selected sources missing/older bgm.m4a: 0`.
- [ ] Generated media plays through `AVAudioPlayer` with acceptable rhythm synchronization.

## KISS guardrails

- One shared source selector, not one required source filename.
- One fixed client-facing derivative.
- One Workflow + one small Container.
- Two Workflow steps, no staging storage protocol.
- One Workflow instance-ID scheme.
- No content migration, client fallback, job DB, Queue, or public generation API.
- One DTXWeb implementation PR; Virgo remains a separate M4A-only PR.

## Platform references

- Cloudflare Workflows: <https://developers.cloudflare.com/workflows/>
- Workflow Workers API / `createBatch()`: <https://developers.cloudflare.com/workflows/build/workers-api/>
- Workflow rules: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
- Workflows REST instance status: <https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/get/>
- Cloudflare Containers local development: <https://developers.cloudflare.com/containers/local-dev/>
- Wrangler local `dev.enable_containers`: <https://developers.cloudflare.com/workers/wrangler/configuration/#local-development-settings>
- Containers configuration: <https://developers.cloudflare.com/workers/wrangler/configuration/#containers>
- R2 Workers API: <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- R2 consistency: <https://developers.cloudflare.com/r2/reference/consistency/>
