# Pulumi-Managed Cloudflare Infrastructure Design

**Date:** 2026-08-28  
**Status:** Proposed  
**Repository:** `cwchanap/DTXWeb`

## Summary

DTXWeb will expand the existing `@dtx/infrastructure` Pulumi workspace beyond Cloudflare Access, but only for persistent resources where Pulumi can become the single owner without duplicating Wrangler's release semantics.

The two existing Pulumi Cloud stacks remain:

- `cwchanap/dtxweb-infrastructure/pre-prod`
- `cwchanap/dtxweb-infrastructure/production`

Pulumi owns, per stack:

- the existing Access application and policy;
- one D1 database;
- one R2 bucket;
- one active rate-limit Workers KV namespace;
- the web Worker custom domain;
- the API Worker custom domain.

Wrangler remains authoritative for Worker identity/releases, observability, code/assets, compatibility settings, bindings, variables, Workflows, Containers, Durable Object migrations, secrets, and D1 schema migrations.

This revision deliberately does **not** add a Wrangler config renderer. Production and pre-production remain ordinary named Wrangler environments with their existing checked-in IDs and release variables. The IDs are non-secret, already versioned, and protected resources should not be replaced during normal work. Keeping Wrangler's native environment semantics is simpler and avoids adding Pulumi Cloud as a runtime dependency of every Worker hotfix.

R2 CORS, the pre-production `r2.dev` managed domain, and production `chart.hapadona.com` remain unmanaged by Pulumi in this ticket. The production asset domain is not detached or recreated.

Routine local development becomes local-first. Today `dtx-api#dev:local` selects `--env pre-prod`, whose D1 and R2 bindings are explicitly remote. The migration changes the default Wrangler configuration to local-safe Miniflare resources while retaining named `production` and `pre-prod` environments for remote deployment.

`pre-prod-prod-data` is retired. It is a temporary alias deployment mode that can steal the same pre-production hostnames while binding production data; it is not a third infrastructure environment.

Before the first Pulumi import, the currently deployed Access-only GitHub Actions workflow must be disabled. Imported resources would otherwise exist in stack state while `main` still registers only Access, causing the old automated `pulumi up` to plan their deletion.

## Goals

- Make Pulumi authoritative for Access, D1, R2 bucket, active KV namespace, and Worker custom-domain identity in both permanent environments.
- Preserve the existing Access behavior exactly.
- Adopt existing Cloudflare resources with no D1/R2 replacement or data migration.
- Keep Wrangler's native environment model for all Worker release configuration.
- Remove Wrangler ownership of Worker custom domains after Pulumi imports them.
- Make `bun run dev` unable to write to remote pre-production D1/R2 through normal configuration.
- Provide a real local schema/data workflow rather than switching developers to an empty Miniflare database.
- Retire `pre-prod-prod-data` after a verified soak while preserving a rollback window beforehand.
- Generalize the existing Access verification/deployment machinery instead of adding parallel scripts/workflows.
- Complete the implementation under one implementation ticket and one implementation PR.

## Non-goals

- Manage `cloudflare.Worker`, Worker versions, or Worker deployments through Pulumi.
- Move Worker release variables into the infrastructure package.
- Generate Wrangler files from Pulumi outputs.
- Require Pulumi Cloud to deploy or roll back application Workers.
- Manage Worker observability, tags, tail consumers, code, or assets through Pulumi.
- Manage R2 CORS, R2 managed domains, or R2 custom domains through Pulumi in this ticket.
- Detach or recreate `chart.hapadona.com`.
- Manage D1 schema migrations through Pulumi.
- Put Worker secrets in Pulumi state or outputs.
- Rewrite historical dated specs/plans to match the new design.
- Add preview stacks, a component framework, a dynamic provider, automatic Worker deployment, automatic rollback, or automatic destroy.
- Preserve `pre-prod-prod-data` compatibility after cleanup.

## Reuse decisions

### Extend the existing closed stack table

`packages/infrastructure/src/access.ts` already owns a closed two-stack table and rejects unknown stack names. Do not create a second `config.ts` table.

Rename/generalize the existing stack definition in-place and extend it only with persistent infrastructure identity:

```typescript
export type StackName = 'pre-prod' | 'production';

export interface InfrastructureStackDefinition {
	stackName: StackName;
	applicationName: string;
	accessDomain: string;
	accessDestinations: AccessDestination[];
	webWorkerName: string;
	apiWorkerName: string;
	webHostname: string;
	apiHostname: string;
	databaseName: string;
	bucketName: string;
	rateLimitKvTitle: string;
}
```

The exact active KV title is captured once during import preparation and committed here because Pulumi needs it to manage the namespace. Worker variables, Workflow names, auth URLs, CORS values, and public R2 URLs stay in Wrangler.

