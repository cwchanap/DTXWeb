# Cloudflare Workflow-Backed M4A Generation Design

**Date:** 2026-08-24  
**Revalidated:** 2026-08-26 against `main@9ec68aac5db82e027432841938f92824e8687f80`  
**Status:** Approved  
**Repository:** `cwchanap/DTXWeb`  
**Tracking:** HPA-311  
**Blocks:** Virgo HPA-85

## Context

Virgo HPA-85 deliberately standardizes server BGM on one fixed `bgm.m4a` filename and keeps playback on the existing `AVAudioPlayer` path. DTXWeb therefore needs to publish one Apple-playable derivative per server song without adding client-side codec negotiation.

The authored backing track cannot safely be standardized by renaming historical R2 objects to `bgm.ogg`. DTX files reference audio by filename through `#WAVxx`, and channel `01` is the BGM lane. Renaming `song.ogg` or `music.ogg` without rewriting the chart would break existing web/desktop playback.

DTXWeb already has a cheaper source heuristic in `packages/dtx-api/src/services/r2Enrichment.ts`: full-track discovery prefers top-level audio over nested sample chips, then applies a stable extension priority. HPA-311 reuses that selector rather than creating a content migration.

Existing seams remain small:

- `packages/dtx-api/src/services/uploads.ts` streams uploads into R2;
- `packages/dtx-api/src/rest/upload.ts` owns Better Auth upload orchestration and `waitUntil()` post-response work;
- `Simfile.files` exposes R2 objects to Virgo;
- `packages/dtx-api/src/services/r2Enrichment.ts` already distinguishes top-level full-track audio from nested samples;
- `packages/dtx-api/src/services/downloads.ts` owns DTX-specific ZIP source collection;
- `packages/common/src/lib/server/zipBuilder.ts` stays format-agnostic.

## Goals

- Preserve historical backing-track filenames and `.dtx` references.
- Reuse one shared top-level full-track selector as the authored BGM source contract.
- Generate stable lower-case `{simfileId}/bgm.m4a` for Virgo regardless of authored source filename/codec.
- Make conversion durable, retryable, idempotent, stream-only, and safe both when source bytes change and when a different object becomes the selected source.
- Keep routine local development and Web E2E Docker-free.
- Reconcile the published catalog through the same public GraphQL surface Virgo consumes before HPA-85 cuts over.

## Non-goals

- Renaming authored backing-track objects or rewriting `.dtx` files.
- Client codec negotiation/fallback, client transcoding, or an OGG decoder.
- A generic media-variant/job framework.
- Queue/R2 event notifications.
- D1/Durable Object job-state tables.
- A public generation/status endpoint.
- Better Auth or GraphQL redesign.
- Making `pre-prod-prod-data` generally read-only; that environment already points at writable production data and broader write protection is outside HPA-311.

## Architecture

Use an **upload-triggered Cloudflare Workflow** and one scale-to-zero **Cloudflare Container** running FFmpeg.

```text
authored top-level full-track upload
        |
        v
source stored at original R2 key
        |
        v
resolve current selected source
        |
        v
GenerateBgmM4aWorkflow
        |
        +--> Step 1: ensure source is still selected + inspect metadata
        |
        +--> Step 2: stream source -> FFmpeg Container
                       -> ensure source is still selected/current
                       -> PUT {id}/bgm.m4a
        |
        v
Simfile.files advertises bgm.m4a
        |
        v
Virgo downloads one fixed M4A filename
```

The Workflow owns durability/retries. The Container only performs stateless audio-to-M4A conversion.

There is **no staging object**. A retry retranscodes. At current project volume this is cheaper than an extra R2 PUT/GET/DELETE, staging-key scheme, cleanup path, and orphan policy.

## Shared R2 file helpers

Avoid another copy of the repository's case-insensitive top-level-key and public-URL rules. Extract the current `r2Enrichment.ts` behavior into a small dtx-api helper, for example `src/lib/r2Files.ts`:

```ts
r2FileName(key);
isTopLevelR2Key(key, prefix);
isTopLevelNamedR2Key(key, prefix, filename);
toPublicR2Url(base, key);
selectTopLevelFullTrackObject(objects, prefix, options);
```

