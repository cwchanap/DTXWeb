# @dtx/infrastructure

This Pulumi workspace manages DTXWeb's Cloudflare Access applications, permanent D1 databases,
R2 buckets, active rate-limit KV namespaces, and Worker custom domains. Wrangler continues to own
Worker release/configuration, D1 schema migrations, and Workflow, Container, and Durable Object
runtime definitions.

## Ownership boundary

Pulumi owns the identity and lifecycle of the Access, D1, R2, KV, and Worker custom-domain
resources in the two stacks below. D1 and R2 are protected and retained; any preview that creates,
replaces, or deletes one of those resources is a hard stop. Wrangler keeps the checked-in binding
IDs and owns Worker code/assets, runtime configuration, secrets, observability, migrations,
Workflows, Containers, and Durable Object migrations.

## Pulumi Cloud ownership

The Cloudflare infrastructure is managed in Pulumi Cloud by these exact stacks:

- `cwchanap/dtxweb-infrastructure/pre-prod` — `DTXWeb Pre-prod` over the entire
  `pre-prod.dtx.hapadona.com` hostname.
- `cwchanap/dtxweb-infrastructure/production` — `DTXWeb Production App` over only
  `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`.

The two stack settings files are committed and are the configuration source for deployment:

- `Pulumi.pre-prod.yaml`
- `Pulumi.production.yaml`

Both use Pulumi Cloud's `default` secrets provider. `accessEmail` is encrypted; the
`devicePostureRuleId` and `cloudflareAccountId` entries are non-secret stack configuration. Never
print or copy their values, ciphertext, or Pulumi stack state. Local passphrase state is retired;
CI does not use `PULUMI_CONFIG_PASSPHRASE`, and these stacks must not be replaced with local
stacks.

## OIDC and Cloudflare credentials

The deployment workflow exchanges its GitHub Actions OIDC identity for a short-lived Pulumi Cloud
token. It uses the repository variable `PULUMI_ORG` (`cwchanap`), audience
`urn:pulumi:org:cwchanap`, and only these environment subjects:

- `repo:cwchanap/DTXWeb:environment:dtx-access-pre-prod`
- `repo:cwchanap/DTXWeb:environment:dtx-access-production`

The workflow uses the SHA-pinned `pulumi/auth-actions` and `pulumi/actions` actions.
`pulumi/auth-actions` exchanges the GitHub Actions OIDC identity for a runtime Pulumi Cloud access
token and exports it as `PULUMI_ACCESS_TOKEN` for the deployment step, so no long-lived
`PULUMI_ACCESS_TOKEN` secret is stored. It requests the personal token type with `user:cwchanap`
scope for that exchange.

The repository's existing `CLOUDFLARE_ACCOUNT_ID` variable remains available to workflows that
already use it. The infrastructure workflow does not inject that variable: the non-secret account
setting is committed in both Pulumi stack files. The renamed workflow reads
`CLOUDFLARE_INFRA_API_TOKEN` from these existing GitHub Environments; keep the old
`CLOUDFLARE_ACCESS_API_TOKEN` secret until the renamed workflow's first successful `main` run:

- `dtx-access-pre-prod`
- `dtx-access-production`

Both environments restrict deployment branches and tags to selected branches with `main` only.
A job that references an Environment receives the default OIDC subject
`repo:cwchanap/DTXWeb:environment:<name>` without a branch ref and can reference the environment
secret, so the workflow-level `main` guard is not a credential boundary; the deployment-branch
restriction is what prevents a modified workflow on another branch from minting the Pulumi-trusted
environment subject.

During the Pulumi refresh-gate and update steps, `CLOUDFLARE_INFRA_API_TOKEN` is exposed only as
`CLOUDFLARE_API_TOKEN`. It must be dashboard-minted with the minimum account-level permissions
for Access Apps/Policies, D1, R2 bucket identity, Workers KV namespaces, and Workers custom
domains. Do not grant token-management or Global API Key privileges. Do not record or print the
token, operator email, posture-rule ID, account ID, application ID, or ciphertext.

## Automatic deployment

The `Deploy Cloudflare Infrastructure` workflow in `.github/workflows/deploy-cloudflare-infrastructure.yml`
has two normal entry points:

Pre-merge checklist: add `CLOUDFLARE_INFRA_API_TOKEN` to `dtx-access-pre-prod` and `dtx-access-production` with
the minimum Access Apps/Policies, D1, R2 bucket identity, Workers KV namespace, and Workers custom domain
permissions; keep `CLOUDFLARE_ACCESS_API_TOKEN` until the renamed workflow runs successfully. Provisioning remains
pending operator action; the full procedure is in the current infrastructure runbook.

1. A relevant change pushed to `main` (`packages/infrastructure/**`, the lockfile, root package
   or TypeScript configuration, or the workflow itself).
2. `workflow_dispatch` started from `main` for a recovery rerun. The jobs guard the `main` ref;
   dispatching another ref skips the deployment jobs.

Both entry points run the same serial path:

```text
pre-production check/test/coverage/build -> Pulumi refresh --preview-only --expect-no-changes
  -> Pulumi up (without --refresh) -> pre-production boundary verification
  -> production check/test/coverage/build -> Pulumi refresh --preview-only --expect-no-changes
  -> Pulumi up (without --refresh) -> production boundary verification
```

The preview-only refresh is a drift gate: any live drift fails the job before the update instead of
being auto-remediated. The production job requires `deploy-pre-prod`, so a pre-production check,
drift gate, update, or boundary failure prevents production from starting. Each job builds and
verifies `dist/index.js` on its own runner, authenticates with OIDC, runs the preview-only refresh
gate followed by one non-refreshing Pulumi update, suppresses stack outputs, and invokes the
version-controlled boundary verifier. There is no pull-request deploy, automatic rollback, or
automatic destroy. Workflow/ref concurrency uses `cancel-in-progress: false`, so a newer run waits
for an active deployment instead of interrupting it.

## Resource protection

Both Access resources are declared with `protect: true`, and the protection bit is persisted in
their Pulumi Cloud state. Normal updates remain possible, but Pulumi refuses deletion or
replacement. An intentional replacement or deletion requires a separately reviewed unprotect
operation; the automatic workflow never performs that exception.

## Verification and human admission

The exact unauthenticated boundary matrices are owned by the version-controlled verifier:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

It fails closed on network or malformed responses and accepts only the strict Cloudflare Access
redirect or the required `403` Access-header contract. It never prints Access header values or
cookies. The verifier proves edge interception only; it does not prove identity, posture, browser
login, desktop authorization, or session expiry.

After any change to the configured identity, posture rule, Access policy, or relevant Cloudflare
tenant settings, a human must enter the protected application on a trusted device and confirm it
works, then use a device that fails the posture rule to confirm Access denies the request before
DTXWeb loads. The runbook contains the full current and future acceptance procedure.
