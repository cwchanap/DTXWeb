# Cloudflare Access Deployment Automation Design

## Summary

DTXWeb will automatically deploy its two existing Cloudflare Zero Trust Access stacks from
GitHub Actions when relevant infrastructure changes land on `main`. The workflow deploys
pre-production first and production second. Production cannot start until pre-production has
passed build, Pulumi, and live boundary checks.

Pulumi state moves from the operator's local filesystem backend to Pulumi Cloud before the
workflow is enabled. GitHub authenticates to Pulumi Cloud with a short-lived OIDC exchange and
uses separate GitHub Environments for the pre-production and production Cloudflare credentials.
Neither stack requires a GitHub reviewer; both applies are automatic.

This design supersedes only the local-backend, operator-only apply, and production-hold decisions
in the original Zero Trust design. It does not change the deployed applications, destinations,
policy, or shared-posture ownership.

## Goals

- Apply both DTXWeb Access stacks automatically after relevant `main` changes.
- Stop before production whenever pre-production validation, deployment, or verification fails.
- Preserve the two live Access applications and their Pulumi resource identities during backend
  migration.
- Prevent automatic deployment from deleting or replacing either Access application.
- Remove long-lived Pulumi credentials and the empty local passphrase from CI.
- Keep pre-production and production Cloudflare credentials isolated in GitHub Environments.
- Verify the public Access boundary after each apply from an unauthenticated GitHub runner.
- Retain the Perseus posture-rule identity preflight after committed Pulumi stack settings become
  the source of deployment configuration.
- Keep trusted-device admission as an explicit human check when identity or posture inputs change.
- Reconcile the operator documentation with the already-applied production stack and the new
  automated deployment path.

## Non-Goals

- Move Workers, APIs, D1, R2, routes, bindings, or runtime deployment from Wrangler to Pulumi.
- Change either Access application's hostname, destinations, policy, session duration, or browser
  flags.
- Create or manage the Perseus-owned trusted-device list or posture rule.
- Reuse the existing R2 release token for Access deployment.
- Add automatic `pulumi destroy`, provider-side rollback, or Cloudflare dashboard mutation.
- Automate a positive trusted-WARP-device browser login from GitHub Actions.
- Add pull-request previews or comments in this slice.
- Merge, push, or enable the workflow before the remote state and environment prerequisites exist.

## Existing Resource Contract

Automation continues to manage exactly these resources:

| Stack        | Application             | Protection scope                                         |
| ------------ | ----------------------- | -------------------------------------------------------- |
| `pre-prod`   | `DTXWeb Pre-prod`       | entire `pre-prod.dtx.hapadona.com` hostname              |
| `production` | `DTXWeb Production App` | `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*` only |

Both applications keep one allow policy with the configured email in `Include` and the existing
Perseus-managed posture-rule ID in `Require`. Both API hostnames and every production route outside
`/app` remain outside Access.

The local Pulumi backend currently records non-empty application IDs for both stacks. Migration must
reconfirm that those IDs identify the two live named applications before import. Automatic deployment
is not a first-create path for either environment.

## Deployment Architecture

Add `.github/workflows/deploy-cloudflare-access.yml` with these triggers:

- `push` to `main` when `packages/infrastructure/**`, `bun.lock`, root `package.json`,
  `tsconfig.base.json`, or the workflow itself changes;
- `workflow_dispatch` for an operator-requested recovery rerun.

Documentation-only changes do not trigger a live deployment. Pull requests continue to use the
existing affected-scope unit, coverage, lint, formatting, and typecheck workflows; the deployment
workflow does not run on pull requests.

These paths are intentionally conservative. `tsconfig.base.json` is directly extended by the
infrastructure package, root `package.json` owns the workspace/filter contract used by the job, and
`bun.lock` selects the transitive Pulumi/provider runtime even when the infrastructure manifest is
unchanged. Missing one of those changes is less safe than an extra idempotent `pulumi up`.

The Cloudflare provider remains semver-ranged in the package manifest and locked in `bun.lock`, but
Dependabot must make Pulumi changes conspicuous. Add a `pulumi-minor-and-patch` group matching
`@pulumi/*`, and exclude `@pulumi/*` from the catch-all JavaScript group. A Pulumi SDK/provider bump
must therefore arrive as its own reviewable pull request rather than inside the weekly aggregate.

