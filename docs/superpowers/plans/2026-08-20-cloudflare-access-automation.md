# Cloudflare Access Deployment Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the two existing DTXWeb Cloudflare Access applications to Pulumi Cloud and deploy them automatically, pre-production before production, after relevant changes reach `main`.

**Architecture:** PR A adds an inert safety foundation: protected resource registration, isolated Pulumi dependency updates, and a tested live-boundary verifier. An operator gate then migrates both existing stack states, establishes Pulumi Cloud/OIDC/GitHub Environment prerequisites, and produces encrypted stack settings. PR B commits those settings and activates one serial two-job GitHub Actions workflow.

**Tech Stack:** Bun 1.3.9, TypeScript 5, Vitest 3, Bash, Pulumi Cloud, `@pulumi/pulumi`, `@pulumi/cloudflare`, GitHub Actions OIDC, Cloudflare Zero Trust Access.

**Spec:** `docs/superpowers/specs/2026-08-20-cloudflare-access-automation-design.md`

## Global Constraints

- Work only in `/Users/chanwaichan/workspace/drumery/.worktrees/cloudflare-zero-trust-web-access` on `codex/cloudflare-zero-trust-web-access`; do not implement on `main`.
- All shell commands are prefixed with `rtk`.
- Use TDD for behavior changes: observe RED, implement the minimum, then observe focused GREEN.
- Keep the Access resources exactly `DTXWeb Pre-prod` over `pre-prod.dtx.hapadona.com` and `DTXWeb Production App` over only `dtx.hapadona.com/app` plus `dtx.hapadona.com/app/*`.
- Keep exactly one allow policy: configured email in `Include`, the Perseus-owned posture-rule ID in `Require`, and a `12h` default session.
- Register exactly one `cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication` named `dtxweb-${stack}-access`, with `{ protect: true }`.
- Do not add pull-request Pulumi previews, automatic rollback, automatic destroy, a YAML parser, a composite action, a cross-repository `StackReference`, or a Perseus checkout in CI.
- GitHub OIDC audience is exactly `urn:pulumi:org:cwchanap`; accepted subjects are exactly `repo:cwchanap/DTXWeb:environment:dtx-access-pre-prod` and `repo:cwchanap/DTXWeb:environment:dtx-access-production`.
- Use `pulumi/auth-actions@1c89817aab0c66407723cdef72b05266e7376640` and `pulumi/actions@8582a9e8cc630786854029b4e09281acd6794b58`.
- GitHub Environment secret name is `CLOUDFLARE_ACCESS_API_TOKEN`; expose it only as `CLOUDFLARE_API_TOKEN` during Pulumi execution.
- The Cloudflare token has only account-level `Access: Apps and Policies Edit` for the target account; no Workers, DNS, D1, R2, token-management, or global-key privileges.
- Never create `PULUMI_ACCESS_TOKEN` or `PULUMI_CONFIG_PASSPHRASE` in GitHub.
- Keep `CLOUDFLARE_ACCOUNT_ID` as the existing repository variable; do not duplicate it in committed stack settings.
- Commit `accessEmail` only as Pulumi Cloud ciphertext and `devicePostureRuleId` as non-secret stack config. Never commit `encryptionsalt` or a local-passphrase stack file.
- `pulumi up` performs the recurring preview and update; do not add a preceding recurring `pulumi preview` action.
- Do not push, open/merge a PR, mutate GitHub/Pulumi Cloud/Cloudflare, or remove migration exports without the coordinator handling the external-action gate.
- Do not run the monorepo-wide build. Build only `@dtx/infrastructure`; `@dtx/common` is unchanged.

---

## PR A — Inert Safety Foundation

### Task 1: Protect Resource Identity and Isolate Pulumi Dependency Updates

**Files:**

- Modify: `packages/infrastructure/src/access.ts`
- Modify: `packages/infrastructure/src/access.test.ts`
- Create: `packages/infrastructure/src/index.test.ts`
- Modify: `.github/dependabot.yml`

**Interfaces:**

- Consumes: existing `createAccessApplication(args: BuildAccessApplicationArgs)` and `src/index.ts` stack registration.
- Produces: the same function signature, now passing `{ protect: true }`; a runtime-mocks regression test for the one resource; a standalone Dependabot group matching `@pulumi/*`.

- [ ] **Step 1: Add a failing constructor-options test**

Hoist a Vitest constructor spy for `@pulumi/cloudflare`, retain the real module's other exports, import `createAccessApplication`, and add this table-driven assertion to `access.test.ts`:

