# Cloudflare Zero Trust Web Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage DTXWeb Cloudflare Zero Trust Access declaratively with a small Pulumi package that protects all pre-production web traffic and only production `/app`, while reusing the existing Perseus device-posture rule.

**Architecture:** Add an Access-only `packages/infrastructure` workspace modeled on the proven Perseus Pulumi implementation. One program serves exactly two stacks (`pre-prod` and `production`); stack name owns the immutable hostname/path scope, while Pulumi config supplies only the Cloudflare account ID, secret operator email, existing Perseus posture-rule ID, and optional session duration. Apply and verify pre-production first; production is a separate stack and is not applied until pre-production acceptance is green.

**Tech Stack:** Bun workspaces/Turborepo, TypeScript, Pulumi `@pulumi/pulumi` `^3.144.0`, Pulumi Cloudflare provider `@pulumi/cloudflare` `^6.13.0`, Vitest `^4.0.18`, Cloudflare Zero Trust Access, Wrangler for existing Worker/API deployment.

**Spec:** `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`

## Global Constraints

- Pulumi owns only DTXWeb Cloudflare Access applications in this slice; Wrangler keeps ownership of Workers, API deployment, D1, R2, service bindings, runtime variables, and application secrets.
- Do not modify `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop`.
- Reuse the existing Perseus device-posture rule by Cloudflare resource ID; do not create a DTXWeb serial list or device-posture rule.
- Do not add a Pulumi `StackReference` to Perseus.
- Supported stack names are exactly `pre-prod` and `production`; any other stack must fail before registering resources.
- Pre-production scope is code-owned and hostname-wide: `pre-prod.dtx.hapadona.com`.
- Production scope is code-owned and exactly `dtx.hapadona.com/app` plus `dtx.hapadona.com/app/*`; production hostname/path destinations are not Pulumi config.
- Keep `api.dtx.hapadona.com`, `api.pre-prod.dtx.hapadona.com`, and all intended public production routes outside Access.
- The Access policy has one `allow` decision with the configured email in `includes` and the existing posture-rule ID in `requires`; default session duration is `12h`.
- Reuse the hardened browser-application flags already proven in Perseus: `appLauncherVisible: false`, `allowAuthenticateViaWarp: false`, `enableBindingCookie: true`, `httpOnlyCookieAttribute: true`, `pathCookieAttribute: false`.
- Do not add service tokens, Service Auth, CLI Access applications, Managed OAuth, Worker-side `CF_Authorization` validation, or unattended pre-production E2E credentials.
- `accessEmail` is Pulumi secret config. `devicePostureRuleId` is plain config and must point to the Perseus-managed rule.
- `Pulumi.<stack>.yaml`, `.pulumi/`, API tokens, operator email, device serials, Access cookies/JWTs, and screenshots containing security identifiers must not be committed.
- Keep deployment operator-executed and local-backend-based for this slice; do not add GitHub Actions deployment.
- Every operational `preview`, `up`, and `destroy` command must name its stack explicitly.
- Run and prove `pre-prod` before applying `production`.
- The checked-in runbook owns live route matrices, browser/desktop acceptance, and rollback commands; do not duplicate those matrices in future operational docs.
- If runtime verification requires application/API/desktop code changes, stop and create a separate follow-up instead of expanding this slice.

---

### Task 1: Add The Infrastructure Workspace And Immutable Stack Definitions

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Create: `packages/infrastructure/.gitignore`
- Create: `packages/infrastructure/Pulumi.yaml`
- Create: `packages/infrastructure/package.json`
- Create: `packages/infrastructure/tsconfig.json`
- Create: `packages/infrastructure/vitest.config.ts`
- Create: `packages/infrastructure/src/access.ts`
- Create: `packages/infrastructure/src/access.test.ts`

**Interfaces:**

- Produces: `AccessStackDefinition`, `getAccessStackDefinition(stackName)`, `normalizeAccessEmail(rawValue)`, and `normalizeDevicePostureRuleId(rawValue)` in `src/access.ts`.
- Later tasks consume those exact helpers to build Pulumi application args and select the current stack.

