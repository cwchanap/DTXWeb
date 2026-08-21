# Cloudflare Zero Trust Web Access Design

## Summary

DTXWeb will manage Cloudflare Zero Trust Access with a small Pulumi workspace that owns **Access applications only**. Existing Workers, APIs, D1, R2, routes, bindings, and runtime deployment remain on Wrangler.

One Pulumi program serves exactly two stacks:

| Stack        | Application             | Code-owned protection scope                              |
| ------------ | ----------------------- | -------------------------------------------------------- |
| `pre-prod`   | `DTXWeb Pre-prod`       | entire `pre-prod.dtx.hapadona.com` hostname              |
| `production` | `DTXWeb Production App` | `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` only |

Production host/path scope is not Pulumi config. This prevents a stack-config typo from broadening Access over the public production site.

DTXWeb reuses the existing Perseus-managed Cloudflare device-posture rule by resource ID. DTXWeb does not create another serial list or posture rule and does not use a cross-repo `StackReference`.

## Goals

- Manage the two DTXWeb Access applications declaratively with Pulumi.
- Keep production public routes and both API hostnames outside Access.
- Make production `/app` an operator-only outer gate while retaining the application authentication system as the inner gate.
- Protect the entire pre-production web hostname, including the `pre-prod-prod-data` deployment mode that can bind the pre-production web surface to production-backed API data.
- Reuse the existing Perseus posture-rule ID without duplicating trusted-device ownership.
- Enforce the production private-route boundary in CI instead of relying only on documentation.
- Reuse the repository's existing affected-scope, unit/coverage, lint, formatting, and typecheck gates.
- Keep live Cloudflare mutations operator-executed.

## Non-Goals

- Migrate Worker/API/runtime infrastructure from Wrangler to Pulumi.
- Create a DTXWeb trusted-device list or posture rule.
- Add a `StackReference` to Perseus.
- Add Service Auth, service tokens, CLI Access applications, Managed OAuth, or Worker-side Access JWT validation.
- Protect either API hostname.
- Protect production routes outside `/app`.
- Add GitHub Actions deployment for Pulumi.
- Add or change runtime application authentication behavior in this slice.

## Resource Ownership

Add `packages/infrastructure` with the same Pulumi Cloudflare resource family used by Perseus, limited to `cloudflare.ZeroTrustAccessApplication` plus its inline browser policy.

The Access policy is:

- decision: `allow`;
- include: configured operator email;
- require: configured existing device-posture rule ID;
- session duration: `12h` by default.

Reuse these browser application flags from the Perseus implementation:

- `appLauncherVisible: false`;
- `allowAuthenticateViaWarp: false`;
- `enableBindingCookie: true`;
- `httpOnlyCookieAttribute: true`;
- `pathCookieAttribute: true`.

`pathCookieAttribute` was changed from `false` to `true` by the 2026-08-20 Access
hardening (commit `f912e38a`, "close remaining Access verification edge cases") to scope
Access cookies to the application path. The implementation in
`packages/infrastructure/src/access.ts` and its test assert `true`; this spec previously
recorded the older `false` value and is corrected here to match the live contract.

Do not copy Perseus service-token, CLI, Worker, storage, or deployment resources.

## Pulumi Configuration

Both stacks accept only:

- `cloudflareAccountId` — plain config;
- `accessEmail` — secret config;
- `devicePostureRuleId` — plain config containing the current Perseus-managed Cloudflare posture-rule ID;
- `accessSessionDuration` — optional, default `12h`.

Hostnames and destinations are code constants selected by `pulumi.getStack()`. Any stack other than `pre-prod` or `production` fails before resource registration.

Use the local Pulumi backend for this slice. `pulumi login --local` stores its default filesystem backend under the operator's home directory; stack config files and any project-local `.pulumi/` state remain ignored by git.

## Shared Posture Ownership

Perseus remains the source of truth for trusted-device membership and exports `adminAccessDevicePostureRuleId`. DTXWeb copies that Cloudflare resource ID into both stack configs.

Because this is a cross-repo foreign key, every operator preflight must compare the current Perseus output with both DTXWeb stack config values. A mismatch is a hard stop before preview or apply.

This deliberately avoids a `StackReference`: DTXWeb and Perseus remain independently deployable and do not depend on the same Pulumi backend/project identity.

## Private Route Invariant

Cloudflare production Access covers only exact `/app` and descendants under `/app/`.

The SvelteKit authenticated route group currently lives under `packages/dtx-web/src/routes/(app)/app`. Add a small test under the `(app)` route group that derives URL paths for route-bearing files and asserts every emitted path is either `/app` or starts with `/app/`.

A future private `/admin`, `/studio`, or other route outside `/app` must therefore fail CI instead of silently shipping outside Access.

The existing `pathname.startsWith('/app')` guard is slightly broader than the Access scope; aligning that runtime guard is a separate cleanup and is not required here.

## CI Integration

`@dtx/infrastructure` must participate in the existing CI contract:

- add it to the fail-closed package allowlist in `.github/scripts/ci-affected-scope.sh`;
- mark it as unit-affected;
- add a Turbo fixture and detector test;
- expose `test:coverage` so root `bun run test:coverage` executes its tests;
- add `bun run --filter=@dtx/infrastructure check` to the existing lint/typecheck workflow;
- extend `../../tsconfig.base.json` from the infrastructure package;
- run repository lint and `prettier --check .` in final implementation verification.

