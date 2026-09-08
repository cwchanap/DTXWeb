# DTXWeb Gateway Posture Runbook

This runbook is the current operator procedure for DTXWeb Cloudflare Access device admission. It
supersedes the Perseus/shared-posture portions of older Access and infrastructure migration
runbooks; those older documents remain historical records of the previous design.

## Desired policy

DTXWeb owns its device posture checks. It does not reuse the Perseus admin serial-number list or
posture rule.

Each infrastructure stack creates one Cloudflare Zero Trust device posture rule:

- pre-production: `DTXWeb Pre-prod Gateway Check`
- production: `DTXWeb Production App Gateway Check`
- posture type: `gateway`

Each Access application keeps the configured DTXWeb email as its identity `Include` and requires
its stack's DTXWeb Gateway posture rule. No serial-number list or externally configured posture-rule
ID is part of DTXWeb.

Cloudflare's Require Gateway check passes only when the device is running Cloudflare One Client,
is enrolled in this Zero Trust organization, and its traffic is filtered by this organization's
Gateway. It is intentionally narrower than Require WARP, which can also match consumer WARP.

## Infrastructure token prerequisite

The existing `CLOUDFLARE_INFRA_API_TOKEN` in both GitHub Environments must include the existing
infrastructure permissions plus **Zero Trust Write**. Cloudflare requires Zero Trust Write for
creating and updating `/accounts/{account_id}/devices/posture` resources.

Environments:

- `dtx-access-pre-prod`
- `dtx-access-production`

Do not print or record the token, configured email, account/application/posture identifiers,
Access cookies, or Pulumi stack state.

## Deployment

The normal deployment path remains `.github/workflows/deploy-cloudflare-infrastructure.yml` on
`main`. Pre-production deploys and verifies first; production runs only after pre-production
succeeds.

The intended Pulumi change per stack is:

1. create one DTXWeb-owned `gateway` posture rule;
2. update the existing Access application policy to require that rule;
3. leave D1, R2, KV, Worker custom domains, Worker releases, and public-route scope unchanged.

The committed stack settings must not contain `devicePostureRuleId`.

## Human admission verification

The boundary verifier proves only that Cloudflare Access intercepts the expected routes:

```bash
packages/infrastructure/scripts/verify-access.sh pre-prod
packages/infrastructure/scripts/verify-access.sh production
```

After deployment, perform the positive admission check on a device registered to this Zero Trust
organization with Cloudflare One Client showing Gateway connected:

1. use the configured DTXWeb Access identity;
2. enter the protected application;
3. confirm `/app` loads and normal API use succeeds.

Then perform the negative check by disconnecting Gateway or using a device not enrolled in this
Zero Trust organization. Request the same protected surface and confirm Cloudflare Access denies it
before DTXWeb loads.

For the reported Windows device, `WARP: on` and `Gateway: on` should satisfy the new device-posture
portion after the infrastructure deployment; the configured Access identity remains separately
required.

## Rollback

Do not restore the Perseus posture-rule ID or create a DTXWeb serial allowlist as a rollback.
If the Gateway posture change itself must be backed out, revert this DTXWeb infrastructure change
through the normal reviewed Pulumi deployment path. Do not alter Perseus Access resources.
