# Cloudflare Workflow-Backed M4A Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Write the failing test before changing behavior and keep each task runnable before commit.

**Goal:** Resolve each song's existing authored top-level full-track audio without renaming it, then publish one stable AAC-LC `{simfileId}/bgm.m4a` through an upload-triggered Cloudflare Workflow + FFmpeg Container before Virgo HPA-85 cuts over.

**Architecture:** Extract the full-track R2 selection rules already embedded in `r2Enrichment.ts`, use that same selector for upload triggering, ZIP filtering, and catalog reconciliation, and keep Virgo's client contract fixed on `bgm.m4a`. The Workflow has two durable steps only: inspect metadata, then stream source through the Container and atomically publish the canonical derivative after a second source-identity check. No staging object, content rename, Queue, or job database.

**Validated against:** `DTXWeb main@9ec68aac5db82e027432841938f92824e8687f80`, Virgo PR #62, and Cloudflare Workflows/Containers/R2 docs current through 2026-08-26.

**Spec:** `docs/superpowers/specs/2026-08-24-cloudflare-workflow-m4a-generation-design.md`

## Review decisions incorporated

- Historical `song.ogg` / `music.ogg` style names are not renamed; `.dtx` `#WAV` references stay intact.
- Source identity reuses current top-level full-track selection semantics instead of a new `bgm.ogg` naming contract.
- Virgo remains **M4A-only**. We do not adopt the reviewer's suggested MP3/WAV client fallback; any selected authored source is reconciled to canonical `bgm.m4a`.
- Existing top-level/case-insensitive R2 key logic and public URL construction are extracted rather than copied a third time.
- Workflow staging is removed; retries retranscode.
- Upload/backfill share one timestamp-based Workflow ID.
- Routine `wrangler dev`, `dev:local`, and Web E2E keep Containers disabled and generation false, so Docker is not a new ordinary-development dependency.
- Pre-prod Workflow execution happens immediately after Workflow wiring, before the backfill REST parser is written.
- `pre-prod-prod-data` is not called read-only. Generation is disabled there; ordinary uploads are not partially rejected.
- The production histogram is informational. Release readiness is based on successful reconciliation plus zero selected sources with missing/older canonical M4A.

## Global constraints

- One HPA-311 implementation PR.
- One authored-source selector; no filename migration.
- One fixed derivative: lower-case `{id}/bgm.m4a`.
- Reserve top-level `bgm.m4a` case-insensitively for the generator.
- Keep current Better Auth `resolveAuthSession()` behavior and `/api/auth/*` routing.
- Worker audio I/O is stream-only; never buffer whole tracks.
- One Workflow ID scheme based on source R2 `uploaded` timestamp.
- Two Workflow steps only: inspect; transcode-and-publish.
- `instance_type: "basic"`, `max_instances: 1`, one FFmpeg process at a time.
- No compatibility-date bump; existing `2025-01-01` already satisfies Workflows.
- No Queue, R2 event notification, D1 media/job state, public job API, iOS package endpoint, client decoder/transcoder, or generic media framework.
- Keep GraphQL schema/generated clients and `packages/common/src/lib/server/zipBuilder.ts` unchanged.

---

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

- all `.dtx` files and authored R2 filenames
- `packages/common/src/lib/server/zipBuilder.ts`
- GraphQL schema/generated clients
- D1 migrations/schema
- Virgo HPA-85 client behavior

---

## Task 1: Extract one R2 full-track selector and expose upload identity

**Files:** create `r2Files.ts/test.ts`, `bgmM4a.ts/test.ts`; modify `r2Enrichment.ts/test.ts`, `uploads.ts/test.ts`, `env.ts`.

### Step 1 — RED shared-R2 helper tests

Cover:

```text
isTopLevelNamedR2Key('42/PREVIEW.MP3', '42/', 'preview.mp3') = true
isTopLevelNamedR2Key('42/assets/preview.mp3', '42/', 'preview.mp3') = false
toPublicR2Url encodes each path segment
selected source prefers top-level over nested
selected source preserves existing extension priority
selected source excludes preview.mp3
selected source excludes generated 42/bgm.m4a
historical top-level music.m4a remains a valid authored source candidate
```

Use a generic input type `{ key: string }` so the same selector works with R2 list metadata and GraphQL file rows.

Run:

```bash
cd packages/dtx-api
bun test src/lib/r2Files.test.ts
```

Expected: RED because helper does not exist.

### Step 2 — implement shared helper and refactor `r2Enrichment.ts`

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

`selectTopLevelFullTrackObject()` must preserve the current extension priority and exclude `preview.mp3`. It accepts an optional `exclude` predicate so HPA-311 can exclude canonical generated `bgm.m4a` from authored-source candidates.

Refactor current `canonicalPreviewKey`, `canonicalSetDefKey`, URL construction, and top-level full-track ranking in `r2Enrichment.ts` onto the helper without changing existing behavior beyond explicit `.m4a` support.

Run existing `r2Enrichment.test.ts` plus new helper tests.

### Step 3 — RED BGM contract tests

`bgmM4a.ts` owns only derivative/profile/payload/ID rules, not source naming:

```ts
export const BGM_DERIVATIVE_FILENAME = 'bgm.m4a';
export const BGM_TRANSCODE_PROFILE = 'aac-lc-192k-v1' as const;
export const bgmDerivativeKey = (id: number) => `${id}/bgm.m4a`;
export const isCanonicalBgmDerivativeKey = (key: string, id: number) =>
  isTopLevelNamedR2Key(key, `${id}/`, BGM_DERIVATIVE_FILENAME);
```

Workflow ID is synchronous and shared by upload/backfill:

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

Zod validates source key is top-level supported full-track audio and is not canonical generated `bgm.m4a`.

### Step 4 — RED upload tests

Extend current `uploads.test.ts`:

- top-level `bgm.m4a`, `BGM.M4A`, and `./bgm.m4a` sanitize to the reserved generated key and return 409;
- `assets/bgm.ogg` remains nested and is allowed;
- arbitrary `music.ogg`/`song.flac` uploads remain allowed even when generation flag is absent/false;
- successful PUT returns R2 `key`, `etag`, `version`, `uploaded.toISOString()`, `size` separately while preserving public JSON response.

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

Only the generated derivative is blocked before R2 PUT. Remove the old plan's source-upload 409 entirely.

### Step 5 — verify/commit Task 1

```bash
bun test src/lib/r2Files.test.ts src/services/bgmM4a.test.ts \
  src/services/r2Enrichment.test.ts src/services/uploads.test.ts
bun run check
git add src/lib/r2Files.ts src/lib/r2Files.test.ts src/services/bgmM4a.ts \
  src/services/bgmM4a.test.ts src/services/r2Enrichment.ts src/services/r2Enrichment.test.ts \
  src/services/uploads.ts src/services/uploads.test.ts src/env.ts
git commit -m "feat(api): define server BGM source and derivative contracts"
```

Expected: PASS.

---

## Task 2: Trigger one Workflow only when the upload is the selected source

**Files:** create trigger service/tests; modify `env.ts`, `rest/upload.ts/test.ts`, `index.test.ts`.

### Step 1 — optional Workflow binding + RED trigger tests

```ts
BGM_M4A_GENERATION_ENABLED?: 'true' | 'false';
BGM_M4A_WORKFLOW?: Workflow<GenerateBgmM4aPayload>;
```

Tests:

1. disabled/missing flag -> `disabled`, no R2 list, no Workflow;
2. nested/non-audio upload -> `not-source`, no list;
3. top-level audio upload -> list `${id}/`, use shared selector excluding canonical derivative;
4. uploaded `music.ogg` selected -> one `createBatch()` using timestamp-based ID and expected ETag/version;
5. uploaded `music.mp3` while older/higher-priority `song.ogg` remains selected -> `not-source`;
6. enabled + missing Workflow binding -> throws loudly;
7. duplicate `createBatch()` empty result -> `duplicate`.

