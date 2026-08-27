# Cloudflare Workflow-Backed M4A Generation Design

**Date:** 2026-08-24  
**Revalidated:** 2026-08-26 against `main@9ec68aac5db82e027432841938f92824e8687f80`  
**Status:** Approved design; implementation plan follows this document  
**Repository:** `cwchanap/DTXWeb`  
**Tracking:** HPA-311  
**Blocks:** Virgo HPA-85

## Context

Virgo persists server BGM locally and plays it through `AVAudioPlayer`. The authored server asset is OGG Vorbis, which is not a safe native playback format for that Apple path. DTXWeb already has the needed seams:

- `packages/dtx-api/src/services/uploads.ts` streams uploads into R2;
- `packages/dtx-api/src/rest/upload.ts` owns authenticated upload orchestration and `ExecutionContext.waitUntil()` post-response work;
- `Simfile.files` exposes the R2 object list;
- `packages/dtx-api/src/services/r2Enrichment.ts` characterizes generic full-track audio;
- `packages/dtx-api/src/services/downloads.ts` owns DTX-specific ZIP source collection;
- `packages/common/src/lib/server/zipBuilder.ts` is intentionally format-agnostic.

PR #240 has since moved API authentication to Better Auth + D1. That changed request/session and environment scaffolding, but not the media seams above.

## Goals

- Keep OGG as the user-authored/source-of-truth BGM.
- Generate one Apple-playable AAC-LC M4A derivative asynchronously after a canonical BGM upload.
- Publish that derivative at stable lower-case `{simfileId}/bgm.m4a` so `Simfile.files` advertises it without GraphQL schema/codegen changes.
- Make generation durable, retryable, idempotent, and safe when the source changes while FFmpeg is running.
- Backfill the existing published catalog and prove the BGM naming contract is non-vacuously satisfied before Virgo HPA-85 cuts over.
- Reuse current upload, R2, cache-purge, catalog, auth, and ZIP seams.

## Non-goals

- Client-side transcoding or an OGG decoder.
- Codec negotiation or a generic media-variant framework.
- Queue/R2 event notifications.
- D1 or Durable Object job-state tables.
- A public generation/status endpoint.
- A dedicated iOS package endpoint.
- Conversion of previews, nested drum samples, or arbitrary `.ogg` assets.
- A compatibility migration for old Virgo local downloads.
- Reworking Better Auth, GraphQL, or the generic ZIP builder.

## Decision

Use an **upload-triggered Cloudflare Workflow** backed by one scale-to-zero Cloudflare Container running FFmpeg.

```text
canonical top-level BGM upload
        |
        v
source stored in R2 under its actual uploaded case
        |
        v
GenerateBgmM4aWorkflow
        |
        +--> capture source ETag/version
        |
        +--> stream R2 source -> FFmpeg Container -> R2 staging
        |
        +--> re-check source ETag/version
        |
        v
publish lower-case {id}/bgm.m4a
        |
        v
Simfile.files advertises completed derivative
        |
        v
Virgo HPA-85 downloads M4A
```

The Workflow owns durability and retries. The Container owns only one stateless OGG-to-M4A conversion request at a time.

## Canonical BGM identity

### Logical source identity

The source contract is **top-level basename `bgm.ogg`, case-insensitive**.

All of these are canonical source keys for simfile 42:

```text
42/bgm.ogg
42/BGM.OGG
42/Bgm.Ogg
```

These are not canonical:

```text
42/assets/bgm.ogg
42/kick.ogg
42/audio/song.ogg
```

R2 keys are case-sensitive, so the implementation must preserve the actual uploaded source key in the Workflow payload and metadata. It must not normalize an existing `42/BGM.OGG` object into a nonexistent lower-case source key.

One shared helper owns this rule and is reused by:

- upload reservation/generation guards;
- upload-trigger selection;
- Workflow payload validation;
- source inspection;
- ZIP filtering;
- backfill selection and catalog audit.

