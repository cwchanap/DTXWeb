# Cloudflare Zero Trust Web Access Design

## Summary

DTXWeb will use Cloudflare Zero Trust Access as an outer gate for private web surfaces while keeping the public production site and both GraphQL API hostnames outside Access.

Production protects only `/app` and its descendants. This is intentionally an operator-only surface: the Perseus-style Access policy allows the configured operator identity on a trusted device, so other Supabase users can still reach public `/login` but cannot enter production `/app` or complete desktop login against production.

Pre-production protects the entire `pre-prod.dtx.hapadona.com` web hostname. It is configured and verified first so identity, device posture, Supabase login/OAuth, and rollback are proven before the production path-scoped application is created.

The Zero Trust configuration is managed manually in the Cloudflare dashboard. This slice does not introduce Pulumi, Terraform, CI deployment, Worker-side Access JWT validation, service tokens, or application-code changes.

## Goals

- Make production `/app` and production desktop login intentionally operator-only behind Cloudflare Access.
- Keep the production public site outside Access, including `/`, `/blog`, `/preview`, `/editor`, `/tool/*`, `/game`, `/login`, and `/auth/*`.
- Require Cloudflare Access for every route served by `pre-prod.dtx.hapadona.com`.
- Reuse the same configured operator identity and trusted-device serial-number posture model used for Perseus.
- Preserve Supabase authentication as an independent inner gate after Access allows a request.
- Keep `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` outside Access.
- Roll out pre-production first, then production only after the pre-production gate and auth round-trip are verified.
- Verify route boundaries from HTTP response headers in addition to browser smoke tests.
- Document the dashboard configuration, verification matrix, and rollback procedure in a dedicated operator runbook.

## Non-Goals

- Add Pulumi, Terraform, or another infrastructure-as-code system.
- Protect the entire production `dtx.hapadona.com` hostname.
- Protect either API hostname.
- Make production `/app` available to every Supabase user.
- Replace Supabase authentication.
- Add Worker-side validation of `CF_Authorization` or Access JWTs.
- Add Cloudflare Access service tokens for desktop, API, CLI, or CI traffic.
- Protect preview/development Worker URLs outside the named custom hostnames.
- Change SvelteKit, GraphQL API, or desktop application code in this slice.

## Existing Context

`packages/dtx-web/wrangler.jsonc` deploys the production web Worker to `dtx.hapadona.com` and pre-production to `pre-prod.dtx.hapadona.com`. The web application uses separate API hostnames: `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com`.

`packages/dtx-web/src/hooks.server.ts` treats paths beginning with `/app` as the Supabase-authenticated application family. An unauthenticated request to `/app` is redirected to public `/login`, and successful web login returns to `/app` or another validated `/app/*` destination.

The desktop flow also starts at public `/login` and finishes through `/app?redirect=desktop...`. Password login redirects there directly; Google OAuth does the same through the auth callback. The login page preserves the desktop callback in `sessionStorage` so the `/app` page can hand the magic link back to either the bundled `dtx://` callback or the Tauri-development loopback callback.

Because production `/app` sits behind a single-operator Access policy, that desktop handoff is also operator-only. Public `/login` is an entry form, not a bypass around Access. A non-operator Supabase user may authenticate successfully and then be denied when the browser returns to `/app`; that is the intended product behavior for this slice.

The repository already uses human-executed Cloudflare runbooks, for example `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`. That file is a historical API-migration cutover checklist, so Zero Trust gets its own durable runbook rather than mixing permanent security operations into the completed Phase 4 migration document.

## Protection Matrix