### Step 2 — implement trigger helper

`triggerBgmM4aGeneration(env, uploaded)`:

```text
if generation disabled -> disabled
if uploaded key is not a top-level supported audio candidate -> not-source
list all objects under {id}/
resolve selected authored source excluding canonical bgm.m4a
if selected key !== uploaded.key -> not-source
require Workflow binding
createBatch([{ id: buildBgmWorkflowInstanceId(id, uploaded.uploaded), params, retention }])
```

### Step 3 — update Better Auth upload route tests

Keep all current `resolveAuthSession()` tests unchanged:

- trusted Better Auth cookie + exact Origin works;
- desktop Bearer works without Origin;
- unsafe cookie POST with missing/wrong Origin fails.

Change only the `uploadSimfileFile()` mock to `UploadResult`, mock trigger service, and assert cache purge + trigger are scheduled from `uploadedObject` with no response cloning/parsing.

Update `index.test.ts` upload mock to the new result shape.

### Step 4 — full package gate now

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

Expected: all dtx-api tests + typecheck PASS.

---

## Task 3: Add the generic audio-to-M4A Container

**Files:** create Container class/Docker/server/smoke; modify package + lockfile.

### Step 1 — add only required dependency

```bash
cd packages/dtx-api
bun add @cloudflare/containers
```

Preserve Better Auth/Drizzle dependencies, scripts, and `./auth-migration` export.

### Step 2 — Container class

```ts
export class BgmTranscoderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '1m';
  enableInternet = false;
}
```

### Step 3 — Docker/server

Use `oven/bun:1.3.9-debian` + `ffmpeg`.

HTTP contract:

```text
POST /transcode/to-m4a
body: streamed source audio; format probed by FFmpeg
200: streamed audio/mp4
422: invalid/no-audio/decode failure
5xx: internal/transient failure
```

Server requirements:

- unique temp directory per request;
- `pipeline()` request stream into temp input;
- serialize FFmpeg work through a promise tail;
- exact AAC-LC 192k / no-video / preserve channels/rate / `+faststart` profile;
- `ffprobe` requires codec `aac`;
- stream response body; no JS whole-file buffers;
- clean temp files after stream close/cancel.

### Step 4 — Docker smoke

`smoke.sh` generates a short synthetic Vorbis OGG, POSTs it, and requires returned `ffprobe` codec `aac`. Also run one MP3 or WAV input through the same endpoint to prove generic probing rather than OGG-only wiring.

Add:

```json
"smoke:bgm-transcoder": "bash container/bgm-transcoder/smoke.sh"
```

### Step 5 — verify/commit

```bash
bun run smoke:bgm-transcoder
bun run check
git add package.json ../../bun.lock src/containers/bgmTranscoder.ts container/bgm-transcoder
git commit -m "feat(api): add BGM transcoder container"
```

---

## Task 4: Implement direct source-safe transcode and publish

**Files:** create `bgmM4aGeneration.ts/test.ts`; modify `env.ts`.

```ts
BGM_TRANSCODER?: DurableObjectNamespace;
```

### Step 1 — RED inspect tests

Cover:

- HEAD actual arbitrary source key (`42/music.ogg`), never reconstruct `bgm.ogg`;
- missing/expected identity mismatch -> `superseded`;
- derivative custom metadata matching source ETag/profile -> `cached`;
- stale derivative -> delete + best-effort purge, then `generate`.

Captured state:

```ts
{ etag: string; version: string; uploaded: string }
```

### Step 2 — RED direct stream tests

Test that:

- source GET body is a `ReadableStream`;
- Container request body is a `ReadableStream`;
- no source `arrayBuffer()`/`text()`/`blob()` helper is called;
- Container 422 throws `PermanentBgmTranscodeError`;
- pure `classifyBgmWorkflowError()` maps only permanent media error to `non-retryable`;
- after Container returns, a second source HEAD mismatch cancels output and returns `superseded` without destination PUT;
- success calls canonical R2 PUT directly with Container response stream and exact metadata.

### Step 3 — implement transcode-and-publish

Core sequence:

```text
GET actual source + verify Step-1 identity
require BGM_TRANSCODER
Container.fetch(POST /transcode/to-m4a, source.body)
422 -> permanent error
5xx/other -> retryable error
HEAD source again after conversion
changed -> cancel response body; superseded
current -> R2.put({id}/bgm.m4a, response.body, metadata)
purge; ready
```

Do not add staging, `bgmStagingKey`, SHA hashing, staging cleanup, or whole-file buffering.

R2 metadata includes source key/ETag/version/uploaded/profile.

### Step 4 — verify/commit

```bash
bun test src/services/bgmM4aGeneration.test.ts
bun run check
git add src/env.ts src/services/bgmM4aGeneration.ts src/services/bgmM4aGeneration.test.ts
git commit -m "feat(api): stream BGM conversion directly to R2"
```

---

## Task 5: Wire Workflow/Containers, keep local dev Docker-free, then prove pre-prod

**Files:** create Workflow wrapper; modify `index.ts/test.ts`, `wrangler.jsonc`, `package.json`, `packages/e2e-web/playwright.config.ts`.

### Step 1 — Wrangler resources

Production and `pre-prod` get Workflow + Container + Durable Object resources with:

```text
instance_type: basic
max_instances: 1
```

Generation vars:

```text
prod: true
pre-prod: true
pre-prod-prod-data: false
```

Do not claim prod-data is read-only and do not add source-upload guards there.

Keep current Better Auth vars and compatibility date unchanged.

### Step 2 — Docker-free `wrangler dev`

Add top-level:

```jsonc
"dev": { "enable_containers": false }
```

Update `dtx-api` local dev scripts to override:

```text
BGM_M4A_GENERATION_ENABLED:false
```

Update the Wrangler API command in `packages/e2e-web/playwright.config.ts` with the same var override.

Local code must never invoke the disabled Container. Docker remains required only for explicit Container smoke/deploy work.

### Step 3 — thin Workflow wrapper

Two steps:

```text
step.do('inspect BGM source and derivative', ...)
step.do('transcode and publish BGM M4A', retry/timeout config, ...)
```

Zod-validate payload. Convert `PermanentBgmTranscodeError` through pure error classification to `NonRetryableError`. Keep Workers-only wrapper out of Node Vitest imports; mock named export modules in `index.test.ts` if needed.

Export Workflow + Container classes from `index.ts` without touching `/api/auth/*` or default fetch routing.

### Step 4 — full local/config gates

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

Web E2E must start its Wrangler API with Containers disabled/generation false; routine E2E must not require the Container daemon.

### Step 5 — deploy/execute pre-prod **before Task 7**

```bash
bun run deploy:api:preprod
```

Use an existing owned pre-prod simfile. Upload an arbitrary top-level full-track name such as `music.ogg` (not `bgm.ogg`) through a current auth path.

Verify:

1. shared selector chooses the uploaded source;
2. upload returns before Workflow completion;
3. Workflow reaches `ready`;
4. `{id}/bgm.m4a` metadata records actual `music.ogg` key;
5. repeated trigger uses same timestamp-based ID / becomes duplicate or cached;
6. source replacement during conversion is covered by unit race test and, when practical, reproduced in pre-prod;
7. `afinfo` reports AAC M4A;
8. Virgo's current `AVAudioPlayer(contentsOf:)` smoke path prepares/plays the file;
9. representative chart synchronization is acceptable.

Then call the Workflows REST instance-status endpoint and record the **actual response/output encoding** in the implementation PR. Task 7 must implement polling against this observed payload rather than an assumed example.

