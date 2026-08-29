# Pulumi-Managed Cloudflare Infrastructure Design

**Date:** 2026-08-28  
**Status:** Proposed  
**Repository:** `cwchanap/DTXWeb`

## Summary

DTXWeb will expand the existing `@dtx/infrastructure` Pulumi workspace from Cloudflare Access-only ownership to the source of truth for every **persistent Cloudflare resource with an independent lifecycle** that DTXWeb owns.

Pulumi will own the two permanent environments' Access applications, D1 databases, R2 buckets, Workers KV namespaces, Worker identities and account-level settings, Worker custom domains, and R2 public-access settings. The existing Pulumi Cloud stacks remain:

- `cwchanap/dtxweb-infrastructure/pre-prod`
- `cwchanap/dtxweb-infrastructure/production`

Wrangler remains the release engine for application code. It continues to build and upload Worker modules and static assets, apply D1 schema migrations, and publish version-coupled bindings, variables, Workflows, Durable Object migrations, and Container rollouts. Before a remote release, a small checked-in renderer reads non-secret Pulumi stack outputs and produces ignored Wrangler deployment files. This removes duplicated D1/KV IDs, bucket names, Worker names, public URLs, and domain ownership from the committed release configuration without recreating Wrangler's build pipeline in Pulumi.

The migration is import-first and pre-production-first. Existing data and Worker resources are adopted into the existing stacks; no D1 database, R2 bucket, Worker, or custom domain may be replaced. Every persistent resource is protected, and D1/R2 additionally use `retainOnDelete`.

The legacy `pre-prod-prod-data` Wrangler environment is retired. It is a mutable deployment alias that points the pre-production hostnames at production D1/R2 data, not a third infrastructure environment. Keeping it would leave hostname ownership split between Pulumi and Wrangler.

This design supersedes the Access-only ownership boundary in the existing Cloudflare Access specifications and runbooks. It does not change the current Access policy, protected paths, configured operator identity, or Perseus-owned posture rule.

## Context

`packages/infrastructure` currently creates only the two Cloudflare Access applications. Its automatic workflow deploys pre-production first, production second, through Pulumi Cloud OIDC. The Access resources are already protected and covered by runtime-mock, workflow-contract, and live-boundary tests.

The rest of the permanent Cloudflare topology is encoded in `packages/dtx-api/wrangler.jsonc` and `packages/dtx-web/wrangler.jsonc`:

- four permanent Worker identities and custom domains;
- two D1 databases;
- two R2 buckets;
- production and pre-production rate-limit KV namespaces;
- the web-to-API service bindings;
- public R2 URLs;
- Worker observability;
- API Workflow, Container, and Durable Object declarations;
- resource IDs copied into committed Wrangler configuration.

Wrangler currently mixes three concerns:

1. durable infrastructure identity;
2. Worker release metadata;
3. local-development topology.

That works, but it leaves the dashboard, Pulumi, and two Wrangler files as overlapping control planes. Resource IDs must be copied by hand, custom-domain drift is reconciled by whichever tool deploys last, and the `pre-prod-prod-data` alias can replace the Worker behind the same pre-production hostnames.

## Goals

- Make the two existing Pulumi stacks authoritative for all permanent DTXWeb-owned Cloudflare infrastructure.
- Preserve the existing Access applications and policies exactly.
- Adopt existing D1, R2, KV, Worker, Worker-domain, and R2 public settings without replacing stateful resources.
- Remove remote resource IDs and domain declarations from committed Wrangler configuration.
- Keep Wrangler for the deployment operations it already handles well: Worker code/assets, bindings, variables, Workflows, Durable Object migrations, Containers, and D1 schema migrations.
- Keep one root command per application/environment for manual deployment.
- Keep local development and Web E2E independent of Pulumi Cloud and remote Cloudflare data.
- Retain the current pre-production-before-production Pulumi deployment gate.
- Finish the migration in one implementation ticket and one pull request.

## Non-goals

