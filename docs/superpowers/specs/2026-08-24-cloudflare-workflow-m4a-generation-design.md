# Cloudflare Workflow-Backed M4A Generation Design

**Date:** 2026-08-24  
**Status:** Approved design; pending implementation planning  
**Repository:** `cwchanap/DTXWeb`  
**Related client ticket:** Virgo HPA-85

## Context

Virgo downloads a server song's BGM from R2 and passes the persisted local path to `AVAudioPlayer`. The current server contract is `bgm.ogg`, but Apple platforms do not natively decode OGG Vorbis through that playback path.

The current DTXWeb seams are already small:

- `packages/dtx-api/src/services/uploads.ts` writes uploaded files directly to R2 under `{simfileId}/{sanitizedFilename}`.
- `packages/dtx-api/src/rest/upload.ts` owns authenticated upload orchestration and already uses `ExecutionContext.waitUntil()` for post-upload work.
- `packages/dtx-api/src/schema/simfile.ts` exposes the R2 object listing through `Simfile.files`.
- `packages/dtx-api/src/services/r2Enrichment.ts` discovers full-track audio from R2.
- `packages/dtx-api/src/services/downloads.ts` and `packages/common/src/lib/server/zipBuilder.ts` build the existing raw ZIP download.
- Virgo's `SimfileMapper` currently recognizes and constructs a URL for `bgm.ogg`.

The server should keep accepting OGG as the authored source while producing one Apple-playable derivative. The iOS client should not contain an OGG decoder, run FFmpeg, poll a generic media-job system, or negotiate codecs.

## Goals

- Preserve `{simfileId}/bgm.ogg` as the canonical authored source.
- Generate AAC-LC audio in an M4A container asynchronously after a successful canonical OGG upload.
- Reserve `{simfileId}/bgm.m4a` as a server-generated key that users cannot overwrite directly.
- Publish the derivative at that stable key so existing GraphQL file discovery can advertise it.
- Make generation durable, retryable, idempotent, and safe against a source being replaced while conversion is running.
- Reuse the current upload, R2, GraphQL, cache-purge, and ZIP seams.
- Keep the implementation in one DTXWeb PR and coordinate a separate one-PR Virgo cutover.

## Non-goals

- Client-side transcoding or an OGG playback dependency.
- A generic media-variant framework or codec-negotiation API.
- A Queue, R2 event notification, Durable Object job table, or public job-status endpoint.
- A dedicated iOS package endpoint.
- Conversion of drum-hit samples, previews, or arbitrary `.ogg` assets.
- Automatic cleanup of every historical generated-object version.
- Changing the existing raw/web download contract beyond filtering the redundant generated BGM sidecar.

## Decision

Use an upload-triggered Cloudflare Workflow backed by one scale-to-zero Cloudflare Container running FFmpeg.

```text
Authenticated upload of {id}/bgm.ogg
                 |
                 v
          source stored in R2
                 |
                 v
       GenerateBgmM4aWorkflow
          |              |
          |              +--> inspect source/destination metadata
          |
          +--> stream source to FFmpeg Container
                         |
                         v
              _generated/bgm-m4a-v1/...
                         |
                         v
                 re-check source ETag
                         |
                         v
                 publish {id}/bgm.m4a
                         |
                         v
              GraphQL Simfile.files advertises it
                         |
                         v
                 Virgo downloads M4A
```

The Workflow is the durable orchestrator. The Container only performs one stateless OGG-to-M4A conversion request at a time.

## File and metadata contracts

### Canonical source

```text
R2 key:        {simfileId}/bgm.ogg
Content:       OGG Vorbis
Ownership:     user-authored/source-of-truth
```

Only this exact top-level key triggers generation. Other OGG files can be DTX sample chips and must never be treated as the backing track.

### Staging derivative

```text
R2 key: _generated/bgm-m4a-v1/{simfileId}/{sha256(sourceEtag)[0..23]}.m4a
```

The staging prefix deliberately lives outside `{simfileId}/` so GraphQL file listings and existing ZIP downloads cannot expose incomplete generated artifacts.