`r2Enrichment.ts` reuses these helpers for canonical `preview.mp3`, `set.def`, public URLs, and full-track ranking.

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
3. optionally excludes canonical generated `{id}/bgm.m4a` from authored-source candidates;
4. preserves the existing extension priority and deterministic key ordering.

A small service helper such as `resolveSelectedAuthoredSource(bucket, simfileId)` lists `${id}/`, invokes the pure selector while excluding canonical `bgm.m4a`, and returns the selected object or null. Upload triggering and both Workflow steps use this same resolver; ZIP/backfill can use the pure selector on their existing listings.

If a row contains only canonical `{id}/bgm.m4a`, it is already ready for Virgo and needs no authored-source Workflow.

The derivative remains fixed even when the selected source is already Apple-playable. Virgo HPA-85 remains M4A-only rather than gaining MP3/WAV/M4A source-selection logic.

## Published derivative

Generated destination is always:

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

## Upload contract

Extend `uploadSimfileFile()` without changing its public HTTP body:

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

Before R2 mutation reject only reserved top-level `bgm.m4a`, case-insensitively.

Do **not** reject authored source uploads when generation is disabled. File-by-file chart uploads must not become half-written because derivative generation is unavailable in that environment.

After successful upload, `routeUpload()` keeps current Better Auth behavior and schedules cache purge plus BGM trigger work with `ctx.waitUntil()`.

The trigger:

1. returns immediately for generation-disabled, nested, or non-audio uploads;
2. lists that simfile prefix and resolves the current authored source;
3. starts a Workflow only when the just-uploaded object's key is the current selected source.

Generation failure never rolls back the authored upload.

## Generation flag and environments

Generation-only fields stay optional in the hand-written `Env` type so unrelated Node fixtures do not need fake platform resources:

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
BGM_TRANSCODER?: DurableObjectNamespace;
```

Semantics:

- missing/non-`true` flag = generation disabled and authored uploads remain allowed;
- enabled + missing Workflow binding = fail loudly/log post-response trigger error;
- Workflow reaching transcode + missing Container binding = fail loudly;
- prod/pre-prod enable and bind generation;
- `pre-prod-prod-data` and routine local/E2E generation are disabled.

`pre-prod-prod-data` is **not** described as read-only. HPA-311 guarantees only that it will not start M4A generation automatically.

## One Workflow instance identity

Upload and backfill use the same deterministic ID based on the R2 object's upload timestamp:

```text
bgm-m4a-v1-{simfileId}-{sourceUploadedEpochMillis}
```

R2 exposes `uploaded` from both `put()` and object listing, so both paths know the same value. This also avoids a second SHA/ID scheme.

Use one-item `createBatch()` because retained duplicate IDs are skipped rather than racing a second conversion.

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

`sourceUploaded` is an expected source identity on every invocation. Upload triggers additionally provide ETag/version. Backfill omits ETag/version and lets Step 1 capture them.

## Workflow: two steps

### Step 1 — inspect current selected source

1. Re-resolve the currently selected authored source from R2.
2. If no source exists or its key differs from `payload.sourceKey`, return `superseded`.
3. HEAD `payload.sourceKey`.
4. Require `source.uploaded.toISOString() === payload.sourceUploaded`; otherwise return `superseded`.
5. When expected ETag/version are supplied, require those too.
6. Capture `{ etag, version, uploaded }` as small metadata.
7. HEAD lower-case `{id}/bgm.m4a`.
8. Destination metadata matching the full captured source identity (ETag + version + uploaded) + profile -> `cached`. ETag alone is content-derived, so re-uploading identical bytes leaves the ETag unchanged while `version`/`uploaded` advance; matching the full identity ensures a new source upload republishes the derivative and can satisfy `--check`.
9. Otherwise keep the stale derivative in place; the publish-side `bucket.put` overwrites it and purges the cache only once the new derivative is live, so a permanent transcode error never leaves Virgo without playable audio.

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

1. GET `payload.sourceKey` and require ETag/version/uploaded still match Step 1.
2. Stream its body directly into the Container.
3. Let the Container complete FFmpeg + `ffprobe` before returning the response stream.
4. **After conversion and before canonical PUT**, list/re-resolve the selected authored source again.
5. If the selected key is no longer `payload.sourceKey`, cancel the Container response body and return `superseded`.
6. HEAD the source again and require ETag/version/uploaded still match Step 1; otherwise cancel/return `superseded`.
7. Stream the Container response directly into lower-case `{id}/bgm.m4a` with the metadata contract.
8. Best-effort purge the public derivative URL and return `ready`.

The selection recheck matters because a source can remain byte-for-byte unchanged while another newly uploaded object becomes the selector's higher-priority winner. ETag checks alone do not catch that race.

Invalid/no-audio/FFmpeg decode failures are non-retryable. Container startup, R2, and 5xx failures remain retryable. A step retry retranscodes by design.

### Why no staging object

Staging did not close either source race; it still required a current-source check followed by a destination write. Removing staging deletes an extra PUT/GET/DELETE, SHA/key derivation, terminal cleanup, and orphan-object concern.

R2 is strongly consistent for writes, deletes, and listings. Once the canonical PUT completes, subsequent Worker/R2 operations see the new object immediately. CDN cache is handled separately with purge + short TTL.

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

HTTP contract is source-format agnostic:

```http
POST /transcode/to-m4a
Content-Type: application/octet-stream