- Reimplement Wrangler's Worker bundling, module upload, static asset upload, version creation, or release rollout in Pulumi.
- Manage D1 schema migrations through Pulumi.
- Move Worker secret values into Pulumi state or stack outputs.
- Manage Workflow instances, R2 objects, generated M4A files, release artifacts, or application data through Pulumi.
- Manage the Cloudflare account, the `hapadona.com` zone, the Perseus-owned posture rule, or other repositories' infrastructure.
- Add preview stacks, per-branch Cloudflare environments, a generic Pulumi component framework, a custom dynamic provider, or a second deployment orchestrator.
- Automate Worker application deployment in this ticket. Infrastructure applies remain automatic; Worker releases remain explicit commands.
- Redesign CORS, Worker observability, Access, authentication, caching, or the BGM Workflow. The migration preserves live behavior.
- Preserve `pre-prod-prod-data` compatibility.

## Decision

### Pulumi is the infrastructure control plane

A resource belongs to Pulumi when it can exist independently of one Worker build and must retain a stable identity across releases. That includes data stores, Worker identities, host-to-Worker mappings, Access policy, and bucket-level public settings.

### Wrangler is the Worker release engine

A setting remains in Wrangler when it is uploaded as part of a Worker version or must move atomically with the code defining it. Bindings and variables are therefore rendered into each deployment even though their target resource identities come from Pulumi.

This hybrid is intentional rather than transitional. Pulumi's current `Worker` resource manages Worker identity, observability, tags, and subdomain settings, while Wrangler remains the supported path for the code/assets/Workflow/Container release surface. Replacing Wrangler would add beta Worker version/deployment resources and custom Container image/rollout orchestration without improving DTXWeb's feature delivery.

## Ownership contract

| Concern | Final owner | Notes |
| --- | --- | --- |
| Access applications and inline policies | Pulumi | Existing resources and logical names remain unchanged. |
| D1 database identity and placement settings | Pulumi | Existing databases are imported; D1 schema remains Wrangler/application-owned. |
| R2 bucket identity and storage settings | Pulumi | Existing buckets are imported. Objects remain application data. |
| Workers KV namespace identity | Pulumi | Import the active production and pre-production namespaces. |
| Worker identity, observability, tags, and subdomain/preview state | Pulumi | Existing Workers are imported. Worker code is not managed here. |
| Worker custom domains | Pulumi | Use `cloudflare.WorkersCustomDomain`; remove `route` from Wrangler. |
| R2 CORS policy | Pulumi | Preserve the live policy exactly; no policy redesign. |
| R2 managed `r2.dev` state | Pulumi | Pre-production keeps its current public endpoint. |
| R2 custom domain | Pulumi | Production keeps `chart.hapadona.com`. |
| Worker code, modules, compatibility date/flags, and assets | Wrangler | Built and released from each application package. |
| D1/R2/KV/service bindings | Rendered Wrangler config | Binding names remain code-owned; target IDs/names come from Pulumi outputs. |
| Plain Worker variables | Rendered Wrangler config | Version-coupled application configuration. |
| Worker secret values | Wrangler/GitHub Environments | Never exported from Pulumi. |
| Workflow declaration and binding | Wrangler | Tied to the Worker class exported by the deployed version. |
| Durable Object binding and migration tags | Wrangler | Must move atomically with code. |
| Container image, instance type, and rollout | Wrangler | Cloudflare's Container deployment path owns the image and rollout. |
| D1 schema migrations | Wrangler | Run immediately before the API Worker deployment. |
| R2 objects and release artifacts | Existing application/release tooling | Data, not infrastructure. |
| Cloudflare account, zone, and Perseus posture rule | External references | DTXWeb consumes their IDs but does not own them. |

## Permanent environment model

Only two Pulumi environments exist.

| Stack | Web Worker | API Worker | Web hostname | API hostname | D1 | R2 |
| --- | --- | --- | --- | --- | --- | --- |
| `pre-prod` | `dtx-web-pre-prod` | `dtx-api-pre-prod` | `pre-prod.dtx.hapadona.com` | `api.pre-prod.dtx.hapadona.com` | `dtx-web-preprod` | `simfile-dtx-preprod` |
| `production` | `dtx-web` | `dtx-api` | `dtx.hapadona.com` | `api.dtx.hapadona.com` | `dtx-web` | `simfile-dtx` |

