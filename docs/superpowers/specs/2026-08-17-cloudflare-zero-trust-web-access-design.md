# Cloudflare Zero Trust Web Access Design

## Summary

DTXWeb will manage its Cloudflare Zero Trust Access applications with a small Pulumi package modeled on the proven Perseus Access implementation.

The package owns **Access only**. Wrangler remains the owner of DTXWeb Workers, API deployment, D1, R2, service bindings, routes, runtime variables, and application secrets.

Production protects only exact `/app` plus descendants under `/app/`. This is intentionally an operator-only surface: the configured Access identity must match the intended operator and the request must satisfy the existing Perseus trusted-device posture rule. Production `/login`, `/auth/*`, the rest of the public web site, and both API hostnames remain outside Access.

Pre-production protects the entire `pre-prod.dtx.hapadona.com` web hostname. It is always previewed and proven before production is applied.

DTXWeb does not create another serial-number list or device-posture rule. Perseus remains the owner of trusted-device membership; DTXWeb consumes the existing Perseus posture-rule resource ID as Pulumi configuration.

The infrastructure code, tests, CI wiring, and Pulumi previews are implementation work. **Live `pulumi up`, live acceptance, and rollback/destroy are operator-executed runbook procedures, not agent implementation-plan steps.**

## Goals

- Manage DTXWeb Cloudflare Access declaratively with Pulumi rather than dashboard-created configuration.
- Follow the proven Perseus `ZeroTrustAccessApplication` + inline policy shape where it applies.
- Reuse the existing Perseus device-posture rule ID instead of duplicating its serial list or posture rule.
- Make production `/app` and production desktop login intentionally operator-only behind Cloudflare Access.
- Keep production `/`, `/blog`, `/preview/*`, `/editor`, `/tool/*`, `/game`, `/login`, `/auth/*`, and other intended public routes outside Access.
- Require Cloudflare Access for every route served by `pre-prod.dtx.hapadona.com`.
- Keep `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` outside Access.
- Preserve Supabase authentication as an independent inner gate after Access allows a request.
- Use separate `pre-prod` and `production` Pulumi stacks so rollout and rollback are environment-specific.
- Make stack name determine hostname/path scope so ordinary config cannot accidentally broaden production Access.
- Wire `@dtx/infrastructure` into the repository's fail-closed affected-scope CI and coverage workflow.
- Reuse DTXWeb's current TypeScript/Vitest/Node type major versions instead of importing Perseus's newer JS test toolchain.
- Keep one checked-in runbook as the live operator source of truth for preview, apply, verification, emergency fallback, and rollback.

## Non-Goals

- Migrate DTXWeb Worker or API deployment from Wrangler to Pulumi.
- Manage D1, R2, KV, Workers, routes, service bindings, runtime environment variables, or application secrets with Pulumi in this slice.
- Create or manage the shared trusted-device serial-number list in DTXWeb.
- Create a DTXWeb-specific device-posture rule.
- Add a Pulumi `StackReference` dependency on the Perseus stack.
- Protect the entire production `dtx.hapadona.com` hostname.
- Protect either API hostname.
- Make production `/app` available to every Supabase user.
- Add a public logout route or change the current non-operator recovery behavior.
- Replace Supabase authentication.
- Add Worker-side validation of `CF_Authorization` or Access JWTs.
- Add Cloudflare Access service tokens, Service Auth policies, CLI applications, or Managed OAuth.
- Copy Perseus's CLI/service-token/Worker/storage resources.
- Make pre-production an unattended E2E target.
- Add GitHub Actions deployment of Pulumi resources.
- Let an agent execute live `pulumi up` or `pulumi destroy` as part of the implementation plan.
- Change code under `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop`.

## Existing Context

### DTXWeb routing and deployment

`packages/dtx-web/wrangler.jsonc` deploys the production web Worker to `dtx.hapadona.com` and pre-production to `pre-prod.dtx.hapadona.com`. The GraphQL API uses separate hostnames: `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com`.

`packages/dtx-web/src/hooks.server.ts` currently treats any pathname beginning with `/app` as Supabase-authenticated. The intended private route family for this design is narrower: exact `/app` or descendants under `/app/`. Production Access therefore protects `/app` and `/app/*`.

