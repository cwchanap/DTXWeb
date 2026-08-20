# Cloudflare Zero Trust Web Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI-covered, Access-only Pulumi package that declaratively defines DTXWeb pre-production and production Cloudflare Access applications while reusing the existing Perseus device-posture rule.

**Architecture:** Add `@dtx/infrastructure` as a normal Drumery workspace, wire it into the existing fail-closed affected-scope and coverage CI, and model the security-sensitive Access shape with pure TypeScript builders plus one Pulumi resource factory. Stack name owns immutable scope: `pre-prod` is hostname-wide and `production` is exactly `/app` plus `/app/*`. This implementation plan stops at tested code, rewritten operator docs, and Pulumi preview evidence; live `pulumi up`, browser/device acceptance, and `pulumi destroy` are operator-only runbook actions.

**Tech Stack:** Bun workspaces/Turborepo, TypeScript `^5.8.3`, Vitest `^3.1.4`, `@vitest/coverage-v8` `^3.0.0`, `@types/node` `^20.11.25`, Pulumi `@pulumi/pulumi` `^3.144.0`, Pulumi Cloudflare provider `@pulumi/cloudflare` `^6.13.0`, Cloudflare Zero Trust Access, Wrangler for existing Worker/API deployment.

**Spec:** `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`

## Global Constraints

- Pulumi owns only DTXWeb Cloudflare Access applications in this slice; Wrangler keeps ownership of Workers, API deployment, D1, R2, service bindings, routes, runtime variables, and application secrets.
- Do not modify `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop`.
- Reuse the existing Perseus device-posture rule by Cloudflare resource ID; do not create a DTXWeb serial list or posture rule.
- Do not add a Pulumi `StackReference` to Perseus.
- Supported stack names are exactly `pre-prod` and `production`; any other stack must fail before resource registration.
- Pre-production scope is code-owned and hostname-wide: `pre-prod.dtx.hapadona.com`.
- Production scope is code-owned and exactly `dtx.hapadona.com/app` plus `dtx.hapadona.com/app/*`; hostname/path destinations are not Pulumi config.
- Keep both API hostnames and all intended public production routes outside Access.
- The Access policy has one `allow` decision with configured email in `includes` and the existing posture-rule ID in `requires`; default session duration is `12h`.
- Reuse the hardened browser-application flags proven in Perseus: `appLauncherVisible: false`, `allowAuthenticateViaWarp: false`, `enableBindingCookie: true`, `httpOnlyCookieAttribute: true`, `pathCookieAttribute: false`.
- Do not add service tokens, Service Auth, CLI Access applications, Managed OAuth, Worker-side Access JWT validation, or unattended pre-production E2E credentials.
- `accessEmail` is Pulumi secret config. `devicePostureRuleId` is plain config pointing to the Perseus-managed rule.
- Do not commit Pulumi stack config, Pulumi state exports, API tokens, operator email, device serials, Access cookies/JWTs, or sensitive screenshots.
- Keep deployment operator-executed and local-backend-based; do not add GitHub Actions deployment.
- Do not add unscoped `pulumi:up`, `pulumi:destroy`, or `pulumi:preview` package scripts.
- Every operational Pulumi command in docs names its stack explicitly.
- Run/prove pre-production before production.
- The checked-in runbook is the single live operator source of truth; do not duplicate its route matrices in this plan.
- **Do not execute `pulumi up` or `pulumi destroy` from this implementation plan.**
- If runtime verification requires application/API/desktop code changes, stop and create a separate follow-up.

---