- [ ] **Step 1: Add the workspace/package scaffolding**

Add `packages/infrastructure` to the root `workspaces` array; do not add root deploy scripts yet.

Create `packages/infrastructure/package.json` with the same dependency floors currently working in Perseus:

```json
{
  "name": "@dtx/infrastructure",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "postinstall": "echo 'Skipping automatic pulumi install during dependency install'",
    "pulumi:install": "command -v pulumi > /dev/null 2>&1 && pulumi install || echo 'Skipping pulumi install: Pulumi CLI not found'",
    "pulumi:preview": "pulumi preview",
    "pulumi:up": "pulumi up",
    "pulumi:destroy": "pulumi destroy",
    "pulumi:refresh": "pulumi refresh",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@pulumi/pulumi": "^3.144.0",
    "@pulumi/cloudflare": "^6.13.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.9.0",
    "vitest": "^4.0.18"
  }
}
```

Create `Pulumi.yaml`:

```yaml
name: dtxweb-infrastructure
runtime: nodejs
description: DTXWeb Cloudflare Access infrastructure managed by Pulumi
main: dist/index.js
```

Create `.gitignore`:

```text
Pulumi.*.yaml
.pulumi/
node_modules/
dist/
.env
.env.local
```

Create `tsconfig.json` following Perseus:

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

Create `vitest.config.ts`:

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

Expected: `bun.lock` updates and `@dtx/infrastructure` is recognized as a workspace.

- [ ] **Step 2: Write failing tests for stack scope and input validation**