The stack files continue to hold `cloudflareAccountId`, encrypted `accessEmail`, and `devicePostureRuleId`. Add two non-secret settings:

- `cloudflareZoneId` — the existing `hapadona.com` zone;
- `rateLimitKvTitle` — the exact live title of that stack's active rate-limit namespace.

Do not commit database IDs, namespace IDs, Worker IDs, Worker-domain IDs, bucket IDs, or `r2.dev` generated hostnames as stack configuration. They become provider state and Pulumi outputs after import.

The Access contract stays:

- pre-production protects the entire `pre-prod.dtx.hapadona.com` hostname;
- production protects only `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`;
- one allow policy includes the configured email and requires the Perseus-managed posture rule;
- APIs and all other production routes remain outside Access.

## Pulumi program structure

Keep one TypeScript program and small resource-focused modules:

```text
packages/infrastructure/src/
├── access.ts
├── config.ts
├── data.ts
├── workers.ts
├── r2-public.ts
├── wrangler.ts
└── index.ts
```

No component-resource framework is needed. Each module exposes a pure argument builder for focused tests and one creation function for `index.ts`.

### `config.ts`

```typescript
export type StackName = 'pre-prod' | 'production';

export interface InfrastructureDefinition {
	stackName: StackName;
	webWorkerName: string;
	apiWorkerName: string;
	webHostname: string;
	apiHostname: string;
	databaseName: string;
	bucketName: string;
	publicSimfileBaseUrl: 'managed-r2' | 'https://chart.hapadona.com';
}

export const getInfrastructureDefinition = (stackName: string): InfrastructureDefinition => {
	// Return the closed two-stack table or reject before resource registration.
};
```

Hostnames, Worker names, D1 names, R2 names, and production public-domain intent stay in code. Account/zone IDs, Access identity, and the live KV title remain stack configuration.

### `data.ts`

Create exactly one D1 database, one R2 bucket, and one active rate-limit KV namespace per stack.

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

D1 and R2 use `STATEFUL_RESOURCE_OPTIONS`. KV uses `PERSISTENT_RESOURCE_OPTIONS`: its counters are disposable, but accidental namespace deletion should still be blocked.

### `workers.ts`

Create/import the web and API `cloudflare.Worker` identities with their current live observability configuration and disabled `workers.dev`/preview URLs. Create two `cloudflare.WorkersCustomDomain` mappings to the exact Worker names. Omit the deprecated `environment` field because pre-production already uses distinct Worker service names.

All four Workers and custom-domain resources use `protect: true`.

### `r2-public.ts`

Manage the bucket-level public surface:

- the exact existing CORS policy for each bucket, when one is present;
- `R2ManagedDomain(enabled: true)` for pre-production;
- `R2CustomDomain(domain: 'chart.hapadona.com', enabled: true)` for production.

These resources use `protect: true`. The implementation first exports the current live settings and codifies them byte-for-byte; it does not infer or broaden origins, methods, TLS settings, or ciphers.

### `index.ts`

`index.ts` remains the composition root. It loads the closed stack definition, stack configuration, Access resource, data resources, Worker resources, and R2 public resources. It exports:

```typescript
export interface WorkerDeploymentConfig {
	stack: StackName;
	web: {
		workerName: string;
		hostname: string;
		apiServiceName: string;
	};
	api: {
		workerName: string;
		hostname: string;
		databaseId: string;
		databaseName: string;
		bucketName: string;
		rateLimitKvNamespaceId: string;
		publicSimfileBucketUrl: string;
	};
}

export const workerDeploymentConfig: pulumi.Output<WorkerDeploymentConfig>;
```

This output is non-secret. Do not export Access IDs, email, posture-rule ID, API tokens, Worker secrets, or Pulumi ciphertext.

## Wrangler deployment configuration

