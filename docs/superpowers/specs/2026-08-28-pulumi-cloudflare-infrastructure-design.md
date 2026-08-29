# Pulumi-Managed Cloudflare Infrastructure Design

**Date:** 2026-08-28  
**Status:** Proposed  
**Repository:** `cwchanap/DTXWeb`

## Summary

DTXWeb will expand the existing `@dtx/infrastructure` Pulumi workspace beyond Cloudflare Access, but only where Pulumi can become the **single safe owner** of a persistent resource without fighting Wrangler or requiring a risky brownfield cutover.

The two existing Pulumi Cloud stacks remain:

- `cwchanap/dtxweb-infrastructure/pre-prod`
- `cwchanap/dtxweb-infrastructure/production`

Pulumi will own, per stack:

- the existing Access application and inline policy;
- one D1 database;
- one R2 bucket;
- one active rate-limit Workers KV namespace;
- the web Worker custom domain;
- the API Worker custom domain.

Wrangler remains the Worker release engine and therefore owns Worker identities/releases, modules, assets, compatibility settings, observability, bindings, variables, Workflows, Durable Object migrations, Containers, secrets, and D1 schema migrations.

R2 CORS plus R2 managed/custom public-domain settings remain outside Pulumi in this migration. The provider cannot import `R2CustomDomain`, so moving `chart.hapadona.com` would require a visible detach/reattach cutover for no current product benefit. The existing public URLs become explicit per-stack release constants instead.

The checked-in Wrangler files become local-first and contain no production/pre-production environment blocks. A small renderer combines one closed per-stack release definition with two non-secret Pulumi output IDs and writes complete ignored remote configs at each application package root. Remote deploy commands continue to use Wrangler.

The legacy `pre-prod-prod-data` environment is retired. It is a hostname-stealing deployment alias, not a third infrastructure environment.

The migration is import-first and pre-production-first. Before the first import, the currently deployed Access-only GitHub Actions workflow must be disabled. This prevents the old Access-only Pulumi program on `main` from interpreting newly imported resources as deletions while the implementation pull request is still open.

## Goals

- Make Pulumi authoritative for the persistent DTXWeb resources that can be safely brownfield-adopted now.
- Preserve the existing Access applications and policy behavior exactly.
- Import existing D1, R2, KV, and Worker custom-domain resources without replacing stateful data.
- Remove copied remote D1/KV IDs and custom-domain ownership from committed Wrangler configuration.
- Keep all remote release variables and Workflow names in one closed per-stack definition rather than deriving them from local config.
- Make routine local development use local Miniflare D1/R2/KV instead of remote pre-production data.
- Keep Wrangler responsible for Worker release metadata and Container/Workflow deployment.
- Retire `pre-prod-prod-data` and its alias Workers/KV after the permanent pre-production Workers own the hostnames again.
- Preserve one root deploy command per app/environment.
- Complete the implementation in one implementation pull request.

## Non-goals

- Manage `cloudflare.Worker`, Worker versions, or Worker deployments through Pulumi.
- Manage Worker observability, tags, tail consumers, `workers.dev`, preview URLs, code, or assets through Pulumi.
- Manage R2 CORS, R2 managed domains, or R2 custom domains through Pulumi in this ticket.
- Detach or recreate `chart.hapadona.com`.
- Manage D1 schema migrations through Pulumi.
- Put Worker secret values in Pulumi state, outputs, or generated files.
- Manage Workflow instances, R2 objects, generated M4A files, release artifacts, or application data.
- Manage the Cloudflare account, `hapadona.com` zone, or Perseus-owned posture rule.
- Add preview stacks, a generic component framework, a dynamic provider, a second deployment orchestrator, or automatic Worker releases.
- Preserve `pre-prod-prod-data` compatibility.
- Add a `dev:remote-preprod` command unless a real need appears after local-first development lands.

## Why the first draft changes

### Do not import `cloudflare.Worker`

Wrangler already writes Worker observability and release settings on every deployment. Having Pulumi also own Worker settings creates a permanent two-writer reconciliation loop. Pulumi only needs the custom-domain resources to stop hostname ownership from moving during a Wrangler release.

The Worker service names remain stable constants in the closed stack definition and are referenced by `WorkersCustomDomain` and generated Wrangler files.

### Do not adopt R2 public-domain resources now

`R2CustomDomain` does not support normal Pulumi import. Detaching and reattaching the production chart domain would introduce user-visible risk solely to change control planes. CORS/public-domain management is deferred until there is an actual change that justifies a dedicated migration.