### Task 1: Add The Infrastructure Workspace And Wire It Into Fail-Closed CI

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.github/scripts/ci-affected-scope.sh`
- Modify: `.github/scripts/ci-affected-scope.test.sh`
- Create: `.github/scripts/fixtures/turbo-infrastructure.json`
- Create: `packages/infrastructure/.gitignore`
- Create: `packages/infrastructure/Pulumi.yaml`
- Create: `packages/infrastructure/package.json`
- Create: `packages/infrastructure/tsconfig.json`
- Create: `packages/infrastructure/vitest.config.ts`
- Create: `packages/infrastructure/src/access.ts`
- Create: `packages/infrastructure/src/access.test.ts`

**Interfaces:**

- Produces workspace `@dtx/infrastructure` with `build`, `check`, `test`, `test:coverage`, and `test:watch` scripts.
- Produces CI identity `@dtx/infrastructure:packages/infrastructure` and marks that package as unit-test-affecting.
- Produces `AccessStackDefinition`, `getAccessStackDefinition(stackName)`, `normalizeAccessEmail(rawValue)`, and `normalizeDevicePostureRuleId(rawValue)` in `src/access.ts`.

- [ ] **Step 1: Add a failing affected-scope fixture/test for infrastructure-only changes**

Create `.github/scripts/fixtures/turbo-infrastructure.json`:

```json
{"packageManager":"bun","packages":{"count":1,"items":[{"name":"@dtx/infrastructure","path":"packages/infrastructure"}]}}
```

Add these cases beside the existing web/e2e cases in `.github/scripts/ci-affected-scope.test.sh`:

```bash
run_expected infrastructure-only-unit unit turbo-infrastructure.json true packages/infrastructure/src/change.ts infrastructure
run_expected infrastructure-only-lint lint turbo-infrastructure.json true packages/infrastructure/src/change.ts infrastructure
```

- [ ] **Step 2: Run the affected-scope contract and verify it fails closed**

Run:

```bash
.github/scripts/ci-affected-scope.test.sh
```

Expected: FAIL at the new infrastructure case with the detector reporting an unknown package.

- [ ] **Step 3: Extend the detector allowlist and unit gate**

In `.github/scripts/ci-affected-scope.sh`, extend the package allowlist with:

```bash
'@dtx/infrastructure:packages/infrastructure' | \
```

Add `@dtx/infrastructure` to the `unit_affected=true` package-name case:

```bash
case "$package_name" in
  '@dtx/common' | '@dtx/ui-components' | '@dtx/infrastructure' | dtx-api | dtx-desktop | dtx-web)
    unit_affected=true
    ;;
esac
```

Do not weaken the unknown-package fail-closed branch.

- [ ] **Step 4: Re-run the detector tests**

```bash
.github/scripts/ci-affected-scope.test.sh
```

Expected: all affected-scope tests pass, including infrastructure `unit => true` and `lint => true`.

- [ ] **Step 5: Add workspace/package scaffolding using Drumery's JS test toolchain**

Add `packages/infrastructure` to root `workspaces`.

Create `packages/infrastructure/package.json`:

```json
{
  "name": "@dtx/infrastructure",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "check": "tsc --noEmit",
    "test": "vitest --run",
    "test:coverage": "vitest --run --coverage",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@pulumi/cloudflare": "^6.13.0",
    "@pulumi/pulumi": "^3.144.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.25",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.4"
  }
}
```

Do not copy Perseus's Vitest 4, TypeScript 5.9, Node types 22, or unscoped Pulumi scripts.

Create `packages/infrastructure/Pulumi.yaml`:

```yaml
name: dtxweb-infrastructure
runtime: nodejs
description: DTXWeb Cloudflare Access infrastructure managed by Pulumi
main: dist/index.js
```

Create `packages/infrastructure/.gitignore`:

```text
Pulumi.*.yaml
.pulumi/
node_modules/
dist/
.env
.env.local
```

Create `packages/infrastructure/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
}
```

Create `packages/infrastructure/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    requireAssertions: true
  }
});
```

Run:

```bash
bun install
```

Expected: `bun.lock` updates and Bun recognizes `@dtx/infrastructure` as a workspace.

- [ ] **Step 6: Write failing tests for immutable stack scope and config validation**

Create `packages/infrastructure/src/access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  getAccessStackDefinition,
  normalizeAccessEmail,
  normalizeDevicePostureRuleId
} from './access.js';

