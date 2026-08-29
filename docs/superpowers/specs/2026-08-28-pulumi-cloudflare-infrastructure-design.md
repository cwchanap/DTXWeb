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

Production and pre-production remain ordinary named Wrangler environments. There is no Wrangler config renderer and no Pulumi Cloud dependency on Worker deploy or rollback commands.

R2 CORS, the pre-production `r2.dev` managed domain, and production `chart.hapadona.com` remain outside Pulumi in this ticket. The production asset domain is never detached or recreated.

`pre-prod-prod-data` is retired only after the normal pre-production Workers have served the hostnames successfully for at least 24 hours. Alias cleanup is limited to alias Workers and the alias-only KV namespace.

## D1 and R2 retention — hard invariant

**All existing D1 and R2 data must be retained in both production and pre-production.**

These four resources are permanent and irreplaceable for this migration:

- production D1: `dtx-web`;
- pre-production D1: `dtx-web-preprod`;
- production R2: `simfile-dtx`;
- pre-production R2: `simfile-dtx-preprod`.

The migration must preserve both resource identity and existing contents. No task may delete, recreate, reset, truncate, clear, repurpose, or replace any of these four resources.

Every D1 and R2 resource uses:

```typescript
{
	protect: true,
	retainOnDelete: true
}
```

Any D1/R2 **create, replacement, or delete** in a Pulumi preview is a hard stop. `protect`/`retainOnDelete` are defense in depth, not permission to accept a destructive plan.

Before the first import, capture privately for each environment:

- D1 database ID;
- at least one representative existing D1 row identifier;
- R2 bucket name/jurisdiction;
- at least one representative existing R2 object key and metadata sufficient to prove it was not replaced.

Repeat read-only checks after each relevant Pulumi apply, after Worker/domain cutover, after alias cleanup, and at the final gate. The representative D1 row and R2 object must still exist.

The normative retention details are also recorded in `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-data-retention-invariant.md`.

## Ownership contract

| Concern | Final owner | Notes |
| --- | --- | --- |
| Access application/policy | Pulumi | Existing logical names and behavior unchanged. |
| D1 database identity | Pulumi | Existing resource imported; protected + retained. |
| R2 bucket identity | Pulumi | Existing resource imported; protected + retained. |
| Active rate-limit KV namespace | Pulumi | Existing resource imported and protected. |
| Web/API Worker custom domains | Pulumi | Existing `WorkersCustomDomain` resources imported. |
| Worker identity/release | Wrangler | No `cloudflare.Worker` resource. |
| Worker observability/compatibility | Wrangler | Avoid a two-writer loop. |
| D1/R2/KV/service bindings | Wrangler env blocks | Existing IDs/names stay checked in. |
| Worker variables | Wrangler env blocks | Application-owned release config. |
| Worker secrets | Wrangler/GitHub Environments | Never exported by Pulumi. |
| Workflow/Container/DO declarations | Wrangler | Version-coupled to Worker code. |
| D1 schema migrations | Wrangler | Application release concern; not run as part of this infrastructure cutover. |
| R2 CORS/public domains | Existing Cloudflare settings | Explicitly unmanaged in this ticket. |
| Cloudflare account/zone/posture rule | External references | DTXWeb consumes but does not create them. |

## Reuse decisions

### Extend the existing closed stack table

`packages/infrastructure/src/access.ts` already owns a closed two-stack table and rejects unknown stack names. Extend that table instead of creating `config.ts`.

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

Worker release variables, Workflow names, auth URLs, CORS values, and public R2 URLs stay in Wrangler.

### Reuse Wrangler environments

Wrangler already provides the environment model and schema validation. After the local-safety change:

```text
top level        -> local Miniflare only
env.production   -> remote production Worker
env.pre-prod     -> remote pre-production Worker
```

Each remote environment explicitly pins its Worker name and retains its existing non-secret bindings/variables. The remote environment blocks lose only custom-domain `route` ownership after Pulumi imports those domains.