Do not add the deployment workflow as a special case to `.github/scripts/ci-affected-scope.sh`.
Instead, add one unconditional `bun run --filter=@dtx/infrastructure test` step to
`.github/workflows/lint-and-format.yml`. That existing required pull-request workflow already
installs locked dependencies and runs on workflow-only changes, so it is the smallest reliable home
for the boundary-script and deployment-contract tests.

The workflow has two jobs:

1. `deploy-pre-prod` uses the `dtx-access-pre-prod` GitHub Environment.
2. `deploy-production` declares `needs: deploy-pre-prod` and uses the
   `dtx-access-production` GitHub Environment.

Each job checks out the same commit, installs the locked Bun dependencies, runs the infrastructure
package check and coverage suite, builds `dist/index.js`, authenticates to Pulumi Cloud, runs
`pulumi up --refresh` for the environment's stack, and runs the environment's live boundary
verification. `pulumi up` computes and logs its own preview before applying; do not add a separate
duplicate preview step to the recurring workflow. The `--refresh` flag (set via the `pulumi/actions`
`refresh: true` input) makes each automated update query the live Cloudflare provider before
applying, so out-of-band dashboard changes to the allow policy, posture requirement, session/cookie
flags, or any other Access field are reconciled forward on every run. Without it, `pulumi up`
compares only against the stored checkpoint and the HTTP boundary verifier cannot detect field-level
drift — for example, removing the posture requirement still leaves an unauthenticated request
returning Access interception. The migration's one-time `pulumi refresh --preview-only
--expect-no-changes` proves the initial checkpoint is current; `--refresh` on every recurring
`pulumi up` extends that drift reconciliation to the automated path. This is what makes the Pulumi
program authoritative for the Access security policy, not merely for the checkpoint.

The production job therefore cannot run after any pre-production failure. Rebuilding in each job
is intentional: the compiled Pulumi entrypoint is produced and checked in the same runner that
performs the corresponding update.

Use workflow permissions:

- `contents: read` for checkout;
- `id-token: write` for the Pulumi Cloud OIDC exchange.

Use a workflow concurrency group derived from the workflow name and Git ref with
`cancel-in-progress: false`. A newer push waits for an active deployment rather than interrupting a
Pulumi update or racing the shared stacks.

## Pulumi Cloud Identity

Both remote stacks live under:

- `cwchanap/dtxweb-infrastructure/pre-prod`;
- `cwchanap/dtxweb-infrastructure/production`.

Pulumi Cloud trusts GitHub Actions as an OIDC issuer for `cwchanap/DTXWeb`. Its authorization policy
requires audience `urn:pulumi:org:cwchanap` and has two allow entries with exact GitHub environment
subjects:

- `repo:cwchanap/DTXWeb:environment:dtx-access-pre-prod`;
- `repo:cwchanap/DTXWeb:environment:dtx-access-production`.

The repository currently uses GitHub's default non-immutable subject format. Recheck that repository
OIDC setting before configuring Pulumi Cloud. If GitHub's subject customization or immutable-subject
setting changes, use the two exact environment subjects GitHub will emit; do not broaden the Pulumi
policy to `repo:cwchanap/DTXWeb:*`.

Each entry issues the same short-lived personal-scope token shape used by Perseus:
`urn:pulumi:token-type:access_token:personal` with `scope: user:cwchanap`. No
`PULUMI_ACCESS_TOKEN` GitHub secret is created.

Use the same SHA-pinned Pulumi actions currently used by the Perseus deployment workflow:

- `pulumi/auth-actions@1c89817aab0c66407723cdef72b05266e7376640` (`v1.0.1`);
- `pulumi/actions@8582a9e8cc630786854029b4e09281acd6794b58` (`v6.6.1`).

The implementation must preserve SHA pinning if either action is upgraded during review.

## GitHub Environment Contract

Create `dtx-access-pre-prod` and `dtx-access-production` with no required reviewers. Each environment
contains one independently owned secret:

| Kind   | Name                          | Purpose                                            |
| ------ | ----------------------------- | -------------------------------------------------- |
| Secret | `CLOUDFLARE_ACCESS_API_TOKEN` | Dedicated Cloudflare Access application credential |

Keep `PULUMI_ORG=cwchanap` as a repository variable, matching Perseus. `CLOUDFLARE_ACCOUNT_ID` remains
an existing repository variable for the desktop R2 release job; this workflow does not read it. The
account ID is not secret, and this design intentionally commits it as plain stack config in both
settings files rather than injecting it at runtime.

The workflow exposes `CLOUDFLARE_ACCESS_API_TOKEN` to the provider only as
`CLOUDFLARE_API_TOKEN` within the Pulumi steps. The token has only the Cloudflare account-level
`Access: Apps and Policies Edit` permission for the target account. It has no Workers, DNS, D1,
R2, API-token-management, or global-key privileges.

After migration, commit `Pulumi.pre-prod.yaml` and `Pulumi.production.yaml` with Pulumi Cloud's
default secrets provider. Each file is the version-controlled source of truth for:

- `accessEmail`, encrypted with the stack-specific Pulumi Cloud key;
- `devicePostureRuleId`, recorded as a non-secret identifier;
- `cloudflareAccountId`, recorded as a non-secret identifier;
- an optional explicit `accessSessionDuration` only if it differs from the code default.

Keep the broad `Pulumi.*.yaml` ignore in `packages/infrastructure/.gitignore` and unignore exactly
`Pulumi.pre-prod.yaml` and `Pulumi.production.yaml`; unknown `Pulumi.*.yaml` stack files stay
untrackable. Never commit a stack file while it
still contains the local passphrase provider or its encryption salt. A pull request must reject a
plain-text `accessEmail`.

The workflow supplies no runtime stack config. `pulumi/actions`' `config-map` input is implemented with
`stack.setAllConfig`, which replaces — not merges with — the stack configuration: a map containing
only `cloudflareAccountId` would erase the committed `accessEmail` and `devicePostureRuleId` before
`up` while `src/index.ts` requires all three. The committed files own every config value, and the
workflow contract test pins the absence of `config-map`.

`accessSessionDuration` remains code-defaulted to `12h`. The workflow does not accept hostnames or
destinations as configuration. `PULUMI_CONFIG_PASSPHRASE` is absent from GitHub.

## One-Time State Migration

State migration is a prerequisite to merging or enabling the deployment workflow. It is an
operator operation, not a recurring workflow step. Every step below is a hard stop on any
mismatch — the imported state must point at the exact named live applications with zero provider
drift, and protection must be persisted into state before export so the exported checkpoint carries
it.

1. Stop local Pulumi applies for both DTXWeb stacks.
2. Log in to the local backend with `PULUMI_CONFIG_PASSPHRASE` set to the empty string. Populate
   the local `CLOUDFLARE_ACCOUNT_ID` from the existing stack config (the exact state being
   validated) and confirm both stacks agree before any live Cloudflare lookup — repository
   variables are not automatically available to the operator shell. Confirm both stack outputs are
   non-empty without printing the application IDs.
3. **Reconfirm each stored application ID identifies the expected named live application before
   export.** For each stack, call the Cloudflare Access API with the dedicated token exposed only
   as `CLOUDFLARE_API_TOKEN` and verify the response `name` and `domain` match the expected values
   — `DTXWeb Pre-prod` over `pre-prod.dtx.hapadona.com` for pre-prod, `DTXWeb Production App` over
   `dtx.hapadona.com/app` for production. Print only the match/mismatch outcome, never the
   application ID or full response. A mismatch is a hard stop — the imported state must point at
   the exact named live application, not a stale or wrong ID. This is stronger than recording a
   non-sensitive summary: it proves the stored ID resolves to the expected name and domain in the
   live Cloudflare account.
4. **Detect provider drift before export.** The identity check above confirms only the application
   ID maps to the expected name and domain. It does not verify destinations, policies, cookie
   flags, session duration, or other Access fields. An ordinary `pulumi preview` compares the
   program against the stored checkpoint — it does not query the live Cloudflare provider, so
   out-of-band dashboard changes would not be detected and stale local state could be exported and
   falsely certified as agreeing with Cloudflare. Run `pulumi refresh --preview-only --expect-no-changes`
   on both local stacks while they are still authoritative and the dedicated Cloudflare token is
   exposed as `CLOUDFLARE_API_TOKEN`. The `--expect-no-changes` flag makes the command exit non-zero
   if any drift is detected; combined with `--preview-only` the checkpoint is never mutated. Require
   zero drift before proceeding to state protection and export. Any drift (session duration, policy,
   cookie settings, destinations, or any other field changed out-of-band) is a hard stop — reconcile
   it deliberately before migration rather than importing stale state.
5. **Establish state-level protection before export.** `pulumi destroy` does not run the program by
   default; it operates on state. The source-level `{ protect: true }` from PR A is not active in
   these pre-existing local stacks until it is persisted into state. Run `pulumi state protect` on
   both Access application URNs so the protect bit is in state before export, then export each
   stack through Pulumi's supported backend-migration procedure into a private temporary location
   and verify the exported state carries the protect bit. The export may contain sensitive state
   and must never enter git, logs, chat, or a shared artifact store. A missing or false `protect`
   bit in the exported state is a hard stop. Because PR A already sets `protect: true` in source,
   the state-level bit is durable — a subsequent `pulumi up` will not clear it.
6. Capture `accessEmail`, `devicePostureRuleId`, and `cloudflareAccountId` into shell variables
   without printing them. Compare the current Perseus `adminAccessDevicePostureRuleId` output with
   the `devicePostureRuleId` in both DTXWeb stacks. Any mismatch is a hard stop.
7. Log in to Pulumi Cloud, initialize the two fully qualified remote stacks, and import the
   matching local state into each one. If either stack already exists, select it and verify it is
   empty before import; never overwrite non-empty remote state.
8. Change each imported stack from the inherited local passphrase secrets provider to Pulumi
   Cloud's managed default secrets provider. The empty passphrase is used only on the operator
   machine while reading the old state.
9. Repopulate stack configuration on each remote stack: set `accessEmail` as secret config,
   `devicePostureRuleId` as non-secret config, and `cloudflareAccountId` as non-secret config.
   `pulumi stack import` migrates deployment state only; stack configuration lives separately in
   `Pulumi.<stack>.yaml` and must be repopulated on the remote stacks. `src/index.ts` calls
   `config.require('cloudflareAccountId')`, so without this set the next step's preview cannot run.
   `cloudflareAccountId` stays in both final files as permanent non-secret stack config. Confirm
   `accessEmail` remains encrypted/redacted in Pulumi output and
   generate the two stack settings files. Verify each file contains `secretsprovider: default`, an
   `accessEmail` `secure:` value, the posture ID, the account ID, and no `encryptionsalt`.
10. Build the current infrastructure program and run a remote preview for each stack with the
    dedicated Cloudflare credential. Require zero provider creates, updates, replacements, or
    deletes — any provider CRUD operation is a hard stop until the state, URNs, provider identity,
    and live application IDs agree. The only acceptable diff is Pulumi state metadata such as
    `protect` or `secrets-provider` changes; since step 5 already persisted the protect bit into
    state via `pulumi state protect`, even that metadata diff should be absent.
11. Run one reviewed `pulumi up` per stack to confirm source and state agree end-to-end (protection
    was already established in state by step 5), then rerun preview. The final previews must
    propose no provider operation whatsoever. Verify both `accessApplicationId` outputs still equal
    their pre-migration values.
12. Keep the non-secret `cloudflareAccountId` in both settings files; committed stack configuration
    is its only source, and the workflow injects no runtime config. Reconfirm encrypted email,
    matching posture IDs, `secretsprovider: default`, the plain account ID, and no passphrase salt. Only after both imports, protected updates, output comparisons, and clean
    previews pass, remove the two files in the private temporary migration directory and the
    directory itself. Then make the settings files version-controlled.

The workflow must not exist on `main` until this sequence and the GitHub Environment/OIDC setup are
complete. Otherwise its first automatic run could start without the state or credentials needed to
adopt the live resources safely.

## Live Boundary Verification

Keep the workflow YAML small by placing the existing header-matrix behavior in a version-controlled
script under `packages/infrastructure/scripts/`. The script accepts only `pre-prod` or `production`
and fails closed on DNS, TLS, network, or unsupported-environment errors.

An Access-intercepted route passes only when either:

- the response is a `3xx` and its `Location` URL has an HTTPS host ending in
  `.cloudflareaccess.com` with at least one leading tenant label; or
- the response is `403` with both `cf-access-aud` and `cf-access-domain`.

The redirect matcher is a constant in the script, not an `ACCESS_REDIRECT_RE` or other uncommitted
environment override. A generic `3xx` is not Access interception. A route expected outside Access
passes only when neither the exact Access redirect nor the Access-header contract appears; its
origin status may still be `200`, `303`, `404`, or another application-owned response.

This tenant's live shape was measured on 2026-08-20 before freezing the contract. An unauthenticated
request to `https://pre-prod.dtx.hapadona.com/` and one to `https://dtx.hapadona.com/app` each
returned HTTP `403` with both `cf-access-aud` and `cf-access-domain`; neither used a redirect. Record
only status, redirect host shape, and header presence in review evidence—never header values. The
redirect branch remains a strict fail-closed compatibility path: if the tenant later emits an
unrecognized same-host or other redirect shape, deployment stops for operator review rather than
classifying it as protected.