describe('getAccessStackDefinition', () => {
  it('makes pre-prod hostname-wide', () => {
    expect(getAccessStackDefinition('pre-prod')).toEqual({
      stackName: 'pre-prod',
      applicationName: 'DTXWeb Pre-prod',
      domain: 'pre-prod.dtx.hapadona.com',
      destinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }]
    });
  });

  it('makes production exactly /app plus /app/*', () => {
    expect(getAccessStackDefinition('production')).toEqual({
      stackName: 'production',
      applicationName: 'DTXWeb Production App',
      domain: 'dtx.hapadona.com/app',
      destinations: [
        { type: 'public', uri: 'dtx.hapadona.com/app' },
        { type: 'public', uri: 'dtx.hapadona.com/app/*' }
      ]
    });
  });

  it('rejects unsupported stacks before resource creation', () => {
    expect(() => getAccessStackDefinition('dev')).toThrow(/Unsupported DTXWeb infrastructure stack/);
  });
});

describe('Access config validation', () => {
  it('normalizes one email address', () => {
    expect(normalizeAccessEmail(' operator@example.com ')).toBe('operator@example.com');
  });

  it('rejects malformed and multiple emails', () => {
    expect(() => normalizeAccessEmail('not-an-email')).toThrow(/single email address/);
    expect(() => normalizeAccessEmail('a@example.com,b@example.com')).toThrow(/single email address/);
  });

  it('requires an existing posture-rule ID', () => {
    expect(normalizeDevicePostureRuleId(' posture-rule-id ')).toBe('posture-rule-id');
    expect(() => normalizeDevicePostureRuleId('   ')).toThrow(/devicePostureRuleId must not be empty/);
  });
});
```

- [ ] **Step 7: Run the focused unit tests and verify they fail**

```bash
bun run --filter=@dtx/infrastructure test
```

Expected: FAIL because `src/access.ts` or its exports do not exist.

- [ ] **Step 8: Implement the immutable stack model and validators**

Create `packages/infrastructure/src/access.ts`:

```ts
const ACCESS_EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export interface AccessDestination {
  type: 'public';
  uri: string;
}

export interface AccessStackDefinition {
  stackName: 'pre-prod' | 'production';
  applicationName: string;
  domain: string;
  destinations: AccessDestination[];
}

const ACCESS_STACKS: Record<AccessStackDefinition['stackName'], AccessStackDefinition> = {
  'pre-prod': {
    stackName: 'pre-prod',
    applicationName: 'DTXWeb Pre-prod',
    domain: 'pre-prod.dtx.hapadona.com',
    destinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }]
  },
  production: {
    stackName: 'production',
    applicationName: 'DTXWeb Production App',
    domain: 'dtx.hapadona.com/app',
    destinations: [
      { type: 'public', uri: 'dtx.hapadona.com/app' },
      { type: 'public', uri: 'dtx.hapadona.com/app/*' }
    ]
  }
};

export function getAccessStackDefinition(stackName: string): AccessStackDefinition {
  if (stackName !== 'pre-prod' && stackName !== 'production') {
    throw new Error(`Unsupported DTXWeb infrastructure stack: ${stackName}`);
  }
  return ACCESS_STACKS[stackName];
}

export function normalizeAccessEmail(rawValue: string): string {
  const value = rawValue.trim();
  if (!ACCESS_EMAIL_PATTERN.test(value)) {
    throw new Error('accessEmail must be a single email address');
  }
  return value;
}