### Checked-in configuration becomes local-first

The checked-in `packages/dtx-api/wrangler.jsonc` and `packages/dtx-web/wrangler.jsonc` remain useful for local development, type generation, and Web E2E. They retain:

- Worker entrypoints and compatibility settings;
- binding names and local resource names;
- API Workflow/Container/Durable Object declarations;
- application variables with local/test-safe defaults where required;
- web assets and local service binding shape.

They no longer contain:

- production or pre-production custom domains;
- remote D1 or KV IDs;
- `remote: true` data bindings;
- production/pre-production environment blocks;
- Pulumi-owned observability configuration;
- `pre-prod-prod-data`.

Local API development stops selecting the remote `pre-prod` environment. It uses local Miniflare D1/R2/KV state, matching Web E2E and preventing routine development from authenticating or writing against deployed resources.

### Generated remote configuration

Add `packages/infrastructure/src/wrangler.ts` plus `scripts/render-wrangler-config.ts`. The pure module accepts the checked-in local config and `WorkerDeploymentConfig`, then returns complete API and web deployment objects.

Generated files are ignored:

```text
.wrangler/generated/pre-prod/api.jsonc
.wrangler/generated/pre-prod/web.jsonc
.wrangler/generated/production/api.jsonc
.wrangler/generated/production/web.jsonc
```

The renderer must:

- inject the exact Worker name;
- inject D1 database ID/name, R2 bucket name, and KV namespace ID;
- inject the web-to-API service target;
- inject `PUBLIC_SIMFILE_BUCKET_URL`;
- preserve version-coupled variables, assets, Workflow, Container, Durable Object, and migration declarations;
- omit `route` and `routes`;
- set `workers_dev: false` and `preview_urls: false` so a Wrangler release cannot re-enable unintended public subdomains;
- reject missing/extra Pulumi fields and unsupported stacks;
- never write secrets or Pulumi stack state.

Cloudflare documents that Wrangler overwrites routes on deployment when route keys remain in its configuration. Removing those keys is therefore mandatory once Pulumi owns Worker custom domains. `workers_dev: false` is a release guard consistent with the Pulumi-owned Worker subdomain state.

### Deployment commands

Preserve the existing root command names:

```text
bun run deploy:api
bun run deploy:api:preprod
bun run deploy:web
bun run deploy:web:preprod
```

Each command renders the selected stack first. API deployment then applies that stack's D1 migrations and deploys the API Worker from the generated config. Web deployment builds SvelteKit and deploys the web Worker from the generated config.

Generated config creation must fail before Wrangler runs when Pulumi login, stack selection, output decoding, or file rendering fails.

## Retire `pre-prod-prod-data`

`pre-prod-prod-data` is removed from:

- both Wrangler files;
- API, web, and root package scripts;
- the API `RATE_LIMIT_ENV` union;
- configuration-contract tests;
- desktop development-topology tests;
- current M4A specification/plan statements that describe the alias as active.

The legacy alias Workers and alias-only KV namespace are inventoried before removal. After normal pre-production is verified:

1. confirm neither pre-production hostname routes to an alias Worker;
2. confirm the alias Workers have no custom domains, routes, schedules, or service consumers;
3. delete the alias Worker identities;
4. delete the alias-only rate-limit KV namespace.

Production D1 and R2 are never deleted or mutated by this cleanup. Importing disposable legacy resources solely to delete them would add state churn and risk, so this one-time decommission remains an explicit operator action recorded in the runbook.

## Existing-resource adoption

### Import-supported resources

The Pulumi Cloudflare provider supports import for:

- `cloudflare.D1Database`: `<account_id>/<database_id>`;
- `cloudflare.R2Bucket`: `<account_id>/<bucket_name>/<jurisdiction>`;
- `cloudflare.WorkersKvNamespace`: `<account_id>/<namespace_id>`;
- `cloudflare.Worker`: `<account_id>/<worker_id>`;
- `cloudflare.WorkersCustomDomain`: `<account_id>/<domain_id>`.