| Surface | Cloudflare Access | Notes |
| --- | --- | --- |
| `dtx.hapadona.com/app` | Protected | Operator-only; exact parent must be covered. |
| `dtx.hapadona.com/app/*` | Protected | Operator-only descendants. |
| `dtx.hapadona.com/` | Public | Landing page. |
| `dtx.hapadona.com/blog/*` | Public | Public content. |
| `dtx.hapadona.com/preview/*` | Public | Public preview surface. |
| `dtx.hapadona.com/editor/*` | Public | Public editor surface. |
| `dtx.hapadona.com/tool/*` | Public | Public tools, including `/tool/dtx-to-midi`. |
| `dtx.hapadona.com/game` | Public | Public game entry. |
| `dtx.hapadona.com/login` | Public | Web and desktop login entry. |
| `dtx.hapadona.com/auth/*` | Public | Supabase/OAuth callbacks. |
| Other production web paths outside `/app` | Public | Do not broaden production Access. |
| `pre-prod.dtx.hapadona.com/*` | Protected | Entire pre-production web hostname. |
| `api.dtx.hapadona.com/*` | Outside Access | Existing API auth remains authoritative. |
| `api.pre-prod.dtx.hapadona.com/*` | Outside Access | Existing API auth remains authoritative. |

Cloudflare Access application paths can protect either an entire hostname or selected paths. Production records both `/app` and `/app/*` explicitly so the parent and descendants are both protected.

## Access Applications

### Pre-production

Create `DTXWeb Pre-prod` first as a self-hosted public-hostname application for:

- `pre-prod.dtx.hapadona.com`

There is no path bypass. `/`, `/login`, `/auth/*`, `/blog`, `/preview`, `/editor`, `/tool/*`, `/game`, `/app`, and future routes on that web hostname all pass through Access.

Do not include `api.pre-prod.dtx.hapadona.com`.

### Production

Only after the pre-production checks pass, create `DTXWeb Production App` with exactly:

- `dtx.hapadona.com/app`
- `dtx.hapadona.com/app/*`

Do not add a hostname-wide production destination or any public path.

## Access Policy

Both applications use the same policy semantics:

- Action: `Allow`.
- Include: the intended operator identity/email used for Perseus access.
- Require: the trusted-device serial-number posture check used for Perseus.
- Session duration: `12h`.

Prefer the existing account-level serial-number list/posture rule when DTXWeb is in the same Zero Trust account. If it is not reusable because the zone is under a different Zero Trust account, create an equivalent list/posture rule there using the same intended trusted devices. Do not weaken the posture requirement.

Do not add a Service Auth policy or service token. API and other non-browser traffic stay outside these Access applications.

## Rollout Order

1. Add the dedicated DTXWeb Zero Trust operator runbook.
2. Confirm the intended operator identity and serial-number posture rule are available without copying personal identifiers into git.
3. Create the hostname-wide pre-production Access application.
4. Verify pre-production interception, trusted-device admission, posture denial, Supabase password login, Google OAuth callback behavior, and API non-interception.
5. If any pre-production check fails, disable/remove the pre-production Access app and stop. Do not touch production.
6. Create the production application with only `/app` and `/app/*`.
7. Run the complete production header matrix, including `/tool/*` and `/game`, before considering the rollout accepted.
8. Run the trusted-device production browser and desktop-login checks, including the Tauri-development loopback callback path.
9. Re-run API non-interception checks and record the final state in the operator runbook/checklist.

## Request Flows

### Production browser

1. Browser requests `/app` or `/app/*`.
2. Cloudflare Access evaluates the operator identity and device posture.
3. A denied request never reaches DTXWeb.
4. An allowed request reaches SvelteKit and the existing Supabase guard.
5. Without a Supabase session, SvelteKit redirects to public `/login`.
6. After Supabase login, the browser returns to protected `/app` and must still satisfy the Access gate.

A normal Supabase user who does not match the Access policy is intentionally denied at step 2 or when returning to `/app` after public login.

### Production desktop login

1. Desktop opens public `/login?redirect=desktop&desktop_callback=...`.
2. `/login` preserves the callback for the post-login handoff.
3. Password or Google login returns the browser to `/app?redirect=desktop...`.
4. Cloudflare Access gates that `/app` return.
5. Only the configured operator on a trusted device can reach the `/app` handoff that generates and forwards the desktop magic link.