The key is deterministic for one source ETag and transcode profile. Workflow retries overwrite the same staging object rather than leaking one object per attempt.

### Published derivative

```text
R2 key:        {simfileId}/bgm.m4a
Content-Type:  audio/mp4
Cache-Control: public, max-age=300, must-revalidate
Ownership:     server-generated; direct upload forbidden
```

Custom metadata:

```text
source-key:         {simfileId}/bgm.ogg
source-etag:        <R2 source ETag>
source-version:     <R2 source version, when available>
transcode-profile:  aac-lc-192k-v1
```

The canonical path is mutable, so it must not use the upload route's current one-year immutable-style cache policy. Cache purge remains best effort, while the five-minute cache ceiling bounds stale playback if purge credentials or the purge request fail.

## Upload contracts and trigger

Before writing to R2, the upload path applies two exact-filename rules after sanitization:

- reject `{simfileId}/bgm.m4a` with `409 Conflict` because the key is owned by the generator;
- when `BGM_M4A_GENERATION_ENABLED` is not `true`, reject `{simfileId}/bgm.ogg` with `409 Conflict` so an environment cannot replace the source without also regenerating its derivative.

All other existing uploads remain unchanged.

After `uploadSimfileFile()` successfully stores an object, return structured metadata to the route instead of cloning and reparsing the JSON `Response`:

```ts
type UploadResult = {
  response: Response;
  uploadedObject?: {
    key: string;
    version: string;
    etag: string;
    size: number;
  };
};
```

`routeUpload()` continues returning the existing successful HTTP response. For an exact key matching `{simfileId}/bgm.ogg`, it schedules a post-response task with `ctx.waitUntil()` that:

1. builds the deterministic Workflow instance ID below;
2. triggers the Workflow through its binding;
3. logs trigger failures without changing the already-successful source upload response.

Use `createBatch()` with a single item because Cloudflare documents it as idempotent for duplicate instance IDs. A duplicate upload callback while the prior instance is retained is skipped rather than failing.

Upload-triggered instance identity:

```text
bgm-m4a-v1-{simfileId}-{sha256(sourceEtag)[0..23]}
```

Retention:

```ts
retention: {
  successRetention: "1 day",
  errorRetention: "7 days"
}
```

The generated R2 object is the durable result. Workflow retention exists only for diagnostics and manual repair.

## Workflow payload

Keep the payload metadata-only and validate it with the repository's existing Zod dependency:

```ts
type GenerateBgmM4aPayload = {
  simfileId: number;
  sourceKey: string;
  expectedSourceEtag?: string;
  expectedSourceVersion?: string;
  profile: "aac-lc-192k-v1";
};
```

Normal upload triggers provide both expected values. The one-time backfill omits them and lets the Workflow capture the current R2 source state in its first step.

The Workflow must reject malformed payloads with `NonRetryableError`. TypeScript types alone are not runtime validation.

## Workflow steps

### Step 1: capture source state and inspect the existing derivative

- `head(sourceKey)` and return `superseded` when the source is missing.
- When an expected ETag/version is present, return `superseded` if the current source does not match it.
- Persist a small `sourceState` result containing the current ETag and version.
- `head({simfileId}/bgm.m4a)`.
- Return `cached` when destination metadata already matches `sourceState.etag` and the transcode profile.
- Delete a stale destination before conversion so Virgo cannot download audio derived from an older source while replacement generation is pending.
- Best-effort purge the stale public M4A URL.

A source re-upload with identical bytes may reuse the current derivative. A content change receives a different ETag and generates a new derivative.

### Step 2: transcode to staging

- Read the source body from R2.
- Send it as the request body to a stable `BgmTranscoderContainer` instance.
- Require a successful container response.
- Stream the response body directly into the staging key derived from `sourceState.etag`.
- Return only small metadata such as staging key and output size.

Retry configuration:

```ts
{
  retries: {
    limit: 2,
    delay: "30 seconds",
    backoff: "exponential"
  },
  timeout: "30 minutes"
}
```