This matches the repository's existing case-insensitive top-level handling for `preview.mp3` and `set.def`, and avoids making uploads from case-insensitive development filesystems silently miss the BGM contract.

### Published derivative identity

The generated destination is always exactly:

```text
{id}/bgm.m4a
```

Direct user uploads whose **top-level basename equals `bgm.m4a` case-insensitively** are rejected with `409 Conflict`. This reserves `bgm.m4a`, `BGM.M4A`, and mixed-case variants for the generator and prevents two logical derivatives differing only by case.

### Staging identity

```text
_generated/bgm-m4a-v1/{simfileId}/{sha256(sourceEtag)[0..23]}.m4a
```

Staging lives outside `{simfileId}/`, because `enrichFiles()` / `Simfile.files` list objects below that prefix. Incomplete output must never be discoverable as a song asset.

## Published object metadata

```text
R2 key:        {simfileId}/bgm.m4a
Content-Type:  audio/mp4
Cache-Control: public, max-age=300, must-revalidate
```

Custom metadata:

```text
source-key:         <actual case-preserved source key>
source-etag:        <captured R2 ETag>
source-version:     <captured R2 version when present>
transcode-profile:  aac-lc-192k-v1
```

The derivative path is mutable. It therefore does not inherit the upload route's one-year cache policy. Cache purge stays best effort; the five-minute TTL bounds stale playback if purge is unavailable.

## Upload contract and trigger

After sanitization and ownership validation, before R2 mutation:

1. reject a case-insensitive top-level canonical derivative key;
2. when `BGM_M4A_GENERATION_ENABLED !== "true"`, reject a case-insensitive top-level canonical source key;
3. leave every other upload unchanged.

The second guard is required for `pre-prod-prod-data`, which points at production R2 and must not replace a BGM source without being able to regenerate its derivative.

`uploadSimfileFile()` currently drops the R2 object's identity by returning only an HTTP `Response`. Extend it to return both the existing response and small R2 metadata:

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

The public HTTP JSON contract remains unchanged.

`routeUpload()` consumes `uploadedObject` directly instead of cloning/reparsing the response body. It keeps the current Better Auth `resolveAuthSession()` behavior intact, then uses `ctx.waitUntil()` for:

- the existing public-R2 cache purge;
- the BGM Workflow trigger when the uploaded key is a canonical source.

A failed Workflow trigger does not roll back the successful source upload.

## Optional generation fields in `Env`

HPA-311 must not force every unrelated test fixture to construct Workflow/Container bindings. Add generation-only fields as optional:

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
BGM_TRANSCODER?: DurableObjectNamespace;
```

Rules:

- missing/anything-other-than-`"true"` flag means generation is disabled;
- when generation is explicitly enabled and `BGM_M4A_WORKFLOW` is absent, triggering fails loudly and is logged by the upload post-response path;
- when a Workflow reaches transcode and `BGM_TRANSCODER` is absent, that Workflow fails loudly;
- deployed production/pre-prod Wrangler configs always bind both resources explicitly.

This keeps existing Node test fixtures small without turning a production configuration error into a silent no-op.

## Workflow identity and payload

Upload-trigger instance ID:

```text
bgm-m4a-v1-{simfileId}-{sha256(sourceEtag)[0..23]}
```

Use one-item `createBatch()` so a retained duplicate ID is idempotently skipped.

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
  sourceKey: string; // actual case-preserved canonical top-level key
  expectedSourceEtag?: string;
  expectedSourceVersion?: string;
  profile: 'aac-lc-192k-v1';
};
```

Zod validates that `sourceKey` satisfies the shared case-insensitive top-level canonical-source helper for `simfileId`.

Normal upload triggers include expected ETag/version. Backfill omits them so Step 1 captures current R2 state.

## Workflow steps

### 1. Capture source and inspect destination

- HEAD the actual `sourceKey`.
- Return `superseded` if it is missing.
- If expected ETag/version are supplied, return `superseded` when current source identity differs.
- Save only `{ etag, version }` as `sourceState`.
- HEAD lower-case `{id}/bgm.m4a`.
- Return `cached` if destination custom metadata matches `sourceState.etag` and profile.
- Otherwise delete stale destination before conversion and best-effort purge its public URL.

