# Cloudflare Zero Trust Web Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Access-only Pulumi workspace that can safely preview DTXWeb pre-production and production Cloudflare Access applications, reuses the existing Perseus posture rule, and is fully covered by the repository's existing CI gates.

**Architecture:** One Pulumi program serves exactly `pre-prod` and `production`. Stack name owns hostname/path scope; config supplies only account ID, secret operator email, existing posture-rule ID, and optional session duration. Agents implement/test/build/preview only; live Cloudflare mutation is operator-executed from the runbook.

**Tech Stack:** Bun workspaces/Turborepo, TypeScript `^5.8.3`, Vitest `^3.1.4`, `@vitest/coverage-v8` `^3.0.0`, `@types/node` `^20.11.25`, Pulumi `@pulumi/pulumi` `^3.144.0`, `@pulumi/cloudflare` `^6.13.0`.

**Spec:** `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`

## Global Constraints

- Pulumi owns only DTXWeb Access applications; Wrangler keeps runtime infrastructure.
- No runtime changes under `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop`.
- One test-only change under `packages/dtx-web/src/routes/(app)` is allowed to enforce the private-route boundary.
- Reuse the existing Perseus `devicePostureRuleId`; do not create another posture list/rule and do not add `StackReference`.
- Supported stacks are exactly `pre-prod` and `production`.
- Production destinations are code constants: `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` only.
- Do not add service tokens, Service Auth, CLI Access apps, Managed OAuth, or Worker-side Access JWT validation.
- Use explicit stack names on every Pulumi preview documented by this plan.
- Do not run `pulumi up` or `pulumi destroy` from this implementation plan.
- Production live apply remains blocked until the queued Better Auth/D1 cutover reconciles PR #221's production acceptance procedure.

---