```typescript
it.each([
	['pre-prod', 'dtxweb-pre-prod-access'],
	['production', 'dtxweb-production-access']
] as const)('protects the %s application resource identity', (stack, logicalName) => {
	createAccessApplication({
		accountId: 'account-id',
		stackDefinition: getAccessStackDefinition(stack),
		accessEmail: 'operator@example.com',
		devicePostureRuleId: 'posture-rule-id'
	});

	expect(zeroTrustAccessApplicationMock).toHaveBeenLastCalledWith(
		logicalName,
		expect.objectContaining({ name: getAccessStackDefinition(stack).applicationName }),
		{ protect: true }
	);
});
```

Clear the spy before each test. The spy must observe the constructor's third argument; do not replace this with a constant-only assertion.

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```bash
rtk bun run --filter=@dtx/infrastructure test -- src/access.test.ts
```

Expected: FAIL because `createAccessApplication` currently passes only the logical name and args.

- [ ] **Step 3: Add resource protection**

Change only the constructor call in `createAccessApplication`:

```typescript
return new cloudflare.ZeroTrustAccessApplication(
	`dtxweb-${args.stackDefinition.stackName}-access`,
	buildAccessApplicationArgs(args),
	{ protect: true }
);
```

- [ ] **Step 4: Add the runtime registration test**

In `index.test.ts`, configure Pulumi runtime mocks for project `dtxweb-infrastructure`, stack `production`, and these project-namespaced config keys:

```typescript
pulumi.runtime.setAllConfig(
	{
		'dtxweb-infrastructure:cloudflareAccountId': 'account-id',
		'dtxweb-infrastructure:accessEmail': 'operator@example.com',
		'dtxweb-infrastructure:devicePostureRuleId': 'posture-rule-id'
	},
	['dtxweb-infrastructure:accessEmail']
);
```

Capture every `MockResourceArgs` from `newResource`, dynamically import `./index.js`, resolve `accessApplicationId`, and assert exactly one captured resource whose type starts with `cloudflare:`:

```typescript
expect(cloudflareResources).toHaveLength(1);
expect(cloudflareResources[0]).toMatchObject({
	type: 'cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication',
	name: 'dtxweb-production-access'
});
```

Do not assert policy/destination inputs here; `access.test.ts` already owns them. `MockResourceArgs` cannot observe resource options, so protection remains covered at the constructor seam.

- [ ] **Step 5: Separate Pulumi Dependabot updates**

Add this group before `js-minor-and-patch`:

```yaml
pulumi-minor-and-patch:
    patterns:
        - '@pulumi/*'
    update-types:
        - 'minor'
        - 'patch'
```

Add this exclusion to the catch-all group:

```yaml
exclude-patterns:
    - '@pulumi/*'
```

- [ ] **Step 6: Run focused GREEN and package checks**

Run:

```bash
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure check
rtk bunx prettier --check packages/infrastructure/src/access.ts packages/infrastructure/src/access.test.ts packages/infrastructure/src/index.test.ts .github/dependabot.yml
```

Expected: all commands exit 0; the test output includes the constructor-options and one-registration cases.

- [ ] **Step 7: Commit Task 1**

```bash
rtk git add packages/infrastructure/src/access.ts packages/infrastructure/src/access.test.ts packages/infrastructure/src/index.test.ts .github/dependabot.yml
rtk git commit -m "feat(infrastructure): protect Access applications"
```

### Task 2: Version-Control the Fail-Closed Access Boundary Verifier

**Files:**

- Create: `packages/infrastructure/scripts/verify-access.sh`
- Create: `packages/infrastructure/scripts/verify-access.test.sh`
- Modify: `packages/infrastructure/package.json`

**Interfaces:**

- Consumes: one positional environment argument, exactly `pre-prod` or `production`; a `curl` executable found through `PATH`.
- Produces: exit 0 only when every protected route is Access-intercepted and every public route is not; `test` and `test:coverage` both run the Bash suite after Vitest.

- [ ] **Step 1: Write the failing Bash test harness**

Create `verify-access.test.sh` with `set -euo pipefail`. Create a temporary `bin/curl`, prepend it to `PATH`, and remove the temporary directory on exit. The fake curl must:

- parse the last argument as the URL;
- append that URL to `$FAKE_CURL_LOG`;
- emit the response selected by `$FAKE_CURL_SCENARIO`;
- return non-zero for `network-failure`;
- emit Access `403` headers for protected hosts/paths and public `200`, `303`, or `404` for public paths in the two full-matrix scenarios.

Use a `run_case <name> <expected-status> <scenario> <environment>` helper and cover exactly:

```text
cloudflare-host redirect accepted
generic redirect rejected for protected route
cloudflare-host redirect with a malformed port rejected
403 with both Access headers accepted
403 missing either Access header rejected
public 200, 303, and 404 accepted
Access interception on a public route rejected
network failure rejected
unsupported environment rejected before curl
pre-prod full matrix requests every specified URL
production full matrix requests every specified URL
```

The first run should fail because `verify-access.sh` does not exist.

- [ ] **Step 2: Observe RED**

Run:

```bash
rtk bash packages/infrastructure/scripts/verify-access.test.sh
```

Expected: non-zero with the missing verifier as the reason.

- [ ] **Step 3: Implement header classification**

Create `verify-access.sh` with `set -euo pipefail` and these functions:

```bash
http_headers()              # curl -sS --max-time 15 -o /dev/null -D - URL; fail on transport/no status
has_access_interception()   # exact Cloudflare redirect OR 403 plus both Access headers
assert_access_intercepted() # fail when has_access_interception is false
assert_public()             # fail when Access interception or either Access header is present
verify_pre_prod()           # run the exact pre-production matrix
verify_production()         # run the exact production matrix
```

Classify a redirect only when the final status is `3xx` and `Location` matches this case-insensitive Bash/grep ERE:

```text
^https://([[:alnum:]-]+\.)+cloudflareaccess\.com(:[0-9]+)?([/?#]|$)
```

A `Location` whose host continues with a non-numeric suffix after a colon (for example
`https://tenant.cloudflareaccess.com:bad`) is therefore not an Access redirect.

Classify the header form only when final status is exactly `403` and both header names occur case-insensitively at line start:

```text
^cf-access-aud:
^cf-access-domain:
```

Print only the status line, `Location`, and the two Access header names with values redacted. Never print cookies or Access header values.

- [ ] **Step 4: Encode the exact route matrices**

Pre-production protected URLs use `https://pre-prod.dtx.hapadona.com` plus:

```text
/
/login
/auth/callback
/blog
/preview/1
/editor
/tool/dtx-to-midi
/game
/app
/app/
/app/score
/app/__data.json
```

Pre-production public URL:

```text
https://api.pre-prod.dtx.hapadona.com/
```

Production protected URLs use `https://dtx.hapadona.com` plus:

```text
/app
/app/
/app/score
```

Production public URLs use `https://dtx.hapadona.com` plus `/`, `/login`, `/auth/callback`, `/blog`, `/preview/1`, `/editor`, `/tool/dtx-to-midi`, and `/game`, plus:

```text
https://api.dtx.hapadona.com/
```

Reject missing or extra arguments and unsupported environments before the first network call.

- [ ] **Step 5: Wire both package suites**

Update only these scripts in `packages/infrastructure/package.json`:

```json
"test": "vitest --run && bash scripts/verify-access.test.sh",
"test:coverage": "vitest --run --coverage && bash scripts/verify-access.test.sh"
```

Mark both scripts executable with `rtk chmod +x` so the runbook and workflow can invoke the verifier directly.

- [ ] **Step 6: Run focused GREEN and coverage**

Run:

```bash
rtk bash packages/infrastructure/scripts/verify-access.test.sh
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure test:coverage
rtk bunx prettier --check packages/infrastructure/package.json
```

Expected: every command exits 0; shell output names all ten passing scenarios; no real network request occurs.

- [ ] **Step 7: Commit Task 2**

```bash
rtk git add packages/infrastructure/scripts/verify-access.sh packages/infrastructure/scripts/verify-access.test.sh packages/infrastructure/package.json
rtk git commit -m "test(infrastructure): verify Access boundaries"
```

### Task 3: Reuse the Verifier in the Operator Runbook and Prove the Live Shape

**Files:**

- Modify: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

**Interfaces:**

- Consumes: `packages/infrastructure/scripts/verify-access.sh pre-prod|production` from Task 2.
- Produces: a runbook that no longer relies on `ACCESS_REDIRECT_RE`, without yet claiming that Pulumi Cloud automation is enabled.

- [ ] **Step 1: Replace the inline header helper block**

Replace the inline `http_headers`, `has_access_interception`, `assert_access_intercepted`, and `assert_no_access_interception` definitions and the `ACCESS_REDIRECT_RE` instructions with:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

Explain that the version-controlled script accepts only the two supported environments, checks the exact route matrices, recognizes only the strict Cloudflare-host redirect or `403` plus both Access headers, and fails closed on network errors.

- [ ] **Step 2: Correct the live-state wording without activating automation**