Use the repository's current TypeScript/Vitest/Node-types major versions. Reuse Perseus's Pulumi and Cloudflare provider floors, not its unrelated JS toolchain versions.

## Testing Focus

The tests should pin security-sensitive behavior rather than duplicate generic provider validation.

Keep tests for:

- exact pre-production hostname-wide definition;
- exact production destinations (`/app`, `/app/*`) and absence of hostname-wide production Access;
- unsupported stack rejection;
- default session duration and browser flags;
- email normalization;
- the real secret-input path by passing a `pulumi.Output<string>` through the email normalization path;
- route-tree agreement under `src/routes/(app)`;
- affected-scope CI behavior for `@dtx/infrastructure`.

Do not add bespoke blank-string validators for account ID or posture-rule ID. Pulumi config presence, provider validation, preview review, and the posture-ID preflight are sufficient for those values.

Implement email normalization through one path for both string and secret input (for example, always `pulumi.output(input).apply(normalizeAccessEmail)`) rather than maintaining separate string/output branches.

## Deployment Sequence

### Phase 1 — implementation and pre-production

1. Implement `packages/infrastructure`, CI wiring, the route-boundary test, and operator documentation.
2. Run static/unit/coverage/lint/format verification.
3. Build `dist/index.js` before every Pulumi preview because `Pulumi.yaml` points at compiled output.
4. Produce non-mutating previews when authenticated local stack config is available.
5. Human operator applies `pre-prod` and runs the hostname-wide acceptance matrix.

### Phase 2 — production hold for Better Auth

A queued Better Auth/D1 migration removes the current desktop magic-link callback flow and introduces Device Authorization approval at `/app/desktop-auth`. Its cutover plan explicitly schedules reconciliation of this Zero Trust spec/plan/runbook after PR #221 lands.

Therefore **do not apply the production Access stack before that Better Auth cutover and documentation reconciliation are complete**. The production scope (`/app` + `/app/*`) remains the intended boundary, but the final browser/desktop acceptance procedure must describe the auth flow that will actually ship.

Production preview may be used as a non-mutating scope check, but `pulumi up --stack production` remains blocked until the Better Auth reconciliation removes this hold.

## Operator Boundary

Implementation agents may edit code/docs, run local tests, build the Pulumi program, and run non-mutating previews when credentials/config are already available.

The checked-in runbook owns all live operations. Human operators perform:

- `pulumi up`;
- `pulumi destroy`;
- identity/device posture checks;
- browser/desktop observations;
- emergency Cloudflare dashboard disable/delete.

## Rollback

Normal rollback uses the stack that owns the one Access application:

- preview destroy for the explicit stack;
- confirm the one named DTXWeb Access application is the only deletion;
- destroy that stack.

If the local Pulumi backend/state is unavailable and immediate Access removal is required, the operator may disable/delete exactly the named DTXWeb Access application in the Cloudflare dashboard, then reconcile Pulumi state before any later apply.

Removing pre-production Access returns `pre-prod.dtx.hapadona.com` to its prior public state. If the `pre-prod-prod-data` deployment mode is active, that public web hostname can be bound to the API environment using production D1/R2 resources. Treat pre-production Access removal as a security-impacting rollback, not a neutral cleanup.

## Risks

### Shared posture-rule drift

Perseus can replace the posture-rule resource, leaving a stale DTXWeb resource ID. Mitigation: compare the current Perseus output with both DTXWeb stack configs on every operator preflight and stop on mismatch.

### Operator-machine concentration

The local Pulumi backend and the trusted posture-satisfying device may live on the same machine. Hardware loss can remove both the normal state-aware rollback path and the trusted DTXWeb login path. Mitigation: keep the named-application Cloudflare dashboard removal procedure as the emergency provider-side recovery path.

### Pre-production rollback exposure

Destroying the pre-production Access application makes the pre-production hostname public again. This matters especially when `pre-prod-prod-data` is serving the hostname against production-backed API data. The runbook must call out that consequence before destroy.

### Auth migration sequencing

Production desktop/browser auth is being redesigned by the queued Better Auth/D1 cutover. Applying production Access before that cutover would force two acceptance procedures and risk validating a flow that is about to disappear. Mitigation: apply pre-production now; hold production apply until the Better Auth reconciliation lands.

## Repository Changes

Expected implementation files:

- `package.json`, `bun.lock`;
- `.github/scripts/ci-affected-scope.sh`;
- `.github/scripts/ci-affected-scope.test.sh`;
- `.github/scripts/fixtures/turbo-infrastructure.json`;
- `.github/workflows/lint-and-format.yml`;
- `packages/dtx-web/src/routes/(app)/private-route-boundary.test.ts`;
- `packages/infrastructure/**`;
- this spec, implementation plan, and operator runbook.

No runtime source changes are planned under `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop`.

## References

Repository:

- DTXWeb `.github/scripts/ci-affected-scope.sh`
- DTXWeb `.github/workflows/lint-and-format.yml`
- DTXWeb `packages/dtx-web/wrangler.jsonc`
- DTXWeb `packages/dtx-api/wrangler.jsonc`
- Perseus `packages/infrastructure/src/admin-access.ts`
- Perseus `packages/infrastructure/src/index.ts`
- queued Better Auth/D1 migration plan, Task 9 and Task 14

Cloudflare/Pulumi provider details must still be checked against the selected provider version during implementation if current typings differ from the referenced Perseus shape.
