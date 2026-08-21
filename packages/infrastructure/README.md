# @dtx/infrastructure

This Pulumi workspace manages the DTXWeb Cloudflare Access applications only. Wrangler
continues to own Worker, API, D1, R2, and other runtime infrastructure.

## Pulumi Cloud ownership

The Access applications are managed in Pulumi Cloud by these exact stacks:

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

The workflow uses the SHA-pinned `pulumi/auth-actions` and `pulumi/actions` actions with the
personal token type and `user:cwchanap` scope. It does not create or use
`PULUMI_ACCESS_TOKEN`.

The repository's existing `CLOUDFLARE_ACCOUNT_ID` variable remains available to workflows that
already use it. The Access workflow does not inject that variable: the non-secret account setting
is committed in both Pulumi stack files. Each GitHub Environment contains only its own
`CLOUDFLARE_ACCESS_API_TOKEN` secret:

- `dtx-access-pre-prod`
- `dtx-access-production`

During the Pulumi update step, the environment secret is exposed only as
`CLOUDFLARE_API_TOKEN`. The token is limited to account-level Cloudflare `Access: Apps and
Policies Edit` for the target account; it has no Workers, DNS, D1, R2, token-management, or
Global API Key privileges. Do not record or print the token, operator email, posture-rule ID,
account ID, application ID, or ciphertext.

## Automatic deployment

The workflow in `.github/workflows/deploy-cloudflare-access.yml` has two normal entry points:

1. A relevant change pushed to `main` (`packages/infrastructure/**`, the lockfile, root package
   or TypeScript configuration, or the workflow itself).
2. `workflow_dispatch` started from `main` for a recovery rerun. The jobs guard the `main` ref;
   dispatching another ref skips the deployment jobs.

Both entry points run the same serial path:

```text
pre-production check/test/coverage/build -> Pulumi up --refresh -> pre-production boundary verification
  -> production check/test/coverage/build -> Pulumi up --refresh -> production boundary verification
```

The production job requires `deploy-pre-prod`, so a pre-production check, update, or boundary
failure prevents production from starting. Each job builds and verifies `dist/index.js` on its own
runner, authenticates with OIDC, runs exactly one refreshed Pulumi update, suppresses stack
outputs, and invokes the version-controlled boundary verifier. There is no pull-request deploy,
automatic rollback, or automatic destroy. Workflow/ref concurrency uses `cancel-in-progress: false`,
so a newer run waits for an active deployment instead of interrupting it.

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
