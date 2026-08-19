# Cloudflare Zero Trust Web Access Design

## Summary

DTXWeb will manage its Cloudflare Zero Trust Access applications with Pulumi, using the same Cloudflare provider and Access-resource shape already proven in Perseus, while keeping the DTXWeb slice deliberately narrower.

Production protects only `/app` and its descendants. This is intentionally an operator-only surface: the configured Access identity must match the intended operator and the request must satisfy the existing Perseus trusted-device posture rule. Other Supabase users may still reach public `/login`, but they cannot enter production `/app` or complete desktop login against production.

Pre-production protects the entire `pre-prod.dtx.hapadona.com` web hostname. It is deployed and verified first. Production is not applied until the pre-production Access stack passes the documented identity, posture, browser-auth, and route-boundary checks.

DTXWeb gets a small `packages/infrastructure` workspace that owns only the two Access applications. Existing Worker/API deployment remains on Wrangler. This slice does not migrate Workers, D1, R2, service bindings, secrets, or runtime deployment into Pulumi.

DTXWeb does not create another serial-number list or device-posture rule. Perseus remains the owner of trusted-device membership; DTXWeb consumes the existing Perseus posture-rule resource ID as Pulumi configuration.

## Goals

- Manage DTXWeb Cloudflare Access declaratively with Pulumi rather than manual dashboard configuration.
- Follow the proven Perseus Access implementation shape where it applies.
- Reuse the existing Perseus device-posture rule ID instead of duplicating its serial list or rule.
- Make production `/app` and production desktop login intentionally operator-only behind Cloudflare Access.
- Keep the production public site outside Access, including `/`, `/blog`, `/preview/*`, `/editor`, `/tool/*`, `/game`, `/login`, and `/auth/*`.
- Require Cloudflare Access for every route served by `pre-prod.dtx.hapadona.com`.
- Preserve Supabase authentication as an independent inner gate after Access allows a request.
- Keep `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` outside Access.
- Make pre-production and production separate Pulumi stacks so rollout and rollback are environment-specific.
- Make the stack name determine the hostname and protection scope so ordinary configuration cannot accidentally broaden production Access.
- Roll out pre-production first, then production only after the pre-production gate and auth round-trip are verified.
- Verify the Access identity `Include` clause independently from the device-posture `Require` clause.
- Keep the existing operator runbook as the durable acceptance/rollback procedure, updated to use Pulumi preview/apply instead of dashboard clicks.

## Non-Goals

- Migrate DTXWeb Worker or API deployment from Wrangler to Pulumi.
- Manage D1, R2, KV, Workers, routes, service bindings, runtime environment variables, or application secrets with Pulumi in this slice.
- Create or manage the shared trusted-device serial-number list in DTXWeb.
- Create or manage a second DTXWeb-specific device-posture rule.
- Add a Pulumi `StackReference` dependency on the Perseus stack.
- Protect the entire production `dtx.hapadona.com` hostname.
- Protect either API hostname.
- Make production `/app` available to every Supabase user.
- Add a public logout route or otherwise change the current non-operator recovery behavior in this slice.
- Replace Supabase authentication.
- Add Worker-side validation of `CF_Authorization` or Access JWTs.
- Add Cloudflare Access service tokens, Service Auth policies, CLI applications, or Managed OAuth.
- Copy Perseus's admin CLI/service-token resources.
- Make pre-production an unattended E2E target in this slice.
- Add GitHub Actions deployment for the new Pulumi package in this slice.
- Change SvelteKit, GraphQL API, or desktop application code.

## Existing Context

### DTXWeb routing and deployment

`packages/dtx-web/wrangler.jsonc` deploys the production web Worker to `dtx.hapadona.com` and pre-production to `pre-prod.dtx.hapadona.com`. The web application uses separate API hostnames: `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com`.

`packages/dtx-web/src/hooks.server.ts` currently treats any pathname beginning with `/app` as Supabase-authenticated. The intended private route family for this design is narrower: exact `/app` or descendants under `/app/`. Production Access therefore protects `/app` and `/app/*`.

This dependency is an operating invariant: any new private production page must live at `/app` or below `/app/`, or the Access design must be revisited before shipping it. A new private sibling such as `/studio` or `/admin` would otherwise be public at the edge. The current `pathname.startsWith('/app')` guard is slightly broader than the intended Access family and must not be used to justify new `/app...` sibling-style routes.