Replace the stale “Production (BLOCKED)” claim with the factual state: production Access is already applied and managed by the local Pulumi backend until the migration gate. Retain manual apply instructions and the warning not to use an automatic workflow before remote state migration.

Do not document GitHub Actions as active in PR A.

- [ ] **Step 3: Run the committed verifier against the live tenant**

Run read-only checks:

```bash
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
rtk packages/infrastructure/scripts/verify-access.sh production
```

Expected protected-target evidence for both environments: HTTP `403`, `cf-access-aud: present`, and `cf-access-domain: present`. Public routes must not match either Access contract. Do not record header values.

- [ ] **Step 4: Verify documentation and PR A scope**

Run:

```bash
rtk bunx prettier --check docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=@dtx/infrastructure build
rtk test -f packages/infrastructure/dist/index.js
rtk git diff --check
```

Expected: all commands exit 0 and no deployment workflow or committed stack settings exist.

- [ ] **Step 5: Commit Task 3**

```bash
rtk git add docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
rtk git commit -m "docs: reuse Access boundary verifier"
```

PR A is now ready for whole-branch review. Pushing, opening, and merging PR A are coordinator-owned external actions.

---

## Operator Migration Gate

### Task 4: Migrate Both Existing Stacks and Establish External Prerequisites

**Files:**

- Generate while still ignored: `packages/infrastructure/Pulumi.pre-prod.yaml`
- Generate while still ignored: `packages/infrastructure/Pulumi.production.yaml`
- Private temporary state exports outside the repository; never commit them.

**Interfaces:**

- Consumes: merged PR A, the two existing local stacks, a dedicated Cloudflare Access token, the existing repository account-ID variable, current Perseus posture output, and authenticated Pulumi/GitHub operator sessions.
- Produces: remote stacks `cwchanap/dtxweb-infrastructure/pre-prod` and `cwchanap/dtxweb-infrastructure/production`, exact OIDC trust, two no-reviewer GitHub Environments, protected imported resources, clean previews, and two Pulumi-Cloud-encrypted settings files ready for PR B.

- [ ] **Step 1: Create and verify the GitHub Environments**

Create `dtx-access-pre-prod` and `dtx-access-production` with no reviewers or wait timers. In each, set only:

```text
CLOUDFLARE_ACCESS_API_TOKEN
```

Do not create `DTX_ACCESS_EMAIL`, `DTX_DEVICE_POSTURE_RULE_ID`, `PULUMI_ACCESS_TOKEN`, or `PULUMI_CONFIG_PASSPHRASE`. Confirm repository variables `PULUMI_ORG=cwchanap` and `CLOUDFLARE_ACCOUNT_ID` exist.

- [ ] **Step 2: Configure exact Pulumi Cloud OIDC trust**

Re-read the repository OIDC subject customization first. Configure audience:

```text
urn:pulumi:org:cwchanap
```

Allow only:

```text
repo:cwchanap/DTXWeb:environment:dtx-access-pre-prod
repo:cwchanap/DTXWeb:environment:dtx-access-production
```

Issue `urn:pulumi:token-type:access_token:personal` with `scope: user:cwchanap`. Reject `repo:cwchanap/DTXWeb:*` or any branch-wide subject.

- [ ] **Step 3: Capture local config securely, reconfirm live identity, establish state protection, and export state**

From `packages/infrastructure`, create a private temporary directory with `rtk mktemp -d`. With `PULUMI_CONFIG_PASSPHRASE` set to the empty string, log in to the local backend. Populate the local `CLOUDFLARE_ACCOUNT_ID` from the existing stack config (the exact state being validated) and confirm both stacks agree before any live Cloudflare lookup — repository variables are not automatically available to this operator shell:

```bash
rtk pulumi login --local
CLOUDFLARE_ACCOUNT_ID="$(pulumi config get cloudflareAccountId --stack pre-prod)"
test "$(pulumi config get cloudflareAccountId --stack production)" = "$CLOUDFLARE_ACCOUNT_ID" || {
  echo 'FAIL: stack Cloudflare account IDs differ' >&2
  exit 1
}
```

Confirm both stack outputs are non-empty without printing the application IDs:

```bash
for stack in pre-prod production; do
  app_id="$(pulumi stack output accessApplicationId --stack "$stack")"
  test -n "$app_id" || { echo "FAIL: $stack has no accessApplicationId" >&2; exit 1; }
done
unset app_id stack
```

**Reconfirm each stored application ID identifies the expected named live application before import.** For each stack, call the Cloudflare Access API with the dedicated token exposed only as `CLOUDFLARE_API_TOKEN` and verify the response `name` and `domain` match the expected values — `DTXWeb Pre-prod` over `pre-prod.dtx.hapadona.com` for pre-prod, `DTXWeb Production App` over `dtx.hapadona.com/app` for production:

```bash
for stack in pre-prod production; do
  app_id="$(pulumi stack output accessApplicationId --stack "$stack")"
  resp="$(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$app_id")"
  case "$stack" in
    pre-prod)   expected_name='DTXWeb Pre-prod';         expected_domain='pre-prod.dtx.hapadona.com' ;;
    production) expected_name='DTXWeb Production App';   expected_domain='dtx.hapadona.com/app' ;;
  esac
  actual_name="$(printf '%s' "$resp" | jq -r '.result.name')"
  actual_domain="$(printf '%s' "$resp" | jq -r '.result.domain')"
  if [ "$actual_name" != "$expected_name" ] || [ "$actual_domain" != "$expected_domain" ]; then
    echo "FAIL: $stack Access application identity does not match expected name/domain" >&2
    exit 1
  fi
done
unset app_id resp actual_name actual_domain expected_name expected_domain stack
```

Do not print `app_id` or the full response in evidence; print only the match/mismatch outcome. A mismatch is a hard stop — the imported state must point at the exact named live application, not a stale or wrong ID.

**Detect provider drift before export.** The identity check above confirms only the application ID maps to the expected name and domain. It does not verify destinations, policies, cookie flags, session duration, or other Access fields. An ordinary `pulumi preview` compares the program against the stored checkpoint — it does not query the live Cloudflare provider, so out-of-band dashboard changes would not be detected and stale local state could be exported and falsely certified as agreeing with Cloudflare. Run `pulumi refresh --preview-only --expect-no-changes` on both local stacks while they are still authoritative and the dedicated Cloudflare token is exposed as `CLOUDFLARE_API_TOKEN`. The `--expect-no-changes` flag makes the command exit non-zero if any drift is detected; combined with `--preview-only` the checkpoint is never mutated. Require zero drift before proceeding to state protection and export:

```bash
for stack in pre-prod production; do
  pulumi refresh --preview-only --expect-no-changes --stack "$stack" || {
    echo "FAIL: $stack has provider drift — reconcile before migration" >&2
    exit 1
  }
done
unset stack
```

`pulumi refresh --preview-only` queries the live Cloudflare provider and reports drift without modifying the checkpoint. Any drift (session duration, policy, cookie settings, destinations, or any other field changed out-of-band) is a hard stop — reconcile it deliberately before migration rather than importing stale state. This uses Pulumi's built-in drift detection instead of hand-comparing every Cloudflare field in the curl block.

**Establish state-level protection before export.** `pulumi destroy` does not run the program by default; it operates on state. The source-level `{ protect: true }` from PR A is not active in these pre-existing local stacks until it is persisted into state. Run `pulumi state protect` on both Access application URNs so the protect bit is in state before export, then verify the exported state carries it:

```bash
rtk pulumi state protect 'urn:pulumi:pre-prod::dtxweb-infrastructure::cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication::dtxweb-pre-prod-access' --stack pre-prod -y
rtk pulumi state protect 'urn:pulumi:production::dtxweb-infrastructure::cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication::dtxweb-production-access' --stack production -y
```

Verify the protect bit is present in each exported state file:

```bash
rtk pulumi stack export --stack pre-prod --file "$DTX_MIGRATION_DIR/pre-prod.json"
rtk pulumi stack export --stack production --file "$DTX_MIGRATION_DIR/production.json"
jq -e '.deployment.resources[] | select(.type == "cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication") | .protect == true' "$DTX_MIGRATION_DIR/pre-prod.json" >/dev/null
jq -e '.deployment.resources[] | select(.type == "cloudflare:index/zeroTrustAccessApplication:ZeroTrustAccessApplication") | .protect == true' "$DTX_MIGRATION_DIR/production.json" >/dev/null
```

The `jq` checks must exit 0; a missing or false `protect` bit is a hard stop. Because PR A already sets `protect: true` in source, the state-level bit is durable — a subsequent `pulumi up` will not clear it.

Capture `accessEmail`, `devicePostureRuleId`, and `cloudflareAccountId` into shell variables without printing them. Confirm the two posture values equal the current Perseus `adminAccessDevicePostureRuleId` output. A mismatch stops migration.

- [ ] **Step 4: Import into Pulumi Cloud**

Authenticate to Pulumi Cloud, initialize/select the two fully qualified stacks, and import the matching exports:

```bash
rtk pulumi login https://api.pulumi.com
rtk pulumi stack init cwchanap/pre-prod
rtk pulumi stack import --stack cwchanap/dtxweb-infrastructure/pre-prod --file "$DTX_MIGRATION_DIR/pre-prod.json"
rtk pulumi stack init cwchanap/production
rtk pulumi stack import --stack cwchanap/dtxweb-infrastructure/production --file "$DTX_MIGRATION_DIR/production.json"
```

If either stack already exists, select it and verify it is empty before import; never overwrite non-empty remote state.

- [ ] **Step 5: Rotate secrets providers and produce settings files**

For each fully qualified stack:

```bash
rtk pulumi stack change-secrets-provider default --stack <fully-qualified-stack>
rtk pulumi config set --secret accessEmail "$DTX_MIGRATION_ACCESS_EMAIL" --stack <fully-qualified-stack>
rtk pulumi config set devicePostureRuleId "$PERSEUS_POSTURE_RULE_ID" --stack <fully-qualified-stack>
rtk pulumi config set cloudflareAccountId "$CLOUDFLARE_ACCOUNT_ID" --stack <fully-qualified-stack>
```

`pulumi stack import` migrates deployment state only; stack configuration lives separately in `Pulumi.<stack>.yaml` and must be repopulated on the remote stacks. `src/index.ts` calls `config.require('cloudflareAccountId')`, so without this set the Step 6 preview cannot run. Keep `cloudflareAccountId` only long enough for manual preview/apply; remove it from both final files before PR B (Step 7). Verify the files contain `secretsprovider: default`, an `accessEmail` `secure:` value, the posture ID, the account ID, and no `encryptionsalt`.

- [ ] **Step 6: Preview, confirm protection agreement, and preview cleanly**

Build once, then for each stack run a preview with the dedicated token exposed only as `CLOUDFLARE_API_TOKEN`. Require zero provider creates, updates, replacements, or deletes — any provider CRUD operation is a hard stop until the state, URNs, provider identity, and live application IDs agree. The only acceptable diff is Pulumi state metadata such as `protect` or `secrets-provider` changes; since Step 3 already persisted the protect bit into state via `pulumi state protect`, even that metadata diff should be absent.

Run one reviewed `pulumi up` per stack to confirm source and state agree end-to-end (protection was already established in state by Step 3), then rerun preview. The final previews must propose no provider operation whatsoever. Verify both `accessApplicationId` outputs still equal their pre-migration values.

- [ ] **Step 7: Prepare PR B inputs and remove private exports**

Remove `cloudflareAccountId` from both settings files, leaving the existing repository variable as its source:

```bash
rtk pulumi config rm cloudflareAccountId --stack cwchanap/dtxweb-infrastructure/pre-prod
rtk pulumi config rm cloudflareAccountId --stack cwchanap/dtxweb-infrastructure/production
```

Reconfirm encrypted email, matching posture IDs, `secretsprovider: default`, and no passphrase salt. Only after both imports, protected updates, output comparisons, and clean previews pass, remove the two files in the private temporary migration directory and the directory itself.

This task is an external/security-sensitive gate. Do not begin PR B if any check is incomplete.

---

## PR B — Automation Activation

### Task 5: Commit Safe Stack Settings and Their Contract

**Files:**

- Modify: `packages/infrastructure/.gitignore`
- Add: `packages/infrastructure/Pulumi.pre-prod.yaml`
- Add: `packages/infrastructure/Pulumi.production.yaml`
- Create: `packages/infrastructure/src/deploy-workflow.test.ts`

**Interfaces:**

- Consumes: the two migrated settings files from Task 4.
- Produces: version-controlled stack config plus text-level safeguards that later extend to the deployment workflow.

- [ ] **Step 1: Write stack-settings contract tests**

Read both files as text from `deploy-workflow.test.ts`. For each file assert:

```typescript
expect(text).toContain('secretsprovider: default');
expect(text).toMatch(/dtxweb-infrastructure:accessEmail:\s*\n\s+secure:/);
expect(text).toMatch(/dtxweb-infrastructure:devicePostureRuleId:/);
expect(text).not.toContain('encryptionsalt:');
expect(text).not.toContain('dtxweb-infrastructure:cloudflareAccountId:');
```

Do not snapshot or print ciphertext or posture values.

- [ ] **Step 2: Verify the migration artifacts satisfy the contract**

Run:

```bash
rtk bunx vitest --run --config packages/infrastructure/vitest.config.ts packages/infrastructure/src/deploy-workflow.test.ts
```