Deleting stale destination prevents Virgo from seeing an older backing track while replacement generation is running.

### 2. Transcode to staging

- GET source from R2.
- Require its ETag/version still match `sourceState`.
- Pass its `ReadableStream` body directly to the Container request.
- Stream the Container response directly into deterministic staging R2.
- Return only small metadata such as staging key/size/source identity.

Retry configuration:

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

Invalid media / missing audio / FFmpeg decode failures are non-retryable. Container startup, R2, and 5xx failures remain retryable.

### 3. Guarded publish

- HEAD the actual source key again.
- Require ETag/version to match `sourceState`.
- If changed, delete staging and return `superseded`.
- Otherwise GET staging and stream it into lower-case `{id}/bgm.m4a` with the metadata contract above.
- Best-effort purge the public derivative URL.
- Delete staging.
- Return `ready`.

Terminal errors perform best-effort deterministic staging cleanup without replacing the original error.

## Streaming invariant

The 50 MiB upload limit is already large relative to the Worker isolate memory budget. HPA-311 therefore has a hard stream-only boundary:

```text
R2 source ReadableStream
  -> Container Request body
  -> Container response ReadableStream
  -> R2 staging put()
  -> staging ReadableStream
  -> canonical R2 put()
```

No `arrayBuffer()`, `bytes()`, `text()`, or equivalent whole-audio buffering is allowed in Worker orchestration.

Cloudflare Workers' `Request` API accepts `ReadableStream` bodies directly. Do not add Node-specific `duplex: 'half'` unless the actual Workers compiler/runtime requires it; the current Cloudflare runtime documentation does not require that option.

Tests must prove the Container request has a stream body and staging/canonical `put()` receive streams.

## FFmpeg Container

One `BgmTranscoderContainer` is exported from the existing `dtx-api` Worker:

```ts
export class BgmTranscoderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
}
```

Initial Wrangler sizing:

```text
instance_type: basic
max_instances: 1
```

One stable instance ID is used and the container serializes FFmpeg jobs internally, so at most one FFmpeg process runs at a time.

The Container receives no R2 credentials.

HTTP contract:

```http
POST /transcode/ogg-to-m4a
Content-Type: audio/ogg

<streamed OGG>
```

Success:

```http
200 OK
Content-Type: audio/mp4

<streamed M4A>
```

Invalid media returns 422; internal/transient failures return 5xx.

Encoding profile:

```text
AAC-LC
192 kbps
MPEG-4/M4A
no video
preserve source sample rate/channels
+faststart
```

Representative FFmpeg command:

```bash
ffmpeg -nostdin -hide_banner -loglevel error \
  -i input.ogg \
  -map 0:a:0 -vn \
  -c:a aac -profile:a aac_low -b:a 192k \
  -movflags +faststart \
  output.m4a
```

The service validates one AAC audio stream with `ffprobe` before returning success and removes unique temporary files after the streamed response closes/cancels.

## Wrangler and Better Auth integration

PR #240's current Better Auth/D1 configuration is baseline state, not code to rewrite.

HPA-311 appends Workflow/Container/DO resources and generation flags while preserving:

- `BETTER_AUTH_URL`, `DTX_WEB_URL`, auth cookie config, and Google client ID;
- existing D1, R2, and KV bindings;
- Better Auth/Drizzle package dependencies and scripts;
- `./auth-migration` package export;
- `/api/auth/*` routing and the existing default fetch handler.

Wrangler bindings are non-inheritable, so production, `pre-prod`, and `pre-prod-prod-data` each declare the Workflow/Container/DO bindings explicitly.

Generation flags:

```text
prod:               true
pre-prod:           true
pre-prod-prod-data: false
```

Run typecheck and dry-run builds for all three environments.

## GraphQL and generic catalog discovery