### Extend the existing verifier

Extend `packages/infrastructure/scripts/verify-access.sh` rather than creating a parallel verifier. It continues to own the Access matrix and additionally checks public API `/healthz` for the selected environment.

## Local development

Normal `bun run dev` must never bind remote pre-production D1/R2.

The top-level Wrangler config is local-only and `dtx-api#dev:local` runs `wrangler dev --local`. The local D1 database name remains `dtx-web` so the existing E2E preparation can be reused.

Add:

```text
migrate:local -> apply tracked D1 migrations to .wrangler/state
dev:seed      -> reuse packages/e2e-web/setup/prepare-stack.ts
```

Normal dev applies local migrations without resetting data. `dev:seed` is the explicit local-only reset/fixture path. It must never use `--remote` or a remote Wrangler environment.

## Pulumi program

### `data.ts`

Create exactly one resource of each type per stack:

```text
cloudflare.D1Database
cloudflare.R2Bucket
cloudflare.WorkersKvNamespace
```

D1/R2 use `{ protect: true, retainOnDelete: true }`; KV uses `{ protect: true }`.

Do not guess provider inputs. Disable the old Access-only workflow first, then use CLI-first `pulumi import` to read the live resource and capture generated TypeScript privately. Copy only provider inputs needed to represent the existing resource; do not copy computed outputs.

### `domains.ts`

Create two protected `cloudflare.WorkersCustomDomain` resources using stable Wrangler-owned Worker service names. No `cloudflare.Worker` resource is registered.

### `index.ts`

Each stack registers exactly:

```text
1 Access application
1 D1 database
1 R2 bucket
1 KV namespace
2 Worker custom domains
```

No Worker, R2 CORS, R2 managed-domain, or R2 custom-domain resource is registered.

## Brownfield adoption

### Disable old automation before import

The current `deploy-cloudflare-access.yml` runs an Access-only program from `main`. Disable it before importing the first new resource. Keep it disabled until the implementation PR merges and the generalized workflow becomes authoritative.

If the migration is abandoned while stack state contains newly imported resources, remove only those new **state entries**, prove the Access-only preview is clean, then re-enable the old workflow. Never delete the live D1/R2 resources to repair state.

### One private inventory

Capture once:

- D1 IDs;
- KV IDs and titles;
- R2 bucket names/jurisdictions;
- Worker custom-domain IDs and current service targets;
- representative D1 row identifiers;
- representative R2 object keys/metadata;
- zone/account IDs.

Do not commit this inventory.

### Import-assisted declarations

Import pre-production first, then production. Use generated code to finalize `data.ts`/`domains.ts`.

A safe preview must contain no D1/R2/KV create, replace, or delete. For pre-production, a custom-domain service change from a `*-pre-prod-prod-data` Worker to the permanent `*-pre-prod` Worker is the only expected adoption update.

## Worker/domain cutover

After a safe Pulumi apply, remove the matching custom-domain `route` entry from the remote Wrangler environment and deploy the Worker again so Wrangler stops owning the hostname.

This infrastructure cutover does **not** change D1 schema. Therefore the cutover deployment must not run package deploy scripts that automatically apply D1 migrations. Deploy the Worker directly with Wrangler for this one cutover.

Every remote Wrangler deploy and dry-run in this migration uses `--no-x-provision`. Current Wrangler can automatically provision missing KV/R2/D1 bindings; disabling provisioning prevents a missing persistent resource from being silently recreated during a Worker deploy.

Normal application deploy scripts may continue to run D1 migrations, but their Wrangler deploy leg is updated to include `--no-x-provision`.

## Pulumi automation safety

The previous Access workflow used `pulumi up --refresh` to reconcile drift forward. That is not acceptable once the stack contains irreplaceable D1/R2 data: Pulumi documents `up --refresh` as drift remediation and remediation may recreate resources.

Each recurring stack job therefore runs:

```text
1. pulumi refresh --preview-only --expect-no-changes
2. pulumi up            # no --refresh
3. live boundary/data-retention verification
```

Step 1 is a fail-closed drift gate. If Cloudflare reports any out-of-band change or missing resource, the workflow stops before `up` and requires human investigation. It does not automatically adopt or remediate drift.

The subsequent `pulumi up` uses the already-recorded state and applies only reviewed program/config changes. Protected D1/R2 resources still block any replacement/delete planned by source changes.

## `pre-prod-prod-data` retirement

After the normal pre-production Workers have served the pre-production hostnames successfully for at least 24 hours, and production verification has passed, remove the alias configuration/scripts and delete only:

```text
dtx-api-pre-prod-prod-data
dtx-web-pre-prod-prod-data
alias-only rate-limit KV namespace
```

Immediately before deletion, prove those resources have no remaining domain, route, schedule, service-binding consumer, or operator dependency.

**Neither production nor pre-production D1/R2 is ever part of alias cleanup.** In particular, do not delete, reset, recreate, truncate, clear, or repurpose:

```text
dtx-web
dtx-web-preprod
simfile-dtx
simfile-dtx-preprod
```

## Risks and rollback

### Stateful drift or disappearance

**Risk:** an out-of-band deletion/change could be silently remediated into a new empty data resource.  
**Mitigation:** recurring `pulumi refresh --preview-only --expect-no-changes`, protected/retained D1/R2, and `--no-x-provision` on Wrangler deploys.  
**Rollback:** no automatic remediation. Stop and investigate; repair Pulumi state/program metadata only if the live retained resource still exists.

### Pre-production domain remap

**Risk:** a hostname currently served by an alias Worker may regress when pointed at the permanent Worker.  
**Mitigation:** import first, preview the service-only diff, keep alias Workers alive for at least 24 hours.  
**Rollback:** restore the custom-domain service to the captured alias Worker. D1/R2 remain untouched.

### Production Worker deploy

**Risk:** the first route-free Worker deploy can contain an unrelated release/config regression.  
**Mitigation:** dry-run with `--no-x-provision` and deploy pre-production first.  
**Rollback:** use `wrangler rollback` to restore the prior Worker version. D1/R2 and Pulumi-owned domains remain in place.

### Alias deletion

**Risk:** deleting alias Workers/KV closes the fast hostname rollback path.  
**Mitigation:** minimum 24-hour soak plus dependency inventory. D1/R2 are not alias resources and are never deleted.

## Validation

Code-level checks cover:

- closed two-stack resource identity;
- D1/R2 `{ protect: true, retainOnDelete: true }`;
- exactly two protected custom domains;
- absence of `cloudflare.Worker` and R2 public-resource ownership;
- local top-level Wrangler config has no remote bindings;
- production/pre-production env blocks keep existing IDs/vars/service names;
- remote deploy commands use `--no-x-provision`;
- no remote env contains `route` after domain adoption;
- `pre-prod-prod-data` and dead `deploy:preview` scripts are removed;
- generalized workflow performs drift detection before a non-refreshing `pulumi up`.

Live gates cover both environments:

- original D1 ID is unchanged;
- representative pre-existing D1 row still exists;
- original R2 bucket name/jurisdiction is unchanged;
- representative pre-existing R2 object still exists with the captured identity metadata;
- Pulumi refresh-preview reports no drift before automation/update;
- Pulumi preview contains no D1/R2 create/replace/delete;
- Access/API boundary checks pass;
- final refresh-preview drift gate is clean.

## Documentation scope

Update only current operational sources: `CLAUDE.md`, `packages/infrastructure/README.md`, the new migration runbook, and this new design/plan/retention invariant. Historical dated specs/plans remain historical records.

## Implementation unit

The work stays one implementation PR per the project task/PR constraint. The draft PR is sequenced through independent commits and operator gates: local-dev safety, pre-production import/cutover, production import/cutover, workflow hardening, 24-hour soak/alias cleanup, and final verification.