### Local config cannot be the source of remote values

Production and pre-production differ in cookie prefix/domain, CORS, GraphiQL, rate-limit environment, public API URLs, Workflow names, and service target. Once checked-in config becomes local-first, copying its values into a remote release would be incorrect.

One stack definition therefore owns both persistent resource names and remote release settings. Pulumi outputs add only live provider-generated IDs.

## Ownership contract

| Concern | Final owner | Notes |
| --- | --- | --- |
| Access applications and policies | Pulumi | Existing resources, names, and policy stay unchanged. |
| D1 database identity | Pulumi | Imported and protected; schema stays Wrangler-owned. |
| R2 bucket identity | Pulumi | Imported and protected; objects stay application data. |
| Active rate-limit KV namespace | Pulumi | Imported and protected. |
| Web/API Worker custom domains | Pulumi | Imported `WorkersCustomDomain` resources point at stable Wrangler-owned Worker names. |
| Worker identity and code release | Wrangler | No `cloudflare.Worker` resource. |
| Worker observability/tags/tails | Wrangler | Prevent a dual-writer loop. |
| `workers.dev` / preview URLs | Generated Wrangler config | Remote configs set them false. |
| D1/R2/KV/service bindings | Generated Wrangler config | Binding names stay code-owned; IDs/names come from closed definition + Pulumi output. |
| Plain Worker variables | Generated Wrangler config | Final remote values come from the closed stack definition. |
| Worker secrets | Wrangler/GitHub Environments | Never emitted by Pulumi. |
| Workflow declaration/name/binding | Generated Wrangler config | Per-stack Workflow name lives in the closed release definition. |
| Durable Object migrations | Wrangler | Must move with code. |
| Container image/config/rollout | Wrangler | Cloudflare release tooling owns it. |
| D1 schema migrations | Wrangler | Run before API Worker deployment. |
| R2 CORS | Existing Cloudflare setting | Explicitly unmanaged in this ticket. |
| R2 `r2.dev` / `chart.hapadona.com` | Existing Cloudflare setting | Explicitly unmanaged; public URLs are release constants. |
| Cloudflare account/zone/posture rule | External references | DTXWeb consumes IDs but does not own them. |

## Permanent environment and release model

Only two stacks exist.

```typescript
export type StackName = 'pre-prod' | 'production';

export interface ApiReleaseSettings {
	workflowName: string;
	vars: {
		BETTER_AUTH_URL: string;
		DTX_WEB_URL: string;
		GOOGLE_AUTH_CLIENT_ID: string;
		AUTH_COOKIE_DOMAIN: string;
		AUTH_COOKIE_PREFIX: string;
		RATE_LIMIT_ENV: 'prod' | 'pre-prod';
		GRAPHIQL: 'true' | 'false';
		CORS_ALLOWED_ORIGINS: string;
		PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false';
		PUBLIC_SIMFILE_BUCKET_URL: string;
		BGM_M4A_GENERATION_ENABLED: 'true';
	};
}

export interface WebReleaseSettings {
	vars: {
		PUBLIC_DTX_API_URL: string;
		PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false';
	};
}

export interface InfrastructureDefinition {
	stackName: StackName;
	webWorkerName: string;
	apiWorkerName: string;
	webHostname: string;
	apiHostname: string;
	databaseName: string;
	bucketName: string;
	rateLimitKvTitle: string;
	apiRelease: ApiReleaseSettings;
	webRelease: WebReleaseSettings;
}
```

The closed table contains the current final remote values for both stacks, including:

| Setting | Production | Pre-production |
| --- | --- | --- |
| API Worker | `dtx-api` | `dtx-api-pre-prod` |
| Web Worker | `dtx-web` | `dtx-web-pre-prod` |
| API hostname | `api.dtx.hapadona.com` | `api.pre-prod.dtx.hapadona.com` |
| Web hostname | `dtx.hapadona.com` | `pre-prod.dtx.hapadona.com` |
| D1 | `dtx-web` | `dtx-web-preprod` |
| R2 | `simfile-dtx` | `simfile-dtx-preprod` |
| Workflow | `dtx-api-bgm-m4a` | `dtx-api-bgm-m4a-preprod` |
| Auth cookie prefix | `dtx` | `dtx-preprod` |
| Rate-limit environment | `prod` | `pre-prod` |
| GraphiQL | `false` | `true` |
| API CORS | production web origin | pre-production web origin plus current localhost development origins |
| Public simfile URL | `https://chart.hapadona.com` | current existing `r2.dev` URL |
| Web public API URL | production API hostname | pre-production API hostname |