**Publication path:** `Simfile.files`, not `discoverCatalogFiles().downloadUrl`.

Publishing lower-case `{id}/bgm.m4a` under the simfile prefix is sufficient for Virgo to see it through the existing `files` field. No GraphQL schema or generated client change is required.

Separately, add `.m4a` after `.ogg` in `r2Enrichment.ts`'s generic `audioExts`:

```ts
['.ogg', '.m4a', '.mp3', '.wav', '.flac']
```

That is only a characterization/compatibility improvement for generic full-track fallback discovery. It is **not** the Virgo publication mechanism, and OGG remains first.

## Raw ZIP behavior

Apply one DTX-specific pre-filter inside `collectZipSources()` before calling `createZipSources()`.

The shared case-insensitive canonical helper applies:

```text
if a simfile has canonical top-level bgm.ogg and canonical top-level bgm.m4a:
    omit the M4A object from raw ZIP sources
else:
    retain what is present
```

`packages/common/src/lib/server/zipBuilder.ts` remains unchanged.

Tests extend the existing `downloads.test.ts`; they do not replace it. Existing access/concurrency tests stay intact, and BGM assertions inspect the object array passed to the mocked `createZipSources()`.

## Catalog audit and backfill

Use one explicit operator script:

```text
packages/dtx-api/src/scripts/backfill-bgm-m4a.ts
```

It pages public `simfiles(scope: PUBLISHED)` and requests `id` plus `files { key uploaded }`.

### Case-insensitive selection

For each row:

- find the actual case-preserved canonical source key using the shared helper;
- find canonical derivative case-insensitively;
- backfill only when source exists and derivative does not;
- send the actual source key in the Workflow payload.

### Non-vacuous contract measurement

The same audit also measures every top-level non-preview audio basename using the server's current full-track extension set (`ogg`, `m4a`, `mp3`, `wav`, `flac`) and prints a lower-cased filename histogram.

Required counters:

```text
published total
with top-level audio
with canonical bgm.ogg
with canonical bgm.m4a
top-level audio without canonical bgm.ogg
missing bgm.m4a among canonical bgm.ogg
```

Dry-run is default.

On `--execute`, start Workflow instances sequentially and poll each to terminal `ready`, `cached`, `superseded`, or `errored` before starting the next.

No permanent admin route, cron, Queue, or job table is added.

## Virgo HPA-85 release gate

A zero missing-M4A count is not sufficient by itself. Before HPA-85 can merge, production audit must satisfy **both**:

```text
top-level audio without canonical bgm.ogg: 0
missing bgm.m4a among canonical bgm.ogg: 0
```

If `with top-level audio > 0`, `with canonical bgm.ogg` must therefore also be nonzero.

This prevents a catalog using `song.ogg`, `music.ogg`, or another historical top-level audio filename from making a vacuous `0 missing` report and shipping Virgo mute. The audit measures the contract; it does not silently rename/migrate those files.

## Error handling and observability

Workflow outcomes:

```text
ready
cached
superseded
errored
```

Structured log fields:

```text
simfileId
sourceKey
sourceEtag
workflowInstanceId
stagingKey
destinationKey
outcome
```

No D1 state is added. Workflow execution state plus R2 metadata are sufficient for this slice.

## Testing strategy

Use existing Node Vitest for pure/service behavior. Do not introduce `@cloudflare/vitest-plugin` just for the thin Workflow entrypoint.

Cover:

- case-insensitive top-level canonical source/derivative matching and nested rejection;
- reserved derivative upload and disabled-generation source upload;
- structured R2 upload identity;
- Better Auth cookie/Bearer upload behavior remains intact;
- deterministic/idempotent Workflow trigger and enabled-with-missing-binding failure;
- cached/superseded source paths;
- stream-only R2 -> Container -> R2 staging/publish;
- permanent-vs-retryable error classification;
- output metadata/cache policy;
- generic `.m4a` characterization with OGG precedence;
- existing ZIP tests plus case-insensitive redundant-M4A filtering;
- backfill candidate selection, filename histogram, non-vacuous counters, REST request, polling outcome parsing.