The implementation declares the final logical names first, then imports the matching live resources into those URNs. Every import is followed by `pulumi preview --refresh --expect-no-changes`. Any create, replacement, or delete for D1, R2, KV, Worker, or Worker custom domain is a hard stop.

Before D1 import, create a D1 backup/export and record only its private location. Never attach the export to the PR or workflow artifacts.

### R2 resources without import support

`R2BucketCors`, `R2ManagedDomain`, and `R2CustomDomain` currently do not support `pulumi import`.

For CORS and the managed `r2.dev` endpoint, Cloudflare exposes singleton PUT APIs. The implementation first records the exact live response, then runs a targeted pre-production Pulumi update using identical values. If the provider successfully performs an idempotent PUT, the resource becomes state-managed without disabling the endpoint. If Cloudflare returns a conflict, restore from the captured response through the API, delete only the singleton setting, and immediately repeat the targeted Pulumi update.

The production R2 custom domain uses an attach operation and therefore gets a controlled detach/re-attach cutover:

1. capture its current enabled state, zone ID/name, minimum TLS, ciphers, and health status;
2. remove only the `chart.hapadona.com` bucket attachment;
3. immediately run a targeted Pulumi update for `R2CustomDomain`;
4. wait until ownership and SSL status are active;
5. verify representative chart downloads and CORS headers.

The R2 bucket and its objects are untouched. A brief `chart.hapadona.com` maintenance window is acceptable for this hobby project and is simpler than introducing an unsupported custom provider or hand-editing Pulumi state.

## Deployment automation

Rename the existing workflow to `.github/workflows/deploy-cloudflare-infrastructure.yml` and generalize its tests and documentation.

Retain:

- push-to-`main` and manual recovery triggers;
- pre-production before production;
- production blocked by any pre-production failure;
- Pulumi Cloud OIDC;
- SHA-pinned actions;
- `pulumi up --refresh`;
- protected stack outputs;
- `cancel-in-progress: false`;
- existing Access boundary verification.

Reuse the existing GitHub Environment names and Pulumi OIDC subjects:

- `dtx-access-pre-prod`;
- `dtx-access-production`.

The names are historical, but reusing them avoids changing an already-working Pulumi OIDC trust policy. Documentation will state that they now gate the complete DTXWeb Cloudflare infrastructure stack.

Replace `CLOUDFLARE_ACCESS_API_TOKEN` with `CLOUDFLARE_INFRA_API_TOKEN` in both environments. The tokens are scoped to the DTXWeb account/zone and only the provider operations needed for Access, D1, R2, Workers KV, Worker identities/settings, and Worker custom domains. They do not receive API-token management, user management, billing, or Global API Key privileges.

The automatic workflow does not deploy Worker code or run D1 schema migrations. A Pulumi change can therefore be reviewed and applied independently of an application release.

After each stack apply:

- run the existing Access boundary matrix;
- verify the public API `/healthz` endpoint;
- verify the expected R2 public endpoint is reachable without DNS/TLS/5xx failure;
- confirm the Pulumi deployment output contains all expected non-secret resource identities.

## Validation strategy

### Unit and contract tests

- closed two-stack configuration table;
- pure D1/R2/KV/Worker/R2-public argument builders;
- constructor options prove protection and retention at the creation seams;
- Pulumi runtime mocks prove exact resource counts, logical names, types, dependencies, and exported deployment shape;
- Wrangler renderer fixtures prove no remote resource IDs or routes remain committed and generated configs contain every required release binding;
- renderer rejects unsupported stacks and incomplete Pulumi output;
- workflow contract keeps serial OIDC deployment and broader credential name;
- shell tests cover infrastructure HTTP verification without real network calls;
- repository search contract proves `pre-prod-prod-data` has no active code/config references.

### Pre-production live gate

- zero-unexpected-change Pulumi preview after import;
- targeted R2 public-setting adoption;
- API and web generated-config dry runs;
- remote D1 migration no-op/apply against the pre-production database;
- API deploy, health check, authenticated smoke, R2 read/write smoke, KV rate-limit smoke;
- web deploy and Access boundary matrix;
- BGM Workflow/Container smoke.