The exact current rate-limit KV titles and pre-production `r2.dev` URL are captured during the read-only inventory and then committed as non-secret constants in this table. IDs are not committed here.

Pulumi stack configuration remains limited to externally assigned or secret inputs:

- `cloudflareAccountId`;
- `cloudflareZoneId`;
- encrypted `accessEmail`;
- `devicePostureRuleId`;
- optional `accessSessionDuration` only when it differs from `12h`.

The rate-limit KV title is not Pulumi config; it is part of the closed stack definition.

## Pulumi program structure

```text
packages/infrastructure/src/
├── access.ts
├── config.ts
├── data.ts
├── domains.ts
├── wrangler.ts
└── index.ts
```

No component framework is introduced.

### `access.ts`

Keep the current Access code and logical resource names unchanged. `createAccessApplication()` already uses `protect: true`.

### `config.ts`

Own the closed two-stack table and reject every other stack name, including `pre-prod-prod-data`.

### `data.ts`

Create one resource of each type per stack:

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

D1 and R2 use `STATEFUL_RESOURCE_OPTIONS`. KV uses `PERSISTENT_RESOURCE_OPTIONS`.

Only live non-default D1/R2 fields observed during inventory are declared. Do not invent jurisdiction, placement, storage class, or replication settings.

### `domains.ts`

Create two protected `cloudflare.WorkersCustomDomain` resources per stack:

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

No Worker resource is registered by Pulumi.

### `index.ts`

`index.ts` composes Access, data resources, and custom domains. Export only the provider-generated IDs needed by the remote renderer:

```typescript
export interface WorkerDeploymentIds {
	stack: StackName;
	databaseId: string;
	rateLimitKvNamespaceId: string;
}

export const workerDeploymentIds: pulumi.Output<WorkerDeploymentIds>;
```

Bucket name, Worker names, hostnames, Workflow names, service targets, and variables come from `getInfrastructureDefinition(stack)`, not from outputs.

Do not export Access IDs, email, posture-rule ID, tokens, ciphertext, or stack state.

## Wrangler model

### Checked-in files are local-first

`packages/dtx-api/wrangler.jsonc` and `packages/dtx-web/wrangler.jsonc` become safe local/default configs.

The API checked-in config keeps:

- `name`, `main`, alias, compatibility settings;
- local D1 binding named `dtx-web` so existing E2E setup continues to target the same local database;
- local R2/KV bindings with schema-valid local-only IDs where required;
- no `remote: true`;
- no remote routes;
- local-safe URLs/CORS/cookie prefix;
- `RATE_LIMIT_ENV: "local"` and the corresponding TypeScript union extension;
- `GRAPHIQL: "true"`;
- `BGM_M4A_GENERATION_ENABLED: "false"`;
- Workflow/Container/Durable Object declarations needed by remote rendering, with local Containers disabled.

The web checked-in config keeps its entrypoint/assets/service shape but uses local API URL values and has no remote route/environment blocks.

Delete both `pre-prod` and `pre-prod-prod-data` Wrangler environment blocks. Remote deployments never select Wrangler environments after this migration.

### One renderer owns remote overlays

`src/wrangler.ts` accepts:

```typescript
renderApiRemoteConfig(localConfig, definition, ids)
renderWebRemoteConfig(localConfig, definition)
```

It must build complete remote configs that:

- set the exact remote Worker name;
- bind D1 using `definition.databaseName` plus `ids.databaseId`;
- bind R2 using `definition.bucketName`;
- bind KV using `ids.rateLimitKvNamespaceId`;
- replace API vars with `definition.apiRelease.vars`;
- set the API Workflow name from `definition.apiRelease.workflowName`;
- set the web service target to `definition.apiWorkerName`;
- replace web vars with `definition.webRelease.vars`;
- preserve the checked-in `main`, alias, compatibility, assets, Container, Durable Object, and migration structures;
- set `workers_dev: false` and `preview_urls: false`;
- omit `route`, `routes`, and `env` entirely;
- reject `pre-prod-prod-data` and any missing Pulumi ID;
- assert that local-only cookie prefixes, localhost-only remote values, or the local Workflow name do not leak into a remote output.

The renderer does not mutate checked-in files.

### Generated config location