Transient container startup, HTTP 5xx, and R2 failures are retryable. Invalid OGG bytes, missing audio streams, and FFmpeg decode errors are permanent and should surface as `NonRetryableError`.

Audio bytes must remain in streams/R2, not ordinary Workflow step return values. Cloudflare limits non-stream step results to 1 MiB.

### Step 3: publish only when the source is still current

Before publishing, `head(sourceKey)` again and require both its ETag and version to match the captured `sourceState`.

If the source changed during conversion:

- delete the staging object;
- return `superseded`;
- never overwrite the canonical M4A.

Otherwise:

- stream staging into `{simfileId}/bgm.m4a`;
- write the HTTP and custom metadata contract above;
- best-effort purge the public M4A URL;
- delete staging;
- return `ready` with the destination key and source ETag.

### Failure cleanup

Wrap transcode/publish orchestration so a terminal failure attempts one cleanup step for the deterministic staging key before rethrowing. Do not add a cleanup database, scheduled janitor, or rollback framework for this slice.

## FFmpeg Container

Keep the Container in the existing `dtx-api` Worker deployment.

```ts
export class BgmTranscoderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "1m";
  enableInternet = false;
}
```

Wrangler configuration uses:

- `instance_type: "basic"`;
- `max_instances: 1`;
- one Durable Object binding for `BgmTranscoderContainer`;
- one `new_sqlite_classes` migration for the class;
- a Dockerfile owned by `packages/dtx-api`.

A `basic` instance supplies enough initial memory and temporary disk for the repository's current upload limit while remaining inexpensive for hobby-project traffic. The Container scales to zero after one minute of inactivity.

The Worker obtains one stable instance, for example `getContainer(env.BGM_TRANSCODER, "bgm-transcoder")`. The container HTTP service must serialize work internally so only one FFmpeg process runs at a time even if several Workflows call the same instance concurrently.

### Container HTTP contract

```http
POST /transcode/ogg-to-m4a
Content-Type: audio/ogg

<streamed OGG body>
```

Success:

```http
200 OK
Content-Type: audio/mp4

<streamed M4A body>
```

The container:

1. writes the request to a unique temporary input file;
2. invokes FFmpeg;
3. verifies the output has one AAC audio stream with `ffprobe`;
4. streams the output;
5. removes temporary files in `finally`;
6. returns a 4xx error for invalid media and a 5xx error for transient/internal failure.

Initial encoding profile:

```text
Codec:       AAC-LC
Bitrate:     192 kbps
Container:   MPEG-4/M4A
Video:       none
Sample rate: preserve source
Channels:    preserve source
Fast start:  enabled
```

Representative command:

```bash
ffmpeg -nostdin -hide_banner -loglevel error \
  -i input.ogg \
  -map 0:a:0 -vn \
  -c:a aac -profile:a aac_low -b:a 192k \
  -movflags +faststart \
  output.m4a
```

The Container receives no R2 credentials. The Worker owns source and destination streams through bindings.

## Wrangler environments

Production and pre-production use isolated Workflow names and Container/Durable Object bindings while retaining the same exported classes and image.

Wrangler bindings and variables are non-inheritable, so every deployed environment explicitly configures the R2, Workflow, Durable Object, and generation-enabled values it uses. Run `wrangler deploy --dry-run` and type generation for the top-level, `pre-prod`, and `pre-prod-prod-data` configurations.

`pre-prod-prod-data` intentionally points at production R2 data. Automatic generation is disabled there, and the upload contract above rejects canonical `bgm.ogg` writes before R2 mutation.

```text
BGM_M4A_GENERATION_ENABLED=true   # prod, pre-prod
BGM_M4A_GENERATION_ENABLED=false  # pre-prod-prod-data
```

No secret is introduced for ordinary Workflow-to-Container communication because both are internal bindings in the same Worker deployment.

## GraphQL and catalog discovery

No GraphQL schema or Apollo code-generation change is required. `Simfile.files` already lists objects under `{simfileId}/`, so the published `bgm.m4a` automatically becomes visible to Virgo.

Update `packages/dtx-api/src/services/r2Enrichment.ts` to recognize `.m4a` as full-track audio while preserving the existing extension precedence:

```ts
const audioExts = [".ogg", ".m4a", ".mp3", ".wav", ".flac"];
```

Keeping OGG first preserves the generic web/download discovery contract. Virgo independently selects the exact `bgm.m4a` key from `Simfile.files`.

## Existing ZIP downloads

The current raw ZIP path includes every non-preview R2 object under `{simfileId}/`. Publishing `bgm.m4a` beside `bgm.ogg` would otherwise double the backing-track payload.

Apply one DTX-specific filter inside `collectZipSources()` before calling the generic ZIP builder:

```text
When top-level bgm.ogg and bgm.m4a both exist:
    omit top-level bgm.m4a from the raw ZIP

When bgm.m4a exists without bgm.ogg:
    retain bgm.m4a
```

Do not place this rule in the generic `zipBuilder.ts`; that helper should remain format-agnostic.

GraphQL continues listing both objects. Only the raw ZIP omits the redundant generated sidecar.

## Virgo coordination

Virgo HPA-85 becomes a hard current-format cutover:

```text
Remote filename: bgm.m4a
Local filename:  {songId}.m4a
Playback:        existing AVAudioPlayer path
Fallback:        none
```

DTXWeb must deploy first. Run the catalog backfill and verify every published simfile with top-level `bgm.ogg` also has a valid `bgm.m4a` before merging the Virgo implementation.

No dual-format fallback or local migration is added to Virgo. Existing pre-release local OGG downloads can be deleted/reset and downloaded again.

## Existing catalog backfill

Use `packages/dtx-api/src/scripts/backfill-bgm-m4a.ts`, not a permanent admin route or scheduled job.

The script:

1. pages the production GraphQL catalog and requests `Simfile.files { key uploaded }`;
2. selects published simfiles with exact top-level `bgm.ogg` and no `bgm.m4a`;
3. invokes the Cloudflare Workflows REST API with a deterministic ID derived from the simfile ID, source upload timestamp, and profile;
4. sends `{ simfileId, sourceKey, profile }`, allowing Workflow Step 1 to capture the current ETag/version;
5. starts instances sequentially because the container pool has one instance;
6. reports `ready`, `cached`, `superseded`, and `errored` outcomes;
7. remains available as an explicit repair tool but is never run automatically.

The script uses operator-provided Cloudflare account/API-token environment variables and does not add credentials to the deployed Worker.

The backfill completes only when a catalog audit reports zero OGG-bearing published simfiles without `bgm.m4a`.

## Error handling and observability

Workflow terminal outputs communicate the useful outcome:

```text
ready       generated and published
cached      existing derivative already matches
superseded  source changed or disappeared; no publish
errored     invalid media or exhausted transient retries
```

Log structured fields at the upload trigger and each Workflow boundary:

```text
simfileId
sourceKey
sourceEtag
workflowInstanceId
stagingKey
destinationKey
outcome
```

Do not add D1 state. Cloudflare Workflow status/logs plus R2 metadata are sufficient for the initial operational model.

A failed generation does not roll back the successful OGG upload. The song remains available to existing non-Apple/raw consumers. After the Virgo M4A-only cutover, Virgo does not advertise BGM until `bgm.m4a` exists.

## Testing strategy

### Unit tests

- Exact top-level `bgm.ogg` triggers generation; nested/sample OGG files do not.
- Direct `bgm.m4a` uploads are rejected.
- Canonical OGG uploads are rejected when generation is disabled.
- Instance IDs are deterministic and profile-versioned.
- Duplicate upload trigger uses idempotent `createBatch()` behavior.
- Payload validation rejects malformed metadata without retries.
- Upload-triggered expected source metadata is enforced.
- Backfill payloads without expected metadata capture current source state.
- Matching destination metadata returns `cached`.
- A changed source before or after transcode returns `superseded`.
- Invalid media maps to a non-retryable failure.
- Published metadata and cache policy match the contract.
- R2 catalog discovery recognizes M4A.
- Raw ZIP filtering omits only the redundant top-level generated M4A.