The pre-production matrix checks Access interception for:

- `/`;
- `/login`;
- `/auth/callback`;
- `/blog`;
- `/preview/1`;
- `/editor`;
- `/tool/dtx-to-midi`;
- `/game`;
- `/app`;
- `/app/`;
- `/app/score`;
- `/app/__data.json`.

It separately verifies that `https://api.pre-prod.dtx.hapadona.com/` is not Access-intercepted.

The production matrix checks Access interception for:

- `/app`;
- `/app/`;
- `/app/score`.

It verifies that these routes are not Access-intercepted:

- `/`;
- `/login`;
- `/auth/callback`;
- `/blog`;
- `/preview/1`;
- `/editor`;
- `/tool/dtx-to-midi`;
- `/game`;
- `https://api.dtx.hapadona.com/`.

Keep the script in Bash and test it without real network calls by PATH-shadowing `curl`, following
the repository's affected-scope test pattern. Tests cover an exact `cloudflareaccess.com` redirect,
a generic non-Access redirect, `403` header interception, public origin `200`/`303`/`404` responses,
network failure, missing Access headers, unexpected Access on a public route, and invalid
environment input.

Wire the Bash test into both `@dtx/infrastructure` `test` and `test:coverage` scripts so the existing
unit workflow cannot omit it. Do not add a YAML or test-runner dependency solely for this script.