Generated configs live at each application package root:

```text
packages/dtx-api/wrangler.remote.pre-prod.generated.jsonc
packages/dtx-api/wrangler.remote.production.generated.jsonc
packages/dtx-web/wrangler.remote.pre-prod.generated.jsonc
packages/dtx-web/wrangler.remote.production.generated.jsonc
```

Add these patterns to the appropriate gitignore files.

They intentionally do **not** live under `packages/infrastructure` or a nested `.wrangler/generated/` directory. Wrangler resolves project-relative paths from the config location. Keeping the generated file beside the checked-in file lets `main: "src/index.ts"`, `../common/...` aliases, `./container/...`, and `.svelte-kit/cloudflare` assets remain unchanged.

Remote commands run from the app package and pass only the generated filename to `--config`.

## Deployment commands

Preserve these root commands:

```text
bun run deploy:api
bun run deploy:api:preprod
bun run deploy:web
bun run deploy:web:preprod
```

Remove all `*:preprod:prod-data` commands.

A remote API deploy does:

```text
read selected Pulumi stack output
-> render API remote config at packages/dtx-api package root
-> apply selected D1 migrations with that generated config
-> wrangler deploy --config <generated-file>
```

A remote web deploy does:

```text
read selected Pulumi stack output
-> render web remote config at packages/dtx-web package root
-> build SvelteKit
-> wrangler deploy --config <generated-file>
```

Failure to log in to Pulumi, select the expected stack, decode the output, or render a complete config stops before Wrangler runs.

## Retire `pre-prod-prod-data`

Remove it from:

- API and web Wrangler files;
- package/root deploy and migration scripts;
- `RATE_LIMIT_ENV` type;
- configuration-contract tests;
- desktop development-topology tests;
- current docs that still describe it as an active environment.

Before deleting alias resources, inventory the two pre-production custom domains.

If a hostname currently points at `dtx-api-pre-prod-prod-data` or `dtx-web-pre-prod-prod-data`, that is an **expected migration state**, not an inventory failure. Import the custom domain, allow the one service-target update to the permanent Worker, apply it, then verify the permanent Worker before deleting the alias.

The one-time cleanup deletes only:

- alias Worker identities after they have no domains/routes/schedules/service consumers;
- the alias-only rate-limit KV namespace after confirming no permanent Worker binds it.

Production D1 and R2 are never deleted or modified by alias cleanup.

## Safe adoption sequence

### 1. Complete the implementation before touching live state

The implementation PR first contains the full Pulumi program, renderer, local-first configs, workflow replacement, tests, and runbook. No D1/R2/KV/custom-domain import occurs while those pieces are incomplete.

### 2. Disable the existing Access-only deployment workflow

Before the **first** import, disable `.github/workflows/deploy-cloudflare-access.yml` in GitHub Actions and verify it cannot run from `main` or `workflow_dispatch`.

Keep it disabled while the implementation PR is open and the remote Pulumi stacks contain resources that `main`'s Access-only `src/index.ts` does not register.

This is a hard gate. `protect` is defense in depth, not a substitute: the old program would still produce delete plans and fail automated Access deployment.

### 3. Import pre-production

Import into `cwchanap/dtxweb-infrastructure/pre-prod`:

- D1 database;
- R2 bucket;
- active KV namespace;
- web custom domain;
- API custom domain.

Use the provider's documented IDs:

```text
D1:                 <account_id>/<database_id>
R2:                 <account_id>/<bucket_name>/<captured_jurisdiction>
KV:                 <account_id>/<namespace_id>
WorkersCustomDomain:<account_id>/<domain_id>
```

`pulumi import` protects imported resources by default; source code also keeps protection enabled. D1/R2 source code adds `retainOnDelete`.

If either custom domain currently targets an alias Worker, the subsequent preview may contain exactly that `service` update to the permanent pre-production Worker. No D1/R2 replacement/delete or unrelated domain change is allowed.

Apply the expected domain remap, render/deploy the permanent pre-production API and web Workers, then verify:

- API `/healthz`;
- web hostname;
- existing Access protected/public route matrix;
- D1 read/write path;
- R2 read path;
- rate-limit KV path;
- BGM Workflow trigger/Container path.

### 4. Import production

Import production D1, R2, KV, and both Worker custom domains. Production custom domains should preview unchanged.

Do **not** manage or detach `chart.hapadona.com`; its existing R2 custom-domain configuration remains untouched.