### Desktop authentication

The desktop flow starts at web `/login` and finishes through `/app?redirect=desktop...`. Password login redirects there directly; Google OAuth does the same through the auth callback. The login page preserves the desktop callback in `sessionStorage` so the `/app` page can hand the magic link back to either the bundled `dtx://` callback or the Tauri-development loopback callback.

Standalone desktop development (`bun run dev:desktop`) loads `VITE_DTX_SERVER_URL` from the ignored root `.env`. In the current operator setup it points at production, so standalone `tauri dev` authentication traverses production `/login` and protected production `/app`. The full local-stack command (`bun run dev`) instead uses `dtx-desktop#dev:local-web` and localhost.

After this Access change, authentication against either deployed web environment is operator-only. Non-operator contributors must use the full local stack or another separately designed ungated development environment.

### Non-operator production lockout

Because production `/app` sits behind a single-operator Access policy, public `/login` is an entry form, not an Access bypass. A non-operator Supabase user may authenticate successfully and then be denied when the browser returns to `/app`.

That state currently has no UI recovery path. `hooks.server.ts` redirects an already-authenticated visitor from `/login` to `/app`, while the only current sign-out control lives inside the Access-protected `(app)` layout. A signed-in non-operator therefore must clear the Drumery/Supabase cookies for the production origin. A public logout route or a change to the authenticated `/login` redirect is an explicit deferred product decision.

### Perseus precedent

Perseus already manages Cloudflare Zero Trust Access with `@pulumi/cloudflare`. Its infrastructure package creates a `ZeroTrustAccessApplication` with inline policies, uses an email `Include` selector, requires a device-posture rule, defaults the Access session to `12h`, and applies hardened cookie/application flags.

Perseus also owns the trusted-device serial-number list and device-posture rule and exports `adminAccessDevicePostureRuleId` from its Pulumi program. DTXWeb will reuse that existing Cloudflare posture-rule resource ID instead of reproducing the list/rule ownership.

Perseus's later CLI application, service token, `non_identity` Service Auth policy, Worker resources, R2/KV/D1 resources, and deployment workflow solve different product requirements and are not part of this design.

## Architecture

### DTXWeb infrastructure workspace

Add a dedicated workspace:

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

The package is intentionally Access-only. It has no Worker build/deployment logic and no storage resources.

The root workspace list adds `packages/infrastructure` so Bun installs and repository checks include the package naturally.

Use the same dependency versions currently working in Perseus for the initial implementation unless DTXWeb dependency resolution requires a compatible update:

- `@pulumi/pulumi` `^3.144.0`
- `@pulumi/cloudflare` `^6.13.0`
- `typescript` `^5.9.0`
- `vitest` `^4.0.18`
- `@types/node` `^22.10.0`

### Pulumi project

`Pulumi.yaml` defines one DTXWeb infrastructure project:

```yaml
name: dtxweb-infrastructure
runtime: nodejs
description: DTXWeb Cloudflare Access infrastructure managed by Pulumi
main: dist/index.js
```

One program serves exactly two supported stacks:

- `pre-prod`
- `production`

Any other `pulumi.getStack()` value fails loudly before creating resources.

This is intentional. Stack-specific hostname/path scope is code-owned rather than freely configurable.

### State and local stack configuration

Match the current Perseus operational model for this slice: local Pulumi usage with stack configuration excluded from git.

`packages/infrastructure/.gitignore` includes at least:

```text
Pulumi.*.yaml
.pulumi/
node_modules/
dist/
.env
.env.local
```

The operator configures both stacks locally with `pulumi config set` commands. No stack config file, encrypted secret value, or local state directory is committed.

This slice does not add CI deployment, so reproducing the stack on another machine requires re-establishing the local Pulumi backend/login plus the documented config values.

## Stack Model

### `pre-prod`

Creates one `ZeroTrustAccessApplication` named `DTXWeb Pre-prod` covering the entire web hostname:

```text
pre-prod.dtx.hapadona.com
```

There is no path bypass. All current and future routes on that web hostname are behind Access.

`api.pre-prod.dtx.hapadona.com` is not a destination and remains outside Access.

### `production`

Creates one `ZeroTrustAccessApplication` named `DTXWeb Production App` with exactly these destinations:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

The production program must not accept arbitrary destination configuration. A hostname-wide production Access application cannot be produced by changing stack config alone.