Expected: PASS because Task 4 already generated the desired external artifacts. This is a
characterization gate for generated encrypted settings, not a behavior implementation; a failure
returns to Task 4 instead of weakening the assertions.

- [ ] **Step 3: Unignore only the two supported settings files**

Replace the broad `Pulumi.*.yaml` ignore with rules that keep unknown/local stack files ignored while admitting exactly:

```gitignore
Pulumi.*.yaml
!Pulumi.pre-prod.yaml
!Pulumi.production.yaml
```

Stage only the two migrated files after independently confirming the encrypted form.

- [ ] **Step 4: Re-run stack-contract GREEN after the ignore-rule change**

Run the same focused Vitest command again. Expected: PASS without emitting config values.

- [ ] **Step 5: Commit Task 5**

```bash
rtk git add packages/infrastructure/.gitignore packages/infrastructure/Pulumi.pre-prod.yaml packages/infrastructure/Pulumi.production.yaml packages/infrastructure/src/deploy-workflow.test.ts
rtk git commit -m "chore(infrastructure): commit Pulumi Cloud stack settings"
```

### Task 6: Add the Serial Automatic Deployment Workflow

**Files:**

- Create: `.github/workflows/deploy-cloudflare-access.yml`
- Modify: `packages/infrastructure/src/deploy-workflow.test.ts`
- Modify: `.github/workflows/lint-and-format.yml`

**Interfaces:**

- Consumes: encrypted committed stack settings, repository variables, environment-scoped Cloudflare tokens, Task 2 verifier.
- Produces: automatic `pre-prod` then `production` updates on relevant `main` pushes and manual recovery dispatch; unconditional PR execution of infrastructure contracts.

- [ ] **Step 1: Add failing workflow contract assertions**

Read `.github/workflows/deploy-cloudflare-access.yml` as repository text and assert:

```text
id-token: write
environment: dtx-access-pre-prod
environment: dtx-access-production
needs: deploy-pre-prod
cwchanap/dtxweb-infrastructure/pre-prod
cwchanap/dtxweb-infrastructure/production
pulumi/auth-actions@1c89817aab0c66407723cdef72b05266e7376640
pulumi/actions@8582a9e8cc630786854029b4e09281acd6794b58
CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_ACCESS_API_TOKEN }}
cancel-in-progress: false
```

Assert `PULUMI_ACCESS_TOKEN`, `PULUMI_CONFIG_PASSPHRASE`, `command: preview`, `DTX_ACCESS_EMAIL`, and `DTX_DEVICE_POSTURE_RULE_ID` are absent. Assert `deploy-production` appears after and depends on `deploy-pre-prod`.

- [ ] **Step 2: Observe RED**

Run:

```bash
rtk bunx vitest --run --config packages/infrastructure/vitest.config.ts packages/infrastructure/src/deploy-workflow.test.ts
```

Expected: FAIL because the workflow file does not exist.

- [ ] **Step 3: Implement workflow triggers, permissions, and concurrency**

Create `deploy-cloudflare-access.yml` with:

```yaml
name: Deploy Cloudflare Access

on:
    push:
        branches: [main]
        paths:
            - 'packages/infrastructure/**'
            - 'bun.lock'
            - 'package.json'
            - 'tsconfig.base.json'
            - '.github/workflows/deploy-cloudflare-access.yml'
    workflow_dispatch:

concurrency:
    group: ${{ github.workflow }}-${{ github.ref }}
    cancel-in-progress: false

permissions:
    contents: read
    id-token: write
```

- [ ] **Step 4: Implement the two jobs without a duplicate preview**

Each job uses Ubuntu, its exact GitHub Environment, checkout, Bun 1.3.9, `bun install --frozen-lockfile`, then runs these commands in GitHub Actions:

```bash
bun run --filter=@dtx/infrastructure check
bun run --filter=@dtx/infrastructure test:coverage
bun run --filter=@dtx/infrastructure build
test -f packages/infrastructure/dist/index.js
```

These are workflow contents, so they omit `rtk`; RTK is an agent-shell requirement, not a runner dependency.

Authenticate with the exact pinned `pulumi/auth-actions` action, `organization: ${{ vars.PULUMI_ORG }}`, personal token type, and `scope: user:cwchanap`. Run the pinned `pulumi/actions` once with `command: up`, the exact fully qualified stack, `work-dir: packages/infrastructure`, and only this config map:

```yaml
config-map: |
    cloudflareAccountId:
      value: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
```

Map the environment secret only for Pulumi execution:

```yaml
env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_ACCESS_API_TOKEN }}
```