export function normalizeDevicePostureRuleId(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) throw new Error('devicePostureRuleId must not be empty');
  return value;
}
```

Hostnames/destinations must remain internal constants, not function parameters.

- [ ] **Step 9: Run the package and CI contract checks**

```bash
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure check
.github/scripts/ci-affected-scope.test.sh
```

Expected: PASS.

- [ ] **Step 10: Commit the independently testable workspace/CI slice**

```bash
git add package.json bun.lock .github/scripts packages/infrastructure
git commit -m "feat: scaffold DTXWeb Access infrastructure"
```

---

### Task 2: Build The Perseus-shaped Access Application And Pulumi Entrypoint

**Files:**

- Modify: `packages/infrastructure/src/access.ts`
- Modify: `packages/infrastructure/src/access.test.ts`
- Create: `packages/infrastructure/src/index.ts`

**Interfaces:**

- Consumes: `AccessStackDefinition`, `getAccessStackDefinition`, `normalizeAccessEmail`, `normalizeDevicePostureRuleId`.
- Produces: `DEFAULT_ACCESS_SESSION_DURATION`, `ACCESS_APPLICATION_FLAGS`, `buildAccessPolicy(...)`, `buildAccessApplicationArgs(...)`, `createAccessApplication(...)`.
- `src/index.ts` is the only Pulumi entrypoint.

- [ ] **Step 1: Write failing tests for the policy and application shape**

Extend the import in `access.test.ts`:

```ts
import {
  ACCESS_APPLICATION_FLAGS,
  DEFAULT_ACCESS_SESSION_DURATION,
  buildAccessApplicationArgs,
  buildAccessPolicy,
  getAccessStackDefinition,
  normalizeAccessEmail,
  normalizeDevicePostureRuleId
} from './access.js';
```

Add:

```ts
it('builds one email + posture allow policy', () => {
  expect(buildAccessPolicy(' operator@example.com ', ' posture-rule-id ')).toEqual({
    name: 'Allow configured operator on trusted device',
    decision: 'allow',
    precedence: 1,
    includes: [{ email: { email: 'operator@example.com' } }],
    requires: [{ devicePosture: { integrationUid: 'posture-rule-id' } }]
  });
});

it('builds production with exact destinations and hardened defaults', () => {
  const args = buildAccessApplicationArgs({
    accountId: 'account-id',
    stackDefinition: getAccessStackDefinition('production'),
    accessEmail: 'operator@example.com',
    devicePostureRuleId: 'posture-rule-id'
  });

  expect(args).toMatchObject({
    accountId: 'account-id',
    name: 'DTXWeb Production App',
    type: 'self_hosted',
    domain: 'dtx.hapadona.com/app',
    destinations: [
      { type: 'public', uri: 'dtx.hapadona.com/app' },
      { type: 'public', uri: 'dtx.hapadona.com/app/*' }
    ],
    sessionDuration: DEFAULT_ACCESS_SESSION_DURATION,
    ...ACCESS_APPLICATION_FLAGS
  });

  expect(args.destinations).not.toContainEqual({ type: 'public', uri: 'dtx.hapadona.com' });
});

it('rejects a blank Cloudflare account ID', () => {
  expect(() =>
    buildAccessApplicationArgs({
      accountId: '   ',
      stackDefinition: getAccessStackDefinition('pre-prod'),
      accessEmail: 'operator@example.com',
      devicePostureRuleId: 'posture-rule-id'
    })
  ).toThrow(/cloudflareAccountId must not be empty/);
});
```

- [ ] **Step 2: Run tests and verify the new expectations fail**

```bash
bun run --filter=@dtx/infrastructure test
```

Expected: FAIL because the Access builders/constants do not exist.

- [ ] **Step 3: Implement the policy/application builders**

Extend `access.ts`:

```ts
import * as cloudflare from '@pulumi/cloudflare';
import * as pulumi from '@pulumi/pulumi';

export const DEFAULT_ACCESS_SESSION_DURATION = '12h';

export const ACCESS_APPLICATION_FLAGS = {
  appLauncherVisible: false,
  allowAuthenticateViaWarp: false,
  enableBindingCookie: true,
  httpOnlyCookieAttribute: true,
  pathCookieAttribute: false
} as const;