## Resource Identity Invariants

Automatic `pulumi up` no longer has a human reviewing the preview before mutation. Extend the
application constructor to pass `{ protect: true }` as a resource option. This permits normal
in-place updates but makes Pulumi refuse a delete or replacement. An intentional replacement
requires an explicit, separately reviewed unprotect step; the automatic workflow never performs
one.

Add one focused Pulumi runtime-mocks test that executes `src/index.ts` and pins:

- the logical Pulumi name `dtxweb-${stack}-access` for each supported stack;
- exactly one `cloudflare.ZeroTrustAccessApplication` registration from `src/index.ts`;
- no second Cloudflare resource registration.

Add a narrow constructor-seam assertion for the third resource argument `{ protect: true }` because
Pulumi's `MockResourceArgs` exposes type, name, inputs, provider, custom, and ID—but not resource
options. Do not pretend the runtime-mocks callback can observe protection.

Do not duplicate the existing `access.test.ts` assertions for the exact production destinations,
absence of hostname-wide production Access, single policy, and posture `Require`.

Also add a focused workflow contract test under the infrastructure package. It reads the workflow
as repository text and asserts the two environment names, serial `needs` edge, exact stack names,
`id-token: write`, SHA-pinned Pulumi actions, dedicated Cloudflare secret mapping, `refresh: true`
on the `pulumi/actions` `up` step, and absence of `PULUMI_ACCESS_TOKEN`,
`PULUMI_CONFIG_PASSPHRASE`, and `config-map`. Use focused text assertions; do not add a YAML-parser dependency. The
`refresh: true` assertion pins drift reconciliation into the workflow contract so a later change
cannot silently revert the automation to checkpoint-only comparison. The same contract suite reads
the two committed stack settings as text and asserts the default secrets provider, encrypted
`accessEmail`, a plain non-secret `cloudflareAccountId`, and absence of `encryptionsalt`.