Any new private production page must live at `/app` or below `/app/`, or this Access design must be revised before shipping it. The broader `pathname.startsWith('/app')` application guard must not be used to justify new `/app...` sibling-style routes.

### Desktop authentication

Desktop login begins on public `/login` and completes through `/app?redirect=desktop...`. Password and Google OAuth both return through the protected `/app` handoff.

Standalone `bun run dev:desktop` consumes `VITE_DTX_SERVER_URL` from the ignored root `.env`; in the current operator setup this targets production. Full local-stack `bun run dev` instead uses `dtx-desktop#dev:local-web` and localhost.

After this Access change, authentication against deployed production or pre-production is operator-only. Non-operator contributors use the full local stack or a separately designed ungated development environment.

### Non-operator production lockout

A non-operator Supabase user can authenticate on public `/login` and then be denied by Access when the browser returns to `/app`.

If they now hold a Supabase session, revisiting `/login` redirects them back to `/app`, while the current sign-out control is inside the protected application layout. Clearing the Drumery/Supabase cookies for the production origin is the documented recovery. A public logout route is a separate product/code decision.

### Perseus precedent

Perseus already manages Cloudflare Access with `@pulumi/cloudflare`. Its browser-admin application uses `ZeroTrustAccessApplication`, an email `Include` rule, a device-posture `Require` rule, a `12h` default session, and hardened application/cookie flags.

Perseus owns the trusted-device serial-number list and posture rule and exports `adminAccessDevicePostureRuleId`. DTXWeb reuses that existing Cloudflare rule ID as config.

Perseus's CLI application, service token, `non_identity` policy, Worker resources, storage resources, and deployment workflows solve different requirements and are not copied.

### Existing CI contract

`.github/scripts/ci-affected-scope.sh` validates every Turbo package against a hardcoded fail-closed package allowlist and separately decides whether unit tests are affected.

Adding `@dtx/infrastructure` without updating that script would make an infrastructure-only PR fail as an unknown package. The package must also participate in `unit_affected`, because `.github/workflows/unit-test.yml` only installs dependencies and runs unit coverage when that detector returns `true`.

The unit workflow runs root `bun run test:coverage`. Therefore `@dtx/infrastructure` must expose `test:coverage`, not only `test`.

`.github/scripts/ci-affected-scope.test.sh` and its JSON fixtures are the existing contract tests for this fail-closed detector and must gain infrastructure coverage.

### Existing operator precedent

`docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md` explicitly marks interactive/live Cloudflare steps as operator-executed. This design keeps that boundary: agents may author/test the Pulumi program and produce previews when credentials/config are already available, but live Cloudflare mutations and human browser/device observations stay in the runbook.

## Architecture

### Infrastructure workspace

Add:

```text
packages/infrastructure/
├── .gitignore
├── Pulumi.yaml
├── package.json
├── README.md
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── access.ts
    ├── access.test.ts
    └── index.ts
```

The root workspace list adds `packages/infrastructure`.

The package is intentionally Access-only. It contains no Worker build/deploy logic and no storage resources.

### Toolchain

Reuse the Pulumi provider floors already proven in Perseus:

- `@pulumi/pulumi` `^3.144.0`
- `@pulumi/cloudflare` `^6.13.0`

Align development tooling with DTXWeb instead of Perseus:

- TypeScript `^5.8.3`
- Vitest `^3.1.4`
- `@vitest/coverage-v8` `^3.0.0`
- `@types/node` `^20.11.25`

Do not introduce Vitest 4, TypeScript 5.9, or Node type major 22 merely because Perseus currently uses them.

`packages/infrastructure/package.json` exposes only repository-safe scripts such as `build`, `check`, `test`, and `test:coverage`. Do not add unscoped `pulumi:up`, `pulumi:destroy`, or `pulumi:preview` scripts that operate on whichever stack happens to be selected.

Operational docs invoke the Pulumi CLI directly and always name `--stack`.

### Pulumi project and supported stacks

`Pulumi.yaml` defines:

```yaml
name: dtxweb-infrastructure
runtime: nodejs
description: DTXWeb Cloudflare Access infrastructure managed by Pulumi
main: dist/index.js
```