`api.dtx.hapadona.com` and all production web routes outside `/app` remain outside Access.

## Pulumi Configuration

Both stacks require the same small set of values:

- `cloudflareAccountId` — Cloudflare account ID; plain configuration.
- `accessEmail` — the allowed operator Access identity/email; Pulumi secret.
- `devicePostureRuleId` — the existing Perseus Cloudflare device-posture rule ID; plain configuration.
- `accessSessionDuration` — optional; defaults to `12h`.

The production and pre-production hostnames are not config values.

The allowed identity is secret because the repository should not publish the operator email. The posture-rule ID is a Cloudflare resource identifier rather than a device serial or credential and does not need Pulumi-secret handling.

### Reusing the Perseus posture-rule ID

The operator obtains the current `adminAccessDevicePostureRuleId` from the Perseus Pulumi stack and writes that value into both DTXWeb stacks as `devicePostureRuleId`.

DTXWeb does not use `pulumi.StackReference` for this dependency. A direct stack reference would couple DTXWeb to the exact Perseus Pulumi backend, organization/project name, and stack identity. Passing the stable Cloudflare resource ID as DTXWeb configuration keeps deployment of the two repositories independent while preserving Perseus as the owner of trusted-device membership.

If Perseus ever replaces the posture rule and its resource ID changes, the DTXWeb stack config must be updated before the next DTXWeb `pulumi up`. This is an explicit operational dependency and belongs in the runbook.

## Access Resource Construction

`src/access.ts` owns pure builders plus the small resource factory.

### Shared application flags

Reuse the relevant hardened application flags from Perseus:

```ts
{
  appLauncherVisible: false,
  allowAuthenticateViaWarp: false,
  enableBindingCookie: true,
  httpOnlyCookieAttribute: true,
  pathCookieAttribute: false
}
```

Do not import or copy CLI/service-token-specific behavior.

### Access policy

Both stacks use one inline policy:

- name: `Allow configured operator on trusted device`
- decision: `allow`
- precedence: `1`
- `includes`: configured email identity
- `requires`: configured existing device-posture rule ID

The policy mirrors the proven Perseus browser-admin policy shape but references the pre-existing posture rule directly.

### Stack definition and application builder

Keep stack selection testable as pure data. A helper such as `getAccessStackDefinition(stackName)` returns the immutable application name, domain, and destinations for `pre-prod` or `production` and throws for any other stack.

The application builder accepts:

- account ID;
- stack definition;
- operator email;
- existing posture-rule ID;
- optional session duration.

It returns `cloudflare.ZeroTrustAccessApplicationArgs`.

No destination or hostname comes from Pulumi config.

### Resource ownership

DTXWeb owns only:

- `DTXWeb Pre-prod` Access application in the `pre-prod` stack;
- `DTXWeb Production App` Access application in the `production` stack.

DTXWeb explicitly does not own:

- Perseus device serial list;
- Perseus device-posture rule;
- Access identity provider configuration;
- service tokens;
- Service Auth policies;
- API hostnames;
- Workers or storage resources.

## Protection Matrix

| Surface | Cloudflare Access | Owner |
| --- | --- | --- |
| `dtx.hapadona.com/app` | Protected | DTXWeb production Pulumi stack |
| `dtx.hapadona.com/app/` | Protected; verify explicitly | DTXWeb production Pulumi stack |
| `dtx.hapadona.com/app/*` | Protected | DTXWeb production Pulumi stack |
| `dtx.hapadona.com/` | Public | Existing Worker deployment |
| `dtx.hapadona.com/blog/*` | Public | Existing Worker deployment |
| `dtx.hapadona.com/preview/*` | Public | Existing Worker deployment |
| `dtx.hapadona.com/editor` | Public | Existing Worker deployment |
| `dtx.hapadona.com/tool/*` | Public | Existing Worker deployment |
| `dtx.hapadona.com/game` | Public | Existing Worker deployment |
| `dtx.hapadona.com/login` | Public | Existing Worker deployment |
| `dtx.hapadona.com/auth/*` | Public | Existing Worker deployment |
| Other production web paths outside `/app` | Public | Existing Worker deployment |
| `pre-prod.dtx.hapadona.com/*` | Protected | DTXWeb pre-prod Pulumi stack |
| `api.dtx.hapadona.com/*` | Outside Access | Existing API deployment |
| `api.pre-prod.dtx.hapadona.com/*` | Outside Access | Existing API deployment |