Do not add a standing preview-JSON rule that rejects every future replacement. The one-time
migration preview keeps its zero-operation gate, while Pulumi's engine-level resource protection is
the recurring guard. A future intentional replacement must use the explicit reviewed unprotect
sequence rather than weakening or parsing preview text in CI.

## Trusted-Device Verification

An unauthenticated GitHub-hosted runner cannot satisfy the operator's identity plus the shared
WARP posture rule. Automated checks therefore prove only the external boundary: protected routes
are intercepted and public routes are not.

After changes to committed `accessEmail`, `devicePostureRuleId`, the Access policy construction, or
relevant Cloudflare tenant identity/posture settings, the operator performs the runbook's manual
browser checks from:

- the configured identity on a trusted device, which must enter and use `/app`;
- a device that does not satisfy the posture rule, which must be denied before DTXWeb loads.

The production `/app/desktop-auth` route does not exist in the current repository, so this design
does not include it in the matrix or claim that edge interception proves the desktop flow. The
future Better Auth/desktop cutover must add that route and separately restore the runbook's desktop,
browser, identity/posture, and session-expiry acceptance checks. This automation does not supersede
that cutover gate.

Ordinary infrastructure build or workflow maintenance changes remain fully automatic and do not
introduce a GitHub approval gate.

The same configuration-change procedure must compare the current Perseus
`adminAccessDevicePostureRuleId` output with `devicePostureRuleId` in both committed stack settings
files. This is a manual operator preflight because DTXWeb must not gain a cross-repository
`StackReference` or a CI dependency on the Perseus checkout. A mismatch is a hard stop before the
next apply; ordinary commits do not add a reviewer gate.