Create the first `src/access.test.ts` tests:

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
      applicationName: 'DTXWeb Pre-prod',
      domain: 'pre-prod.dtx.hapadona.com',
      destinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }]
    });
  });

  it('makes production exactly /app plus /app/*', () => {
    expect(getAccessStackDefinition('production')).toEqual({
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

  it('rejects malformed or multiple emails', () => {
    expect(() => normalizeAccessEmail('not-an-email')).toThrow(/single email address/);
    expect(() => normalizeAccessEmail('a@example.com,b@example.com')).toThrow(/single email address/);
  });

  it('requires an existing posture-rule ID', () => {
    expect(normalizeDevicePostureRuleId(' posture-rule-id ')).toBe('posture-rule-id');
    expect(() => normalizeDevicePostureRuleId('   ')).toThrow(/devicePostureRuleId must not be empty/);
  });
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
bun run --filter=@dtx/infrastructure test
```

Expected: FAIL because `src/access.ts` or the named exports do not exist yet.

- [ ] **Step 4: Implement only the immutable stack model and validators**

Create `src/access.ts` with these public interfaces and behavior:

```ts
const ACCESS_EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export interface AccessDestination {
  type: 'public';
  uri: string;
}

export interface AccessStackDefinition {
  applicationName: string;
  domain: string;
  destinations: AccessDestination[];
}

const ACCESS_STACKS: Record<'pre-prod' | 'production', AccessStackDefinition> = {
  'pre-prod': {
    applicationName: 'DTXWeb Pre-prod',
    domain: 'pre-prod.dtx.hapadona.com',
    destinations: [{ type: 'public', uri: 'pre-prod.dtx.hapadona.com' }]
  },
  production: {
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

Do not make hostnames or destinations parameters.

- [ ] **Step 5: Run the focused test/check cycle**

Run:

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
```

Expected: PASS.

- [ ] **Step 6: Commit the independently testable stack-model slice**

```bash
git add package.json bun.lock packages/infrastructure
git commit -m "feat: scaffold DTXWeb Access infrastructure"
```

---

### Task 2: Build The Access Application Args And Pulumi Entrypoint

**Files:**

- Modify: `packages/infrastructure/src/access.ts`
- Modify: `packages/infrastructure/src/access.test.ts`
- Create: `packages/infrastructure/src/index.ts`

**Interfaces:**

- Consumes: `AccessStackDefinition`, `getAccessStackDefinition`, `normalizeAccessEmail`, and `normalizeDevicePostureRuleId` from Task 1.
- Produces: `DEFAULT_ACCESS_SESSION_DURATION`, `ACCESS_APPLICATION_FLAGS`, `buildAccessPolicy(...)`, `buildAccessApplicationArgs(...)`, and `createAccessApplication(...)`.
- `src/index.ts` is the only Pulumi program entrypoint and calls `getAccessStackDefinition(pulumi.getStack())` before creating resources.

- [ ] **Step 1: Add failing tests for the policy and application shape**

Extend the existing import from `./access.js` with these names rather than adding a second import later in the file:

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

Add these focused tests:

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

it('builds the production application with the hardened defaults', () => {
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
});

it('never builds hostname-wide production Access', () => {
  const args = buildAccessApplicationArgs({
    accountId: 'account-id',
    stackDefinition: getAccessStackDefinition('production'),
    accessEmail: 'operator@example.com',
    devicePostureRuleId: 'posture-rule-id'
  });

  expect(args.destinations).not.toContainEqual({ type: 'public', uri: 'dtx.hapadona.com' });
});

it('rejects an empty Cloudflare account ID before deployment', () => {
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

- [ ] **Step 2: Run the tests and verify the new expectations fail**

```bash
bun run --filter=@dtx/infrastructure test
```

Expected: FAIL because the application/policy builders do not exist.

- [ ] **Step 3: Implement the Pulumi-compatible builders and resource factory**

Extend `src/access.ts` using the same provider shapes as Perseus:

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
      { devicePosture: { integrationUid: normalizeDevicePostureRuleId(devicePostureRuleId) } }
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

export function buildAccessApplicationArgs(args: BuildAccessApplicationArgs): AccessApplicationArgs {
  if (!args.accountId.trim()) throw new Error('cloudflareAccountId must not be empty');

  return {
    accountId: args.accountId.trim(),
    name: args.stackDefinition.applicationName,
    type: 'self_hosted',
    domain: args.stackDefinition.domain,
    destinations: args.stackDefinition.destinations,
    sessionDuration: args.sessionDuration ?? DEFAULT_ACCESS_SESSION_DURATION,
    ...ACCESS_APPLICATION_FLAGS,
    policies: [buildAccessPolicy(args.accessEmail, args.devicePostureRuleId)]
  };
}

export function createAccessApplication(args: BuildAccessApplicationArgs) {
  return new cloudflare.ZeroTrustAccessApplication(
    'dtxweb-access-application',
    buildAccessApplicationArgs(args)
  );
}
```

The current Pulumi Cloudflare v6 resource is `ZeroTrustAccessApplication` and supports `destinations`, `policies`, `domain`, and `sessionDuration`. If dependency resolution installs a later compatible v6 release, keep this non-deprecated resource and the external behavior above; do not switch to deprecated `AccessApplication` resources.

- [ ] **Step 4: Add the Pulumi program entrypoint**

Create `src/index.ts`:

```ts
import * as pulumi from '@pulumi/pulumi';
import { createAccessApplication, getAccessStackDefinition } from './access.js';

const config = new pulumi.Config();
const stackDefinition = getAccessStackDefinition(pulumi.getStack());

const application = createAccessApplication({
  accountId: config.require('cloudflareAccountId'),
  stackDefinition,
  accessEmail: config.requireSecret('accessEmail'),
  devicePostureRuleId: config.require('devicePostureRuleId'),
  sessionDuration: config.get('accessSessionDuration') ?? undefined
});

export const accessApplicationId = application.id;
```

Do not create or look up the posture resource in this program.

- [ ] **Step 5: Run the package and root static checks**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
bun run check
```

Expected: all pass. The root `check` should discover the new workspace through the existing Turborepo `check` task without a `turbo.json` change.

- [ ] **Step 6: Commit the Access resource implementation**

```bash
git add packages/infrastructure/src
git commit -m "feat: manage DTXWeb Access with Pulumi"
```

---

### Task 3: Rewrite The Infrastructure README And Zero Trust Runbook For Pulumi

**Files:**

- Create: `packages/infrastructure/README.md`
- Modify: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

**Interfaces:**

- Consumes: the exact stack/config names from Tasks 1-2.
- Produces: the single operator procedure for obtaining the Perseus posture-rule ID, configuring local stacks, previewing/applying Access, running acceptance, and rolling back one environment.

- [ ] **Step 1: Write the infrastructure README with exact local setup commands**

Document these prerequisites and commands without real identifiers:

```bash
cd packages/infrastructure
pulumi login --local

pulumi stack select pre-prod || pulumi stack init pre-prod
pulumi stack select production || pulumi stack init production

pulumi config set cloudflareAccountId "$CLOUDFLARE_ACCOUNT_ID" --stack pre-prod
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack pre-prod
pulumi config set devicePostureRuleId "$PERSEUS_POSTURE_RULE_ID" --stack pre-prod

pulumi config set cloudflareAccountId "$CLOUDFLARE_ACCOUNT_ID" --stack production
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack production
pulumi config set devicePostureRuleId "$PERSEUS_POSTURE_RULE_ID" --stack production
```

Document that the optional duration override is:

```bash
pulumi config set accessSessionDuration 12h --stack pre-prod
pulumi config set accessSessionDuration 12h --stack production
```

Document how to obtain the shared posture ID from the existing Perseus infrastructure stack:

```bash
pulumi stack output adminAccessDevicePostureRuleId
```

Run that command from the Perseus infrastructure project/stack that owns the current trusted-device posture rule; do not copy serial numbers into DTXWeb.

Document the Cloudflare token requirement as an account-scoped token with `Access: Apps and Policies Write`, which Cloudflare currently accepts for Access application and application-policy writes. Do not add permissions for Workers, D1, R2, service tokens, or device-posture writes for this DTXWeb package.

- [ ] **Step 2: Replace dashboard configuration in the runbook with Pulumi preview/apply**

Keep the existing hardened HTTP helper, pre-production route matrix, production route matrix, independent identity/posture checks, browser checks, desktop checks, session-expiry check, and known non-operator lockout.

Replace the configuration sections with these named operations:

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build

cd packages/infrastructure
pulumi preview --stack pre-prod
pulumi up --stack pre-prod
```

Then, only after pre-production acceptance is green:

```bash
pulumi preview --stack production
pulumi up --stack production
```

State the preview acceptance criteria explicitly:

- pre-prod preview: one `cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication`, hostname-wide `pre-prod.dtx.hapadona.com`, no API hostname;
- production preview: one Access application with exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` destinations;
- hard stop if preview creates a device list, posture rule, service token, Worker/storage resource, API Access application, or hostname-wide production destination.

- [ ] **Step 3: Rewrite rollback around stack-specific destroy previews**

Use exactly:

```bash
pulumi preview --destroy --stack pre-prod
pulumi destroy --stack pre-prod --yes
```

or:

```bash
pulumi preview --destroy --stack production
pulumi destroy --stack production --yes
```

Before `destroy`, require the operator to confirm the preview deletes only the corresponding DTXWeb Access application. Do not use `pulumi stack rm` as rollback; retain stack/config state for a later re-apply.

- [ ] **Step 4: Add secret/state hygiene checks**

Run:

```bash
bunx prettier --check packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
git status --short
git check-ignore packages/infrastructure/Pulumi.pre-prod.yaml packages/infrastructure/Pulumi.production.yaml packages/infrastructure/.pulumi
```

Expected:

- formatting check passes;
- stack config/state paths are ignored;
- no operator email, device serial, API token, Access cookie/JWT, or Pulumi local state is staged.

- [ ] **Step 5: Commit the Pulumi operator documentation**

```bash
git add packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
git commit -m "docs: document Pulumi Access rollout"
```

---

### Task 4: Configure, Preview, Apply, And Prove Pre-production

**Files:**

- Reference: `packages/infrastructure/README.md`
- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No tracked source files should change during stack configuration or apply.

**Interfaces:**

- Consumes: built infrastructure package plus local `pre-prod` Pulumi config containing `cloudflareAccountId`, secret `accessEmail`, and the existing Perseus `devicePostureRuleId`.
- Produces: a verified hostname-wide `DTXWeb Pre-prod` Access application and a hard go/no-go for production.

- [ ] **Step 1: Establish local backend/config without committing it**

Follow the README to log into the local backend and select/init `pre-prod`. Set the three required values using shell/environment values; never paste them into tracked Markdown or source.

Verify:

```bash
pulumi config --stack pre-prod
```

Expected: the three keys exist; `accessEmail` is displayed as a secret value.

- [ ] **Step 2: Re-run the code gate immediately before preview**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
```

Expected: PASS.

- [ ] **Step 3: Preview pre-production and inspect resource scope**

```bash
cd packages/infrastructure
pulumi preview --stack pre-prod
```

Expected:

- exactly one DTXWeb-managed resource is created;
- it is a `ZeroTrustAccessApplication` named `DTXWeb Pre-prod`;
- its destination is hostname-wide `pre-prod.dtx.hapadona.com`;
- no API hostname, posture/list, service token, Worker, or storage resource appears.

If the preview differs, stop before `up` and fix the code/config.

- [ ] **Step 4: Apply pre-production**

```bash
pulumi up --stack pre-prod
```

Expected: one Access application created successfully.

- [ ] **Step 5: Execute the runbook's complete pre-production acceptance**

Run the runbook's pre-production HTTP matrix with no Access session, then perform:

- allowed operator identity on trusted posture;
- password login behind Access;
- Google OAuth behind Access;
- API-backed app behavior;
- failed-posture denial;
- pre-production API non-interception.

Expected: every required check passes.

- [ ] **Step 6: Enforce the go/no-go**

If any required check fails:

```bash
pulumi preview --destroy --stack pre-prod
pulumi destroy --stack pre-prod --yes
```

Confirm only `DTXWeb Pre-prod` is deleted, record the non-sensitive failure, and stop. Do not start Task 5.

If all checks pass, record only `Pre-prod Access: PASS`-style outcomes in the PR/implementation notes; do not commit credentials or screenshots containing identifiers.

---

### Task 5: Preview, Apply, And Prove Production `/app`

**Files:**

- Reference: `packages/infrastructure/README.md`
- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No tracked source files should change during production stack configuration or apply.

**Interfaces:**

- Consumes: a fully green Task 4 and local `production` Pulumi config using the same operator identity semantics and Perseus posture-rule ID.
- Produces: path-scoped production Access plus route, identity, posture, browser, session-expiry, and desktop evidence.

- [ ] **Step 1: Configure/select production only after pre-production is green**

Follow the README to select/init `production` and set the required config. Verify:

```bash
pulumi config --stack production
```

Expected: `cloudflareAccountId`, secret `accessEmail`, and `devicePostureRuleId` exist.

- [ ] **Step 2: Preview production and reject any broadening**

```bash
pulumi preview --stack production
```

Expected:

- exactly one DTXWeb-managed Access application;
- name `DTXWeb Production App`;
- destinations exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`;
- no hostname-wide `dtx.hapadona.com` destination;
- no API hostname or additional Cloudflare resource type.

Any mismatch is a hard stop.

- [ ] **Step 3: Apply production**

```bash
pulumi up --stack production
```

Expected: one production Access application created successfully.

- [ ] **Step 4: Run the complete production route matrix**

Execute the runbook's single production matrix.

Expected protected/intercepted:

- `/app`
- `/app/`
- `/app/score`
- `/app/__data.json`

Expected outside Access:

- `/`
- `/blog`
- `/preview/1`
- `/editor`
- `/tool/dtx-to-midi`
- `/game`
- `/login`
- `/auth/callback`
- both API hostnames.

Every assertion must prove a real HTTP response; DNS/connection/TLS/timeout failure is not a pass.

- [ ] **Step 5: Prove the Access policy clauses independently**

Follow the runbook exactly:

1. configured operator identity + trusted device => allowed;
2. non-allowed IdP identity on that same trusted device => denied by Access;
3. configured operator identity on a device that fails the posture rule => denied by Access.

Do not substitute a second Supabase identity for step 2.

- [ ] **Step 6: Complete browser/session/non-operator acceptance**

Verify:

- operator `/app -> /login -> /app` works with Access as the outer gate and Supabase as the inner gate;
- ending the Access session during SvelteKit client navigation into `/app` is characterized and direct `/app` navigation/reload provides a usable reauthentication path;
- a signed-in non-operator reproduces the documented `/login -> /app` denial dead end and cookie clearing recovers the browser.

If direct protected navigation cannot recover after Access reauthentication, rollback production and stop.

- [ ] **Step 7: Complete bundled and standalone desktop authentication**

On the trusted operator device verify both password and Google login for:

- bundled desktop callback `dtx://auth-callback`;
- standalone `bun run dev:desktop` loopback callback `http://127.0.0.1:<configured-port>/auth-callback` against the deployed production target used by the current local `.env`.

The full-local-stack `bun run dev` / `dev:local-web` flow is not a substitute for this production Access test.

- [ ] **Step 8: Roll back production on any required failure**

```bash
pulumi preview --destroy --stack production
pulumi destroy --stack production --yes
```

Confirm the only deletion is `DTXWeb Production App`. Keep the verified pre-production stack intact for diagnosis.

---

### Task 6: Run Final Repository Verification And Record Non-sensitive Acceptance

**Files:**

- Modify only if needed for factual documentation corrections found during execution: `packages/infrastructure/README.md`, `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- Do not modify application/API/desktop source.

**Interfaces:**

- Consumes: successful Tasks 1-5.
- Produces: final evidence that the codebase contains only the approved Access IaC/docs and that live environment acceptance matches the spec.

- [ ] **Step 1: Run fresh infrastructure and repository checks**

```bash
bun run --filter=@dtx/infrastructure test
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure build
bun run check
bun run test
```

Expected: PASS. If an unrelated pre-existing repository failure appears, record it precisely rather than claiming a green repository.

- [ ] **Step 2: Prove scope stayed out of application code**

Run:

```bash
git diff --exit-code main...HEAD -- packages/dtx-web packages/dtx-api packages/dtx-desktop
git status --short
```

Expected: no changes under the three application packages; no local Pulumi config/state or secrets appear as tracked/staged files.

- [ ] **Step 3: Re-run both durable route-boundary checks after all troubleshooting**

Re-run the runbook's pre-production and production HTTP matrices.

Expected: both still pass; production public/API boundaries did not drift during browser/desktop troubleshooting.

- [ ] **Step 4: Record only non-sensitive outcomes**

Use a checklist like:

```text
Infrastructure unit tests/typecheck/build: PASS
Pre-prod preview scope: PASS
Pre-prod Access acceptance: PASS
Production preview exact /app scope: PASS
Production public/API matrix: PASS
Production Access identity selector: PASS
Production posture selector: PASS
Production operator browser auth: PASS
Production expired-session recovery characterized: PASS
Production non-operator lockout characterized: PASS
Production bundled desktop auth: PASS
Production tauri-dev loopback auth: PASS
```

Do not record operator email, posture-rule ID, account ID, cookies/JWTs, API tokens, or device serials.

- [ ] **Step 5: Commit only factual doc corrections, if execution required them**

If no documentation changed, do not create an empty commit.

If the runbook/README needed factual corrections discovered during live execution:

```bash
git add packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
git commit -m "docs: refine Zero Trust rollout guidance"
```

The implementation is complete only when fresh verification evidence exists for the final tracked code and the final live Access state.
