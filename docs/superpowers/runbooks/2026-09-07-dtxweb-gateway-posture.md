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

A client reporting `Gateway: on` is the expected positive device signal after the infrastructure
change is deployed; the configured Access identity remains separately required.

## Enforcement window

Each Gateway posture rule sets `expiration: '10m'`. A posture result therefore stays valid for at
most ten minutes after the last successful Gateway check; the One Client polls on its default `5m`
schedule, so `10m` is 2× the polling interval as Cloudflare recommends. If a device stops reporting
Gateway (for example, the One Client is quit or loses connectivity), Access denies that device
within at most ten minutes rather than retaining a stale pass indefinitely. Treat any admission
verification that follows a deliberate Gateway disconnect as conclusive only after this window has
elapsed.

## Rollback

A plain `git revert` of this change is **not** the rollback: it restores the old
`devicePostureRuleId` config and the committed Perseus posture-rule IDs, which reintroduces the
Perseus coupling this runbook removes. Do not alter Perseus Access resources.

To back the Gateway posture change out while keeping DTXWeb decoupled, ship a one-off reviewed
Pulumi change (not a revert) that temporarily drops the device-posture `requires` from the affected
stack's Access policy, leaving the operator-email `Include` as the only admission condition:

1. in `createAccessApplication`, build the policy without the `requires` entry (email `Include`
   only) for the stack being rolled back;
2. deploy through the normal reviewed `.github/workflows/deploy-cloudflare-infrastructure.yml`
   path (pre-production first, then production);
3. confirm the protected surface is reachable for the configured operator identity;
4. restore the Gateway `requires` and redeploy once the posture change is ready to re-enable.

This temporarily lowers admission to email identity only. It does not touch Perseus, does not
restore `devicePostureRuleId`, and keeps DTXWeb's posture ownership intact in the committed code.