## Failure Handling And Recovery

- A pre-production check, `pulumi up`, or smoke failure blocks production.
- A production failure before `pulumi up` leaves production unchanged.
- A production smoke failure after `pulumi up` leaves the job red and explicitly reports that the
  desired configuration may already be live.
- The workflow never performs automatic rollback or destroy.
- Reverting or correcting the infrastructure commit on `main` triggers a new serial deployment that
  reconciles both stacks forward to the corrected desired state.
- `workflow_dispatch` reruns the same pre-production-then-production path for recovery; it does not
  skip pre-production or select only one stack.
- Pulumi Cloud and GitHub workflow concurrency prevent simultaneous updates from this workflow.

If Pulumi Cloud or its state is unavailable and immediate provider-side intervention is required,
the existing runbook's exact-application Cloudflare dashboard procedure remains the emergency path.
Because every automated `pulumi up` runs with `--refresh`, the next automated run will detect the
dashboard drift and reconcile forward to the Pulumi program's desired state — which will revert the
emergency change if it is not reflected in the program. The operator must therefore commit the
emergency change to the Pulumi program before the next automated run; merely reconciling Pulumi
state is not sufficient because `--refresh` queries the live provider, not just the checkpoint.

## Delivery And Activation Order

Use two pull requests with an out-of-band migration gate between them:

1. **PR A — inert safety foundation.** Add `protect: true`, the dedicated Pulumi Dependabot group,
   the Bash boundary script and PATH-shadowed tests, the focused resource-registration test, package
   script wiring, and draft documentation that does not yet claim automation is active. Run the
   version-controlled verifier against both live protected targets and record the same measured
   `403` plus Access-header presence before merging PR A. Do not add the deployment workflow or
   commit stack settings yet.
2. **Operator migration gate.** Create the two GitHub Environments with only their Cloudflare
   secrets, verify the two exact GitHub OIDC subjects, configure Pulumi Cloud trust, reconfirm each
   stored application ID against the expected named live application, detect provider drift with
   `pulumi refresh --preview-only --expect-no-changes`, establish state-level resource protection
   before export, import both live stack states, change secrets providers, repopulate remote stack
   configuration (including the non-secret `cloudflareAccountId`), generate the reviewable
   stack settings, compare the Perseus posture ID, and obtain clean final previews for both remote
   stacks.
3. **PR B — automation activation.** Commit the two migrated stack settings, remove their ignore
   rule, add the deployment workflow and its contract test, add the unconditional infrastructure
   test step to `lint-and-format.yml`, and finalize the README/runbook reconciliation. Merge only
   after the operator gate is complete.

