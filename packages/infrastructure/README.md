# @dtx/infrastructure

This Pulumi workspace manages the DTXWeb Cloudflare Access applications only. Wrangler
continues to own Worker, API, D1, R2, and other runtime infrastructure.

## Local backend and supported stacks

Use the local Pulumi backend from this package:

```bash
cd packages/infrastructure
pulumi login --local
```

The only supported stacks are `pre-prod` and `production`:

```bash
pulumi stack select pre-prod || {
  echo 'FAIL: expected the existing local pre-prod stack; refusing to initialize a new stack' >&2
  exit 1
}
pulumi stack select production || {
  echo 'FAIL: expected the existing local production stack; refusing to initialize a new stack' >&2
  exit 1
}

for stack in pre-prod production; do
  access_application_id="$(pulumi stack output accessApplicationId --stack "$stack")" || exit 1
  if [ -z "$access_application_id" ]; then
    echo "FAIL: $stack has no accessApplicationId output; refusing preview/apply" >&2
    exit 1
  fi
done
unset access_application_id stack
```

The Pulumi program rejects every other stack name. Stack configuration files are local
operator state and are ignored by git. Both existing stack selections and non-empty
`accessApplicationId` outputs are required before preview or apply; the captured identifiers are
not printed in evidence. Never initialize a replacement stack when selection fails.

## Configuration

Each supported stack requires these keys:

- `cloudflareAccountId` — the Cloudflare account ID, stored as plain config.
- `accessEmail` — the operator email, stored with Pulumi secret config.
- `devicePostureRuleId` — the existing Perseus-managed posture-rule ID, stored as plain
  config.

`accessSessionDuration` is optional and defaults to `12h`.

Configure values from uncommitted shell variables; never put credentials or identities in
source files or logs:

```bash
pulumi config set cloudflareAccountId "$DTX_CLOUDFLARE_ACCOUNT_ID" --stack pre-prod
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack pre-prod
pulumi config set devicePostureRuleId "$DTX_DEVICE_POSTURE_RULE_ID" --stack pre-prod

pulumi config set cloudflareAccountId "$DTX_CLOUDFLARE_ACCOUNT_ID" --stack production
pulumi config set --secret accessEmail "$DTX_ACCESS_EMAIL" --stack production
pulumi config set devicePostureRuleId "$DTX_DEVICE_POSTURE_RULE_ID" --stack production
```

Obtain the current posture-rule output from the Perseus infrastructure package using its
correct backend and production stack:

```bash
: "${PERSEUS_INFRA_DIR:?set PERSEUS_INFRA_DIR to Perseus packages/infrastructure}"
(
  cd "$PERSEUS_INFRA_DIR"
  pulumi stack output adminAccessDevicePostureRuleId
)
```

Use that output for `devicePostureRuleId` in both DTXWeb stacks. The required comparison
against both configured stack values is defined in the [operator runbook](../../docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md).

## Build and preview

Build the Pulumi program before every preview because `Pulumi.yaml` executes
`dist/index.js`:

```bash
bun run --filter=@dtx/infrastructure build
```

From this package, use explicit stack names for non-mutating previews:

```bash
pulumi preview --stack pre-prod
pulumi preview --stack production
```

Do not add or use unscoped Pulumi package scripts. Production live apply remains on hold
until the Better Auth/D1 cutover is complete and the operator runbook has been reconciled.

## Operator procedures

The [Cloudflare Zero Trust Web Access Runbook](../../docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md)
is the sole source of truth for live route matrices, posture comparison, apply and destroy,
browser/device acceptance, and rollback. Follow it for all operator-only `pulumi up`,
`pulumi destroy`, browser, and device operations.