One program supports exactly:

- `pre-prod`
- `production`

Any other `pulumi.getStack()` value fails before a Cloudflare resource is registered.

### `pre-prod` stack

Creates exactly one `ZeroTrustAccessApplication` named `DTXWeb Pre-prod` for:

```text
pre-prod.dtx.hapadona.com
```

No API hostname is included.

### `production` stack

Creates exactly one `ZeroTrustAccessApplication` named `DTXWeb Production App` with exactly:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

Hostname and destinations are code-owned, not Pulumi configuration.

### Pulumi configuration

Both stacks require:

- `cloudflareAccountId` — plain config.
- `accessEmail` — Pulumi secret config.
- `devicePostureRuleId` — plain config containing the existing Perseus-managed rule ID.
- `accessSessionDuration` — optional; defaults to `12h`.

DTXWeb does not use `StackReference`. If Perseus replaces its posture rule and the Cloudflare ID changes, the operator updates `devicePostureRuleId` in both DTXWeb stacks before the next preview/apply.

### Access resource construction

`src/access.ts` owns pure builders plus one resource factory.

Reuse these Perseus browser-application flags:

```ts
{
  appLauncherVisible: false,
  allowAuthenticateViaWarp: false,
  enableBindingCookie: true,
  httpOnlyCookieAttribute: true,
  pathCookieAttribute: false
}
```

Each Access application has one inline policy:

- name: `Allow configured operator on trusted device`
- decision: `allow`
- precedence: `1`
- `includes`: configured email identity
- `requires`: configured existing posture-rule ID

No posture/list/token resource is created by DTXWeb.

### Local state and config

Follow the same local-backend operating model as Perseus, but document it accurately.

`pulumi login --local` is equivalent to a filesystem backend rooted at the operator's home directory, with default state under `~/.pulumi`. Stack config files created in the project (`Pulumi.<stack>.yaml`) are ignored and not committed.

`packages/infrastructure/.gitignore` includes at least:

```text
Pulumi.*.yaml
.pulumi/
node_modules/
dist/
.env
.env.local
```

The `.pulumi/` ignore is defensive for explicitly project-local filesystem backends; it is not a claim that `pulumi login --local` stores default state in the repository.

Because state is local-machine-owned, the runbook must include both normal Pulumi rollback and an emergency Cloudflare dashboard delete/disable path if state/backend access is unavailable.

## CI Integration

Task implementation must update:

- `.github/scripts/ci-affected-scope.sh`
- `.github/scripts/ci-affected-scope.test.sh`
- `.github/scripts/fixtures/turbo-infrastructure.json`

The detector allowlist gains:

```text
@dtx/infrastructure:packages/infrastructure
```

`@dtx/infrastructure` also sets `unit_affected=true`.

The detector tests add an infrastructure-only fixture and assert:

- `unit` => `true`
- `lint` => `true`

`@dtx/infrastructure` defines:

```json
"test:coverage": "vitest --run --coverage"
```

so the existing root `bun run test:coverage` workflow executes the Access unit tests.

No new CI workflow is needed.

## Protection Matrix

| Surface | Access |
| --- | --- |
| `dtx.hapadona.com/app` | Protected |
| `dtx.hapadona.com/app/` | Protected; verify explicitly |
| `dtx.hapadona.com/app/*` | Protected |
| Production routes outside `/app` | Public |
| `pre-prod.dtx.hapadona.com/*` | Protected |
| `api.dtx.hapadona.com/*` | Outside Access |
| `api.pre-prod.dtx.hapadona.com/*` | Outside Access |

Production verification includes real public examples `/`, `/blog`, `/preview/1`, `/editor`, `/tool/dtx-to-midi`, `/game`, `/login`, and `/auth/callback`.

## Testing And Implementation Gates

### Unit tests

`src/access.test.ts` tests pure builders without contacting Cloudflare.

At minimum:

- pre-prod is hostname-wide and never includes the API hostname;
- production destinations are exactly `/app` and `/app/*`;
- unsupported stack names throw;
- malformed/multiple email values throw;
- blank account ID and posture-rule ID throw;
- the policy uses the normalized email in `includes`;
- the policy references the supplied posture-rule ID in `requires`;
- default session duration is `12h`;
- hardened flags match the approved values;
- production cannot become hostname-wide through config.