### Reuse Wrangler environments

Wrangler already provides the closed per-environment release model, schema validation, and non-inheritable binding semantics. Keep that instead of reimplementing it in TypeScript.

After the local-first change, the files have this shape:

```text
top level      -> local development / Miniflare
[env.production] -> remote production Worker
[env.pre-prod]   -> remote pre-production Worker
```

Both remote environments explicitly set their Worker names so introducing a named production environment does not rename `dtx-api` or `dtx-web`.

All release-specific values remain with the applications:

- Better Auth URLs and cookie settings;
- CORS and GraphiQL;
- service bindings;
- Workflow names;
- production/pre-production D1/KV IDs;
- R2 bucket names/public URLs;
- Worker observability and compatibility metadata.

The remote environment blocks lose only `route`/custom-domain ownership once Pulumi owns the domains.

### Extend existing verification

Do not add a separate `verify-infrastructure.sh`. Extend `packages/infrastructure/scripts/verify-access.sh` and its existing shell test harness with:

- API `/healthz` checks;
- exact web/API hostname reachability;
- the existing Access boundary matrix.

The same script remains the live post-apply verifier.

### Reuse local E2E preparation

`packages/e2e-web/setup/prepare-stack.ts` already resets local Miniflare state, applies every D1 migration in lexical order, seeds deterministic D1 rows, and adds local R2 fixtures against database name `dtx-web`.

Expose it as an explicit `dev:seed` reset command rather than inventing a second seed path. Normal `bun run dev` should also run tracked **local** D1 migrations before starting services so a developer with existing local state receives new schema changes without resetting data.

## Ownership contract

| Concern | Final owner | Notes |
| --- | --- | --- |
| Access application/policy | Pulumi | Existing logical names and behavior unchanged. |
| D1 database identity | Pulumi | Imported, protected, retained on source removal. |
| R2 bucket identity | Pulumi | Imported, protected, retained on source removal. |
| Active rate-limit KV namespace | Pulumi | Imported and protected. |
| Web/API Worker custom domains | Pulumi | Imported `WorkersCustomDomain` resources. |
| Worker identity/release | Wrangler | No `cloudflare.Worker` resource. |
| Worker observability/compatibility | Wrangler | Avoid a two-writer loop. |
| D1/R2/KV/service bindings | Wrangler env blocks | IDs remain checked in; they are references, not secrets. |
| Worker variables | Wrangler env blocks | Application-owned release config. |
| Worker secrets | Wrangler/GitHub Environments | Never exported by Pulumi. |
| Workflow/Container/DO declarations | Wrangler | Version-coupled to Worker code. |
| D1 schema migrations | Wrangler | Applied before API deployment. |
| R2 CORS/public domains | Existing Cloudflare settings | Explicitly unmanaged in this ticket. |
| Cloudflare account/zone/posture rule | External references | DTXWeb consumes but does not create them. |

## Pulumi program

### Stack definition

Extend the current table in `access.ts`; do not add another configuration module. The Access builder consumes the Access fields, while `data.ts` and `domains.ts` consume the persistent resource fields.

`pre-prod-prod-data`, `preview`, and arbitrary stack names remain rejected before resource registration.

### `data.ts`

Create exactly one resource of each type per stack:

```text
cloudflare.D1Database
cloudflare.R2Bucket
cloudflare.WorkersKvNamespace
```

Resource options:

```typescript
export const STATEFUL_RESOURCE_OPTIONS = {
	protect: true,
	retainOnDelete: true
} as const;

export const PERSISTENT_RESOURCE_OPTIONS = {
	protect: true
} as const;
```

D1/R2 use `STATEFUL_RESOURCE_OPTIONS`; KV uses `PERSISTENT_RESOURCE_OPTIONS`.

Do not guess provider inputs. The declaration is finalized from the code emitted by CLI-first `pulumi import`, which reads the live resource and generates the corresponding TypeScript declaration. Pulumi imports protect resources by default. Any generated server-computed fields that are outputs rather than inputs are not copied back into constructor args.

### `domains.ts`

Create two protected `cloudflare.WorkersCustomDomain` resources using stable Wrangler-owned Worker service names:

```typescript
{
	accountId,
	zoneId,
	hostname: definition.webHostname,
	service: definition.webWorkerName
}

{
	accountId,
	zoneId,
	hostname: definition.apiHostname,
	service: definition.apiWorkerName
}
```

No Worker resource is registered.

### `index.ts`

Compose Access, data, and domains. Non-secret resource IDs may be exported for operator verification, but application deployment does not consume them.

The stack must register exactly:

```text
1 Access application
1 D1 database
1 R2 bucket
1 KV namespace
2 Worker custom domains
```

and no Worker or R2 public-domain/CORS resources.

## Wrangler environment model