type AccessPolicy = cloudflare.types.input.ZeroTrustAccessApplicationPolicy;
type AccessApplicationArgs = cloudflare.ZeroTrustAccessApplicationArgs;

function normalizeAccountId(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) throw new Error('cloudflareAccountId must not be empty');
  return value;
}

function normalizeAccessEmailInput(value: pulumi.Input<string>): pulumi.Input<string> {
  return typeof value === 'string'
    ? normalizeAccessEmail(value)
    : pulumi.output(value).apply(normalizeAccessEmail);
}

export function buildAccessPolicy(
  accessEmail: pulumi.Input<string>,
  devicePostureRuleId: string
): AccessPolicy {
  return {
    name: 'Allow configured operator on trusted device',
    decision: 'allow',
    precedence: 1,
    includes: [{ email: { email: normalizeAccessEmailInput(accessEmail) } }],
    requires: [
      {
        devicePosture: {
          integrationUid: normalizeDevicePostureRuleId(devicePostureRuleId)
        }
      }
    ]
  };
}

export interface BuildAccessApplicationArgs {
  accountId: string;
  stackDefinition: AccessStackDefinition;
  accessEmail: pulumi.Input<string>;
  devicePostureRuleId: string;
  sessionDuration?: string;
}

export function buildAccessApplicationArgs(
  args: BuildAccessApplicationArgs
): AccessApplicationArgs {
  return {
    accountId: normalizeAccountId(args.accountId),
    name: args.stackDefinition.applicationName,
    type: 'self_hosted',
    domain: args.stackDefinition.domain,
    destinations: args.stackDefinition.destinations,
    sessionDuration: args.sessionDuration?.trim() || DEFAULT_ACCESS_SESSION_DURATION,
    ...ACCESS_APPLICATION_FLAGS,
    policies: [buildAccessPolicy(args.accessEmail, args.devicePostureRuleId)]
  };
}

export function createAccessApplication(
  args: BuildAccessApplicationArgs
): cloudflare.ZeroTrustAccessApplication {
  return new cloudflare.ZeroTrustAccessApplication(
    `dtxweb-${args.stackDefinition.stackName}-access`,
    buildAccessApplicationArgs(args)
  );
}
```

Do not add list/posture/token resources.

- [ ] **Step 4: Add the Pulumi entrypoint**

Create `packages/infrastructure/src/index.ts`:

```ts
import * as pulumi from '@pulumi/pulumi';
import { createAccessApplication, getAccessStackDefinition } from './access.js';

const config = new pulumi.Config();
const stackDefinition = getAccessStackDefinition(pulumi.getStack());

const accessApplication = createAccessApplication({
  accountId: config.require('cloudflareAccountId'),
  stackDefinition,
  accessEmail: config.requireSecret('accessEmail'),
  devicePostureRuleId: config.require('devicePostureRuleId'),
  sessionDuration: config.get('accessSessionDuration')
});

export const accessApplicationId = accessApplication.id;
```

Stack validation must happen before `createAccessApplication`.

- [ ] **Step 5: Run focused and package-wide verification**

```bash
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
```

Expected: PASS.

If the selected Cloudflare provider typings differ from the working Perseus shape, verify the current provider API before adapting names; do not redesign the policy semantics.

- [ ] **Step 6: Run the existing root unit-coverage command**

```bash
bun run test:coverage
```

Expected: the existing workspace coverage suite runs and includes `@dtx/infrastructure` rather than silently skipping it.

- [ ] **Step 7: Commit the Access resource slice**

```bash
git add packages/infrastructure

