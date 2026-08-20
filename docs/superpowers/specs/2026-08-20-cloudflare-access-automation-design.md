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
- Remove long-lived Pulumi credentials and the empty local passphrase from CI.
- Keep pre-production and production Cloudflare credentials isolated in GitHub Environments.
- Verify the public Access boundary after each apply from an unauthenticated GitHub runner.
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

## Deployment Architecture

Add `.github/workflows/deploy-cloudflare-access.yml` with these triggers:

- `push` to `main` when `packages/infrastructure/**`, `bun.lock`, root `package.json`,
  `tsconfig.base.json`, or the workflow itself changes;
- `workflow_dispatch` for an operator-requested recovery rerun.

Documentation-only changes do not trigger a live deployment. Pull requests continue to use the
existing affected-scope unit, coverage, lint, formatting, and typecheck workflows; the deployment
workflow does not run on pull requests.

The workflow has two jobs:

1. `deploy-pre-prod` uses the `dtx-access-pre-prod` GitHub Environment.
2. `deploy-production` declares `needs: deploy-pre-prod` and uses the
   `dtx-access-production` GitHub Environment.

Each job checks out the same commit, installs the locked Bun dependencies, runs the infrastructure
package check and coverage suite, builds `dist/index.js`, authenticates to Pulumi Cloud, previews
the environment's stack, applies it, and runs the environment's live boundary verification.

The production job therefore cannot run after any pre-production failure. Rebuilding in each job
is intentional: the compiled Pulumi entrypoint is produced and checked in the same runner that
performs the corresponding preview and apply.

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
allows the repository's GitHub OIDC subject and issues the same short-lived personal-scope token
shape used by Perseus: `urn:pulumi:token-type:access_token:personal` with `scope: user:cwchanap`.
No `PULUMI_ACCESS_TOKEN` GitHub secret is created.

Use the same SHA-pinned Pulumi actions currently used by the Perseus deployment workflow:

- `pulumi/auth-actions@1c89817aab0c66407723cdef72b05266e7376640` (`v1.0.1`);
- `pulumi/actions@8582a9e8cc630786854029b4e09281acd6794b58` (`v6.6.1`).

The implementation must preserve SHA pinning if either action is upgraded during review.

## GitHub Environment Contract

Create `dtx-access-pre-prod` and `dtx-access-production` with no required reviewers. Each environment
contains the same variable names but owns its values independently.

| Kind     | Name                          | Purpose                                            |
| -------- | ----------------------------- | -------------------------------------------------- |
| Secret   | `CLOUDFLARE_ACCESS_API_TOKEN` | Dedicated Cloudflare Access application credential |
| Secret   | `DTX_ACCESS_EMAIL`            | Email included by the one Access allow policy      |
| Variable | `CLOUDFLARE_ACCOUNT_ID`       | Cloudflare account containing both applications    |
| Variable | `DTX_DEVICE_POSTURE_RULE_ID`  | Existing Perseus-managed posture-rule resource ID  |

Keep `PULUMI_ORG=cwchanap` as a repository variable, matching Perseus.

The workflow exposes `CLOUDFLARE_ACCESS_API_TOKEN` to the provider only as
`CLOUDFLARE_API_TOKEN` within the Pulumi steps. The token has only the Cloudflare account-level
`Access: Apps and Policies Edit` permission for the target account. It has no Workers, DNS, D1,
R2, API-token-management, or global-key privileges.

The Pulumi action supplies these stack config values on each preview and apply:

- `cloudflareAccountId` from `vars.CLOUDFLARE_ACCOUNT_ID`;
- `accessEmail` from `secrets.DTX_ACCESS_EMAIL`, marked secret;
- `devicePostureRuleId` from `vars.DTX_DEVICE_POSTURE_RULE_ID`.

`accessSessionDuration` remains code-defaulted to `12h`. The workflow does not accept hostnames or
destinations as configuration. `PULUMI_CONFIG_PASSPHRASE` is absent from GitHub.

## One-Time State Migration

State migration is a prerequisite to merging or enabling the deployment workflow. It is an
operator operation, not a recurring workflow step.

1. Stop local Pulumi applies for both DTXWeb stacks.
2. Confirm the local `pre-prod` and `production` stacks refer to the two current live Cloudflare
   applications and record a non-sensitive resource summary.
3. Export each stack through Pulumi's supported backend-migration procedure into a private
   temporary location. The export may contain sensitive state and must never enter git, logs, chat,
   or a shared artifact store.
4. Log in to Pulumi Cloud, initialize the two fully qualified remote stacks, and import the
   matching local state into each one.