Do not perform a prod-data write test: generation disabled there is not a read-only guarantee.

### Step 6 — commit Task 5 changes

```bash
git add src/workflows/generateBgmM4a.ts src/index.ts src/index.test.ts \
  wrangler.jsonc package.json ../e2e-web/playwright.config.ts
git commit -m "feat(api): deploy BGM generation workflow"
```

---

## Task 6: Keep raw ZIPs from duplicating the derived track

**Files:** modify `downloads.ts` and existing `downloads.test.ts`.

### Step 1 — RED existing-test-file additions

Using current `mockedListAll` + `mockedCreateZipSources`:

- `music.ogg + bgm.m4a` -> pre-filter sends `music.ogg` but omits generated M4A;
- `song.mp3 + bgm.m4a` -> same;
- only `bgm.m4a` and no authored source -> keep M4A;
- nested sample audio does not count as authored top-level source;
- preserve existing access-control/concurrency tests.

### Step 2 — filter using shared selector

For each simfile listing:

```text
source = selectTopLevelFullTrackObject(objects, prefix, exclude canonical bgm.m4a)
if source exists -> remove canonical bgm.m4a before createZipSources()
else -> leave listing unchanged
```

Do not touch `zipBuilder.ts`.

### Step 3 — verify/commit

```bash
bun test src/services/downloads.test.ts src/rest/downloadSimfile.test.ts src/rest/downloadBulk.test.ts
bun run check
git add src/services/downloads.ts src/services/downloads.test.ts
git commit -m "feat(api): avoid duplicate derived audio in raw ZIPs"
```

---

## Task 7: Build audit/backfill against the observed Workflow API shape

**Files:** create script/tests; modify `package.json`.

### Step 1 — RED catalog/source-selection tests

GraphQL query remains public:

```graphql
query PublishedSimfiles($page: Int!, $pageSize: Int!) {
  simfiles(scope: PUBLISHED, page: $page, pageSize: $pageSize) {
    count
    data { id files { key uploaded } }
  }
}
```

Use the same shared selector as runtime triggering. Fixtures should include:

```text
42/music.ogg
43/song.mp3
44/backing.flac
45/music.m4a
46/assets/kick.ogg only
47/bgm.m4a only
```

No fixture requires `bgm.ogg`.

### Step 2 — informational audit

Print:

```text
published total
audio-bearing rows
selected authored sources
canonical bgm.m4a rows
selected sources missing/older bgm.m4a
filename histogram (lower-cased top-level audio names)
mode: dry-run|execute|check
```

The histogram never gates on filename.

`selected sources missing/older bgm.m4a` counts a selected source when canonical derivative is absent or `derivative.uploaded < source.uploaded`.

### Step 3 — one instance-ID scheme

Both upload and backfill call:

```ts
buildBgmWorkflowInstanceId(Number(row.id), source.uploaded)
```

No backfill-specific ID and no SHA/ETag ID.

### Step 4 — implement REST creation/polling from observed pre-prod payload

Use the exact status/output envelope recorded in Task 5.

`--execute` reconciles **every selected authored source**, not only visibly missing rows:

1. create Workflow with shared ID and `{ simfileId, sourceKey, sourceUploaded, profile }`;
2. if creation reports retained duplicate, poll the same known ID;
3. poll terminal status before next row;
4. `ready`/`cached` pass;
5. `superseded` exits nonzero and requires rerun because source changed during reconciliation;
6. `errored`/`terminated` fail immediately.

This avoids concurrent upload/backfill conversion for the same source and lets Workflow metadata, not timestamps alone, decide whether an existing derivative is current.

### Step 5 — `--check`

No Workflow mutations. Exit nonzero unless:

```text
selected sources missing/older bgm.m4a: 0
```

The stronger release proof is successful `--execute` immediately before `--check`.

### Step 6 — verify/commit

