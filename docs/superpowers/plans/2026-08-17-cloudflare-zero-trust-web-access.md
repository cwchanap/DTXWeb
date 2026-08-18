# Cloudflare Zero Trust Web Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect production DTXWeb `/app` routes and the entire pre-production web hostname with Cloudflare Zero Trust Access while leaving public production routes and both API hostnames outside Access.

**Architecture:** Configure two manually managed Cloudflare Access self-hosted public-hostname applications. Production is path-scoped to the exact `/app` parent and `/app/*` descendants; pre-production is hostname-wide. Both reuse the Perseus-style operator identity plus trusted-device serial-number posture requirement, while existing Supabase authentication stays unchanged behind the Access gate.

**Tech Stack:** Cloudflare Zero Trust Access dashboard, Cloudflare One Client/WARP device posture, SvelteKit/Supabase existing authentication, Markdown operator documentation, curl/browser verification.

**Spec:** `docs/superpowers/specs/2026-08-17-cloudflare-zero-trust-web-access-design.md`

## Global Constraints

- Do not add Pulumi, Terraform, or another infrastructure-as-code system.
- Do not modify `packages/dtx-web`, `packages/dtx-api`, or `packages/dtx-desktop` for this slice.
- Production Access destinations must be exactly `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`.
- Production `/`, `/blog`, `/preview`, `/editor`, `/login`, `/auth/*`, and every route outside `/app` remain outside Cloudflare Access.
- Pre-production Access covers the entire `pre-prod.dtx.hapadona.com` hostname with no path bypass.
- `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` remain outside Cloudflare Access.
- Use an `Allow` policy that includes the intended operator identity/email and requires the trusted-device serial-number posture check used for Perseus.
- Use a `12h` Access session duration to match the existing Perseus configuration.
- Prefer reusing the existing account-level Perseus serial-number list/posture rule when it is available in the same Cloudflare Zero Trust account. If the DTXWeb zone is in a different Zero Trust account, create an equivalent serial-number list/posture rule there; do not weaken the posture requirement.
- Do not create Service Auth policies, service tokens, or Cloudflare Access credentials for API, desktop, CLI, or CI traffic.
- Do not commit the allowed email address, device serial numbers, Access cookies, tokens, screenshots containing credentials, or other personal/security identifiers.
- If implementation reveals that application code must change for the approved routing model to work, stop and create a separate follow-up rather than expanding this slice silently.

---

### Task 1: Add The Zero Trust Operator Runbook

**Files:**

- Create: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

**Interfaces:**

- Consumes: the approved protection matrix from the design spec.
- Produces: the durable repository source of truth for manual Cloudflare dashboard configuration, verification, and rollback.

- [ ] **Step 1: Create the runbook with the exact intended configuration**

Create `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md` with:

```markdown
# Cloudflare Zero Trust Web Access Runbook

## Scope

DTXWeb uses manually managed Cloudflare Zero Trust Access for two browser-facing web surfaces:

| Application | Protected destination |
| --- | --- |
| `DTXWeb Production App` | `dtx.hapadona.com/app` |
| `DTXWeb Production App` | `dtx.hapadona.com/app/*` |
| `DTXWeb Pre-prod` | entire `pre-prod.dtx.hapadona.com` hostname |

The production landing page and public tools/content remain outside Access. Both GraphQL API hostnames remain outside Access.

## Required Policy

Both Access applications use the same policy semantics:

- Action: `Allow`
- Include: the intended operator identity/email used for the existing Perseus Zero Trust access
- Require: the trusted-device serial-number posture check used for Perseus
- Session duration: `12h`

Reuse the existing account-level Perseus serial-number list/posture rule when it is available in the same Cloudflare Zero Trust account. If DTXWeb is in a different Zero Trust account, create an equivalent serial-number list and posture rule there using the same intended trusted devices.

Never commit the email address, device serial numbers, Access cookies, tokens, or other security identifiers to this repository.

## Production Configuration

In Cloudflare Dashboard:

1. Go to **Zero Trust > Access controls > Applications**.
2. Create a new **Self-hosted and private** application.
3. Name it `DTXWeb Production App`.
4. Add public-hostname destinations whose resulting URIs are exactly:
   - `dtx.hapadona.com/app`
   - `dtx.hapadona.com/app/*`
5. Set the Access session duration to `12h`.
6. Attach an `Allow` policy that includes the intended operator identity/email and requires the trusted-device serial-number posture check.
7. Do not add a Service Auth policy or service token.
8. Save the application.

Do not add a hostname-wide `dtx.hapadona.com` destination. Do not add `/login`, `/auth/*`, `/blog`, `/preview`, `/editor`, or other public paths.

Cloudflare path wildcards do not cover their parent path, which is why both `/app` and `/app/*` are recorded explicitly.

## Pre-production Configuration

In Cloudflare Dashboard:

1. Go to **Zero Trust > Access controls > Applications**.
2. Create a new **Self-hosted and private** application.
3. Name it `DTXWeb Pre-prod`.
4. Add one public-hostname destination for the entire `pre-prod.dtx.hapadona.com` hostname with no path restriction.
5. Set the Access session duration to `12h`.
6. Attach an `Allow` policy that includes the intended operator identity/email and requires the trusted-device serial-number posture check.
7. Do not add a Service Auth policy or service token.
8. Save the application.

Do not add `api.pre-prod.dtx.hapadona.com` to this application.

## Protection Matrix

| URL family | Expected Access behavior |
| --- | --- |
| `https://dtx.hapadona.com/app` | Access required |
| `https://dtx.hapadona.com/app/*` | Access required |
| `https://dtx.hapadona.com/` | No Access challenge |
| `https://dtx.hapadona.com/blog/*` | No Access challenge |
| `https://dtx.hapadona.com/preview/*` | No Access challenge |
| `https://dtx.hapadona.com/editor/*` | No Access challenge |
| `https://dtx.hapadona.com/login` | No Access challenge |
| `https://dtx.hapadona.com/auth/*` | No Access challenge |
| `https://pre-prod.dtx.hapadona.com/*` | Access required |
| `https://api.dtx.hapadona.com/*` | No Access challenge |
| `https://api.pre-prod.dtx.hapadona.com/*` | No Access challenge |

## Verification

### Logged-out browser

Use a private/incognito browser with no current Cloudflare Access session.

Production:

- Open `/app` and one descendant such as `/app/score`; both must enter Cloudflare Access before DTXWeb loads.
- Open `/`, `/blog`, `/preview`, `/editor`, and `/login`; none may enter Cloudflare Access.

Pre-production:

- Open `/`, `/login`, `/blog`, `/preview`, `/editor`, and `/app`; every route must enter Cloudflare Access before DTXWeb loads.

APIs:

- Open or request both API hostnames and confirm neither is intercepted by Cloudflare Access. Their application/API-specific response status is not important for this check.

### Allowed identity on trusted device

Production:

- Pass Access and open `/app`.
- With no Supabase session, confirm SvelteKit redirects to public `/login`.
- Complete the existing login flow and confirm the browser returns successfully to `/app` through the still-valid Access session.
- Start the desktop browser-login flow and confirm public `/login` can return through protected `/app?redirect=desktop...` to the desktop callback.

Pre-production:

- Pass the hostname-wide Access gate.
- Complete the normal pre-production login/OAuth flow and confirm callbacks on the same hostname work under the existing Access session.

### Untrusted device

From a device that does not satisfy the serial-number posture rule, confirm production `/app` and the pre-production hostname are denied before DTXWeb loads.

## Rollback

Production rollback:

- Disable or delete `DTXWeb Production App` if `/app` must be restored immediately.
- If public production routes are accidentally challenged, remove any broad destination and restore the application to only `dtx.hapadona.com/app` and `dtx.hapadona.com/app/*`.

Pre-production rollback:

- Disable or delete `DTXWeb Pre-prod` to restore the pre-production hostname.

If either API hostname receives an Access challenge, remove that hostname from the relevant Access application. Do not introduce service tokens as an emergency workaround.

No Worker rollback or code deployment is required for these Access-only changes.

## References

- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
```

- [ ] **Step 2: Format-check the runbook**

Run:

```bash
bunx prettier --check docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
```

Expected: exits `0` with the runbook formatted correctly.

If it reports formatting differences, run:

```bash
bunx prettier --write docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
bunx prettier --check docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
```

Expected: the second command exits `0`.

- [ ] **Step 3: Confirm the documentation does not contain secret values**

Run:

```bash
git diff -- docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
```

Expected: the document contains only application names, hostnames, route paths, policy semantics, and operator instructions. It must not contain an actual personal email address, device serial number, token, cookie, or credential.

- [ ] **Step 4: Commit the runbook**

```bash
git add docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
git commit -m "docs: add Zero Trust web access runbook"
```

---

### Task 2: Configure Production `/app` Access

**Files:**

- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No source files modified.

**Interfaces:**

- Consumes: the existing Cloudflare zone for `dtx.hapadona.com`, the intended operator identity, and the trusted-device serial-number posture rule.
- Produces: one Cloudflare Access application named `DTXWeb Production App` whose only protected production web destinations are `/app` and `/app/*`.

- [ ] **Step 1: Confirm the existing Perseus posture components are reusable**

In Cloudflare Zero Trust, inspect the device posture rules/lists already used for Perseus.

Expected:

- the intended trusted-device serial-number posture rule is visible in the same Zero Trust account as the DTXWeb zone and can be selected by an Access policy; or
- if the DTXWeb zone is in a different Zero Trust account, create an equivalent serial-number list and serial-number posture rule there before continuing.

Do not copy serial numbers into git, issue comments, PR descriptions, or terminal transcripts committed to the repo.

- [ ] **Step 2: Create the production Access application**

In **Zero Trust > Access controls > Applications**:

1. Select **Create new application**.
2. Select **Self-hosted and private**.
3. Name the application `DTXWeb Production App`.
4. Add public-hostname entries so the resulting protected destinations are exactly:

```text
dtx.hapadona.com/app
dtx.hapadona.com/app/*
```

5. Set session duration to `12h`.
6. Add an `Allow` policy whose Include rule matches the intended operator identity/email and whose Require rule matches the trusted-device serial-number posture check.
7. Do not add a Service Auth policy.
8. Save the application.

Expected: there is no hostname-wide `dtx.hapadona.com` destination and no destination for any route outside `/app`.

- [ ] **Step 3: Verify the unauthenticated production boundary**

From a browser with no Access session, verify:

```text
https://dtx.hapadona.com/app        -> Cloudflare Access required
https://dtx.hapadona.com/app/score  -> Cloudflare Access required
https://dtx.hapadona.com/           -> no Cloudflare Access challenge
https://dtx.hapadona.com/blog       -> no Cloudflare Access challenge
https://dtx.hapadona.com/preview    -> no Cloudflare Access challenge
https://dtx.hapadona.com/editor     -> no Cloudflare Access challenge
https://dtx.hapadona.com/login      -> no Cloudflare Access challenge
```

Also request a representative `/auth/*` URL and confirm any response comes from DTXWeb rather than Cloudflare Access. A DTXWeb `404`, redirect, or application-specific response is acceptable; an Access login/challenge is not.

- [ ] **Step 4: Verify the trusted production browser flow**

Using the allowed identity on the trusted device:

1. Open `https://dtx.hapadona.com/app` and pass Cloudflare Access.
2. If the browser has no Supabase session, confirm DTXWeb redirects to `https://dtx.hapadona.com/login` without another Access challenge.
3. Complete the existing Supabase login.
4. Confirm the browser returns to `/app` and is accepted by the existing Access session.
5. Sign out of Supabase and confirm this does not remove the Cloudflare Access boundary from `/app`.

Expected: Cloudflare Access and Supabase remain two independent gates; public `/login` is not accidentally protected.

- [ ] **Step 5: Verify production posture denial**

From a device that does not satisfy the configured serial-number posture rule, request `https://dtx.hapadona.com/app`.

Expected: Cloudflare denies access before the DTXWeb application loads.

---

### Task 3: Configure Hostname-Wide Pre-production Access

**Files:**

- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No source files modified.

**Interfaces:**

- Consumes: the same intended operator identity and trusted-device posture semantics as production.
- Produces: one Cloudflare Access application named `DTXWeb Pre-prod` protecting the entire `pre-prod.dtx.hapadona.com` web hostname.

- [ ] **Step 1: Create the pre-production Access application**

In **Zero Trust > Access controls > Applications**:

1. Select **Create new application**.
2. Select **Self-hosted and private**.
3. Name the application `DTXWeb Pre-prod`.
4. Add one public hostname for:

```text
pre-prod.dtx.hapadona.com
```

Do not enter a path restriction.

5. Set session duration to `12h`.
6. Add an `Allow` policy whose Include rule matches the intended operator identity/email and whose Require rule matches the trusted-device serial-number posture check.
7. Do not add a Service Auth policy.
8. Save the application.

Expected: the entire pre-production web hostname is protected, including `/`, `/login`, `/auth/*`, `/blog`, `/preview`, `/editor`, `/app`, and future paths.

- [ ] **Step 2: Verify the unauthenticated pre-production boundary**

From a browser with no Access session, request each of:

```text
https://pre-prod.dtx.hapadona.com/
https://pre-prod.dtx.hapadona.com/login
https://pre-prod.dtx.hapadona.com/blog
https://pre-prod.dtx.hapadona.com/preview
https://pre-prod.dtx.hapadona.com/editor
https://pre-prod.dtx.hapadona.com/app
```

Expected: every request is intercepted by Cloudflare Access before DTXWeb loads.

- [ ] **Step 3: Verify the trusted pre-production auth flow**

Using the allowed identity on the trusted device:

1. Enter `https://pre-prod.dtx.hapadona.com/` through Cloudflare Access.
2. Open `/login` under the same Access session.
3. Complete the existing pre-production Supabase login/OAuth flow.
4. Confirm the browser can return through the pre-production `/auth/*` callback and reach `/app` without being trapped in an Access/auth redirect loop.

Expected: the hostname-wide Access session remains valid across the application login/OAuth flow.

- [ ] **Step 4: Verify pre-production posture denial**

From a device that does not satisfy the configured serial-number posture rule, request `https://pre-prod.dtx.hapadona.com/`.

Expected: Cloudflare denies access before DTXWeb loads.

---

### Task 4: Verify API And Desktop Boundaries

**Files:**

- Reference: `packages/dtx-web/wrangler.jsonc`
- Reference: `packages/dtx-desktop/src/renderer/src/services/authService.ts`
- Reference: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- No source files modified.

**Interfaces:**

- Consumes: the two configured Access applications from Tasks 2 and 3.
- Produces: evidence that browser-route protection did not introduce an Access dependency for GraphQL API clients or break the production desktop login entry flow.

- [ ] **Step 1: Confirm both API hostnames remain outside Access**

Run from a shell without Cloudflare Access credentials:

```bash
for url in \
  https://api.dtx.hapadona.com \
  https://api.pre-prod.dtx.hapadona.com; do
  echo "=== $url ==="
  curl -sS -o /dev/null -D - "$url" | sed -n '1,12p'
done
```

Expected: neither response redirects to a `cloudflareaccess.com` Access login URL. A GraphQL/API-specific `200`, `4xx`, or redirect is acceptable; the purpose is only to confirm that Cloudflare Access is not intercepting the API hostname.

If either API hostname is challenged by Access, stop and remove it from the Access application before proceeding. Do not add service tokens.

- [ ] **Step 2: Verify the production desktop login browser boundary**

Use the production desktop application and start its existing login flow.

Expected sequence:

```text
desktop app
  -> https://dtx.hapadona.com/login?redirect=desktop&desktop_callback=...
     (public; no Access challenge)
  -> existing Supabase login
  -> https://dtx.hapadona.com/app?redirect=desktop&desktop_callback=...
     (Cloudflare Access required if no valid Access session)
  -> existing DTXWeb magic-link/deep-link callback
  -> desktop app
```

Using the allowed identity on the trusted device, complete the flow and confirm the desktop receives its normal authenticated session.

Expected: no API service token or desktop code change is required.

- [ ] **Step 3: Re-run the complete route matrix from the runbook**

Check every row in the runbook's Protection Matrix.

Expected:

- production `/app` only: protected;
- production public routes: not protected;
- pre-production web hostname: protected everywhere;
- both APIs: not protected.

Do not consider the implementation complete if any route falls into the wrong category.

---

### Task 5: Final Repository And Rollback Check

**Files:**

- Verify: `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`
- Verify: repository working tree

**Interfaces:**

- Consumes: the completed dashboard configuration and verification results.
- Produces: a clean implementation branch containing documentation only, with the external Cloudflare configuration matching that documentation.

- [ ] **Step 1: Confirm no application or deployment code changed**

Run:

```bash
git status --short
git diff --stat HEAD~1..HEAD
```

Expected: the implementation commit contains only the Zero Trust runbook. There must be no changes under `packages/dtx-web`, `packages/dtx-api`, `packages/dtx-desktop`, `.github/workflows`, or a new infrastructure package.

- [ ] **Step 2: Run repository diff checks**

Run:

```bash
git diff --check HEAD~1..HEAD
bunx prettier --check docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md
```

Expected: both commands exit `0`.

- [ ] **Step 3: Confirm rollback instructions match the live configuration**

Read the runbook rollback section and verify the named Access applications are exactly:

```text
DTXWeb Production App
DTXWeb Pre-prod
```

Expected: disabling/deleting those two applications is sufficient to remove the Access gates; no Worker or API deploy is required.

- [ ] **Step 4: Final scope check**

Confirm all of the following are true before marking the work complete:

```text
[production] dtx.hapadona.com/app      protected
[production] dtx.hapadona.com/app/*    protected
[production] other web routes          public to Access
[pre-prod]   pre-prod.dtx.hapadona.com protected hostname-wide
[API]        production API             public to Access
[API]        pre-production API         public to Access
[IaC]        none added
[app code]   none changed
[secrets]    none committed
```

Expected: every line matches the live Cloudflare configuration and repository diff.