### Task 1: Add The CI-Covered Infrastructure Workspace And Route Boundary Guard

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.github/scripts/ci-affected-scope.sh`
- Modify: `.github/scripts/ci-affected-scope.test.sh`
- Create: `.github/scripts/fixtures/turbo-infrastructure.json`
- Modify: `.github/workflows/lint-and-format.yml`
- Create: `packages/dtx-web/src/routes/(app)/private-route-boundary.test.ts`
- Create: `packages/infrastructure/.gitignore`
- Create: `packages/infrastructure/Pulumi.yaml`
- Create: `packages/infrastructure/package.json`
- Create: `packages/infrastructure/tsconfig.json`
- Create: `packages/infrastructure/vitest.config.ts`

**Interfaces:**

- Produces the `@dtx/infrastructure` workspace with `build`, `check`, `test`, `test:coverage`, and `test:watch` scripts.
- Produces a CI invariant that every route-bearing file inside SvelteKit's `(app)` route group emits `/app` or `/app/...`.
- Produces affected-scope support so infrastructure-only changes run the existing unit/coverage gate instead of failing as an unknown package.

- [ ] **Step 1: Scaffold the workspace using DTXWeb's current JS toolchain**

Add `packages/infrastructure` to root workspaces.

Create the package with:

- dependencies: `@pulumi/pulumi ^3.144.0`, `@pulumi/cloudflare ^6.13.0`;
- dev dependencies: `typescript ^5.8.3`, `vitest ^3.1.4`, `@vitest/coverage-v8 ^3.0.0`, `@types/node ^20.11.25`;
- scripts: `build`, `check`, `test`, `test:coverage`, `test:watch` only for build/test lifecycle; do **not** add unscoped `pulumi:up`, `pulumi:destroy`, or `pulumi:preview` scripts.

`Pulumi.yaml` must set `main: dist/index.js` and project name `dtxweb-infrastructure`.

`tsconfig.json` must extend `../../tsconfig.base.json`, emit `src/**` to `dist/**`, use NodeNext module/moduleResolution, and exclude tests from build output.

`.gitignore` must ignore `Pulumi.*.yaml`, `.pulumi/`, `node_modules/`, `dist/`, `.env`, and `.env.local`. The `.pulumi/` entry is defensive for explicitly project-local backends; normal `pulumi login --local` state defaults under the operator home directory.

Run:

```bash
bun install
bun run --filter=@dtx/infrastructure check
```

Expected: dependency lock updates and TypeScript can load the scaffold package.

- [ ] **Step 2: Add the private-route boundary test**

Create `private-route-boundary.test.ts` that recursively finds route-bearing `+page*` and `+server*` files below `src/routes/(app)`, strips route-group segments such as `(app)`, derives the emitted URL directory, and asserts every derived path satisfies:

```ts
route === '/app' || route.startsWith('/app/');
```

The test must fail if a future route such as `(app)/admin/+page.svelte` or `(app)/studio/+server.ts` is added.

Run:

```bash
bun run --filter=dtx-web test -- 'src/routes/(app)/private-route-boundary.test.ts'
```

Expected: PASS for the current `(app)/app/**` tree.

- [ ] **Step 3: Extend the fail-closed affected-scope contract with a failing fixture first**

Create `.github/scripts/fixtures/turbo-infrastructure.json` representing exactly:

```json
{
	"packageManager": "bun",
	"packages": {
		"count": 1,
		"items": [{ "name": "@dtx/infrastructure", "path": "packages/infrastructure" }]
	}
}
```

Format it with:

```bash
bunx prettier --write .github/scripts/fixtures/turbo-infrastructure.json
```

Add this detector case before modifying the allowlist:

```bash
run_expected infrastructure-unit unit turbo-infrastructure.json true packages/infrastructure/src/access.ts infrastructure
```

Run `.github/scripts/ci-affected-scope.test.sh` and confirm it fails because `@dtx/infrastructure` is still unknown.

- [ ] **Step 4: Add infrastructure to both detector gates**

In `.github/scripts/ci-affected-scope.sh`:

- add `@dtx/infrastructure:packages/infrastructure` to the known package/path allowlist;
- add `@dtx/infrastructure` to the package-name case that sets `unit_affected=true`.

Run:

```bash
.github/scripts/ci-affected-scope.test.sh
```

Expected: all detector tests PASS, including `infrastructure-unit`.

- [ ] **Step 5: Add infrastructure TypeScript checking to the existing lint workflow**

In `.github/workflows/lint-and-format.yml`, extend the existing typecheck step with:

```bash
bun run --filter=@dtx/infrastructure check
```

Do not create a new workflow.

- [ ] **Step 6: Verify and commit Task 1**

Run:

```bash
bun run --filter=dtx-web test -- 'src/routes/(app)/private-route-boundary.test.ts'
bun run --filter=@dtx/infrastructure check
.github/scripts/ci-affected-scope.test.sh
bun run lint
bunx prettier --check .
git diff --check
```

Expected: all PASS.

Commit the workspace, CI wiring, fixture, and route-boundary test together.

---

### Task 2: Implement The Access Stack Definitions And Pulumi Application

**Files:**

- Create: `packages/infrastructure/src/access.ts`
- Create: `packages/infrastructure/src/access.test.ts`
- Create: `packages/infrastructure/src/index.ts`

**Interfaces:**

- `AccessStackDefinition`
- `getAccessStackDefinition(stackName: string): AccessStackDefinition`
- `normalizeAccessEmail(rawValue: string): string`
- `buildAccessPolicy(accessEmail: pulumi.Input<string>, devicePostureRuleId: pulumi.Input<string>)`
- `buildAccessApplicationArgs(...)`
- `createAccessApplication(...)`

The email normalization path must always use `pulumi.output(accessEmail).apply(normalizeAccessEmail)`; do not maintain separate plain-string and `Output` branches.

Do not add custom `normalizeAccountId` or `normalizeDevicePostureRuleId` helpers.

- [ ] **Step 1: Write the focused stack/policy tests**

Cover only:

1. `pre-prod` => `DTXWeb Pre-prod` at hostname-wide `pre-prod.dtx.hapadona.com`;
2. `production` => exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`;
3. no hostname-wide `dtx.hapadona.com` production destination;
4. unsupported stack throws before resource creation;
5. email normalization trims one email and rejects malformed/multiple values;
6. default session duration and browser flags match the spec;
7. policy uses email `Include` and supplied posture-rule `Require`;
8. an async test passes `pulumi.output(' operator@example.com ')` through `buildAccessPolicy` and resolves the nested email `Output` to `operator@example.com`.

Use a small test helper that awaits a known Pulumi `Output<T>` by resolving inside `apply`; do not introduce Pulumi mocks unless the provider constructor itself forces them.

Run:

```bash
bun run --filter=@dtx/infrastructure test
```

Expected: FAIL because `access.ts` does not exist yet.

- [ ] **Step 2: Implement immutable stack definitions and one email-normalization path**

In `access.ts`:

- hard-code the two supported stack definitions;
- throw for every other stack name;
- keep production host/path values out of Pulumi config;
- keep `normalizeAccessEmail` as the only bespoke config validator;
- always normalize `accessEmail` via `pulumi.output(accessEmail).apply(normalizeAccessEmail)`;
- pass account ID and posture-rule ID through from required Pulumi config without extra blank-string validators.

Run the focused infrastructure tests again. Expected: stack/email tests PASS.

- [ ] **Step 3: Implement the Access application args/resource factory**

Mirror only the browser Access shape used by Perseus:

- `cloudflare.ZeroTrustAccessApplication`;
- type `self_hosted`;
- one inline `allow` policy at precedence `1`;
- email `Include`;
- existing posture-rule ID `Require`;
- `12h` default session;
- `appLauncherVisible: false`;
- `allowAuthenticateViaWarp: false`;
- `enableBindingCookie: true`;
- `httpOnlyCookieAttribute: true`;
- `pathCookieAttribute: false`.

Do not add posture/list/service-token/CLI resources.

Run:

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
```

Expected: PASS.

- [ ] **Step 4: Add the Pulumi entrypoint**

`index.ts` must:

1. call `getAccessStackDefinition(pulumi.getStack())` before resource creation;
2. read `cloudflareAccountId` with `config.require`;
3. read `accessEmail` with `config.requireSecret`;
4. read `devicePostureRuleId` with `config.require`;
5. read optional `accessSessionDuration` with `config.get`;
6. create exactly one Access application;
7. export only non-secret application metadata needed for operator inspection.

Run:

```bash
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
```

Expected: PASS and `dist/index.js` exists.

If selected `@pulumi/cloudflare` typings differ from the referenced resource shape, stop and reconcile against the installed provider API rather than widening scope.

- [ ] **Step 5: Commit Task 2**

Commit only the Access implementation/tests/entrypoint after the test, check, and build commands pass.

---

### Task 3: Finish Operator Documentation And Preview Readiness

**Files:**

- Create: `packages/infrastructure/README.md`
- Modify only if implementation details changed: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- Modify only if implementation details changed: `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`

**Interfaces:**

- README documents local stack setup/config and points to the runbook for live rollout.
- The runbook remains the sole source of live route matrices, posture comparison, apply, acceptance, and rollback.

- [ ] **Step 1: Write the infrastructure README without duplicating the live runbook**

Document:

- `pulumi login --local`;
- exact supported stacks (`pre-prod`, `production`);
- required config keys and `accessEmail` secret handling;
- obtaining the current Perseus posture-rule output;
- `bun run --filter=@dtx/infrastructure build` before preview;
- explicit `pulumi preview --stack pre-prod` and `pulumi preview --stack production` commands;
- production apply hold until Better Auth/D1 reconciliation;
- pointer to the operator runbook for all `up`/destroy/browser/device operations.

Do not add unscoped package scripts as shortcuts.

- [ ] **Step 2: Verify the runbook preflight matches the implementation**

The runbook must require, before preview:

```bash
bun install --frozen-lockfile
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure build
.github/scripts/ci-affected-scope.test.sh
bun run lint
bunx prettier --check .
```

It must also compare the current Perseus `adminAccessDevicePostureRuleId` against `pulumi config get devicePostureRuleId --stack pre-prod` and `--stack production`; mismatch is a hard stop.

- [ ] **Step 3: Produce non-mutating preview evidence when local credentials/config are available**

After the build, from `packages/infrastructure`:

```bash
pulumi preview --stack pre-prod
pulumi preview --stack production
```

Expected:

- pre-prod preview registers one hostname-wide `DTXWeb Pre-prod` Access application only;
- production preview registers one `DTXWeb Production App` with exactly `/app` and `/app/*` destinations;
- neither preview creates posture/list/token/Worker/API resources.

If authenticated local config is unavailable, record previews as `NOT RUN — operator credentials/config unavailable`; do not fabricate stack config or secrets.

Do **not** run `pulumi up`.

- [ ] **Step 4: Run final implementation verification and commit**

From the repository root:

```bash
bun install --frozen-lockfile
bun run --filter=dtx-web test -- 'src/routes/(app)/private-route-boundary.test.ts'
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
.github/scripts/ci-affected-scope.test.sh
bun run lint
bunx prettier --check .
git diff --check
```

Expected: all commands PASS and no secret/config/state file is tracked.

Commit README/document corrections only after these gates pass.

---

## Operator Handoff After Implementation

The agent implementation ends after Task 3.

A human operator then follows `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`:

1. apply and verify `pre-prod` first;
2. keep pre-production Access enabled if accepted;
3. **do not apply `production` yet**;
4. wait for the queued Better Auth/D1 cutover to replace the current desktop auth flow and reconcile PR #221's production acceptance procedure;
5. only after that reconciliation removes the production hold, preview/apply/verify the production stack.

This sequencing avoids validating and documenting a production desktop auth flow that the queued migration already plans to remove.