Run `packages/infrastructure/scripts/verify-access.sh pre-prod` after the first update and `production` after the second. Set `deploy-production.needs: deploy-pre-prod`. Do not add reviewer gates, rollback, destroy, or a standalone preview.

- [ ] **Step 5: Add the unconditional PR contract hook**

In `lint-and-format.yml`, immediately after “Test affected-scope detector”, add:

```yaml
- name: Test infrastructure contracts
  run: bun run --filter=@dtx/infrastructure test
```

Do not modify `.github/scripts/ci-affected-scope.sh` or its test.

- [ ] **Step 6: Run focused GREEN and workflow checks**

Run:

```bash
rtk bunx vitest --run --config packages/infrastructure/vitest.config.ts packages/infrastructure/src/deploy-workflow.test.ts
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure check
rtk bunx prettier --check .github/workflows/deploy-cloudflare-access.yml .github/workflows/lint-and-format.yml packages/infrastructure/src/deploy-workflow.test.ts
rtk git diff --check
```

Expected: all commands exit 0; no affected-scope file changed.

- [ ] **Step 7: Commit Task 6**

```bash
rtk git add .github/workflows/deploy-cloudflare-access.yml .github/workflows/lint-and-format.yml packages/infrastructure/src/deploy-workflow.test.ts
rtk git commit -m "ci: deploy Cloudflare Access automatically"
```

### Task 7: Reconcile Operator Documentation with the Active Automation

**Files:**

- Modify: `packages/infrastructure/README.md`
- Modify: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

**Interfaces:**

- Consumes: completed migration and the workflow contract from Task 6.
- Produces: current operator instructions for remote stacks, automatic deployment, recovery, manual admission checks, and emergency reconciliation.

- [ ] **Step 1: Replace local-backend primary instructions in the README**

Document the exact remote stacks, OIDC authentication, committed encrypted stack settings, the repository account-ID variable, and the environment-scoped Cloudflare token. State that local passphrase state is retired and `PULUMI_CONFIG_PASSPHRASE` is not used in CI.

Document these normal paths:

```text
main change -> pre-prod up -> pre-prod boundary verification -> production up -> production boundary verification
workflow_dispatch -> the same serial path
```

State that `protect: true` blocks deletion/replacement and intentional replacement requires a separately reviewed unprotect operation.

- [ ] **Step 2: Finalize the runbook reconciliation**

Remove obsolete operator-only apply and production-hold instructions. Preserve:

- exact route matrices through the version-controlled verifier;
- manual trusted-device entry and denied-device rejection after identity/posture/policy changes;
- the future Better Auth desktop/browser/session-expiry acceptance gate;
- the warning that removing pre-production Access can expose production-backed data;
- the exact named-application emergency dashboard procedure;
- the requirement to reconcile any emergency dashboard edit into Pulumi before the next automated run.

- [ ] **Step 3: Run documentation and package verification**

```bash
rtk bunx prettier --check packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
rtk bun run --filter=@dtx/infrastructure test
rtk bun run --filter=@dtx/infrastructure check
rtk bun run --filter=@dtx/infrastructure build
rtk test -f packages/infrastructure/dist/index.js
rtk git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit Task 7**

```bash
rtk git add packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
rtk git commit -m "docs: document automatic Access deployment"
```

PR B is now ready for whole-branch review. Pushing/opening/merging and observing the first `main` workflow are coordinator-owned external actions.

### Task 8: First Automatic Rollout Acceptance

**Files:** None unless verification exposes a defect; fixes return to the owning task and review loop.

**Interfaces:**

- Consumes: merged PR B and the configured external prerequisites.
- Produces: GitHub Actions and live-tenant evidence that the automatic serial rollout works.

- [ ] **Step 1: Observe the first main-triggered workflow**

Confirm `deploy-pre-prod` completes before `deploy-production` starts. Confirm each job builds `dist/index.js`, uses OIDC, performs exactly one `pulumi up`, and then runs its boundary matrix.

- [ ] **Step 2: Re-run live boundary verification independently**

```bash
rtk packages/infrastructure/scripts/verify-access.sh pre-prod
rtk packages/infrastructure/scripts/verify-access.sh production
```

Both commands must pass without printing Access header values.

- [ ] **Step 3: Complete manual admission checks**

From the configured identity on a trusted WARP device, enter and use `/app`. From a device that does not satisfy the posture rule, confirm Access denies the request before DTXWeb loads.

- [ ] **Step 4: Record final acceptance**

Record the workflow run URL, Pulumi update permalinks, verifier outcome, and manual admission outcome in the task handoff. Do not record tokens, email plaintext, posture IDs, application IDs, cookies, or Access header values.