### Local default

The checked-in top level becomes intentionally local-safe:

- API D1 database name remains `dtx-web`;
- D1/R2/KV are local Miniflare bindings with no `remote: true`;
- local URLs/cookie prefix/CORS are safe for `localhost`;
- `RATE_LIMIT_ENV` accepts `local`;
- GraphiQL is enabled;
- BGM M4A generation is disabled;
- Containers remain disabled for routine local development.

`dtx-api#dev:local` stops using `--env pre-prod`.

### Remote production and pre-production

Move the existing top-level production release contract into `env.production` and keep the existing `env.pre-prod` contract. Each named environment contains all non-inheritable bindings and vars required by Wrangler and explicitly pins the existing Worker name.

Remote deployment commands become explicit:

```text
wrangler deploy --env production
wrangler deploy --env pre-prod
```

and D1 migration commands use the same environment names.

After Worker custom-domain import succeeds, remove the `route` entries from both remote environments. Wrangler continues to publish everything else normally.

This keeps a production hotfix dependent only on Cloudflare/Wrangler credentials, not Pulumi Cloud.

## Local schema and seed workflow

Add two developer paths:

```text
migrate:local -> wrangler d1 migrations apply dtx-web --local --persist-to .wrangler/state
dev:seed      -> run packages/e2e-web/setup/prepare-stack.ts
```

Root `bun run dev` performs the tracked local migration before starting API/web/desktop. It does not wipe local state.

`bun run dev:seed` is an explicit deterministic reset: it reuses the existing E2E preparation path, which clears local state, reapplies all migrations, seeds rows, and adds R2 fixtures.

The verification gate must prove more than config shape: after `dev:seed`, the local D1 contains the seeded rows and `dtx-api#dev:local` reaches `/healthz` without remote bindings.

## Brownfield adoption

### One inventory, once

Before any import, capture privately:

- D1 IDs already present in Wrangler;
- KV IDs already present in Wrangler plus their live namespace titles;
- R2 bucket names and live jurisdiction required by the current provider import ID;
- Worker custom-domain IDs and current `service` targets;
- current Access application state.

Do not repeat the same inventory later.

### Disable automation first

Before importing the first new resource, disable `.github/workflows/deploy-cloudflare-access.yml` in GitHub Actions.

If the migration is abandoned before the branch program matches state, remove only the newly imported Pulumi **state entries** (never the Cloudflare resources), verify the Access-only preview is clean again, then re-enable the old workflow.

### Import before finalizing declarations

Use CLI-first `pulumi import` on the real target stack with generated code written to a private temporary file. The old workflow is disabled, so the temporary state/program mismatch cannot be auto-applied.

The current provider import shapes are:

```text
D1Database:          <account_id>/<database_id>
R2Bucket:            <account_id>/<bucket_name>/<jurisdiction>
WorkersKvNamespace:  <account_id>/<namespace_id>
WorkersCustomDomain: <account_id>/<domain_id>
```

Use the generated TypeScript as the source for which live input fields `data.ts`/`domains.ts` must declare. Add explicit `retainOnDelete` to D1/R2 and keep imported protection enabled.

Do not run `pulumi up` until the branch program registers every imported URN.

### Pre-production first

Import and reconcile pre-production before touching production.

A preview must contain no D1/R2/KV replacement or delete. If a pre-production custom domain currently points at `dtx-*-pre-prod-prod-data`, changing only its `service` to the permanent `dtx-*-pre-prod` Worker is an expected migration update, not a failure.

Apply that domain remap, then verify:

- API `/healthz`;
- web hostname Access interception;
- API remains public;
- authenticated trusted-device admission manually where applicable.

Keep alias Workers alive throughout the soak/production migration so the pre-production hostname can be restored if needed.

### Production second

Only after pre-production passes do the same D1/R2/KV/custom-domain imports for production.

No `chart.hapadona.com` detach/reattach occurs. A refreshed production preview must have no resource replacement/delete before apply.

Deploy the production API/web once with `route` removed from Wrangler so Wrangler no longer owns custom-domain mappings.

## Workflow automation

Generalize the existing workflow rather than creating a parallel deployment system:

```text
deploy-cloudflare-access.yml
-> deploy-cloudflare-infrastructure.yml
```

Retain:

- pre-production before production;
- Pulumi Cloud OIDC;
- `pulumi up --refresh`;
- non-cancelling concurrency;
- current Access boundary verification.

Broaden the Cloudflare credential from Access-only to exactly the D1/R2/KV/Workers Custom Domain permissions required by the Pulumi program, and rename the GitHub Environment secret to `CLOUDFLARE_INFRA_API_TOKEN`.

The workflow is enabled only after both permanent stacks have already been imported/reconciled with the branch program. Its first run on merged `main` must therefore be an ordinary refresh/update, not an import/create path.