### Production live gate

Repeat the same sequence, then perform the controlled `chart.hapadona.com` attachment cutover and representative public download/CORS verification.

## Failure and recovery

- A preview showing D1/R2/Worker replacement or deletion stops the migration.
- `protect: true` blocks deletion/replacement during normal automation.
- `retainOnDelete: true` prevents a source-code/state mistake from deleting D1 or R2.
- A mistaken import is removed from Pulumi state only; the live resource is not deleted.
- D1 backup/export is required before production adoption.
- R2 CORS/domain settings are captured before any non-importable-resource cutover.
- The old Access workflow remains active until the generalized workflow and broader credentials pass pre-production.
- Worker releases continue using the old committed Wrangler path until generated configs pass dry-run and pre-production deployment.
- No automatic rollback or destroy is added. Recovery is a reviewed forward fix or explicit operator action.

## Rollout sequence

All work remains one implementation pull request. The PR stays draft while external adoption is in progress.

1. Add the final Pulumi declarations, tests, and outputs.
2. Import and verify pre-production data, Worker, domain, and R2 public resources.
3. Add and validate generated Wrangler deployment files; deploy pre-production API/web.
4. Generalize the workflow and validate its pre-production job.
5. Import and verify production resources.
6. Adopt production R2 settings and `chart.hapadona.com`.
7. Deploy production API/web through generated configs.
8. Remove `pre-prod-prod-data` code/config and decommission its disposable Worker/KV resources.
9. Run the complete validation matrix, update the runbook, and mark the PR ready.

## Acceptance criteria

- The existing Pulumi stacks manage Access, two D1 databases, two R2 buckets, two active KV namespaces, four Worker identities, four Worker custom domains, and the desired R2 public settings.
- D1 and R2 resources are protected and retained; every other persistent resource is protected.
- `pulumi preview --refresh --expect-no-changes` succeeds for both final stacks.
- No production or pre-production D1/KV IDs or Worker-domain declarations remain in committed Wrangler files.
- Generated Wrangler files are ignored, deterministic, secret-free, and pass API/web dry runs.
- Existing root deployment command names still deploy the selected API/web environment.
- Local development and Web E2E use local Miniflare data without Pulumi Cloud.
- `pre-prod-prod-data` has no active code/config/script references, alias Workers are gone, and its alias-only KV namespace is gone.
- API health, web behavior, Access boundaries, R2 public reads/CORS, KV use, D1 queries, service binding, BGM Workflow, and Container transcoding work in both environments.
- The automatic workflow applies pre-production before production and does not deploy Worker application code.
- No secrets, stack state, D1 backups, or R2-setting exports are committed or logged.

## Superseded documentation

This design supersedes only the following earlier decisions:

- `packages/infrastructure` manages Access applications only;
- Workers/D1/R2/KV/custom domains are permanent Wrangler-owned infrastructure;
- the deployment workflow and credential are Access-specific;
- `pre-prod-prod-data` remains an active deployment option.

The Access route/policy contract and the M4A Workflow/Container application design remain valid.

## Primary references

- [Cloudflare Wrangler configuration — source of truth and route ownership](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)
- [Pulumi Cloudflare `Worker`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/worker/)
- [Pulumi Cloudflare `WorkersCustomDomain`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/workerscustomdomain/)
- [Pulumi Cloudflare `D1Database`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/d1database/)
- [Pulumi Cloudflare `R2Bucket`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/r2bucket/)
- [Pulumi Cloudflare `WorkersKvNamespace`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/workerskvnamespace/)
- [Pulumi Cloudflare `R2BucketCors`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/r2bucketcors/)
- [Pulumi Cloudflare `R2ManagedDomain`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/r2manageddomain/)
- [Pulumi Cloudflare `R2CustomDomain`](https://www.pulumi.com/registry/packages/cloudflare/api-docs/r2customdomain/)
- [Cloudflare R2 CORS API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/cors/)
- [Cloudflare R2 domain API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/)
