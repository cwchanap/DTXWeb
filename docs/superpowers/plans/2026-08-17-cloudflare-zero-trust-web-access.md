# Cloudflare Zero Trust Web Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production DTXWeb `/app` and production desktop login operator-only behind Cloudflare Zero Trust, while protecting the entire pre-production web hostname and leaving the public production site plus both API hostnames outside Access.

**Architecture:** Configure two manually managed Cloudflare Access self-hosted public-hostname applications. Roll out hostname-wide pre-production first to prove identity, device posture, Supabase login/OAuth, and rollback; only then create the production application scoped to exactly `/app` and `/app/*`. Supabase stays as the inner application-authentication gate, and route boundaries are verified with HTTP headers plus trusted-device browser/desktop smoke tests.

**Tech Stack:** Cloudflare Zero Trust Access dashboard, Cloudflare One Client/WARP device posture, SvelteKit/Supabase existing authentication, Markdown operator documentation, `curl` header verification.

**Spec:** `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`

## Global Constraints

- Do not add Pulumi, Terraform, or another infrastructure-as-code system.
- Do not add CI deployment for Zero Trust.
- Do not modify `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop` in this slice.
- Production `/app` and production desktop login are intentionally operator-only behind Access; normal Supabase users are not expected to enter production `/app`.
- Production Access destinations must be exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`.
- Production `/`, `/blog`, `/preview`, `/editor`, `/tool/*`, `/game`, `/login`, `/auth/*`, and every route outside `/app` remain outside Access.
- Pre-production Access covers the entire `pre-prod.dtx.hapadona.com` hostname with no path bypass.
- `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` remain outside Access.
- Use an `Allow` policy that includes the intended operator identity/email and requires the trusted-device serial-number posture check used for Perseus.
- Use a `12h` Access session duration.
- Prefer reusing the existing account-level Perseus serial-number list/posture rule when available in the same Zero Trust account. If DTXWeb is in another Zero Trust account, create an equivalent list/posture rule there without weakening the requirement.
- Do not create Service Auth policies, service tokens, or Access credentials for API, desktop, CLI, or CI traffic.
- Do not enable Managed OAuth or add machine-auth behavior in this slice.
- Keep the normal Cloudflare Access login-page flow during rollout rather than enabling instant authentication; the header checks below use the Access `302`/`Location` signal.
- Do not commit the operator email, device serial numbers, Access cookies, tokens, screenshots containing credentials, or other personal/security identifiers.
- Configure and verify pre-production before creating the production Access application.
- If implementation reveals that application code must change for the approved model to work, stop and create a separate follow-up rather than widening this slice.

---

### Task 1: Add The Dedicated Zero Trust Operator Runbook

**Files:**

- Create: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- Reference: `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`

**Interfaces:**

- Consumes: the approved protection matrix and rollout order from the design spec.
- Produces: the durable repository source of truth for manual Access configuration, verification, rollback, and the operator-only product intent.

- [ ] **Step 1: Create the runbook with the exact configuration and rollout contract**

Create `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md` with:

```markdown
# Cloudflare Zero Trust Web Access Runbook

## Scope

DTXWeb uses manually managed Cloudflare Zero Trust Access for two web surfaces:

| Application | Protected destination |
| --- | --- |
| `DTXWeb Pre-prod` | entire `pre-prod.dtx.hapadona.com` hostname |
| `DTXWeb Production App` | `dtx.hapadona.com/app` |
| `DTXWeb Production App` | `dtx.hapadona.com/app/*` |

Production `/app` and production desktop login are intentionally operator-only. The configured Access identity and trusted-device posture are an outer gate; Supabase remains the inner application-authentication gate.

A normal Supabase user may reach public `/login`, authenticate successfully, and then be denied when returning to `/app`. That is expected for this configuration: public `/login` is an entry point, not an Access bypass.

The production landing page and public content/tools remain outside Access, including `/blog`, `/preview`, `/editor`, `/tool/*`, and `/game`. Both GraphQL API hostnames remain outside Access.

This runbook is the durable Zero Trust source of truth. `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md` is useful precedent for human-executed Cloudflare operations but remains a historical API-migration runbook and is not modified for this feature.

## Required Policy

Both Access applications use the same policy semantics:

- Action: `Allow`
- Include: the intended operator identity/email used for existing Perseus access
- Require: the trusted-device serial-number posture check used for Perseus
- Session duration: `12h`
- Service Auth: none
- Managed OAuth: off
- Instant authentication: off during this rollout so unauthenticated header verification has a stable Access-login redirect

Reuse the existing account-level Perseus serial-number list/posture rule when it is available in the same Zero Trust account. If DTXWeb is in another Zero Trust account, create an equivalent serial-number list and posture rule there using the same intended trusted devices.

Never commit the email address, device serial numbers, Access cookies, tokens, or other security identifiers to this repository.

## Rollout Order

1. Confirm the operator identity and trusted-device posture rule.
2. Create and verify `DTXWeb Pre-prod`.
3. Prove pre-production password login, Google OAuth, posture denial, and API non-interception.
4. Stop and roll back pre-production if any check fails.
5. Create `DTXWeb Production App` with only `/app` and `/app/*`.
6. Run the complete production public/protected header matrix.
7. Run the trusted production browser and desktop-login checks.
8. Re-run both API non-interception checks.

Do not create the production Access application until the pre-production checks are green.

## Header Verification Helpers

Use unauthenticated requests with no Access cookies:

```bash
access_headers() {
  curl -sS -o /dev/null -D - "$1" | tr -d '\r'
}

assert_access_redirect() {
  url="$1"
  headers="$(access_headers "$url")"
  printf '%s\n' "$headers" | sed -n '1p;/^location:/Ip'
  printf '%s\n' "$headers" \
    | grep -Eiq '^location: https://[^/]+\.cloudflareaccess\.com/cdn-cgi/access/' \
    || { echo "FAIL: Access did not intercept $url" >&2; return 1; }
}

assert_no_access_redirect() {
  url="$1"
  headers="$(access_headers "$url")"
  printf '%s\n' "$headers" | sed -n '1p;/^location:/Ip'
  if printf '%s\n' "$headers" \
    | grep -Eiq '^location: https://[^/]+\.cloudflareaccess\.com/cdn-cgi/access/'; then
    echo "FAIL: Access unexpectedly intercepted $url" >&2
    return 1
  fi
}
```

An origin `200`, `3xx`, `4xx`, or `5xx` can all be valid for an unprotected URL. The boundary assertion is whether Cloudflare Access intercepted the request.

## Pre-production Configuration

In **Zero Trust > Access controls > Applications**:

1. Create a **Self-hosted and private** application.
2. Name it `DTXWeb Pre-prod`.
3. Add one public hostname for `pre-prod.dtx.hapadona.com` with no path restriction.
4. Set session duration to `12h`.
5. Attach the operator `Allow` policy with the serial-number posture requirement.
6. Leave Service Auth, Managed OAuth, and instant authentication off.
7. Save the application.

Do not add `api.pre-prod.dtx.hapadona.com`.

## Pre-production Verification

Run:

```bash
assert_access_redirect https://pre-prod.dtx.hapadona.com/
assert_access_redirect https://pre-prod.dtx.hapadona.com/login
assert_access_redirect https://pre-prod.dtx.hapadona.com/auth/callback
assert_access_redirect https://pre-prod.dtx.hapadona.com/blog
assert_access_redirect https://pre-prod.dtx.hapadona.com/preview
assert_access_redirect https://pre-prod.dtx.hapadona.com/editor
assert_access_redirect https://pre-prod.dtx.hapadona.com/tool/dtx-to-midi
assert_access_redirect https://pre-prod.dtx.hapadona.com/game
assert_access_redirect https://pre-prod.dtx.hapadona.com/app
assert_access_redirect https://pre-prod.dtx.hapadona.com/app/score
assert_no_access_redirect https://api.pre-prod.dtx.hapadona.com/
```

Then, on the trusted WARP/Cloudflare One device with the allowed identity:

- enter the pre-production hostname through Access;
- complete a password login and return to the application;
- complete Google OAuth and confirm the callback returns behind the same hostname-wide Access gate;
- confirm normal pre-production API-backed application behavior still works;
- from a device that fails the serial posture rule, confirm the hostname is denied before DTXWeb loads.

If any pre-production check fails, disable/delete `DTXWeb Pre-prod` and stop. Do not create production Access yet.

## Production Configuration

Only after pre-production verification succeeds:

1. Create a **Self-hosted and private** application.
2. Name it `DTXWeb Production App`.
3. Add exactly these public-hostname destinations:
   - `dtx.hapadona.com/app`
   - `dtx.hapadona.com/app/*`
4. Set session duration to `12h`.
5. Attach the operator `Allow` policy with the serial-number posture requirement.
6. Leave Service Auth, Managed OAuth, and instant authentication off.
7. Save the application.

Do not add a hostname-wide `dtx.hapadona.com` destination or any other production path.

## Production Header Matrix

Run:

```bash
assert_access_redirect https://dtx.hapadona.com/app
assert_access_redirect https://dtx.hapadona.com/app/score

assert_no_access_redirect https://dtx.hapadona.com/
assert_no_access_redirect https://dtx.hapadona.com/blog
assert_no_access_redirect https://dtx.hapadona.com/preview
assert_no_access_redirect https://dtx.hapadona.com/editor
assert_no_access_redirect https://dtx.hapadona.com/tool/dtx-to-midi
assert_no_access_redirect https://dtx.hapadona.com/game
assert_no_access_redirect https://dtx.hapadona.com/login
assert_no_access_redirect https://dtx.hapadona.com/auth/callback
assert_no_access_redirect https://api.dtx.hapadona.com/
assert_no_access_redirect https://api.pre-prod.dtx.hapadona.com/
```

The public matrix is intentionally broad enough to catch an accidentally hostname-wide or over-broad production destination; `/tool/dtx-to-midi` also catches accidental `/t*`-style scoping.

## Trusted Production Browser Verification

On the trusted WARP/Cloudflare One device with the allowed identity:

1. Open production `/app` and pass Access.
2. With no Supabase session, confirm SvelteKit redirects to public `/login`.
3. Complete normal Supabase login.
4. Confirm the browser returns to protected `/app` using the existing Access session.
5. Confirm a Supabase logout does not remove the Access gate.

From a Supabase account that does not match the configured Access identity, confirm `/login` can still be public while `/app` remains inaccessible. Do not add a bypass to make that account reach `/app`; operator-only access is intentional.

## Production Desktop Login Verification

This is a required production check, not an optional smoke test.

On the trusted device:

1. Start desktop login so the browser opens `/login?redirect=desktop&desktop_callback=...`.
2. Confirm `/login` remains public.
3. Complete password login and confirm the return to `/app?redirect=desktop...` passes Access and opens the desktop callback.
4. Repeat with Google login.
5. Verify the bundled `dtx://auth-callback` flow.
6. When a `tauri dev` instance is available, verify its loopback `http://127.0.0.1:<port>/auth-callback` flow in the same browser tab so the `sessionStorage` callback handoff is exercised.

If the browser reaches public `/login` but cannot complete the protected `/app` handoff on the trusted operator device, disable the production Access app and investigate separately. Do not widen the policy or add path bypasses in this slice.

## Rollback

Pre-production:

- Disable or delete `DTXWeb Pre-prod` if the hostname-wide gate breaks identity, posture, login, OAuth, or route behavior.

Production:

- Disable or delete `DTXWeb Production App` if `/app` or desktop login fails for the trusted operator device.
- If any public production route is intercepted, disable the application, correct it back to exactly `/app` and `/app/*`, and rerun the full header matrix before re-enabling.

If either API hostname is intercepted, remove it from Access. Do not introduce service tokens as an emergency workaround.

No Worker rollback or code deployment is required for these dashboard-only changes.

## References

- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/
```

- [ ] **Step 2: Format-check the runbook**

Run:

```bash
bunx prettier --check docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
```

Expected: exit `0`.

If formatting differs:

```bash
bunx prettier --write docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
bunx prettier --check docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
```

Expected: the second command exits `0`.

- [ ] **Step 3: Review the staged runbook for secrets and scope drift**

Run:

```bash
git diff -- docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
```

Expected:

- no actual operator email;
- no device serial number;
- no Access cookie/token;
- rollout order is pre-production before production;
- production destinations are only `/app` and `/app/*`;
- `/tool/*` and `/game` are explicitly public in production;
- API hostnames remain outside Access.

- [ ] **Step 4: Commit the runbook**

```bash
git add docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
git commit -m "docs: add Zero Trust web access runbook"
```

---

### Task 2: Configure And Prove Hostname-Wide Pre-production Access

**Files:**

- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No source files modified.

**Interfaces:**

- Consumes: the existing Zero Trust tenant, intended operator identity, trusted-device posture rule, and `pre-prod.dtx.hapadona.com` web hostname.
- Produces: a verified `DTXWeb Pre-prod` Access application and a go/no-go decision for production.

- [ ] **Step 1: Confirm the Perseus posture components are reusable**

In Cloudflare Zero Trust, inspect the identity/policy and device posture resources used for Perseus.

Expected:

- the intended operator identity is known to the operator but not copied into git;
- the serial-number posture rule is selectable in the DTXWeb Zero Trust account; or
- if the zone is under another Zero Trust account, an equivalent serial list/posture rule is created there before continuing.

- [ ] **Step 2: Create `DTXWeb Pre-prod`**

In **Zero Trust > Access controls > Applications**:

1. Create a **Self-hosted and private** application.
2. Name it `DTXWeb Pre-prod`.
3. Add `pre-prod.dtx.hapadona.com` as the public hostname with no path.
4. Set session duration to `12h`.
5. Add the operator `Allow` policy and require the serial-number posture rule.
6. Leave Service Auth, Managed OAuth, and instant authentication off.
7. Save.

Expected: every path on the pre-production web hostname is under this application; the pre-production API hostname is not.

- [ ] **Step 3: Run the unauthenticated pre-production header matrix**

Source the two shell helpers from the runbook, then run:

```bash
assert_access_redirect https://pre-prod.dtx.hapadona.com/
assert_access_redirect https://pre-prod.dtx.hapadona.com/login
assert_access_redirect https://pre-prod.dtx.hapadona.com/auth/callback
assert_access_redirect https://pre-prod.dtx.hapadona.com/blog
assert_access_redirect https://pre-prod.dtx.hapadona.com/preview
assert_access_redirect https://pre-prod.dtx.hapadona.com/editor
assert_access_redirect https://pre-prod.dtx.hapadona.com/tool/dtx-to-midi
assert_access_redirect https://pre-prod.dtx.hapadona.com/game
assert_access_redirect https://pre-prod.dtx.hapadona.com/app
assert_access_redirect https://pre-prod.dtx.hapadona.com/app/score
assert_no_access_redirect https://api.pre-prod.dtx.hapadona.com/
```

Expected: all commands exit `0`.

If any command fails, disable/delete `DTXWeb Pre-prod` and stop before production.

- [ ] **Step 4: Prove trusted-device pre-production login and OAuth**

On the trusted WARP/Cloudflare One device with the configured operator identity:

1. Enter `https://pre-prod.dtx.hapadona.com/` through Access.
2. Open `/login` under the established Access session.
3. Complete password login and confirm the existing app flow succeeds.
4. Log out of Supabase while keeping the Access session.
5. Complete Google login and confirm `/auth/callback` returns successfully under Access.
6. Open `/app` and one API-backed page to confirm normal application behavior.

Expected: Access remains the outer hostname gate and both existing Supabase login paths work behind it.

- [ ] **Step 5: Prove posture denial on pre-production**

From a device that does not satisfy the serial posture rule, request the pre-production hostname.

Expected: Cloudflare denies access before DTXWeb loads.

- [ ] **Step 6: Record the pre-production go/no-go**

Proceed only if Steps 3-5 all pass. Otherwise roll back pre-production and stop this implementation before Task 3.

---

### Task 3: Configure Production `/app` And Prove The Route Boundary

**Files:**

- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No source files modified.

**Interfaces:**

- Consumes: successful Task 2 verification and the same operator identity/posture semantics.
- Produces: `DTXWeb Production App` with only `/app` and `/app/*`, plus deterministic evidence that public production routes were not captured.

- [ ] **Step 1: Create the production Access application**

In **Zero Trust > Access controls > Applications**:

1. Create a **Self-hosted and private** application.
2. Name it `DTXWeb Production App`.
3. Add exactly:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

4. Set session duration to `12h`.
5. Add the operator `Allow` policy and require the serial-number posture rule.
6. Leave Service Auth, Managed OAuth, and instant authentication off.
7. Save.

Expected: no hostname-wide production destination and no third destination.

- [ ] **Step 2: Run the protected production assertions**

```bash
assert_access_redirect https://dtx.hapadona.com/app
assert_access_redirect https://dtx.hapadona.com/app/score
```

Expected: both commands exit `0`.

- [ ] **Step 3: Run the full public production matrix**

```bash
assert_no_access_redirect https://dtx.hapadona.com/
assert_no_access_redirect https://dtx.hapadona.com/blog
assert_no_access_redirect https://dtx.hapadona.com/preview
assert_no_access_redirect https://dtx.hapadona.com/editor
assert_no_access_redirect https://dtx.hapadona.com/tool/dtx-to-midi
assert_no_access_redirect https://dtx.hapadona.com/game
assert_no_access_redirect https://dtx.hapadona.com/login
assert_no_access_redirect https://dtx.hapadona.com/auth/callback
```

Expected: every command exits `0`.

If any route shows an Access redirect, disable `DTXWeb Production App` immediately, correct the destination set, and rerun Steps 2-3 before continuing.

- [ ] **Step 4: Prove the operator-only browser behavior**

On the trusted operator device:

1. Open `/app` and pass Access.
2. With no Supabase session, confirm DTXWeb sends the browser to public `/login`.
3. Complete Supabase login and confirm return to protected `/app` succeeds under the existing Access session.
4. Sign out of Supabase and confirm `/app` remains Access-protected.

Expected: Access and Supabase remain independent gates.

Using a Supabase identity that is not the configured Access identity, confirm public `/login` does not grant entry to `/app`.

Expected: the user is denied by Access on the `/app` return. This is intentional; do not widen the Access policy.

- [ ] **Step 5: Prove production posture denial**

From a device that fails the serial posture rule, request `https://dtx.hapadona.com/app`.

Expected: denied before DTXWeb loads.

---

### Task 4: Verify Production Desktop Login, APIs, And Final Acceptance

**Files:**

- Reference: `packages/dtx-desktop/src/renderer/src/services/authService.ts`
- Reference: `packages/dtx-web/src/routes/(login)/login/+page.svelte`
- Reference: `packages/dtx-web/src/routes/(login)/login/+page.server.ts`
- Reference: `packages/dtx-web/src/routes/auth/callback/+server.ts`
- Reference: `packages/dtx-web/src/routes/(app)/app/+page.svelte`
- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No source files modified.

**Interfaces:**

- Consumes: verified pre-production and production Access applications.
- Produces: final acceptance evidence for the desktop `/login -> /app -> callback` handoff and API exclusion.

- [ ] **Step 1: Verify the bundled production desktop login flow**

On the trusted operator device with the bundled desktop app:

1. Start desktop login.
2. Confirm the browser opens the public production `/login?redirect=desktop&desktop_callback=...` flow without an Access challenge on `/login`.
3. Complete password login.
4. Confirm the browser return to `/app?redirect=desktop...` passes Access.
5. Confirm the generated magic link reaches `dtx://auth-callback` and the desktop session becomes authenticated.
6. Repeat the flow with Google login.

Expected: both password and Google desktop logins complete through protected `/app` for the trusted operator.

- [ ] **Step 2: Verify the Tauri-development loopback handoff when available**

With a `tauri dev` instance running on its configured loopback callback port:

1. Start desktop login from that development instance.
2. Keep the login and callback flow in the same browser tab.
3. Complete password login and confirm `/app?redirect=desktop...` passes Access.
4. Confirm the magic link returns to `http://127.0.0.1:<configured-port>/auth-callback`.
5. Repeat with Google login if practical in the development environment.

Expected: the loopback callback succeeds, proving the `/login` `sessionStorage` callback handoff survived the Access-gated return to `/app`.

If this fails while bundled `dtx://` succeeds, disable the production Access application and investigate the handoff separately. Do not add an Access bypass in this slice.

- [ ] **Step 3: Re-run both API exclusion assertions**

```bash
assert_no_access_redirect https://api.dtx.hapadona.com/
assert_no_access_redirect https://api.pre-prod.dtx.hapadona.com/
```

Expected: both commands exit `0`. The APIs may return their own redirect/error/status; they must not redirect into Cloudflare Access.

- [ ] **Step 4: Re-run the production boundary spot check**

```bash
assert_access_redirect https://dtx.hapadona.com/app
assert_no_access_redirect https://dtx.hapadona.com/tool/dtx-to-midi
assert_no_access_redirect https://dtx.hapadona.com/game
assert_no_access_redirect https://dtx.hapadona.com/login
```

Expected: all commands exit `0`.

- [ ] **Step 5: Record final operator verification**

In the implementation notes/PR checklist, record only non-sensitive outcomes:

```text
Pre-prod hostname-wide Access: PASS
Pre-prod password + Google auth: PASS
Prod /app + /app/* Access: PASS
Prod public route matrix: PASS
Prod bundled desktop login: PASS
Prod tauri-dev loopback login: PASS or NOT RUN (environment unavailable)
Prod + pre-prod API exclusion: PASS
Untrusted-device posture denial: PASS
```

Do not paste cookies, JWTs, operator email addresses, device serial numbers, or screenshots containing those values.

- [ ] **Step 6: Stop if any required acceptance check is red**

Required checks are all lines above except the Tauri-development loopback line when no development instance is available. A required failure means disable the affected Access application and investigate separately; do not broaden routes or policies in this slice to force a green result.
