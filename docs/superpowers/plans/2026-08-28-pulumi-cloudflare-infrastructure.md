# Pulumi-Managed Cloudflare Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing DTXWeb Pulumi stacks from Access-only ownership to D1, R2 bucket, active KV namespace, and Worker custom-domain ownership while preserving every production and pre-production D1/R2 byte and keeping Wrangler as the Worker release engine.

**Architecture:** Extend the existing two-stack table in `access.ts`; do not add another configuration table or a Wrangler renderer. Wrangler keeps checked-in `production` and `pre-prod` environments, while top-level configuration becomes local-only. Disable the old Access workflow before import, use CLI-first imports to derive live resource inputs, adopt pre-production before production, and fail closed on any D1/R2 drift or replacement signal.

**Tech Stack:** Bun 1.3.9, TypeScript 5.8, Vitest 3, Bash, Pulumi Cloud, `@pulumi/pulumi` 3.258.0, locked `@pulumi/cloudflare` 6.19.0, Wrangler 4.123.0, GitHub Actions OIDC, Cloudflare Workers/D1/R2/KV/Access.

**Spec:** `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md`  
**Retention Invariant:** `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-data-retention-invariant.md`

## Global Constraints

- One implementation ticket, one implementation branch/worktree, one implementation pull request.
- Keep the pull request draft through all import/cutover/soak gates.
- Preserve Pulumi stacks `cwchanap/dtxweb-infrastructure/pre-prod` and `cwchanap/dtxweb-infrastructure/production`.
- Preserve the existing Access logical names, destinations, configured identity, Perseus posture requirement, and `12h` default.
- Extend the existing closed stack table in `packages/infrastructure/src/access.ts`; do not create `config.ts`.
- Do not add a Wrangler renderer, generated Wrangler files, or a Pulumi Cloud dependency to Worker deploy/rollback commands.
- Do not import/create `cloudflare.Worker`, `R2BucketCors`, `R2ManagedDomain`, or `R2CustomDomain` resources.
- Pulumi owns exactly one D1, one R2 bucket, one active rate-limit KV namespace, and two `WorkersCustomDomain` resources per stack in addition to Access.
- **Production and pre-production D1/R2 are permanent data stores.** The retained resources are exactly `dtx-web`, `dtx-web-preprod`, `simfile-dtx`, and `simfile-dtx-preprod`.
- Every D1/R2 resource uses `{ protect: true, retainOnDelete: true }`.
- Any D1/R2 create, replacement, or delete in a preview is a hard stop. Do not accept a destructive plan because protection would block it later.
- Never delete, recreate, reset, truncate, clear, or repurpose either environment's D1/R2 as part of import, rollback, alias retirement, or cleanup.
- Keep D1/KV IDs checked into remote Wrangler env blocks; they are non-secret references.
- Top-level Wrangler config is local-only; production and pre-production are explicit named environments.
- Normal local development must never use remote D1/R2 bindings.
- Remote Wrangler deploys/dry-runs in this ticket use `--no-x-provision` so missing persistent resources cannot be automatically provisioned.
- Infrastructure cutover Worker deploys do **not** run D1 migrations; this ticket changes no D1 schema.
- Disable the current Access-only GitHub Actions workflow before the first new Pulumi import and keep it disabled until the implementation PR merges.
- Recurring Pulumi automation detects drift with `pulumi refresh --preview-only --expect-no-changes` before `pulumi up`; recurring `pulumi up` must not use `--refresh`.
- Recurring Pulumi automation runs a fail-closed source preview gate between the drift refresh and `pulumi up` that rejects any D1/R2 stateful operation proposed by the checked-in program. `protect: true` blocks D1/R2 delete/replace but not a source-introduced create, and `pulumi/actions` runs `pulumi up --yes --skip-preview`, so the drift refresh alone cannot enforce the "any D1/R2 create/replace/delete is a hard stop" invariant.
- Adopt and validate pre-production before production.
- Keep alias Workers alive for at least 24 hours after the successful pre-production hostname remap.
- Alias cleanup may remove alias Workers/KV only; both production and pre-production D1/R2 remain untouched.
- Never detach/recreate `chart.hapadona.com`.
- Never print/commit Cloudflare tokens, Access email, posture-rule IDs, Pulumi stack exports, private API responses, representative data values, or secret values.
- Historical dated specs/plans are not rewritten; update only current operational docs named in Task 7.