Verification must cover both a bundled `dtx://auth-callback` flow and, when available, a `tauri dev` loopback callback in the same browser tab because the loopback path depends on the preserved callback state.

### Pre-production

Any request to `pre-prod.dtx.hapadona.com` reaches Access first. Once the browser has a valid Access session, the existing Supabase login and callback routes on that same hostname run normally behind the gate.

### API traffic

Requests to the two GraphQL API hostnames do not pass through these Access applications. Existing Supabase/API authorization stays unchanged and API/desktop callers require no Cloudflare Access credential.

## Repository Changes

Implementation creates one focused runbook:

- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

The runbook records the two applications, operator-only product intent, pre-production-first rollout, exact production destinations, policy semantics, header-based verification matrix, trusted-device browser/desktop checks, API exclusions, and rollback.

Do not edit the historical Phase 4 API migration runbook except for a future independent documentation cleanup; it is useful precedent for human-executed Cloudflare operations but not the ownership location for this permanent Access configuration.

No source or deployment code changes are planned. If verification shows that SvelteKit, desktop, API, or routing code must change for this approved model to work, stop this slice and create a separate follow-up rather than widening scope.

## Verification

### Header-based boundary checks

For unauthenticated requests, inspect response headers rather than relying only on what a browser appears to show. Cloudflare's normal Access login flow returns an interception redirect; the durable failure signal for routes that must remain public is a `Location` pointing to the account's `cloudflareaccess.com/cdn-cgi/access/` flow.

Run the matrix with `curl -sS -o /dev/null -D - <url>` and inspect the status plus `Location` header.

Pre-production must show Access interception for representative routes across the hostname, including `/`, `/login`, `/auth/callback`, `/blog`, `/preview`, `/editor`, `/tool/dtx-to-midi`, `/game`, `/app`, and `/app/score`.

Production must show Access interception for `/app` and `/app/score`, while these must not return a Cloudflare Access `Location`:

- `/`
- `/blog`
- `/preview`
- `/editor`
- `/tool/dtx-to-midi`
- `/game`
- `/login`
- `/auth/callback`

Both API hostnames must also avoid a Cloudflare Access `Location`; their application-specific HTTP status is otherwise irrelevant to this boundary check.

If the Zero Trust account uses instant authentication and therefore redirects directly to the identity provider instead of the Cloudflare Access login page, use the equivalent known Access redirect behavior for that tenant plus the browser checks below; do not mistake an application redirect for Access interception.

### Trusted browser and desktop checks

On the WARP/Cloudflare One-enrolled trusted device with the configured operator identity:

- prove pre-production login and callback flows before production configuration;
- prove production `/app -> /login -> /app` still works as two independent gates;
- prove production desktop login returns through protected `/app` and reaches the desktop callback;
- specifically exercise the Tauri-development loopback callback when available so the `sessionStorage` handoff is tested, not just the bundled `dtx://` path.

### Denial check

From a device that fails the serial-number posture rule, protected pre-production and production surfaces must be denied before DTXWeb loads.

## Failure Handling And Rollback

If pre-production identity, posture, login, callback, or route-boundary checks fail, disable/delete `DTXWeb Pre-prod` and stop before production.

If any production public route is intercepted, disable `DTXWeb Production App` immediately and correct its destinations before re-enabling it. The accepted production destination set is only `/app` and `/app/*`.

If either API hostname is intercepted, remove the API hostname from Access. Do not add service tokens as a workaround in this slice.

If the trusted production desktop flow cannot complete the `/login -> /app -> desktop` handoff, disable the production Access application and investigate separately. Do not widen the Access policy or add a bypass to make the test pass.

Rollback is dashboard-only: disable or delete the relevant Access application. No Worker rollback or code deployment is required.

## References

- Cloudflare Access application paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Cloudflare self-hosted public applications: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- Cloudflare Access policies: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
- Cloudflare Access authorization cookie: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/