Render/deploy the production API and web Workers, then repeat the live validation gate.

### 5. Delete alias resources

After permanent pre-production hostnames are verified, delete only the unused alias Workers and alias KV namespace.

### 6. Merge with matching state/program

Only merge after both stacks have been imported, both remote generated configs have been exercised, alias cleanup is complete, and the PR program previews without unexpected changes.

At merge time the old Access workflow is still disabled. The merged commit deletes it and adds the generalized infrastructure workflow, so there is never an enabled Access-only program against the expanded state.

Run or manually dispatch the new workflow immediately after merge and require pre-production success before production.

## Automatic Pulumi workflow

Replace `.github/workflows/deploy-cloudflare-access.yml` with `.github/workflows/deploy-cloudflare-infrastructure.yml`.

Keep:

- push to `main` for relevant infrastructure/lock/workflow changes;
- `workflow_dispatch` recovery entrypoint;
- pre-production before production;
- `needs: deploy-pre-prod`;
- Pulumi Cloud OIDC;
- the existing GitHub Environment names `dtx-access-pre-prod` and `dtx-access-production` so OIDC subjects do not change;
- `pulumi up --refresh`;
- `suppress-outputs: true`;
- non-cancelling concurrency;
- Access boundary verification.

Replace the Access-only Cloudflare token with `CLOUDFLARE_INFRA_API_TOKEN`, scoped only for the resources this program now owns: Access apps/policies, D1, R2 bucket identity, KV, and Workers custom domains. No R2 public-domain or DNS mutation permission is required for this ticket.

Add a small live infrastructure verifier that checks names/hostnames and API health without printing IDs or secret values.

## Testing

### Pure tests

- closed two-stack table and exact release settings;
- `pre-prod-prod-data` rejection;
- D1/R2/KV argument builders and resource options;
- custom-domain arguments and protection;
- stack registration contains Access + D1 + R2 + KV + two custom domains, and no `cloudflare.Worker`/R2 public resources;
- remote API renderer replaces local vars completely and uses the stack-specific Workflow name;
- remote web renderer sets the correct API service/URL;
- generated remote configs contain no routes/env blocks and disable `workers.dev`/preview URLs;
- renderer rejects missing IDs and local-only value leakage;
- package scripts no longer expose `pre-prod-prod-data`;
- checked-in local configs contain no `remote: true` or production/pre-production environment blocks;
- root `bun run dev` uses local-safe config and local D1 name `dtx-web`.

### Dry-run tests

For each generated API/web config:

```bash
wrangler deploy --dry-run --config <generated-file> --containers-rollout=none
```

The dry run must resolve existing source, alias, Container, and assets paths from the application package root.

### Live gates

For each stack:

- `pulumi preview --refresh` has no unexpected create/replace/delete;
- D1/R2/KV/domain resources are protected;
- D1/R2 are retained on source removal;
- custom domains point to permanent Workers;
- generated Wrangler deployment succeeds;
- API health and Access boundary checks pass;
- no secret or provider ID is printed by verification scripts.

## Acceptance criteria

The migration is complete when:

- the existing Access resources remain unchanged;
- each stack state contains one D1, one R2 bucket, one active rate-limit KV namespace, and two Worker custom domains;
- no `cloudflare.Worker`, R2 CORS, R2 managed-domain, or R2 custom-domain resource is registered by this program;
- D1 and R2 are both protected and retained;
- committed Wrangler files contain no production/pre-production D1/KV IDs, no custom routes, no `remote: true`, and no `pre-prod-prod-data`;
- local `bun run dev` cannot write to remote pre-production D1/R2 by configuration;
- remote renderer outputs exact per-stack vars and Workflow names from the closed definition;
- generated configs live beside each app's checked-in Wrangler file and pass dry runs without path rewriting;
- production `chart.hapadona.com` was never detached;
- permanent pre-production Workers own both pre-production hostnames;
- alias Workers/KV are removed only after that verification;
- the Access-only workflow was disabled before the first import and remained disabled until merge;
- the generalized infrastructure workflow succeeds pre-production before production after merge.

## Deferred follow-ups

These require a concrete need before implementation:

- Pulumi ownership of R2 CORS/public domains once the provider supports safe import or a domain change is required;
- a remote-pre-production local development command;
- Pulumi Worker identity/settings ownership if Wrangler stops owning those fields;
- a replacement for `pre-prod-prod-data` using a distinct no-domain Worker if production-data diagnostics become necessary again.