---

## Task 1: Make normal local development fully local

**Files:**

- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/src/index.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Create: `packages/dtx-api/src/rest/localR2.ts`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/dtx-web/package.json`
- Modify: `packages/dtx-desktop/src/devTopology.test.ts`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**

- top-level API/web Wrangler config = local/default only;
- `env.production` = current production release contract;
- `env.pre-prod` = current pre-production release contract;
- `migrate:local` = tracked local D1 migration without reset;
- root `dev:seed` = deterministic local-only reset/seed via existing E2E preparation;
- local `PUBLIC_SIMFILE_BUCKET_URL` = `http://localhost:8787/local-r2`, served by a local-only R2 passthrough route registered only when `RATE_LIMIT_ENV === 'local'`, and pinned in `dev:local` via `--var` so `.env` cannot override it.

- [ ] **Step 1: Write RED topology tests**

Require:

```typescript
expect(apiPackage.scripts['dev:local']).not.toContain('--env pre-prod');
expect(apiPackage.scripts['dev:local']).toContain('wrangler dev --local');
expect(apiWrangler.d1_databases?.[0]).toMatchObject({
	binding: 'DB',
	database_name: 'dtx-web'
});
expect(apiWrangler.d1_databases?.[0]).not.toHaveProperty('remote');
expect(apiWrangler.r2_buckets?.[0]).not.toHaveProperty('remote');
expect(apiWrangler.env?.production?.name).toBe('dtx-api');
expect(apiWrangler.env?.['pre-prod']?.name).toBe('dtx-api-pre-prod');
expect(rootPackage.scripts['dev:seed']).toContain('packages/e2e-web/setup/prepare-stack.ts');
expect(apiWrangler.vars?.PUBLIC_SIMFILE_BUCKET_URL).toBe('http://localhost:8787/local-r2');
expect(apiPackage.scripts['dev:local']).toContain(
	'--var PUBLIC_SIMFILE_BUCKET_URL:http://localhost:8787/local-r2'
);
```

Run:

```bash
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
```

Expected: FAIL against the current remote-pre-prod local-dev contract.

- [ ] **Step 2: Restructure API Wrangler config**

Make top level local-safe. Keep API entrypoint/alias/compatibility, local D1 name `dtx-web`, local R2/KV bindings, local URLs/CORS/cookie prefix, `RATE_LIMIT_ENV: "local"`, GraphiQL enabled, BGM generation disabled, and Containers disabled for routine local dev. Set the local `PUBLIC_SIMFILE_BUCKET_URL` to `http://localhost:8787/local-r2` so catalog/preview URLs resolve to the local Miniflare bucket via the local-only R2 passthrough added in this task, not the remote pre-prod public bucket.

Move today's production values into `env.production` and explicitly set `name: "dtx-api"`. Keep today's pre-production values in `env.pre-prod` and explicitly set `name: "dtx-api-pre-prod"`.

For this task only, keep current route/custom-domain declarations in both remote environments; Pulumi does not own them yet.