Extract small pure helpers and inject R2/container/Workflow-binding interfaces so the existing Node Vitest setup can cover orchestration without introducing a second broad testing framework.

### Container smoke

Build and run the Docker image locally, convert a small OGG fixture, and require `ffprobe` to report AAC audio in an M4A/MP4 container.

### Pre-production smoke

- Upload a real `bgm.ogg` to pre-production.
- Confirm a Workflow instance completes.
- Confirm `{simfileId}/bgm.m4a` has the expected metadata.
- Download the public object and validate it with `afinfo`.
- Open it through the same `AVAudioPlayer` initialization path used by Virgo.
- Check one representative rhythm chart for audible timing alignment.

Keep network-dependent checks out of ordinary unit-test CI.

## Deployment order

1. Deploy the Workflow, Container, upload trigger, and ZIP/catalog changes to pre-production.
2. Run the pre-production media and playback smoke.
3. Deploy DTXWeb production.
4. Run the one-time production backfill.
5. Audit the complete published catalog; mismatch count must be zero.
6. Merge and deploy the separate Virgo HPA-85 M4A cutover.

## Risks and mitigations

- **Source replaced during conversion:** compare captured ETag/version before and after FFmpeg; never publish stale output.
- **Duplicate trigger:** deterministic instance ID plus idempotent `createBatch()`.
- **Generated key overwritten by a user:** reject direct `bgm.m4a` uploads.
- **Invalid bytes behind an OGG filename:** `ffprobe` validation and non-retryable failure.
- **Stale CDN object:** delete stale destination, purge best effort, and use a five-minute cache ceiling.
- **Container overload:** one `basic` instance and one in-container conversion at a time.
- **Incomplete rollout before Virgo cutover:** production catalog audit is a hard merge gate.
- **Raw ZIP size regression:** omit the generated sidecar when canonical OGG is present.
- **Prod-data test environment creating source/derivative drift:** reject canonical OGG uploads when generation is disabled.

## Acceptance criteria

- [ ] Uploading exact top-level `bgm.ogg` starts one idempotent Workflow instance without delaying the upload response.
- [ ] Direct upload cannot overwrite `{simfileId}/bgm.m4a`.
- [ ] Environments with generation disabled cannot replace canonical `bgm.ogg`.
- [ ] The Workflow produces valid AAC-LC audio at `{simfileId}/bgm.m4a`.
- [ ] Re-uploading identical source bytes returns `cached` or performs no duplicate publish.
- [ ] Replacing the source while conversion is running cannot publish stale output.
- [ ] Invalid OGG media ends in a clear non-retryable error.
- [ ] GraphQL `Simfile.files` exposes the completed `bgm.m4a` without a schema change.
- [ ] Raw ZIP downloads do not contain both canonical OGG and generated M4A.
- [ ] Pre-production and production Workflows/Containers are isolated.
- [ ] The backfill audit reports zero published OGG-bearing simfiles missing M4A.
- [ ] A generated file initializes and plays through Virgo's `AVAudioPlayer` path with acceptable chart synchronization.

## KISS guardrails

- One source format contract and one generated Apple-playable derivative.
- One Workflow class and one small FFmpeg Container.
- One deterministic staging convention; no media database.
- No Queue, event notification, polling API, generic job UI, or client fallback.
- DTXWeb backend work stays in one PR; Virgo cutover stays in its existing one-PR ticket.

## Platform references

- Cloudflare Workflows overview: <https://developers.cloudflare.com/workflows/>
- Workflows Workers API and `createBatch()`: <https://developers.cloudflare.com/workflows/build/workers-api/>
- Workflows retry rules and limits: <https://developers.cloudflare.com/workflows/build/rules-of-workflows/>
- Workflows REST API: <https://developers.cloudflare.com/api/resources/workflows/subresources/instances/methods/create/>
- Cloudflare Containers: <https://developers.cloudflare.com/containers/>
- Container class API: <https://developers.cloudflare.com/containers/container-class/>
- Wrangler Container configuration: <https://developers.cloudflare.com/workers/wrangler/configuration/#containers>
- R2 Workers API object metadata: <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>