After Task 2 and after Workflow wiring, run the **full `dtx-api` test suite and typecheck**, not only focused new tests. `index.test.ts` must be updated when the upload mock changes to `UploadResult`.

The Workers-only Workflow wrapper is verified by Wrangler dry-run builds for all environments; a Node-testable helper classifies `PermanentBgmTranscodeError` as non-retryable so the wrapper's error branch is not uncharacterized.

Container smoke builds the Docker image, generates a small synthetic OGG fixture, converts it, and requires `ffprobe` to report AAC in M4A/MP4.

## Deployment order

1. Implement and verify HPA-311 in one PR.
2. Deploy pre-prod.
3. Upload/replace canonical BGM through current Better Auth cookie+trusted-Origin or desktop Bearer auth and verify Workflow/Container behavior.
4. Validate generated M4A with `afinfo` and Virgo's `AVAudioPlayer` path; check one representative chart for synchronization.
5. Prove `pre-prod-prod-data` rejects canonical source and derivative writes without changing production R2.
6. Deploy DTXWeb production.
7. Run production audit dry-run and inspect histogram/counters.
8. Resolve any non-canonical top-level-audio rows explicitly; do not waive the gate.
9. Execute backfill sequentially.
10. Re-run audit until both HPA-85 gates are zero.
11. Only then merge/deploy the separate Virgo HPA-85 M4A cutover.

## Acceptance criteria

- [ ] Canonical source identity is top-level `bgm.ogg` case-insensitively and preserves the actual R2 source key.
- [ ] Direct top-level `bgm.m4a` uploads are rejected case-insensitively.
- [ ] Generation-disabled environments cannot replace a canonical source.
- [ ] Canonical source upload starts one idempotent Workflow without delaying/rolling back the source response.
- [ ] Enabled generation with a missing Workflow/Container binding fails loudly rather than silently skipping work.
- [ ] Workflow produces valid AAC-LC at lower-case `{id}/bgm.m4a`.
- [ ] Replacing source during conversion cannot publish stale output.
- [ ] Invalid media is non-retryable; transient failures retry under the approved policy.
- [ ] Worker orchestration never buffers full audio; source, Container response, staging, and publish use streams.
- [ ] `Simfile.files` exposes generated M4A with no schema/codegen change.
- [ ] Generic `.m4a` discovery is characterized but is not described as the Virgo publication path.
- [ ] Raw ZIP omits only redundant canonical generated M4A and existing ZIP/access tests remain intact.
- [ ] Better Auth request/session behavior and current Wrangler/package config are preserved.
- [ ] Production audit prints a top-level audio filename histogram.
- [ ] Production reports `top-level audio without canonical bgm.ogg: 0`.
- [ ] Production reports `missing bgm.m4a among canonical bgm.ogg: 0`.
- [ ] Generated M4A plays through `AVAudioPlayer` with acceptable rhythm synchronization.

## KISS guardrails

- One logical source contract and one generated derivative.
- One Workflow and one small Container.
- One deterministic staging convention.
- Optional generation-only `Env` fields to avoid unrelated fixture churn, with fail-loud enabled-mode binding checks.
- No new job database, Queue, public API, client fallback, or media framework.
- One DTXWeb implementation PR; Virgo remains its own PR.

## Platform references

- Cloudflare Workflows: <https://developers.cloudflare.com/workflows/>
- Workflow Workers API / `createBatch()`: <https://developers.cloudflare.com/workflows/build/workers-api/>
- Workflow rules/retries: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
- Workflow REST API: <https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/create/>
- Cloudflare Containers: <https://developers.cloudflare.com/containers/>
- Container class API: <https://developers.cloudflare.com/containers/container-class/>
- Workers Request streaming: <https://developers.cloudflare.com/workers/runtime-apis/request/>
- Workers Streams: <https://developers.cloudflare.com/workers/runtime-apis/streams/>
- R2 Workers API: <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