Add a local-only R2 passthrough so seeded/local-only chart objects are reachable. Create `packages/dtx-api/src/rest/localR2.ts` exporting `routeLocalR2(env, key)` that streams `env.DTXFILE_BUCKET.get(key)` (404 when missing, `content-type` from `object.httpMetadata`). Wire it in `src/index.ts` under a `/^\/local-r2\/(.+)$/` pattern, registered **only** when `env.RATE_LIMIT_ENV === 'local'`, decoding each percent-encoded path segment and rejoining with `/` to recover the R2 key (matching `toPublicR2Url`'s encoding). It is never reachable in production or pre-production. Cover it in `src/index.test.ts`: streams an object, decodes encoded segments, 404 on missing, 405 on non-GET, and 404 outside the local environment.

- [ ] **Step 3: Restructure web Wrangler config**

Make top level local-safe. Add explicit remote environments:

```jsonc
"env": {
	"production": { "name": "dtx-web" },
	"pre-prod": { "name": "dtx-web-pre-prod" }
}
```

Preserve current production/pre-production vars and API service targets in their matching env blocks. Keep route ownership until Tasks 3/4.

- [ ] **Step 4: Update scripts and disable automatic remote provisioning**

API scripts must preserve normal migration-before-release behavior while hardening the deploy leg:

```json
"dev:local": "wrangler dev --local --env-file ../../.env --port 8787 --var AUTH_COOKIE_DOMAIN: --var BGM_M4A_GENERATION_ENABLED:false --var PUBLIC_SIMFILE_BUCKET_URL:http://localhost:8787/local-r2",
"migrate:local": "wrangler d1 migrations apply dtx-web --local --persist-to .wrangler/state",
"build": "wrangler deploy --dry-run --env production --outdir=dist --containers-rollout=none --no-x-provision",
"build:preprod": "wrangler deploy --dry-run --env pre-prod --outdir=dist --containers-rollout=none --no-x-provision",
"migrate:prod": "wrangler d1 migrations apply dtx-web --remote --env production",
"deploy:prod": "bun run migrate:prod && wrangler deploy --env production --no-x-provision",
"deploy:preprod": "bun run migrate:preprod && wrangler deploy --env pre-prod --no-x-provision"
```

Pin `PUBLIC_SIMFILE_BUCKET_URL` in `dev:local` via `--var` because `dev:local` loads `../../.env` and Wrangler lets env-file values override configured vars; `.env.example` contains `PUBLIC_SIMFILE_BUCKET_URL`, so the checked-in value is not authoritative unless the command pins it. Update `.env.example` to set `PUBLIC_SIMFILE_BUCKET_URL='http://localhost:8787/local-r2'` so the web client (which reads the workspace-root `.env` via Vite `envDir`) also resolves local chart URLs correctly.

Keep `pre-prod-prod-data` scripts temporarily; Task 6 removes them after the soak.

Web remote deploy scripts also add `--no-x-provision` and use explicit `production` / `pre-prod` environments.

Root scripts:

```json
"dev": "bun run migrate:api:local && turbo run dtx-api#dev:local dtx-web#dev:local-api dtx-desktop#dev:local-web",
"dev:all": "bun run migrate:api:local && turbo run dtx-api#dev:local dtx-web#dev:local-api dtx-desktop#dev:local-web @dtx/common#dev",
"dev:seed": "bun run packages/e2e-web/setup/prepare-stack.ts",
"migrate:api:local": "bun run --filter=dtx-api migrate:local"
```

- [ ] **Step 5: Extend the environment type**

Temporarily use:

```typescript
RATE_LIMIT_ENV: 'local' | 'prod' | 'pre-prod' | 'pre-prod-prod-data';
```

Task 6 removes the alias member.

- [ ] **Step 6: Prove local reset/migration is local-only**

```bash
bun run dev:seed
cd packages/dtx-api
bunx wrangler d1 execute dtx-web --local --persist-to .wrangler/state \
  --command 'SELECT COUNT(*) AS count FROM simfiles;'
```

Expected: count > 0.

Start `bun run dev:local` and verify `http://localhost:8787/healthz` returns `{"ok":true}`. No command may use `--remote` or `--env pre-prod` in the normal local path.

- [ ] **Step 7: GREEN and commit**

```bash
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
bun run --filter=dtx-api test -- src/index.test.ts
bun run --filter=dtx-api check
bun run --filter=dtx-web check
git add package.json packages/dtx-api packages/dtx-web packages/dtx-desktop/src/devTopology.test.ts
git commit -m "fix(dev): keep local API data local"
```

---

## Task 2: Disable old automation, capture retention baselines, and import pre-production

**Files:**

- Modify: `packages/infrastructure/src/access.ts`
- Modify: `packages/infrastructure/src/access.test.ts`
- Create: `packages/infrastructure/src/data.ts`
- Create: `packages/infrastructure/src/data.test.ts`
- Create: `packages/infrastructure/src/domains.ts`
- Create: `packages/infrastructure/src/domains.test.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Modify: `packages/infrastructure/src/index.test.ts`
- Modify: `packages/infrastructure/Pulumi.pre-prod.yaml`
- Modify: `packages/infrastructure/Pulumi.production.yaml`

- [ ] **Step 1: Disable the Access-only workflow before any import**

```bash
gh workflow disable deploy-cloudflare-access.yml --repo cwchanap/DTXWeb
gh workflow list --repo cwchanap/DTXWeb | grep 'Deploy Cloudflare Access'
```

Expected: disabled. Stop if it remains enabled.

Recovery before the expanded program matches state: remove only newly imported Pulumi state entries, prove the Access-only preview is clean, then re-enable the old workflow. Never delete a live D1/R2 resource to repair state.

- [ ] **Step 2: Capture one private inventory and retention baseline**

Create a private temp directory outside the repo. Capture without logging values:

```text
both D1 IDs
both KV IDs/titles
both R2 bucket names/jurisdictions
four Worker custom-domain IDs/current service targets
one representative existing D1 row identifier per environment
one representative existing R2 object key + stable metadata per environment
zone/account IDs
```

The current checked-in IDs to verify against the live account are:

```text
pre-prod D1: 6fedd126-9dcf-419f-bc2e-eaf8c23d9510
pre-prod KV: 449636182e7440e48a4361ed19822f6e
production D1: 19376000-d389-4e0e-a5a8-00d9e31a9ffb
production KV: b5ff0ae92972479a9e607818f05e15f8
```

Do not continue if the live resource identity disagrees with the checked-in environment.

- [ ] **Step 3: Add only the zone ID to stack config**

```bash
cd packages/infrastructure
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi config set cloudflareZoneId "$CLOUDFLARE_ZONE_ID" --stack cwchanap/dtxweb-infrastructure/production
```

Retain `secretsprovider: default`, encrypted `accessEmail`, and no `encryptionsalt`.

- [ ] **Step 4: Import existing pre-production resources only**

Use the live IDs from the private inventory with `pulumi import --out <private-file>` for:

```text
dtxweb-pre-prod-d1
dtxweb-pre-prod-r2
dtxweb-pre-prod-rate-limit-kv
dtxweb-pre-prod-web-domain
dtxweb-pre-prod-api-domain
```

Import the existing D1/R2; do not create replacements. Pulumi CLI imports are protected by default. Do not run `pulumi up` yet.

- [ ] **Step 5: Write RED tests from the imported resource shape**

Pin the pre-production identity and resource options:

```typescript
expect(getInfrastructureStackDefinition('pre-prod')).toMatchObject({
	stackName: 'pre-prod',
	webWorkerName: 'dtx-web-pre-prod',
	apiWorkerName: 'dtx-api-pre-prod',
	webHostname: 'pre-prod.dtx.hapadona.com',
	apiHostname: 'api.pre-prod.dtx.hapadona.com',
	databaseName: 'dtx-web-preprod',
	bucketName: 'simfile-dtx-preprod'
});
```

Constructor tests require:

```typescript
{ protect: true, retainOnDelete: true } // D1
{ protect: true, retainOnDelete: true } // R2
{ protect: true }                       // KV/domains
```

`index.test.ts` must capture exactly one Access, one D1, one R2, one KV, two custom domains, and no Worker/R2-public resources.

- [ ] **Step 6: Implement only imported provider inputs**

Use generated import code as the source for live input fields. Copy provider inputs only; do not copy computed outputs. Extend the existing stack table in `access.ts`; put D1/R2/KV resources in `data.ts` and custom domains only in `domains.ts`.

- [ ] **Step 7: Verify drift and source preview before apply**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
cd packages/infrastructure
pulumi refresh --preview-only --expect-no-changes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi preview --stack cwchanap/dtxweb-infrastructure/pre-prod
```

Expected: refresh-preview finds no provider drift; source preview contains no D1/R2/KV create/replace/delete. The only permitted update is an alias -> permanent `WorkersCustomDomain.service` change if inventory showed an alias currently owns the hostname.

- [ ] **Step 8: Commit**

```bash
git add packages/infrastructure
git commit -m "feat(infrastructure): adopt pre-prod Cloudflare data and domains"
```

---

## Task 3: Apply and cut over pre-production without touching D1 data

**Files:**

- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/infrastructure/scripts/verify-access.sh`
- Modify: `packages/infrastructure/scripts/verify-access.test.sh`

- [ ] **Step 1: Extend verifier tests**

Add API `/healthz` checks for both environments while preserving the existing Access matrix and fail-closed network behavior.

- [ ] **Step 2: Apply the reviewed pre-production Pulumi change**

Do not refresh/remediate during apply; Task 2 already performed the fail-closed drift check.

```bash
cd packages/infrastructure
pulumi up --stack cwchanap/dtxweb-infrastructure/pre-prod
```

Expected: D1/R2/KV unchanged; only the reviewed domain service change is allowed.

- [ ] **Step 3: Run retention probes immediately after apply**

Using the private baseline, require:

```text
same pre-prod D1 ID
representative pre-existing D1 row still exists
same pre-prod R2 bucket/jurisdiction
representative pre-existing R2 object still exists with captured metadata
```

Stop on any mismatch.

- [ ] **Step 4: Verify live pre-production boundary**

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
```

Perform the existing trusted-device positive Access admission check.

- [ ] **Step 5: Remove Wrangler route ownership and dry-run with provisioning disabled**

Remove `route` only from `env.pre-prod` in both Wrangler files. Keep every binding/var/workflow/container field unchanged.

```bash
bun run --filter=dtx-api build:preprod
cd packages/dtx-web
bun run build
bunx wrangler deploy --dry-run --env pre-prod --no-x-provision
```

- [ ] **Step 6: Deploy Workers directly, without D1 migrations**

Do **not** call `deploy:api:preprod` for this cutover because it applies D1 migrations.

```bash
cd packages/dtx-api
bunx wrangler deploy --env pre-prod --no-x-provision
cd ../dtx-web
bun run build
bunx wrangler deploy --env pre-prod --no-x-provision
cd ../..
packages/infrastructure/scripts/verify-access.sh pre-prod
```

Re-run the pre-production retention probes from Step 3.

- [ ] **Step 7: Commit and start soak**

```bash
git add packages/dtx-api/wrangler.jsonc packages/dtx-web/wrangler.jsonc \
  packages/infrastructure/scripts/verify-access.sh \
  packages/infrastructure/scripts/verify-access.test.sh
git commit -m "feat(infrastructure): cut pre-prod domains to Pulumi"
```

Start the minimum 24-hour soak. Keep alias Workers/KV alive.

---

## Task 4: Import and cut over production without touching D1 data

**Files:**

- Modify infrastructure builders/tests only if production import exposes a real input difference.
- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-web/wrangler.jsonc`

- [ ] **Step 1: Import existing production resources**

Using the private inventory, CLI-import the existing production D1/R2/KV/custom domains and capture generated code privately. Do not create new data resources.

- [ ] **Step 2: Reconcile real provider-input differences only**

If production import-generated inputs differ from pre-production, add the smallest stack-specific field to the existing definition/builder with a focused test. Never copy computed outputs.

- [ ] **Step 3: Require clean live drift and source previews**

```bash
cd packages/infrastructure
pulumi refresh --preview-only --expect-no-changes \
  --stack cwchanap/dtxweb-infrastructure/production
pulumi preview --stack cwchanap/dtxweb-infrastructure/production
```

Expected: no D1/R2/KV/domain create/replace/delete and no Access behavior diff.

- [ ] **Step 4: Apply without refresh remediation**

```bash
pulumi up --stack cwchanap/dtxweb-infrastructure/production
```

Run production retention probes immediately afterward: same D1 ID, representative row exists, same R2 bucket/jurisdiction, representative object still exists.

- [ ] **Step 5: Remove production Wrangler route ownership**

Remove `route` only from `env.production` in both Wrangler configs. Keep checked-in IDs, vars, service binding, Workflow, Container, DO, compatibility, and observability unchanged.

- [ ] **Step 6: Dry-run and deploy Workers directly with no migrations/provisioning**

```bash
bun run --filter=dtx-api build
cd packages/dtx-web
bun run build
bunx wrangler deploy --dry-run --env production --no-x-provision
cd ../dtx-api
bunx wrangler deploy --env production --no-x-provision
cd ../dtx-web
bunx wrangler deploy --env production --no-x-provision
cd ../..
packages/infrastructure/scripts/verify-access.sh production
```

Re-run the production retention probes.

If the Worker version regresses independently of infrastructure:

```bash
cd packages/dtx-api && bunx wrangler rollback --name dtx-api
cd ../dtx-web && bunx wrangler rollback --name dtx-web
```

- [ ] **Step 7: Commit**

```bash
git add packages/infrastructure/src packages/dtx-api/wrangler.jsonc packages/dtx-web/wrangler.jsonc
git commit -m "feat(infrastructure): cut production domains to Pulumi"
```

---

## Task 5: Generalize Pulumi automation and fail closed on drift

**Files:**

- Rename: `.github/workflows/deploy-cloudflare-access.yml` -> `.github/workflows/deploy-cloudflare-infrastructure.yml`
- Create: `packages/infrastructure/scripts/preview-gate.py`
- Create: `packages/infrastructure/scripts/preview-gate.sh`
- Create: `packages/infrastructure/scripts/preview-gate.test.sh`
- Modify: `packages/infrastructure/src/deploy-workflow.test.ts`
- Modify: `packages/infrastructure/README.md`
- Modify: `packages/infrastructure/package.json`

- [ ] **Step 1: Write RED workflow-contract tests**

Require two serial jobs, same stack names/OIDC/actions, `CLOUDFLARE_INFRA_API_TOKEN`, and this exact operation order per job:

```text
pulumi refresh --preview-only --expect-no-changes
scripts/preview-gate.sh <stack>     # source preview: reject D1/R2 stateful ops
pulumi up                 # no --refresh
verify-access.sh
```

Require the source preview gate step to appear once per job, ordered after the drift refresh and before `command: up`, and `CLOUDFLARE_INFRA_API_TOKEN` to be injected into the gate step. Reject `pulumi up --refresh`, `pulumi destroy`, `PULUMI_ACCESS_TOKEN`, and `PULUMI_CONFIG_PASSPHRASE`. The forbidden `command: preview` still holds because the gate runs `pulumi preview` via a shell script, not `pulumi/actions`'s `command: preview`.

- [ ] **Step 2: Add the source preview gate and rename/generalize workflow**

Add `packages/infrastructure/scripts/preview-gate.py` (reads `pulumi preview --json` from stdin, exits non-zero if any `cloudflare:index/d1Database:D1Database` or `cloudflare:index/r2Bucket:R2Bucket` step has a stateful `op` — anything other than `same`/`refresh`/`read`) and `preview-gate.sh` (runs `pulumi preview --json --suppress-outputs --stack <stack>` piped into the parser). Do **not** use `--expect-no-changes` in the gate because legitimate non-D1/R2 changes (e.g. an alias -> permanent `WorkersCustomDomain.service` update) must be allowed to proceed to `pulumi up`; only D1/R2 stateful ops are rejected. Add `preview-gate.test.sh` fixture tests and wire both bash tests into the infrastructure `test`/`test:coverage` scripts.

Insert a `Source preview gate (<environment>)` step between each job's drift refresh and `pulumi/actions up`, using `working-directory: packages/infrastructure` and `run: scripts/preview-gate.sh <stack>`, with `CLOUDFLARE_INFRA_API_TOKEN` injected. Preserve pre-prod -> production ordering, concurrency, locked actions, and infrastructure package tests/build.

Add a drift-detection step before each update using `pulumi refresh --preview-only --expect-no-changes`. Then run `pulumi up` **without refresh**. Any live drift stops automation instead of being remediated automatically.

- [ ] **Step 3: Prepare credentials**

In existing GitHub Environments `dtx-access-pre-prod` and `dtx-access-production`, add `CLOUDFLARE_INFRA_API_TOKEN` with minimum Access/D1/R2/KV/Workers Custom Domain permissions. Keep Environment names/OIDC subjects unchanged.

- [ ] **Step 4: GREEN and commit**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
git add .github/workflows packages/infrastructure/src/deploy-workflow.test.ts packages/infrastructure/README.md
git commit -m "ci(infrastructure): fail closed on Cloudflare drift"
```

Keep the old workflow disabled until merge.

---

## Task 6: Retire `pre-prod-prod-data` after soak, without touching retained data

**Files:**

- Modify: `packages/dtx-api/wrangler.jsonc`
- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-api/src/env.ts`
- Modify: `packages/dtx-api/src/index.test.ts`
- Modify: `packages/dtx-web/wrangler.jsonc`
- Modify: `packages/dtx-web/package.json`
- Modify: `packages/dtx-desktop/src/devTopology.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Require the 24-hour soak**

Confirm at least 24 hours have elapsed since Task 3 and no regression required restoring alias domains. Re-run both live verifiers and both environments' D1/R2 retention probes.

- [ ] **Step 2: Write RED cleanup assertions**

Require no `pre-prod-prod-data` env/scripts, no root prod-data deploy/migration scripts, no `deploy:preview`, and `RATE_LIMIT_ENV` narrowed to `'local' | 'prod' | 'pre-prod'`.

- [ ] **Step 3: Remove alias config/scripts**

Delete only the alias environment configuration and dead scripts. No D1/R2 binding in production or pre-production may change.

- [ ] **Step 4: Inventory alias dependencies**

Before deletion, confirm alias Workers have no custom domain, route, schedule, service-binding consumer, or operator use. Confirm the alias-only KV ID is neither the production nor permanent pre-production KV ID.

- [ ] **Step 5: Delete only alias Workers/KV**

Delete only:

```text
dtx-api-pre-prod-prod-data
dtx-web-pre-prod-prod-data
alias-only rate-limit KV namespace
```

**Forbidden during this step:** any operation against `dtx-web`, `dtx-web-preprod`, `simfile-dtx`, or `simfile-dtx-preprod`.

Immediately repeat both environments' retention probes after cleanup.

- [ ] **Step 6: GREEN and commit**

```bash
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-web check
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
git add package.json packages/dtx-api packages/dtx-web packages/dtx-desktop/src/devTopology.test.ts
git commit -m "chore(cloudflare): retire pre-prod prod-data alias"
```

---

## Task 7: Bound docs and run final retention/drift gates

**Files:**

- Modify: `CLAUDE.md`
- Modify: `packages/infrastructure/README.md`
- Create: `docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md`
- Keep historical dated specs/plans unchanged except this design/plan/retention invariant.

- [ ] **Step 1: Write current operator runbook**

Document ownership, local dev, workflow-disable/import recovery, retention probes, pre-prod-before-production cutover, `--no-x-provision`, no-migration cutover deploys, drift-detection-before-up automation, 24-hour alias soak, Worker rollback, and final gates.

- [ ] **Step 2: Update current docs only**

Update `CLAUDE.md` and `packages/infrastructure/README.md`. Do not rewrite older Access/M4A design history.

- [ ] **Step 3: Final live drift gate**

```bash
cd packages/infrastructure
pulumi refresh --preview-only --expect-no-changes \
  --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi refresh --preview-only --expect-no-changes \
  --stack cwchanap/dtxweb-infrastructure/production
pulumi preview --expect-no-changes --stack cwchanap/dtxweb-infrastructure/pre-prod
pulumi preview --expect-no-changes --stack cwchanap/dtxweb-infrastructure/production
```

No command here remediates drift.

- [ ] **Step 4: Final data-retention gate**

For both environments, verify from the private baseline:

```text
same D1 ID
representative pre-existing D1 row still exists
same R2 bucket name/jurisdiction
representative pre-existing R2 object still exists with captured metadata
```

Failure blocks merge.

- [ ] **Step 5: Final code/live validation**

```bash
cd ../../
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure check
bun run --filter=dtx-api test
bun run --filter=dtx-api check
bun run --filter=dtx-web test
bun run --filter=dtx-web check
bun run --filter=dtx-desktop test -- src/devTopology.test.ts
bun run lint
bunx prettier --check .
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

- [ ] **Step 6: Verify merge transition**

Before merge:

```text
old Access-only workflow disabled
new generalized workflow present
both stacks match branch program
both GitHub Environments contain CLOUDFLARE_INFRA_API_TOKEN
both environments pass retention probes
alias resources passed soak/cleanup
```

After merge, the generalized workflow's first `main` run must first pass the preview-only refresh drift gate, then perform a non-refreshing `pulumi up`.

- [ ] **Step 7: Commit docs**

```bash
git add CLAUDE.md packages/infrastructure/README.md \
  docs/superpowers/runbooks/2026-08-28-pulumi-cloudflare-infrastructure.md
git commit -m "docs(infrastructure): document retained Cloudflare ownership"
```

---

## Review findings disposition

- Local development using remote pre-production: accepted and moved to Task 1.
- Wrangler renderer/generated configs: removed; native Wrangler environments remain authoritative.
- Release variables in infrastructure: removed; application config stays in Wrangler.
- Local empty-database regression: handled by local migrations plus reused `dev:seed`.
- Resource declarations before import: import-generated declarations now precede final source inputs.
- Missing rollback/soak: explicit recovery and 24-hour soak gates added.
- Split into three PRs: not adopted because this project uses one PR per task unless explicitly approved.
- Historical doc rewriting: bounded to current operational docs.
- Dead `deploy:preview`: removed during alias cleanup.
- D1/R2 retention: elevated to a hard invariant for both production and pre-production.
- Recurring `pulumi up --refresh`: removed because it remediates drift; automation now detects drift and fails before a plain `pulumi up`.
- Wrangler automatic provisioning: disabled for all remote deploy/dry-run commands with `--no-x-provision`.
- Infrastructure cutover D1 migrations: removed; direct Worker deploy is used because this ticket changes no D1 schema.
- Local catalog/preview URLs 404 on seeded objects: local `PUBLIC_SIMFILE_BUCKET_URL` now points at a local-only R2 passthrough (`http://localhost:8787/local-r2`) registered only when `RATE_LIMIT_ENV === 'local'`, and is pinned in `dev:local` via `--var` so `.env` cannot override it.
- Recurring workflow skipping the source plan before apply: a fail-closed source preview gate (`scripts/preview-gate.sh`) now runs between the drift refresh and `pulumi up` for both stacks and rejects any D1/R2 stateful operation proposed by the checked-in program, closing the gap that `protect` and the drift refresh cannot.