```bash
bun test src/scripts/backfill-bgm-m4a.test.ts
DTX_GRAPHQL_URL=https://api.pre-prod.dtx.hapadona.com/graphql bun run backfill:bgm-m4a
bun run check
git add src/scripts/backfill-bgm-m4a.ts src/scripts/backfill-bgm-m4a.test.ts package.json
git commit -m "feat(api): add BGM M4A reconciliation tool"
```

Default command is dry-run and creates no Workflow.

---

## Task 8: Production rollout and Virgo unblock gate

### Step 1 — final local verification

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

Expected: PASS. Reproduce any unrelated baseline failure on current `main`; do not weaken HPA-311 tests.

### Step 2 — forbidden-architecture diff gate

Confirm:

- no `.dtx`/authored asset rename;
- no `_generated/` staging protocol;
- no D1 migration/job table;
- no Queue/R2 event binding;
- no public generation route;
- no GraphQL schema/generated client change;
- `zipBuilder.ts` unchanged.

### Step 3 — deploy production

```bash
bun run deploy:api
```

### Step 4 — dry-run audit

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a
```

Record source filename histogram and missing/older count. Do not rename nonstandard filenames.

### Step 5 — reconcile every selected source

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
BGM_WORKFLOW_NAME=dtx-api-bgm-m4a \
  bun run --filter=dtx-api backfill:bgm-m4a --execute
```

Release requires every row to finish `ready` or `cached`. Rerun if any source becomes `superseded`; repair/re-upload if any row errors.

### Step 6 — visible catalog gate

```bash
DTX_GRAPHQL_URL=https://api.dtx.hapadona.com/graphql \
  bun run --filter=dtx-api backfill:bgm-m4a --check
```

Required:

```text
selected sources missing/older bgm.m4a: 0
```

### Step 7 — production contract sample

For one representative row:

- `Simfile.files` contains original authored source name and `bgm.m4a`;
- raw ZIP contains original authored source but not redundant generated M4A;
- generated object metadata points to the actual source key;
- public M4A initializes through Virgo `AVAudioPlayer`.

### Step 8 — record evidence and unblock HPA-85

Record in implementation PR + HPA-311:

```text
dtx-api tests/typecheck: PASS
Web E2E with local Containers disabled: PASS
Wrangler prod/pre-prod/prod-data dry runs: PASS
Container smoke: PASS
Pre-prod real Workflow + REST output contract: PASS
Pre-prod AVAudioPlayer/sync smoke: PASS
Production reconciliation outcomes: ready/cached only
Production selected sources missing/older M4A: 0
```

Only then remove HPA-311 as blocker for Virgo HPA-85.

---

## Completion checklist

- [ ] Historical authored audio names and `.dtx` references are untouched.
- [ ] Shared R2 helpers replace duplicate canonical-top-level/public-URL logic.
- [ ] One full-track source selector is reused by catalog, trigger, ZIP, and backfill.
- [ ] Virgo still receives one fixed `bgm.m4a` contract.
- [ ] Generated key is reserved; authored source uploads remain allowed when generation is off.
- [ ] Upload result includes R2 `uploaded` timestamp.
- [ ] Upload/backfill share one Workflow ID.
- [ ] Workflow has two steps and no staging object.
- [ ] Worker source/response paths are stream-only.
- [ ] Stale source cannot publish its completed conversion after the post-convert identity check.
- [ ] Routine local dev/Web E2E do not require Docker.
- [ ] Pre-prod Workflow executes before Task 7 REST polling code is finalized.
- [ ] Existing `downloads.test.ts` is extended, not replaced.
- [ ] Public GraphQL is used because it measures Virgo's visible catalog.
- [ ] Histogram is informational; there is no filename migration gate.
- [ ] Production reconciliation completes with ready/cached only.
- [ ] Production `selected sources missing/older bgm.m4a = 0`.
- [ ] Virgo HPA-85 remains separate and blocked until that gate passes.
