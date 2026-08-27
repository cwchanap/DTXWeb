# Cloudflare Workflow-Backed M4A Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Write the failing test before behavior changes and keep each task runnable before commit.

**Goal:** Resolve each song's existing authored top-level full-track audio without renaming it, then publish one stable AAC-LC `{simfileId}/bgm.m4a` through an upload-triggered Cloudflare Workflow + FFmpeg Container before Virgo HPA-85 cuts over.

**Architecture:** Extract the R2 full-track selection rules already embedded in `r2Enrichment.ts` and reuse them for upload triggering, Workflow race checks, ZIP filtering, and catalog reconciliation. Virgo stays fixed on `bgm.m4a`. The Workflow has two durable steps: inspect the current selected source, then stream-transcode-and-publish after re-resolving that selection. No staging object, filename migration, Queue, or job DB.

**Validated against:** `DTXWeb main@9ec68aac5db82e027432841938f92824e8687f80`, Virgo PR #62, and Cloudflare platform docs current through 2026-08-26.

**Spec:** `docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md`

## Locked decisions

- Preserve historical `song.ogg` / `music.ogg` / `.dtx` references; do not introduce a `bgm.ogg` source naming migration.
- One shared top-level full-track selector; no third copy of canonical-top-level/public-URL logic.
- One fixed client derivative: lower-case `{id}/bgm.m4a` for Virgo HPA-85, even when the selected source codec is already Apple-playable.
- One Workflow + one `basic` Container; two Workflow steps only.
- No staging R2 protocol; a retry retranscodes.
- One timestamp-based Workflow ID shared by upload/backfill.
- Retained failed/stale instances are repaired with Cloudflare's Workflow `restart` status API, not a second ID scheme.
- Both Workflow steps must prove `payload.sourceKey` is **still the selector's current winner**; ETag checks alone do not catch a different newly uploaded winner.
- Routine `wrangler dev`, `dev:local`, and Web E2E keep Containers disabled/generation false, so Docker is not an ordinary development dependency.
- `pre-prod-prod-data` has generation disabled but is not represented as read-only.
- Pre-prod real Workflow execution and REST-output observation happen after Task 5, before Task 7 polling code is written.
- Public GraphQL is used for reconciliation because that is the catalog surface Virgo sees.

## File map

### Create

- `packages/dtx-api/src/lib/r2Files.ts`
- `packages/dtx-api/src/lib/r2Files.test.ts`
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
- `packages/dtx-api/src/services/r2Enrichment.ts`
- `packages/dtx-api/src/services/r2Enrichment.test.ts`
- `packages/dtx-api/src/services/uploads.ts`
- `packages/dtx-api/src/services/uploads.test.ts`
- `packages/dtx-api/src/rest/upload.ts`
- `packages/dtx-api/src/rest/upload.test.ts`
- `packages/dtx-api/src/index.ts`
- `packages/dtx-api/src/index.test.ts`
- `packages/dtx-api/src/services/downloads.ts`
- `packages/dtx-api/src/services/downloads.test.ts` — existing file; extend it.
- `packages/dtx-api/package.json`
- `packages/dtx-api/wrangler.jsonc`
- `packages/e2e-web/playwright.config.ts`
- `bun.lock`

### Intentionally unchanged

- authored R2 filenames and `.dtx` contents
- `packages/common/src/lib/server/zipBuilder.ts`
- GraphQL schema/generated clients
- D1 migrations/schema
- Virgo HPA-85 client behavior

---

## Task 1: Extract the shared R2 selector and expose upload identity

**Files:** create `r2Files.ts/test.ts`, `bgmM4a.ts/test.ts`; modify `r2Enrichment.ts/test.ts`, `uploads.ts/test.ts`, `env.ts`.

### 1.1 RED shared-R2 helper tests

Cover:

```text
case-insensitive top-level named key matching
nested key rejection
per-segment public URL encoding
preview.mp3 exclusion
current top-level-beats-nested behavior
current extension priority
canonical generated {id}/bgm.m4a exclusion when selecting authored source
historical music.m4a remains a valid authored source
```

Use a generic `{ key: string }` input so the selector works with both R2 list metadata and GraphQL file rows.

Run:

```bash
cd packages/dtx-api
bun test src/lib/r2Files.test.ts
```

Expected RED.

### 1.2 Implement helpers and refactor `r2Enrichment.ts`

`r2Files.ts` owns:

```ts
export const FULL_TRACK_AUDIO_EXTENSIONS = ['.ogg', '.m4a', '.mp3', '.wav', '.flac'] as const;
export const r2FileName = (key: string) => key.split('/').at(-1) ?? '';
export const isTopLevelR2Key = (key: string, prefix: string) =>
  key.startsWith(prefix) && !key.slice(prefix.length).includes('/');
export const isTopLevelNamedR2Key = (key: string, prefix: string, filename: string) =>
  isTopLevelR2Key(key, prefix) && r2FileName(key).toLowerCase() === filename.toLowerCase();
export const toPublicR2Url = (base: string, key: string) =>
  `${base.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
```

`selectTopLevelFullTrackObject()` preserves current ranking and accepts an `exclude` predicate.

Refactor `r2Enrichment.ts` preview/set.def/public URL/top-level audio selection onto these helpers. Add `.m4a` as a supported source extension without changing existing priority.

Also add a small async service helper (location can be `bgmM4a.ts` or `r2Files.ts` depending on dependency direction):

```ts
resolveSelectedAuthoredSource(bucket, simfileId)
```

It lists `${id}/`, calls the pure selector, and excludes canonical generated `bgm.m4a`.

### 1.3 RED derivative/identity tests

`bgmM4a.ts` owns only derivative/profile/payload/ID rules:

```ts
export const BGM_DERIVATIVE_FILENAME = 'bgm.m4a';
export const BGM_TRANSCODE_PROFILE = 'aac-lc-192k-v1' as const;
export const bgmDerivativeKey = (id: number) => `${id}/bgm.m4a`;
export const isCanonicalBgmDerivativeKey = (key: string, id: number) =>
  isTopLevelNamedR2Key(key, `${id}/`, BGM_DERIVATIVE_FILENAME);
```

Shared Workflow ID:

```ts
export const buildBgmWorkflowInstanceId = (id: number, uploaded: string) => {
  const epochMs = Date.parse(uploaded);
  if (!Number.isFinite(epochMs)) throw new Error('Invalid source uploaded timestamp');
  return `bgm-m4a-v1-${id}-${epochMs}`;
};
```

Payload:

```ts
{
  simfileId: number,
  sourceKey: string,
  sourceUploaded: string,
  expectedSourceEtag?: string,
  expectedSourceVersion?: string,
  profile: 'aac-lc-192k-v1'
}
```

Zod requires `sourceKey` to be a top-level supported audio key and not canonical generated `bgm.m4a`.

### 1.4 RED upload tests

Extend current `uploads.test.ts`:

- `bgm.m4a`, `BGM.M4A`, and `./bgm.m4a` sanitize to reserved generated key and return 409;
- `assets/bgm.ogg` remains nested and allowed;
- arbitrary `music.ogg`, `song.flac`, etc. remain allowed when generation is off;
- successful R2 PUT returns `key`, `etag`, `version`, `uploaded.toISOString()`, and `size` separately while preserving the existing response JSON.

`UploadedObject`:

```ts
{
  simfileId: number;
  key: string;
  etag: string;
  version: string;
  uploaded: string;
  size: number;
}
```

Only generated derivative upload is blocked.

### 1.5 Verify/commit

```bash
bun test src/lib/r2Files.test.ts src/services/bgmM4a.test.ts \
  src/services/r2Enrichment.test.ts src/services/uploads.test.ts
bun run check
git add src/lib/r2Files.ts src/lib/r2Files.test.ts src/services/bgmM4a.ts \
  src/services/bgmM4a.test.ts src/services/r2Enrichment.ts src/services/r2Enrichment.test.ts \
  src/services/uploads.ts src/services/uploads.test.ts src/env.ts
git commit -m "feat(api): define server BGM source and derivative contracts"
```

---

## Task 2: Trigger only when the upload is the selected source

**Files:** create trigger service/tests; modify `env.ts`, `rest/upload.ts/test.ts`, `index.test.ts`.

### 2.1 Optional binding + RED tests

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
```

Tests:

1. disabled/missing flag -> `disabled`, no R2 list/Workflow;
2. nested/non-audio upload -> `not-source`, no list;
3. candidate upload -> resolve current authored source;
4. uploaded `music.ogg` is selected -> one `createBatch()` with timestamp ID + ETag/version;
5. uploaded lower-priority audio while another object remains selected -> `not-source`;
6. enabled + missing binding -> throws loudly;
7. duplicate `createBatch()` empty result -> `duplicate`.

### 2.2 Implement trigger

```text
if generation disabled -> disabled
if uploaded key is not top-level supported audio or is canonical bgm.m4a -> not-source
resolveSelectedAuthoredSource()
if selected key !== uploaded.key -> not-source
require Workflow binding
createBatch([{ id: buildBgmWorkflowInstanceId(id, uploaded.uploaded), params, retention }])
```

Payload includes actual source key, upload timestamp, ETag/version, profile.

### 2.3 Update current Better Auth upload-route tests

Keep trusted cookie+Origin, Bearer-without-Origin, and unsafe-cookie rejection tests unchanged. Change only the upload mock to `UploadResult`, add trigger mock/assertions, and drive cache purge from `uploadedObject` rather than response cloning.

Update `index.test.ts` upload mock to the new result shape.

### 2.4 Full package gate

```bash
bun test src/services/bgmM4aWorkflowTrigger.test.ts src/rest/upload.test.ts \
  src/services/uploads.test.ts src/index.test.ts
bun run test
bun run check
git add src/env.ts src/services/bgmM4aWorkflowTrigger.ts \
  src/services/bgmM4aWorkflowTrigger.test.ts src/rest/upload.ts src/rest/upload.test.ts \
  src/index.test.ts
git commit -m "feat(api): trigger BGM derivative workflow"
```

---

## Task 3: Add generic audio-to-M4A Container

**Files:** Container class, Dockerfile, server, smoke; package + lockfile.

### 3.1 Dependency and Container class

```bash
cd packages/dtx-api
bun add @cloudflare/containers
```

Preserve Better Auth/Drizzle package state.

```ts
export class BgmTranscoderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
}
```

### 3.2 Generic Container endpoint

```text
POST /transcode/to-m4a
body: streamed source audio; FFmpeg probes format
200: streamed audio/mp4
422: invalid/no-audio/decode failure
5xx: transient/internal failure
```

Requirements:

- unique temp directory/request;
- stream request body to temp input;
- serialize jobs via promise tail;
- AAC-LC 192k, no video, preserve rate/channels, `+faststart`;
- `ffprobe` requires codec `aac`;
- stream response, no whole-file JS buffer;
- cleanup on stream close/cancel.

### 3.3 Smoke two input formats

`smoke.sh` converts one short generated Vorbis OGG plus one MP3/WAV source and requires returned `ffprobe` codec `aac` for both.

Add `smoke:bgm-transcoder` package script.

### 3.4 Verify/commit

```bash
bun run smoke:bgm-transcoder
bun run check
git add package.json ../../bun.lock src/containers/bgmTranscoder.ts container/bgm-transcoder
git commit -m "feat(api): add BGM transcoder container"
```

---

## Task 4: Direct source-safe transcode and publish

**Files:** create generation service/tests; modify `env.ts`.

```ts
BGM_TRANSCODER?: DurableObjectNamespace;
```

### 4.1 RED inspect tests

Cover:

- selector currently returns payload source -> continue;
- selector returns different key -> `superseded` even when old source still exists/ETag unchanged;
- HEAD actual arbitrary source key, not reconstructed `bgm.ogg`;
- `source.uploaded` differs from `payload.sourceUploaded` -> `superseded`;
- expected ETag/version mismatch -> `superseded`;
- derivative metadata matches source ETag/profile -> `cached`;
- stale derivative -> delete/purge -> `generate`.

Captured state:

```ts
{ etag: string; version: string; uploaded: string }
```

### 4.2 RED direct stream/race tests

Test:

- source GET body is a `ReadableStream` and whole-body helpers are never called;
- Container receives stream body;
- Container 422 -> `PermanentBgmTranscodeError`;
- pure error classifier maps only permanent media errors to non-retryable;
- after conversion, selector changes to another key -> response canceled, no canonical PUT;
- after conversion, same selected key but ETag/version/uploaded changes -> response canceled, no PUT;
- success sends Container response stream directly to canonical R2 PUT with exact source metadata.

### 4.3 Implement inspect

```text
selected = resolveSelectedAuthoredSource(id)
if selected?.key !== payload.sourceKey -> superseded
head source
if uploaded != sourceUploaded -> superseded
if expected ETag/version mismatch -> superseded
inspect derivative metadata -> cached or delete stale/purge/generate
```

### 4.4 Implement transcode-and-publish

```text
GET source + require captured ETag/version/uploaded
Container.fetch(POST /transcode/to-m4a, source.body)
422 -> permanent; 5xx -> retryable
after conversion: resolveSelectedAuthoredSource(id) again
if selected key changed -> cancel output; superseded
HEAD source again; require captured ETag/version/uploaded
changed -> cancel output; superseded
R2.put({id}/bgm.m4a, response.body, metadata)
purge; ready
```

No staging key/SHA/cleanup protocol.

### 4.5 Verify/commit

```bash
bun test src/services/bgmM4aGeneration.test.ts
bun run check
git add src/env.ts src/services/bgmM4aGeneration.ts src/services/bgmM4aGeneration.test.ts
git commit -m "feat(api): stream BGM conversion directly to R2"
```

---

## Task 5: Wire Workflow/Containers, keep dev Docker-free, prove pre-prod

**Files:** Workflow wrapper; `index.ts/test.ts`, `wrangler.jsonc`, package scripts, `packages/e2e-web/playwright.config.ts`.

### 5.1 Wrangler resources

Production/pre-prod get Workflow + Container + DO resources:

```text
instance_type: basic
max_instances: 1
```

Generation:

```text
prod: true
pre-prod: true
pre-prod-prod-data: false
local/E2E: false
```

Keep Better Auth config and compatibility date unchanged. Do not describe prod-data as read-only.

### 5.2 Docker-free local dev

Add:

```jsonc
"dev": { "enable_containers": false }
```

Override `BGM_M4A_GENERATION_ENABLED:false` in dtx-api local dev scripts and Playwright's Wrangler API command. Local code must never call disabled Container bindings.

### 5.3 Thin Workflow wrapper

Two steps only:

```text
step.do('inspect BGM source and derivative', ...)
step.do('transcode and publish BGM M4A', retry/timeout config, ...)
```

Zod-validate payload. Permanent media errors become `NonRetryableError`; keep Workers-only imports out of ordinary Node tests. Export Workflow/Container classes from `index.ts` without restructuring Better Auth routing.

### 5.4 Full local/config gates

```bash
bun run test
bun run check
bun run build
bun run build:preprod
bun run build:preprod:prod-data
bun run cf-typegen >/dev/null
bun run cf-typegen:preprod >/dev/null
bun run cf-typegen:preprod:prod-data >/dev/null
cd ../..
bun run e2e:web
```

Web E2E must start Wrangler without Docker.

### 5.5 Deploy/execute pre-prod before Task 7

```bash
bun run deploy:api:preprod
```

Use an owned pre-prod simfile and upload a noncanonical source name such as `music.ogg`.

Verify:

1. shared selector chooses the intended source;
2. upload returns before Workflow completion;
3. Workflow reaches `ready`;
4. derivative metadata records actual source key/uploaded identity;
5. repeated trigger uses the same timestamp ID;
6. `afinfo` validates AAC M4A;
7. Virgo's `AVAudioPlayer` smoke prepares/plays it;
8. representative chart sync is acceptable.

Then GET the Workflow instance and record the **actual** REST status/output encoding in the implementation PR. Task 7 follows observed behavior, not a guessed fixture.

### 5.6 Commit

```bash
git add src/workflows/generateBgmM4a.ts src/index.ts src/index.test.ts \
  wrangler.jsonc package.json ../e2e-web/playwright.config.ts
git commit -m "feat(api): deploy BGM generation workflow"
```

---

## Task 6: Remove redundant generated audio from raw ZIPs

**Files:** modify `downloads.ts` and existing `downloads.test.ts`.

### 6.1 RED additions to existing test file

Cover:

```text
music.ogg + bgm.m4a -> ZIP input keeps music.ogg, drops bgm.m4a
song.mp3 + bgm.m4a -> same
only bgm.m4a -> retain it
nested sample audio does not count as authored full-track source
existing access/concurrency tests remain
```

### 6.2 Implement via shared selector

```text
source = selectTopLevelFullTrackObject(objects, prefix, exclude canonical bgm.m4a)
if source -> remove canonical bgm.m4a before createZipSources()
else -> listing unchanged
```

Do not touch `zipBuilder.ts`.

### 6.3 Verify/commit

```bash
bun test src/services/downloads.test.ts src/rest/downloadSimfile.test.ts src/rest/downloadBulk.test.ts
bun run check
git add src/services/downloads.ts src/services/downloads.test.ts
git commit -m "feat(api): avoid duplicate derived audio in raw ZIPs"
```

---

## Task 7: Build audit/reconciliation against observed Workflow API

**Files:** create script/tests; modify package script.

### 7.1 Public GraphQL source selection

Query:

```graphql
query PublishedSimfiles($page: Int!, $pageSize: Int!) {
  simfiles(scope: PUBLISHED, page: $page, pageSize: $pageSize) {
    count
    data { id files { key uploaded } }
  }
}
```

Use the same pure selector. Fixtures include arbitrary top-level names/codecs and nested-only rows. No fixture requires `bgm.ogg`.

### 7.2 Dry-run audit

Print:

```text
published total
audio-bearing rows
selected authored sources
canonical bgm.m4a rows
selected sources missing/older bgm.m4a
filename histogram
mode: dry-run|execute|check
```

Histogram is informational only.

A selected source is missing/older when derivative is absent or `derivative.uploaded < source.uploaded`.

### 7.3 One ID scheme

Upload/backfill both call:

```ts
buildBgmWorkflowInstanceId(Number(row.id), source.uploaded)
```

### 7.4 RED REST lifecycle tests from Task-5 observed envelope

Cover:

- new instance -> poll;
- retained queued/running/waiting -> poll same ID;
- retained errored/terminated -> PATCH `status: restart`, then poll;
- retained complete `ready`/`cached` + visible derivative current -> reuse outcome;
- retained complete but visible derivative missing/older -> PATCH restart, poll repair;
- `superseded` -> nonzero/rerun after fresh catalog;
- failed repair -> nonzero.

This closes the repair hole created by idempotent retained IDs without reintroducing a second ID scheme. Cloudflare's instance-status API supports `restart`.

### 7.5 Implement `--execute`

Reconcile **every selected authored source** sequentially:

1. compute shared ID;
2. attempt create;
3. if duplicate, GET the known ID;
4. apply the lifecycle rules above;
5. poll terminal result before next row.

Only final `ready`/`cached` outcomes pass release reconciliation.

### 7.6 Implement `--check`

No mutation. Exit nonzero unless:

```text
selected sources missing/older bgm.m4a: 0
```

Successful `--execute` immediately before `--check` is the stronger ETag/profile proof; `--check` verifies the visible catalog freshness Virgo sees.

### 7.7 Verify/commit

```bash
bun test src/scripts/backfill-bgm-m4a.test.ts
DTX_GRAPHQL_URL=https://api.pre-prod.dtx.hapadona.com/graphql bun run backfill:bgm-m4a
bun run check
git add src/scripts/backfill-bgm-m4a.ts src/scripts/backfill-bgm-m4a.test.ts package.json
git commit -m "feat(api): add BGM M4A reconciliation tool"
```

Default mode is dry-run.

---

## Task 8: Production rollout and Virgo unblock

### 8.1 Final local gates

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
bun run e2e:web
```

### 8.2 Diff guard

Require:

- no authored filename/.dtx migration;
- no `_generated/` staging protocol;
- no D1 job migration, Queue/R2 event binding, public generation route;
- no GraphQL schema/client change;
- `zipBuilder.ts` unchanged.

### 8.3 Deploy + dry-run

```bash
bun run deploy:api
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a
```

Record filename histogram and visible freshness count; do not rename sources.

### 8.4 Reconcile every selected source

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
BGM_WORKFLOW_NAME=dtx-api-bgm-m4a \
  bun run --filter=dtx-api backfill:bgm-m4a --execute
```

Require final outcomes `ready`/`cached` only. Restart retained failed/stale instances through the same ID. Fresh catalog rerun is required after `superseded`.

### 8.5 Visible gate

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a --check
```

Required:

```text
selected sources missing/older bgm.m4a: 0
```

### 8.6 Production sample + evidence

For one row verify:

- `Simfile.files` contains original authored source and `bgm.m4a`;
- raw ZIP contains original source, not redundant generated M4A;
- derivative metadata points at actual selected source;
- public M4A initializes in Virgo `AVAudioPlayer`.

Record:

```text
dtx-api tests/typecheck: PASS
Web E2E with local Containers disabled: PASS
Wrangler prod/pre-prod/prod-data dry runs: PASS
Container smoke: PASS
Pre-prod real Workflow + REST contract: PASS
Pre-prod AVAudioPlayer/sync smoke: PASS
Production reconciliation: ready/cached only
Production selected sources missing/older M4A: 0
```

Only then unblock HPA-85.

---

## Completion checklist

- [ ] Historical authored audio names and `.dtx` references are untouched.
- [ ] Shared R2 helpers replace duplicate top-level/public-URL logic.
- [ ] One source selector is reused by catalog, trigger, Workflow, ZIP, and backfill.
- [ ] Virgo receives one fixed `bgm.m4a` contract.
- [ ] Generated key is reserved; generation-off authored uploads remain allowed.
- [ ] Upload result includes R2 `uploaded` timestamp.
- [ ] Upload/backfill share one Workflow ID and retained-instance restart repair.
- [ ] Workflow has two steps and no staging object.
- [ ] Inspect and pre-publish checks both verify source is still the selected winner.
- [ ] Worker paths are stream-only.
- [ ] Routine local dev/Web E2E do not require Docker.
- [ ] Pre-prod Workflow runs before Task 7 REST parser is finalized.
- [ ] Existing `downloads.test.ts` is extended, not replaced.
- [ ] Public GraphQL is used because it measures Virgo's visible catalog.
- [ ] Histogram is informational; no filename migration gate.
- [ ] Production reconciliation ends ready/cached after necessary restart repairs.
- [ ] Production `selected sources missing/older bgm.m4a = 0`.
- [ ] Virgo HPA-85 remains separate and blocked until the production gate passes.