<streamed source audio>
```

The Container writes to a unique temp input, lets FFmpeg probe the input, emits AAC-LC M4A, verifies one AAC stream with `ffprobe`, then streams the result. Invalid media returns 422; transient/internal failures return 5xx. Requests are serialized so one FFmpeg process runs at a time. The Container receives no R2 credentials.

Encoding:

```text
AAC-LC
192 kbps
MPEG-4/M4A
no video
preserve source sample rate/channels
+faststart
```

## Docker-free local development

Declared Containers make `wrangler dev` require a Docker-compatible daemon by default. HPA-311 must not impose that on routine app development or Web E2E.

Add:

```jsonc
"dev": {
  "enable_containers": false
}
```

and override `BGM_M4A_GENERATION_ENABLED=false` in local API dev commands and the Playwright API web-server command so local code never invokes a disabled Container.

Docker is required only for explicit Container smoke/deploy or intentionally enabled Container-local development.

## Wrangler and Better Auth integration

HPA-311 appends Workflow/Container/Durable Object resources to current production/pre-prod config while preserving Better Auth URLs/cookies/Google config, D1/R2/KV bindings, package auth scripts/exports, `/api/auth/*`, and default fetch routing.

Keep compatibility date `2025-01-01`; it already satisfies Workflows.

```text
prod:               generation=true
pre-prod:           generation=true
pre-prod-prod-data: generation=false
local dev/E2E:      generation=false
```

## Publication and raw ZIP behavior

**Virgo publication path is `Simfile.files`.** No GraphQL schema/codegen change is needed.

The shared selector also powers `r2Enrichment.ts`; `.m4a` is therefore a real source-selection extension for historical authored `music.m4a` style files, while canonical generated `{id}/bgm.m4a` is excluded from authored candidates.

Raw ZIP filtering uses source identity rather than hard-coded OGG naming:

```text
selected authored source + canonical bgm.m4a -> omit generated bgm.m4a
canonical bgm.m4a with no authored source     -> keep bgm.m4a
```

`packages/common/src/lib/server/zipBuilder.ts` remains unchanged.

## Catalog audit and reconciliation

Use one explicit operator script, `packages/dtx-api/src/scripts/backfill-bgm-m4a.ts`.

It pages **public GraphQL** `simfiles(scope: PUBLISHED)` because the release gate should measure the same catalog surface Virgo consumes rather than an internal D1/R2-only view.

For each row it uses the same pure top-level full-track selector over `files { key uploaded }`.

Default dry-run prints:

```text
published total: <n>
audio-bearing rows: <n>
selected authored sources: <n>
canonical bgm.m4a rows: <n>
selected sources missing/older bgm.m4a: <n>
filename histogram: ...
mode: dry-run|execute|check
```

The histogram is informational; it never forces content renames.

### Execute mode and retained instances

`--execute` reconciles every row with a selected authored source.

For each source:

1. build the shared timestamp-based instance ID;
2. attempt Workflow creation;
3. if a new instance starts, poll it;
4. if the ID already exists, GET that exact retained instance rather than creating a second ID;
5. queued/running/waiting instances are polled as-is;
6. errored/terminated instances are restarted through the Workflow instance-status API, then polled;
7. a complete retained `ready`/`cached` result may be reused only when the current public derivative exists and is not older than the source; otherwise restart the instance and poll the repair run;
8. `superseded` requires a fresh catalog read/rerun because selection/source identity changed;
9. `errored` after restart fails immediately.

This keeps one source identity while still allowing explicit repair during Workflow retention.

The exact REST envelope/output encoding is recorded from the Task-5 pre-prod instance before implementing this parser.

### Check mode

`--check` makes no Workflow mutations. It fails unless every selected authored source has canonical `bgm.m4a` with public `uploaded >= source.uploaded`.

The timestamp check is the visible-catalog safety net. The stronger correctness proof is the immediately preceding successful `--execute`, whose Workflow inspection compares source identity/profile metadata.

## Rollout order

1. Tasks 1–5 implement shared source selection, upload trigger, Container, direct publish, Workflow/Wrangler, and Docker-free dev behavior.
2. **Immediately after Task 5**, deploy pre-prod and execute a real Workflow before writing the backfill REST parser.
3. Record actual Workflow instance status/output; validate M4A with `afinfo` + Virgo's `AVAudioPlayer` path and representative synchronization.
4. Complete ZIP behavior and operator audit/reconciliation against that observed API shape.
5. Deploy production.
6. Dry-run audit.
7. `--execute` reconciliation for every selected source.
8. `--check` visible-catalog gate.
9. Only then unblock Virgo HPA-85.

## Acceptance criteria

- [ ] No authored audio object or `.dtx` file is renamed.
- [ ] One shared top-level full-track selector is reused by catalog, trigger, Workflow selection checks, ZIP, and backfill.
- [ ] Direct top-level `bgm.m4a` uploads are rejected case-insensitively.
- [ ] Generation-disabled environments accept ordinary authored uploads and skip generation.
- [ ] Upload/backfill share one timestamp-based Workflow ID with retained-instance restart repair.
- [ ] Upload starts a Workflow only when that upload is the selected authored source.
- [ ] Workflow has two durable steps and no staging R2 protocol.
- [ ] Both Workflow steps reject a payload whose source is no longer the selected authored source.
- [ ] Worker orchestration never buffers full audio.
- [ ] Local `wrangler dev`, `dev:local`, and Web E2E do not require Docker or invoke generation.
- [ ] `Simfile.files` exposes generated M4A without schema/codegen changes.
- [ ] Raw ZIP omits redundant generated M4A when an authored source exists.
- [ ] Pre-prod Workflow execution is proven before the backfill parser is finalized.
- [ ] Production reconciliation ends with `ready`/`cached` only after any retained failed instance is restarted/repaired.
- [ ] Production `selected sources missing/older bgm.m4a = 0`.
- [ ] Generated media plays through `AVAudioPlayer` with acceptable rhythm synchronization.

## KISS guardrails

- One shared source selector, not one required source filename.
- One fixed client-facing derivative.
- One Workflow + one small Container.
- Two Workflow steps, no staging storage protocol.
- One Workflow instance-ID scheme with platform restart for repair.
- No content migration, client fallback, job DB, Queue, or public generation API.
- One DTXWeb implementation PR; Virgo remains a separate M4A-only PR.

## Platform references

- Cloudflare Workflows: <https://developers.cloudflare.com/workflows/>
- Workflow Workers API / `createBatch()`: <https://developers.cloudflare.com/workflows/build/workers-api/>
- Workflow instance status/restart: <https://developers.cloudflare.com/api/resources/workflows/subresources/instances/subresources/status/methods/edit/>
- Cloudflare Containers local development: <https://developers.cloudflare.com/containers/local-dev/>
- Wrangler `dev.enable_containers`: <https://developers.cloudflare.com/workers/wrangler/configuration/#local-development-settings>
- R2 Workers API: <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
- R2 consistency: <https://developers.cloudflare.com/r2/reference/consistency/>