### CI contract tests

Run `.github/scripts/ci-affected-scope.test.sh` and prove infrastructure-only changes select the unit gate rather than failing closed or skipping unit coverage.

### Repository checks

Run:

```bash
bun install
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure test:coverage
.github/scripts/ci-affected-scope.test.sh
```

Then run the relevant root checks if practical.

### Pulumi preview gate

Before any live apply, the operator or an authenticated implementation environment runs explicit-stack previews.

Pre-prod preview must show only one `DTXWeb Pre-prod` Access application.

Production preview must show only one `DTXWeb Production App` and exactly `/app` plus `/app/*` destinations.

A preview showing a hostname-wide production app, API destination, new posture/list resource, service token, or unrelated resource is a hard stop.

**The implementation plan ends at tested code, rewritten runbook, and successful/non-run preview evidence. It does not contain `pulumi up` or `pulumi destroy` execution steps.**

## Operator Runbook Boundary

`docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md` is marked operator-executed.

It owns:

1. Pulumi local-backend login and stack/config setup.
2. Obtaining the current Perseus posture-rule ID.
3. Explicit-stack previews.
4. `pulumi up --stack pre-prod`.
5. Pre-prod HTTP/browser/posture acceptance.
6. Only after pre-prod is green, `pulumi up --stack production`.
7. Production route, identity, posture, browser, session-expiry, bundled desktop, and standalone Tauri-dev acceptance.
8. Normal stack-specific rollback.
9. Emergency Cloudflare dashboard disable/delete when Pulumi state/backend access is unavailable.

Agents may prepare or verify non-mutating artifacts, but live applies/destroys and human browser/device observations are operator actions.

## Rollback

### Normal Pulumi rollback

For the affected stack, the operator first reviews:

```bash
pulumi preview --destroy --stack <pre-prod|production>
```

The preview must show exactly one deletion: the corresponding DTXWeb Access application.

Then the operator may run:

```bash
pulumi destroy --stack <pre-prod|production> --yes
```

### Emergency fallback without usable state

If the local Pulumi backend/state is unavailable and immediate Access removal is necessary, the operator uses Cloudflare Zero Trust dashboard controls to disable/delete the named application:

- `DTXWeb Pre-prod`, or
- `DTXWeb Production App`.

Do not create a bypass policy, service token, API Access app, or broader route as an emergency workaround.

If Pulumi state later becomes available after a manual provider-side deletion, reconcile it before any future `pulumi up` (for example through the appropriate refresh/import/recovery procedure) rather than blindly applying stale state.

## Repository Changes

Expected implementation changes:

- `package.json`
- `bun.lock`
- `.github/scripts/ci-affected-scope.sh`
- `.github/scripts/ci-affected-scope.test.sh`
- `.github/scripts/fixtures/turbo-infrastructure.json`
- `packages/infrastructure/.gitignore`
- `packages/infrastructure/Pulumi.yaml`
- `packages/infrastructure/package.json`
- `packages/infrastructure/tsconfig.json`
- `packages/infrastructure/vitest.config.ts`
- `packages/infrastructure/src/access.ts`
- `packages/infrastructure/src/access.test.ts`
- `packages/infrastructure/src/index.ts`
- `packages/infrastructure/README.md`
- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- `docs/superpowers/plans/2026-08-17-cloudflare-zero-trust-web-access.md`

No application/API/desktop source files change.

## References

Repository precedent:

- Perseus `packages/infrastructure/src/admin-access.ts`
- Perseus `packages/infrastructure/src/admin-access.test.ts`
- Perseus `packages/infrastructure/src/index.ts`
- Perseus `packages/infrastructure/Pulumi.yaml`
- Perseus `packages/infrastructure/package.json`
- DTXWeb `.github/scripts/ci-affected-scope.sh`
- DTXWeb `.github/scripts/ci-affected-scope.test.sh`
- DTXWeb `.github/workflows/unit-test.yml`
- DTXWeb `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`

Current Pulumi local-backend and recovery behavior should be verified against Pulumi's official state/backend and destroy-troubleshooting documentation during implementation.