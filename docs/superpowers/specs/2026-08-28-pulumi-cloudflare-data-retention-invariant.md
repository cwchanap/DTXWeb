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

The infrastructure migration, `pre-prod-prod-data` retirement, rollback procedures, workflow changes, and later Pulumi reconciliation must preserve the identity and contents of all four resources.

This constraint is stronger than any weaker wording elsewhere in the design or implementation plan. If another step can reasonably be interpreted as allowing D1/R2 replacement, recreation, reset, cleanup, or deletion, this invariant wins and that step must be rewritten before execution.

## Required Pulumi protection

Every D1 database and R2 bucket in both stacks must use:

```typescript
{
	protect: true,
	retainOnDelete: true
}
```

`protect: true` blocks normal Pulumi deletion/replacement. `retainOnDelete: true` ensures that removing a resource from the Pulumi program does not delete the underlying Cloudflare data resource.

Neither option is permission to accept a replacement preview. **Any D1 or R2 create/replacement/delete in a migration or recurring preview is a hard stop.**

## Forbidden operations

This task must never intentionally perform any of the following against production **or pre-production** D1/R2:

- `pulumi destroy` for either stack;
- deleting a D1 database or R2 bucket in Cloudflare;
- replacing a D1 database or R2 bucket with a newly created resource;
- resetting or recreating pre-production data as part of the Pulumi migration;
- deleting or truncating D1 application data as an infrastructure-cleanup step;
- deleting R2 objects as an infrastructure-cleanup step;
- using `pre-prod-prod-data` retirement as justification to delete either the production or pre-production D1/R2 resources;
- accepting a preview that replaces or deletes either environment's D1/R2 resource;
- treating pre-production data as disposable simply because it is not production.

If a Pulumi import or declaration is wrong, fix **Pulumi state/program metadata only**. Use state-only recovery where appropriate; do not delete/recreate the live Cloudflare resource to make the program match.

## `pre-prod-prod-data` retirement boundary

Retiring `pre-prod-prod-data` may remove only resources that exist solely for that alias and contain no retained application data, specifically its alias Worker identities and alias-only KV namespace after the required soak and dependency checks.

It must **not** delete, recreate, clear, or repurpose:

- `dtx-web`;
- `dtx-web-preprod`;
- `simfile-dtx`;
- `simfile-dtx-preprod`.

The pre-production D1/R2 resources remain the permanent backing stores for the normal `pre-prod` environment after the alias is removed.

## Import and cutover gates

Before importing D1/R2 into Pulumi, record their existing Cloudflare identities privately. After import and after each relevant `pulumi up --refresh`, verify the same resources are still attached to the intended stack/environment.

For both pre-production and production:

1. import the existing D1 database; do not create a new one;
2. import the existing R2 bucket; do not create a new one;
3. add `protect: true` and `retainOnDelete: true` in source;
4. require a refreshed preview with no D1/R2 create, replacement, or delete;
5. after apply, verify the same database ID/name and bucket name are still in use;
6. perform representative read-only checks against existing D1 rows and R2 objects before considering the environment migrated.

A failure at any of these gates stops the migration before production proceeds.

## Rollback

Rollback must preserve data resources in place.

- Pulumi import/program mistake: remove or repair the Pulumi **state entry** as needed; leave the live D1/R2 resource untouched.
- Worker/domain regression: roll back the Worker/domain mapping; leave D1/R2 untouched.
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
- no implementation/cleanup step deletes D1 rows or R2 objects;
- `pre-prod-prod-data` cleanup is limited to alias-only Worker/KV resources;
- final refreshed Pulumi previews contain no D1/R2 create, replacement, or delete for either stack.