5. Change each imported stack from the inherited local passphrase secrets provider to Pulumi
   Cloud's managed default secrets provider. The empty passphrase is used only on the operator
   machine while reading the old state.
6. Reapply `accessEmail` as secret config and confirm it remains encrypted/redacted in Pulumi
   output.
7. Build the current infrastructure program and run a remote preview for each stack with the
   dedicated Cloudflare credential.
8. Require zero resource creates, replacements, or deletes. Config-only secret-provider metadata
   changes are acceptable. Any resource operation is a hard stop until the state, URNs, provider
   identity, and live application IDs agree.
9. Remove the temporary exports after both imports and previews are verified.

The workflow must not exist on `main` until this sequence and the GitHub Environment/OIDC setup are
complete. Otherwise its first automatic run could start without the state or credentials needed to
adopt the live resources safely.

## Live Boundary Verification

Keep the workflow YAML small by placing the existing header-matrix behavior in a version-controlled
script under `packages/infrastructure/scripts/`. The script accepts only `pre-prod` or `production`
and fails closed on DNS, TLS, network, or unsupported-environment errors.

An Access-intercepted route passes when it follows the tenant's known Access redirect contract or
returns `403` with both `cf-access-aud` and `cf-access-domain`. A route expected outside Access
passes only when neither Access redirect nor Access headers appear; its origin status may still be
`200`, `303`, `404`, or another application-owned response.

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
- `/app/score`;
- `/app/desktop-auth`.

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

The script must be testable without real network calls by injecting or shadowing its HTTP client.
Tests cover redirect interception, `403` header interception, non-intercepted origin responses,
network failure, missing Access headers, unexpected Access on a public route, and invalid
environment input.

## Trusted-Device Verification

An unauthenticated GitHub-hosted runner cannot satisfy the operator's identity plus the shared
WARP posture rule. Automated checks therefore prove only the external boundary: protected routes
are intercepted and public routes are not.

After changes to `DTX_ACCESS_EMAIL`, `DTX_DEVICE_POSTURE_RULE_ID`, the Access policy construction,
or relevant Cloudflare tenant identity/posture settings, the operator performs the runbook's manual
browser checks from:

- the configured identity on a trusted device, which must enter and use `/app`;
- a device that does not satisfy the posture rule, which must be denied before DTXWeb loads.

Ordinary infrastructure build or workflow maintenance changes remain fully automatic and do not
introduce a GitHub approval gate.

## Failure Handling And Recovery

- A pre-production check, preview, apply, or smoke failure blocks production.
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
The operator must reconcile the provider-side change with Pulumi state before the next automated
apply.

## Documentation Reconciliation

Update `packages/infrastructure/README.md` and the Zero Trust operator runbook to:

- replace the local backend as the primary backend with the two Pulumi Cloud stack identities;
- explain OIDC and GitHub Environment configuration without including values;
- remove the obsolete production hold and operator-only apply instructions;
- record that pre-production and production are already live;
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
- workflow jobs use the expected stacks, environments, dependencies, permissions, path filters,
  concurrency, SHA-pinned actions, and config secrecy;
- documentation no longer instructs operators to use the local backend or hold production.

Automation is ready to enable when:

- both Pulumi Cloud stacks contain the migrated live resource state;
- both remote previews show no unintended resource operations;
- Pulumi Cloud OIDC trust is restricted to `cwchanap/DTXWeb`;
- both GitHub Environments contain the required secrets and variables with no reviewer gate;
- the first `main`-triggered workflow run completes pre-production then production successfully;
- both automated live matrices pass;
- the operator completes the trusted-device and denied-device checks once after the first
  automated rollout, and again whenever identity, posture, or policy inputs change.

## Expected Repository Changes

- `.github/workflows/deploy-cloudflare-access.yml`;
- `packages/infrastructure/scripts/verify-access.sh`;
- tests for the verification script;
- `packages/infrastructure/README.md`;
- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`;
- this design and its implementation plan.

No Worker, API, web runtime, desktop runtime, D1, R2, or Wrangler configuration changes are planned.

## References

- [Pulumi GitHub Actions](https://www.pulumi.com/docs/iac/operations/continuous-delivery/github-actions/)
- [Pulumi state and backend migration](https://www.pulumi.com/docs/iac/concepts/state-and-backends/)
- [Pulumi GitHub OIDC configuration](https://www.pulumi.com/docs/administration/access-identity/oidc-issuers/github/)
- [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)
- Perseus `.github/workflows/deploy-infrastructure.yml`
- DTXWeb `packages/infrastructure/src/access.ts`
- DTXWeb `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