git commit -m "feat: define DTXWeb Cloudflare Access apps"
```

---

### Task 3: Finalize Operator Documentation And Produce Non-mutating Preview Evidence

**Files:**

- Create: `packages/infrastructure/README.md`
- Review/modify if implementation details require it: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

**Interfaces:**

- Consumes the implemented `@dtx/infrastructure` package and the already rewritten operator runbook.
- Produces repository-local setup documentation plus pre-prod/production preview evidence.
- Produces **no live Cloudflare mutation**.

- [ ] **Step 1: Write the infrastructure README**

Document:

- this package owns only DTXWeb Access applications;
- Workers/API/storage remain on Wrangler;
- supported stacks are exactly `pre-prod` and `production`;
- DTXWeb consumes the Perseus `adminAccessDevicePostureRuleId` as config;
- `pulumi login --local` defaults to state under `~/.pulumi`;
- stack config files are local/ignored;
- Cloudflare token requires `Access: Apps and Policies Write` for application lifecycle;
- package scripts are test/build/check only;
- live commands are taken from the operator runbook and always specify `--stack`;
- emergency provider-side deletion is documented only in the runbook.

Do not duplicate the full route matrices from the runbook.

- [ ] **Step 2: Validate the runbook against the implemented package**

Review `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md` and confirm its config keys exactly match code:

```text
cloudflareAccountId
accessEmail
devicePostureRuleId
accessSessionDuration
```

Confirm it remains marked operator-executed and owns every `pulumi up`, `pulumi destroy`, browser/device check, and dashboard emergency fallback.

If the implementation changed no interface, make no gratuitous runbook edit.

- [ ] **Step 3: Run the complete non-live repository verification**

```bash
bun install --frozen-lockfile
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure build
.github/scripts/ci-affected-scope.test.sh
bun run test:coverage
```

Expected: PASS.

- [ ] **Step 4: Run Pulumi previews only when authenticated local config is available**

If the operator/development environment already has the Cloudflare API token plus DTXWeb stack config, run:

```bash
cd packages/infrastructure
pulumi preview --stack pre-prod
pulumi preview --stack production
```

Expected pre-prod preview:

- one DTXWeb Access application;
- hostname-wide `pre-prod.dtx.hapadona.com`;
- existing posture-rule reference;
- no API/list/posture/token/Worker/storage resource.

Expected production preview:

- one `DTXWeb Production App`;
- destinations exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`;
- no hostname-wide production destination;
- no API/list/posture/token/Worker/storage resource.

If authenticated config is unavailable, record the previews as `NOT RUN — operator credentials/config required`; do not manufacture config values or ask for secrets in PR comments.

**Do not run `pulumi up` or `pulumi destroy`.**

- [ ] **Step 5: Commit documentation/preview-ready state**

```bash
git add packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
git commit -m "docs: document DTXWeb Access operations"
```

If the runbook did not change, commit only the README.

---

## Operator Handoff — Not Agent Plan Tasks

After Tasks 1–3 are complete, stop implementation and hand the operator to:

`docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

The operator performs, in order:

1. pre-prod preview review;
2. `pulumi up --stack pre-prod`;
3. pre-prod route/browser/posture acceptance;
4. only after pre-prod is green, production preview review;
5. `pulumi up --stack production`;
6. production route/identity/posture/browser/session-expiry/desktop acceptance;
7. stack-specific rollback if required;
8. dashboard disable/delete only if Pulumi state/backend is unavailable during an emergency.

These are deliberately outside the `For agentic workers` task list.

## Final Implementation Verification

Before claiming the implementation branch complete, verify:

```bash
git diff --check
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure test:coverage
.github/scripts/ci-affected-scope.test.sh
```

Confirm the diff contains no changes under:

```text
packages/dtx-web/
packages/dtx-api/
packages/dtx-desktop/
```

Confirm no committed file contains real operator email, API token, device serial, Access cookie/JWT, Pulumi stack config, or Pulumi state export.

Confirm the Access code contains no `ZeroTrustList`, `ZeroTrustDevicePostureRule`, `ZeroTrustAccessServiceToken`, Service Auth policy, or hostname-configurable production destination.