The safety boundary is that `.github/workflows/deploy-cloudflare-access.yml` must neither reach
`main` nor run until step 2 has passed. If revalidation finds either live application absent, stop
and redesign the first-create procedure; do not let the automatic workflow perform an unreviewed
initial create.

## Documentation Reconciliation

Update `packages/infrastructure/README.md` and the Zero Trust operator runbook to:

- replace the local backend as the primary backend with the two Pulumi Cloud stack identities;
- explain OIDC and GitHub Environment configuration without including values;
- remove the obsolete production hold and operator-only apply instructions;
- record that pre-production and production were reverified as live during migration;
- describe automatic `main` deployment, serial failure behavior, and `workflow_dispatch` recovery;
- reuse the version-controlled boundary-verification script;
- retain the manual trusted/untrusted device acceptance checks;
- retain the warning that destroying pre-production Access can expose a production-data-backed
  pre-production deployment;
- retain the exact named-application emergency dashboard procedure.

The original 2026-08-17 design remains a historical record. This design is the reviewed authority
for backend, deployment ownership, and production automation.

## Testing And Acceptance

Repository implementation is ready for review when:

- the workflow parses and is checked by the repository's normal formatting/lint tooling;
- infrastructure check, unit tests, coverage, and build pass from a clean checkout;
- the build produces `packages/infrastructure/dist/index.js` before Pulumi runs;
- boundary-verification script tests pass without network access;
- the required lint workflow runs the infrastructure test suite unconditionally;
- resource-identity and workflow contract tests pass;
- workflow jobs use the expected stacks, environments, dependencies, permissions, path filters,
  concurrency, SHA-pinned actions, and config secrecy;
- documentation no longer instructs operators to use the local backend or hold production.

Automation is ready to enable when:

- both Pulumi Cloud stacks contain the migrated live resource state;
- both remote previews show no unintended resource operations;
- both Access applications are protected against deletion and replacement;
- Pulumi Cloud OIDC trust permits only the two verified GitHub Environment subjects;
- both GitHub Environments contain the dedicated Cloudflare secret with no reviewer gate;
- both committed stack settings use Pulumi Cloud encryption, contain no passphrase salt, and match
  the current Perseus posture-rule output;
- the first `main`-triggered workflow run completes pre-production then production successfully;
- both automated live matrices pass;
- the operator completes the trusted-device and denied-device checks once after the first
  automated rollout, and again whenever identity, posture, or policy inputs change.

## Expected Repository Changes

- `.github/workflows/deploy-cloudflare-access.yml`;
- `.github/workflows/lint-and-format.yml`;
- `.github/dependabot.yml`;
- `packages/infrastructure/.gitignore`;
- `packages/infrastructure/Pulumi.pre-prod.yaml` and `Pulumi.production.yaml` after migration;
- `packages/infrastructure/package.json`;
- `packages/infrastructure/src/access.ts` and focused index/resource-registration coverage;
- `packages/infrastructure/src/deploy-workflow.test.ts`;
- `packages/infrastructure/scripts/verify-access.sh`;
- `packages/infrastructure/scripts/verify-access.test.sh`;
- `packages/infrastructure/README.md`;
- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`;
- this design and its implementation plan.

No Worker, API, web runtime, desktop runtime, D1, R2, or Wrangler configuration changes are planned.

## References

- [Pulumi GitHub Actions](https://www.pulumi.com/docs/iac/operations/continuous-delivery/github-actions/)
- [Pulumi state and backend migration](https://www.pulumi.com/docs/iac/concepts/state-and-backends/)
- [Pulumi `protect` resource option](https://www.pulumi.com/docs/iac/concepts/resources/options/protect/)
- [Pulumi stack settings files](https://www.pulumi.com/docs/iac/concepts/projects/stack-settings-file/)
- [Pulumi GitHub OIDC configuration](https://www.pulumi.com/docs/administration/access-identity/oidc-issuers/github/)
- [GitHub OIDC subject claims](https://docs.github.com/en/actions/reference/security/oidc#example-subject-claims)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- Perseus `.github/workflows/deploy-infrastructure.yml`
- DTXWeb `packages/infrastructure/src/access.ts`
- DTXWeb `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
