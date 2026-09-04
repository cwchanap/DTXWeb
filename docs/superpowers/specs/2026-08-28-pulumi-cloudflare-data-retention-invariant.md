# Cloudflare D1 and R2 Data Retention Invariant

**Date:** 2026-08-28  
**Status:** Mandatory implementation constraint  
**Applies to:** `docs/superpowers/specs/2026-08-28-pulumi-cloudflare-infrastructure-design.md` and `docs/superpowers/plans/2026-08-28-pulumi-cloudflare-infrastructure.md`

## Hard invariant

**All existing D1 and R2 data must be retained in both production and pre-production.**

The following four resources are permanent data-bearing resources for this migration:

- production D1: `dtx-web`;
- pre-production D1: `dtx-web-preprod`;
- production R2: `simfile-dtx`;
- pre-production R2: `simfile-dtx-preprod`.

The infrastructure migration, local-development changes, `pre-prod-prod-data` retirement, rollback procedures, workflow changes, and later Pulumi reconciliation must preserve the identity and contents of all four resources.

If another instruction can reasonably be read as permitting replacement, recreation, reset, cleanup, truncation, object deletion, or automatic remediation of one of these resources, this invariant wins and that instruction must be corrected before execution.

## Required Pulumi protection

Every D1 database and R2 bucket in both stacks must use:

```typescript
{
	protect: true,
	retainOnDelete: true
}
```

`protect: true` blocks normal Pulumi deletion/replacement. `retainOnDelete: true` retains the provider resource if it is accidentally removed from the Pulumi program.

Neither option is permission to accept a destructive plan. **Any D1 or R2 create, replacement, or delete in a migration or recurring preview is a hard stop.**

## Drift must fail closed, never auto-remediate

Once D1/R2 are in the stack, recurring automation must detect provider drift before update:

```bash
pulumi refresh --preview-only --expect-no-changes --stack <stack>
pulumi up --stack <stack>
```

The recurring `pulumi up` must not use `--refresh`.

Pulumi documents `up --refresh` as drift remediation: it refreshes live state and then pushes the program's desired state back to the provider, and remediation can recreate resources. That behavior is incompatible with irreplaceable data stores.

If the preview-only refresh detects any drift or missing resource, stop before `pulumi up` and investigate manually. Do not automatically adopt, recreate, or reconcile missing D1/R2 resources.

## Wrangler must not auto-provision persistent resources

Current Wrangler can automatically provision missing D1/R2/KV bindings during deploy. Every remote Worker deploy or dry-run touched by this migration must therefore use:

```text
--no-x-provision
```

A missing R2 bucket must cause deployment failure, not creation of a new empty bucket with the same name.

The infrastructure cutover does not change D1 schema. Cutover Worker deploys must call `wrangler deploy` directly and must not invoke package deploy scripts that automatically run D1 migrations.

Normal future application releases may continue to run migrations intentionally, but their Wrangler deploy leg still uses `--no-x-provision`.

## Forbidden operations

This task must never intentionally perform any of the following against production **or pre-production** D1/R2:

- `pulumi destroy` for either stack;
- `pulumi state unprotect` on retained D1/R2;
- deleting a D1 database or R2 bucket in Cloudflare;
- replacing a D1 database or R2 bucket with a newly created resource;
- resetting or recreating pre-production data as part of the migration;
- deleting or truncating D1 application data as an infrastructure-cleanup step;
- deleting R2 objects as an infrastructure-cleanup step;
- using `pre-prod-prod-data` retirement as justification to delete either environment's D1/R2 resources;
- accepting a preview that creates, replaces, or deletes either environment's D1/R2 resource;
- using recurring `pulumi up --refresh` to remediate provider drift;
- allowing Wrangler automatic provisioning to recreate a missing retained resource;
- running D1 migrations merely to remove Wrangler route ownership;
- treating pre-production data as disposable.

If an import or declaration is wrong, fix Pulumi state/program metadata only. State-only recovery may remove an import entry from Pulumi state; it must never delete the live Cloudflare resource.

## `pre-prod-prod-data` retirement boundary

Retiring `pre-prod-prod-data` may remove only resources that exist solely for that alias and contain no retained application data: its alias Worker identities and alias-only KV namespace, after the required soak and dependency checks.

It must **not** delete, recreate, clear, truncate, reset, or repurpose:

- `dtx-web`;
- `dtx-web-preprod`;
- `simfile-dtx`;
- `simfile-dtx-preprod`.

The pre-production D1/R2 resources remain the permanent backing stores for normal `pre-prod` after the alias is removed.

## Import and cutover gates

Before importing D1/R2 into Pulumi, capture their existing Cloudflare identities privately. Also capture one representative pre-existing D1 row identifier and one representative pre-existing R2 object key plus stable object metadata for each environment. Do not commit these values.

For both pre-production and production:

1. import the existing D1 database; do not create a new one;
2. import the existing R2 bucket; do not create a new one;
3. add `protect: true` and `retainOnDelete: true` in source;
4. run `pulumi refresh --preview-only --expect-no-changes` and require zero provider drift;
5. require a source preview with no D1/R2 create, replacement, or delete;
6. after apply, verify the same D1 identity and R2 bucket identity are still in use;
7. verify the representative D1 row still exists;
8. verify the representative R2 object still exists with the captured identity metadata;
9. repeat the read-only probes after Worker/domain cutover and after alias cleanup.

A failure at any gate stops the migration before the next environment proceeds.

## Local-development reset boundary

`dev:seed` may reset only local Miniflare state under `.wrangler/state`. It must not use `--remote`, select a remote Wrangler environment, or target either permanent D1/R2 resource.

Local fixtures and local resets are never evidence that pre-production data is disposable.

## Rollback

Rollback must preserve data resources in place.

- Pulumi import/program mistake: remove or repair only the Pulumi state entry as needed; leave live D1/R2 untouched.
- Provider drift detected before update: stop and investigate; do not remediate automatically.
- Worker/domain regression: roll back Worker/domain mapping; leave D1/R2 untouched.
- Alias-retirement regression: recreate/repoint the alias Worker if needed; leave D1/R2 untouched.

There is no rollback procedure in this task whose solution is to recreate a D1 database, recreate an R2 bucket, or restore them from an empty state.

## Acceptance criteria

The infrastructure work cannot be considered complete unless all of the following are true:

- production D1 retains its original Cloudflare database identity and existing data;
- pre-production D1 retains its original Cloudflare database identity and existing data;
- production R2 retains the existing `simfile-dtx` bucket and its objects;
- pre-production R2 retains the existing `simfile-dtx-preprod` bucket and its objects;
- both D1 resources are protected and retained in Pulumi;
- both R2 resources are protected and retained in Pulumi;
- representative pre-existing D1 rows and R2 objects survive import, cutover, and cleanup;
- no implementation/cleanup step deletes D1 rows or R2 objects;
- recurring automation performs fail-closed drift detection before update and does not use `pulumi up --refresh`;
- remote Wrangler deploys use `--no-x-provision`;
- `pre-prod-prod-data` cleanup is limited to alias-only Worker/KV resources;
- final refreshed drift previews contain no D1/R2 drift for either stack;
- final source previews contain no D1/R2 create, replacement, or delete for either stack.