## Deployment Workflow

Pulumi manages only Access. Wrangler remains the runtime deployment tool.

### Initial setup

Use the same local-backend pattern as Perseus:

```bash
cd packages/infrastructure
pulumi login --local
pulumi stack init pre-prod
pulumi stack init production
```

If either stack already exists locally, select it rather than recreating it.

Configure both stacks with the Cloudflare account ID, secret Access email, reused Perseus posture-rule ID, and optional session duration. The implementation runbook will contain the exact commands without real values.

### Pre-production first

1. Build/typecheck/test the infrastructure package.
2. Run `pulumi preview -s pre-prod`.
3. Review the preview and confirm it creates only the hostname-wide `DTXWeb Pre-prod` Access application.
4. Run `pulumi up -s pre-prod`.
5. Execute the complete pre-production verification section from the runbook.
6. If any required check fails, run the pre-production rollback immediately.

Production must not be applied before pre-production is green.

### Production

1. Run `pulumi preview -s production`.
2. Review the preview and confirm the application has exactly `/app` and `/app/*` destinations.
3. Run `pulumi up -s production`.
4. Execute the complete production route, identity, posture, browser, session-expiry, and desktop verification sections from the runbook.

Do not use `pulumi up` without an explicit stack in operational documentation for this feature.

## Testing Strategy

### Unit tests

`src/access.test.ts` tests builders without contacting Cloudflare.

At minimum, test:

- production destinations are exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`;
- pre-production destination is hostname-wide and does not include the API hostname;
- production cannot become hostname-wide through configuration;
- policy contains the normalized configured email in `includes`;
- policy references the provided posture-rule ID in `requires`;
- default session duration is `12h`;
- hardened application flags match the intended values;
- unsupported stack names fail loudly;
- empty/invalid email and empty posture-rule ID fail before deployment.

Follow the Perseus pattern of separating pure builders from Pulumi resource creation so the security-sensitive shape is deterministic and unit-testable.

### Static verification

Run the package TypeScript check and unit tests before any preview.

The root repository check should include the new workspace through normal workspace/turbo integration where practical; do not add unrelated CI redesign merely for this package.

### Pulumi preview as a safety gate

`pulumi preview` is required before each environment apply.

Pre-production preview must show only the intended pre-production Access application.

Production preview must show only the intended production Access application and exactly the two path destinations. A preview that shows hostname-wide production Access, an API destination, a new posture rule/list, or a service token is a hard stop.

## Runtime Verification Requirements

The existing runbook remains the owner of live acceptance commands and browser checks. It is rewritten from dashboard instructions to Pulumi preview/apply/rollback instructions.

The route-boundary helper must fail loudly if DNS, connection, TLS, or timeout fails; a request that never received an HTTP response cannot count as a successful public-route assertion.

The production matrix must include:

- protected: `/app`, `/app/`, `/app/score`, `/app/__data.json`;
- public: `/`, `/blog`, `/preview/1`, `/editor`, `/tool/dtx-to-midi`, `/game`, `/login`, `/auth/callback`;
- outside Access: both API hostnames.

The policy checks independently prove:

- allowed identity + trusted posture passes;
- trusted device + non-allowed IdP identity is denied;
- allowed identity on a device that fails posture is denied.

The browser checks cover:

- pre-production password and Google login before production is applied;
- production `/app -> /login -> /app` for the operator;
- bundled desktop login;
- standalone Tauri-development loopback login against deployed production in the current operator setup;
- expired/logged-out Access session during SvelteKit client-side navigation into `/app`;
- non-operator production login dead-end and documented cookie-clearing recovery.

## Rollback

Rollback is stack-specific and does not touch Worker/API deployment.

Because each stack owns exactly one Cloudflare resource in this slice, the rollback procedure is explicit:

```bash
pulumi preview --destroy -s pre-prod
pulumi destroy -s pre-prod --yes
```

for pre-production, or:

```bash
pulumi preview --destroy -s production
pulumi destroy -s production --yes
```

for production.

Before running `destroy`, the operator must review the destroy preview and confirm the only deletion is the corresponding DTXWeb Access application. If the infrastructure package later owns additional resources, this rollback procedure must be redesigned before those resources ship.

If pre-production fails required acceptance, destroy only the `pre-prod` stack's Access application. Production remains untouched.

If production fails required acceptance, destroy only the `production` stack's Access application. Pre-production remains available for further diagnosis.

Rollback requires no Worker redeploy and no application-code rollback.

Do not add a service token, API Access application, bypass policy, or widened destination as an emergency workaround.

## Security And Secret Handling

Never commit:

- operator email;
- device serial numbers;
- Access cookies or JWTs;
- Cloudflare API tokens;
- `Pulumi.<stack>.yaml` files for this local-stack workflow;
- `.pulumi/` local state;
- screenshots containing security identifiers.

`accessEmail` is set with Pulumi secret configuration.

`devicePostureRuleId` is plain configuration, but it must refer to the existing Perseus-managed rule and must never be replaced with a freshly created DTXWeb rule as part of this slice.

The Cloudflare API token used for Pulumi should be scoped to the least privilege needed to manage the intended Access application resources. The exact token permission checklist must be verified against the provider/Cloudflare API during implementation and recorded in the runbook rather than guessed in application source.

## Operational Consequences

### Shared posture ownership

Perseus controls trusted-device membership. Changing the Perseus serial list affects DTXWeb because both applications require the same posture rule.

If the posture rule is replaced rather than updated in place, DTXWeb's `devicePostureRuleId` config becomes stale and must be changed before the next DTXWeb deployment.

### Desktop development

Standalone desktop auth against production or pre-production is operator-only. Full local-stack development remains the non-operator path.

### Pre-production automation

This slice adds no non-interactive Access credential. Unattended E2E/CI against the Access-protected pre-production hostname remains unsupported even though Playwright can target another base URL.

### Non-operator logout dead end

The existing production Supabase/UI behavior is unchanged. Signed-in non-operators can become trapped between public `/login` redirect behavior and Access denial at `/app`; clearing production site cookies remains the documented recovery until a separate product/code change is approved.

## Repository Changes

The implementation is expected to modify only infrastructure/workspace/documentation files:

- `package.json` — add `packages/infrastructure` workspace and optional convenience scripts if justified by the implementation plan.
- `bun.lock` — dependency resolution.
- `packages/infrastructure/.gitignore` — ignore local stack config/state, dependencies, build output, and env files.
- `packages/infrastructure/Pulumi.yaml` — Pulumi project metadata.
- `packages/infrastructure/package.json` — Pulumi/Cloudflare/TypeScript/Vitest package definition.
- `packages/infrastructure/tsconfig.json`.
- `packages/infrastructure/vitest.config.ts`.
- `packages/infrastructure/src/access.ts` — stack definitions, Access builders, and resource factory.
- `packages/infrastructure/src/access.test.ts` — unit tests.
- `packages/infrastructure/src/index.ts` — stack selection and resource creation.
- `packages/infrastructure/README.md` — local config/preview/apply instructions.
- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md` — Pulumi-based rollout, verification, and rollback.
- `docs/superpowers/plans/2026-08-17-cloudflare-zero-trust-web-access.md` — rewritten implementation plan after this spec is approved.

No changes are planned under `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop`.

## Superseded Manual-Configuration Design

The earlier version of this design used two manually configured dashboard applications. That approach is superseded by this Pulumi design.

The approved protection matrix, product consequences, pre-production-first order, verification matrix, and rollback criteria remain valid. What changes is resource ownership and deployment:

- Access applications are created by Pulumi rather than dashboard clicks;
- the posture rule is referenced by existing Perseus resource ID rather than manually selected as an unmanaged dependency;
- previews/unit tests provide an additional configuration safety gate;
- the existing runbook and implementation plan must be rewritten before execution because their dashboard-configuration instructions are obsolete.

## References

Repository precedent:

- Perseus `packages/infrastructure/src/admin-access.ts`
- Perseus `packages/infrastructure/src/admin-access.test.ts`
- Perseus `packages/infrastructure/src/index.ts`
- Perseus `packages/infrastructure/src/config.ts`
- Perseus `packages/infrastructure/Pulumi.yaml`
- Perseus `packages/infrastructure/package.json`
- Perseus `packages/infrastructure/.gitignore`
- Perseus `packages/infrastructure/README.md`

Cloudflare/Pulumi behavior should be verified against current provider and Cloudflare documentation during implementation if the working Perseus resource shape no longer typechecks against the selected provider version.
