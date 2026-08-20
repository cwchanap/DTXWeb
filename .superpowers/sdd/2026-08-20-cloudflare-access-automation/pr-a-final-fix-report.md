# PR A Final Fix Report

## Scope

This fix wave starts at `70efbe555c46bce696ff105a19b6dcc34eb45216` and addresses all three
Important findings from the whole-branch review:

1. reject Cloudflare Access redirect host userinfo spoofing;
2. refuse empty or newly initialized local Pulumi stacks; and
3. document the protected-resource exception required for an intentional pre-production rollback.

No live Cloudflare or Pulumi state was mutated.

## Fixes

### 1. Strict redirect host matching

`packages/infrastructure/scripts/verify-access.sh` now accepts only the strict redirect shape:

```text
^https://([[:alnum:]-]+\.)+cloudflareaccess\.com(:[0-9]+)?([/?#]|$)
```

The optional port is digits-only and must be followed by a path, query, fragment, or end of URL.
This rejects the userinfo spoof URL `https://tenant.cloudflareaccess.com:443@evil.example/login`,
whose actual host is `evil.example`.

The PATH-shadowed fake-curl suite adds an exact regression for that URL. Existing redaction checks,
protected/public matrices, final-response handling, and supported Access response contracts remain
covered.

### 2. Existing local stack hard stops

The transitional runbook and infrastructure README now:

- select `pre-prod` and `production` only, failing instead of running `pulumi stack init`;
- capture each stack's `accessApplicationId` output without printing it; and
- stop before preview/apply if either output is empty or unavailable.

The migration plan's intentional remote `pulumi stack init` commands were not changed; they are
not fallback initialization paths for the existing local stacks.

### 3. Protected pre-production rollback

The runbook now explains that `{ protect: true }` makes the normal destroy path fail closed. It
documents the separately reviewed `pulumi state unprotect` step for only the exact pre-production
Access resource before rerunning the destroy preview and `pulumi destroy`.

The existing production-data exposure warning remains in place. The runbook also states that no
automatic rollback performs this exception and that a later `pulumi up` will recreate the declared
application unless desired source and Pulumi state are deliberately reconciled.

## RED/GREEN evidence

### Redirect spoof regression

Before changing the matcher, with the new fake-curl case present:

```text
Command: rtk bash packages/infrastructure/scripts/verify-access.test.sh
Result: exit 1 (RED)
FAIL: Cloudflare host userinfo spoof rejected (expected status 1, got 0)
```

After changing the matcher:

```text
Command: rtk bash packages/infrastructure/scripts/verify-access.test.sh
Result: exit 0 (GREEN)
PASS: Cloudflare host userinfo spoof rejected
```

## Verification evidence

All commands were run from the PR A worktree.

| Check | Result |
| --- | --- |
| `rtk bun run --filter=@dtx/infrastructure test` | PASS — 2 Vitest files, 12 Vitest tests, and all Bash verifier cases passed |
| `rtk bun run --filter=@dtx/infrastructure check` | PASS — exit 0 |
| `rtk bun run --filter=@dtx/infrastructure build` | PASS — exit 0 |
| `rtk bunx prettier --check .superpowers/sdd/2026-08-20-cloudflare-access-automation/pr-a-final-fix-report.md packages/infrastructure/README.md docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md` | PASS — all matched files use Prettier style |
| `rtk bash -n packages/infrastructure/scripts/verify-access.sh` | PASS |
| `rtk bash -n packages/infrastructure/scripts/verify-access.test.sh` | PASS |
| `rtk git diff --check` | PASS |

## Changed files

- `.superpowers/sdd/2026-08-20-cloudflare-access-automation/pr-a-final-fix-report.md`
- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- `packages/infrastructure/README.md`
- `packages/infrastructure/scripts/verify-access.sh`
- `packages/infrastructure/scripts/verify-access.test.sh`

## Remaining concern

Live Cloudflare boundary verification and Pulumi state migration remain operator-owned external
gates. This fix wave intentionally performed no live provider mutation and does not claim those
gates passed.