## `pre-prod-prod-data` retirement

Remove the alias from:

- API/web Wrangler env blocks;
- API/web/root deployment and migration scripts;
- `RATE_LIMIT_ENV` type;
- config-contract and desktop topology tests.

Also remove the dead `packages/dtx-web` `deploy:preview` script because there is no `preview` Wrangler environment.

Do **not** delete alias Workers/KV immediately after the hostname remap. Keep them for a minimum **24-hour pre-production soak** after the permanent Workers have served the pre-production hostnames successfully.

After the soak and production verification:

1. confirm neither pre-production custom domain points at an alias Worker;
2. confirm no routes, schedules, service bindings, or other consumers reference the alias Workers;
3. delete the alias Workers;
4. delete the alias-only KV namespace;
5. record the cleanup in the runbook/PR checklist.

Production D1/R2 are never part of this deletion.

## Risks and rollback

### Expanded Pulumi state vs old workflow

**Risk:** the Access-only program on `main` would plan deletion of newly imported resources.  
**Mitigation:** disable it before import.  
**Rollback:** state-delete only the new imports, prove the Access-only preview is clean, then re-enable the old workflow.

### Pre-production domain remap

**Risk:** a hostname currently served by `pre-prod-prod-data` may regress when pointed back to the permanent Worker.  
**Mitigation:** import first, preview the service-only diff, keep alias Workers alive for at least 24 hours.  
**Rollback before alias deletion:** restore the custom-domain service to the alias Worker using the previously working configuration, verify `/healthz`/Access, then investigate before retrying.

### Production Worker deploy after route ownership removal

**Risk:** the first Worker deploy after route removal may expose an unrelated release/config regression.  
**Mitigation:** dry-run both environments and deploy pre-production first.  
**Rollback:** use `wrangler rollback --name dtx-api` and `wrangler rollback --name dtx-web` to return to the previous Worker versions; Pulumi-owned domain resources remain in place. This ticket does not change D1 schema, so it introduces no schema rollback dependency.

### Stateful replacement

**Risk:** an incorrect D1/R2 declaration could request replacement.  
**Mitigation:** import-generated declarations, `protect: true`, `retainOnDelete: true`, and a hard stop on any replacement/delete preview.  
**Rollback:** do not apply; correct the program from imported/live state.

### Local development behavior change

**Risk:** switching from remote pre-production to local Miniflare could appear broken with an empty schema.  
**Mitigation:** tracked local migration on normal dev startup plus explicit reusable `dev:seed` reset/fixtures.

### Alias deletion

**Risk:** deleting alias Workers/KV closes the fastest rollback path.  
**Mitigation:** delete only after the 24-hour soak, production verification, and dependency inventory. Git history remains the recovery source if the alias must later be recreated.

## Documentation scope

Update only current operational sources:

- `CLAUDE.md` deployment/development commands;
- `packages/infrastructure/README.md` ownership and workflow contract;
- the new infrastructure migration runbook;
- this new design/plan.

Leave older dated specs/plans/runbooks intact as historical records unless they are linked as the current operator procedure. The new design states what it supersedes without rewriting history.

## Validation

Code-level tests cover:

- the extended closed stack table and unsupported-stack rejection;
- D1/R2/KV constructor args and protection/retention;
- two protected custom-domain resources and absence of `cloudflare.Worker`;
- stack registration shape;
- top-level Wrangler config is local-only and contains no `remote: true`;
- production/pre-production envs preserve their existing Worker names, vars, bindings, Workflow/Container/DO contracts, and checked-in IDs;
- no remote env contains `route` after domain adoption;
- `pre-prod-prod-data` and dead `deploy:preview` scripts are gone;
- the generalized workflow keeps serial pre-prod -> production behavior;
- the extended verification script covers Access plus hostname/API health.

Live gates cover:

- local migration and seeded-row proof;
- pre-production import preview and domain-remap verification;
- 24-hour pre-production soak before alias deletion;
- production import preview;
- pre-production and production Wrangler dry runs/deployments without route ownership;
- post-deploy Access/API checks;
- final `pulumi preview --refresh --expect-no-changes` on both stacks.

## Implementation unit

This review proposed splitting the work into three PRs. The task remains one implementation PR because the project-level constraint is one PR per ticket/task unless explicitly approved otherwise.

The implementation is still sequenced into independent review gates inside that PR:

1. local development safety and local data path;
2. disable old automation + import-assisted Pulumi declarations;
3. pre-production adoption/verification;
4. production adoption/verification;
5. 24-hour soak and alias cleanup;
6. workflow/docs finalization and merge.

The first phase is intentionally code-only and can be reviewed/tested before any Cloudflare mutation, while the draft PR remains the single unit of delivery.
