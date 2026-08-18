# Cloudflare Zero Trust Web Access Design

## Summary

DTXWeb will use Cloudflare Zero Trust Access as an outer gate for private web surfaces while keeping the public production site and both GraphQL API hostnames outside Access.

Production protects only `/app` and its descendants. This is intentionally an operator-only surface: the Perseus-style Access policy allows the configured operator identity on a trusted device, so other Supabase users can still reach public `/login` but cannot enter production `/app` or complete desktop login against production.

Pre-production protects the entire `pre-prod.dtx.hapadona.com` web hostname. It is configured and verified first so identity, device posture, Supabase login/OAuth, and rollback are proven before the production path-scoped application is created.

The Zero Trust configuration is managed manually in the Cloudflare dashboard. This slice does not introduce Pulumi, Terraform, CI deployment, Worker-side Access JWT validation, service tokens, or application-code changes.

## Goals

- Make production `/app` and production desktop login intentionally operator-only behind Cloudflare Access.
- Keep the production public site outside Access, including `/`, `/blog`, `/preview/*`, `/editor`, `/tool/*`, `/game`, `/login`, and `/auth/*`.
- Require Cloudflare Access for every route served by `pre-prod.dtx.hapadona.com`.
- Reuse the same configured operator identity and trusted-device serial-number posture model used for Perseus.
- Preserve Supabase authentication as an independent inner gate after Access allows a request.
- Keep `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com` outside Access.
- Roll out pre-production first, then production only after the pre-production gate and auth round-trip are verified.
- Verify both policy clauses independently: the configured Access identity and the trusted-device posture requirement.
- Make route-boundary checks fail loudly when the request itself fails.
- Characterize Access-session expiry during SvelteKit client-side navigation instead of discovering that behavior after rollout.
- Document desktop-development, non-operator lockout, E2E, and private-route invariants in a dedicated operator runbook.

## Non-Goals

- Add Pulumi, Terraform, or another infrastructure-as-code system.
- Protect the entire production `dtx.hapadona.com` hostname.
- Protect either API hostname.
- Make production `/app` available to every Supabase user.
- Add a public logout route or otherwise change the current non-operator recovery behavior in this slice.
- Replace Supabase authentication.
- Add Worker-side validation of `CF_Authorization` or Access JWTs.
- Add Cloudflare Access service tokens for desktop, API, CLI, E2E, or CI traffic.
- Make pre-production an unattended E2E target in this slice.
- Protect preview/development Worker URLs outside the named custom hostnames.
- Change SvelteKit, GraphQL API, or desktop application code in this slice.

## Existing Context

`packages/dtx-web/wrangler.jsonc` deploys the production web Worker to `dtx.hapadona.com` and pre-production to `pre-prod.dtx.hapadona.com`. The web application uses separate API hostnames: `api.dtx.hapadona.com` and `api.pre-prod.dtx.hapadona.com`.

`packages/dtx-web/src/hooks.server.ts` currently treats any pathname beginning with `/app` as Supabase-authenticated. The intended private route family for this design is narrower and matches the existing redirect validator: exact `/app` or descendants under `/app/`. Production Access therefore protects `/app` and `/app/*`. No current route relies on the broader `/app...` string-prefix behavior.

This dependency is an operating invariant: any new private production page must live at `/app` or below `/app/`, or the Access design must be revisited before shipping it. A new private sibling such as `/studio` or `/admin` would otherwise be public at the edge. A future `/appstore`-style route would also expose the current mismatch between `startsWith('/app')` and the Access destination family and should be handled as a separate routing cleanup rather than silently treated as protected.

The desktop flow starts at web `/login` and finishes through `/app?redirect=desktop...`. Password login redirects there directly; Google OAuth does the same through the auth callback. The login page preserves the desktop callback in `sessionStorage` so the `/app` page can hand the magic link back to either the bundled `dtx://` callback or the Tauri-development loopback callback.

Standalone desktop development (`bun run dev:desktop`, which runs the desktop package `dev` script) loads `VITE_DTX_SERVER_URL` from the ignored root `.env`. In the current operator setup that value points at production, so ordinary standalone `tauri dev` authentication traverses production `/login` and production `/app`. The full local-stack command (`bun run dev`) is different: it uses `dtx-desktop#dev:local-web`, which overrides the web and API URLs to localhost. After this Access change, authentication against either deployed web environment is operator-only; non-operator contributors must use the full local stack or another separately designed ungated development environment.

Because production `/app` sits behind a single-operator Access policy, public `/login` is an entry form, not an Access bypass. A non-operator Supabase user may authenticate successfully and then be denied when the browser returns to `/app`.

That state currently has no UI recovery path. `hooks.server.ts` redirects an already-authenticated visitor from `/login` to `/app`, while the only current sign-out control lives inside the Access-protected `(app)` layout. A signed-in non-operator therefore cannot use the production UI to return to `/login` or sign out; they must clear the Drumery/Supabase cookies for the production web origin. A public logout route or a change to the authenticated `/login` redirect is an explicit deferred product decision, not part of this dashboard-only slice.

The repository already uses human-executed Cloudflare runbooks, for example `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md`. That file is a historical API-migration cutover checklist, so Zero Trust gets its own durable runbook rather than mixing permanent security operations into the completed Phase 4 migration document.

The web E2E harness supports overriding `PLAYWRIGHT_BASE_URL`, but current CI runs against Playwright-managed localhost servers. Hostname-wide pre-production Access means this slice does not support unattended E2E against `pre-prod.dtx.hapadona.com`; doing so later requires a separate Access-authentication strategy and is intentionally deferred.

## Protection Matrix

| Surface | Cloudflare Access | Notes |
| --- | --- | --- |
| `dtx.hapadona.com/app` | Protected | Operator-only exact parent. |
| `dtx.hapadona.com/app/` | Protected | Explicitly verify path semantics during rollout. |
| `dtx.hapadona.com/app/*` | Protected | Operator-only descendants, including SvelteKit data requests. |
| `dtx.hapadona.com/` | Public | Landing page. |
| `dtx.hapadona.com/blog/*` | Public | Public content. |
| `dtx.hapadona.com/preview/*` | Public | Verify with a real route such as `/preview/1`. |
| `dtx.hapadona.com/editor` | Public | Public editor surface. |
| `dtx.hapadona.com/tool/*` | Public | Public tools, including `/tool/dtx-to-midi`. |
| `dtx.hapadona.com/game` | Public | Public game entry. |
| `dtx.hapadona.com/login` | Public | Web and desktop login entry. |
| `dtx.hapadona.com/auth/*` | Public | Supabase/OAuth callbacks. |
| Other production web paths outside `/app` | Public | Do not broaden production Access. |
| `pre-prod.dtx.hapadona.com/*` | Protected | Entire pre-production web hostname. |
| `api.dtx.hapadona.com/*` | Outside Access | Existing API auth remains authoritative. |
| `api.pre-prod.dtx.hapadona.com/*` | Outside Access | Existing API auth remains authoritative. |

Cloudflare Access application paths can protect either an entire hostname or selected paths. Production records both `/app` and `/app/*` explicitly because Cloudflare documents that a wildcard sub-path does not replace the exact parent rule. The rollout also probes `/app/` directly instead of assuming how the trailing-slash request is normalized or matched.

## Access Applications

### Pre-production

Create `DTXWeb Pre-prod` first as a self-hosted public-hostname application for:

- `pre-prod.dtx.hapadona.com`

There is no path bypass. `/`, `/login`, `/auth/*`, `/blog`, `/preview/*`, `/editor`, `/tool/*`, `/game`, `/app`, SvelteKit data requests, and future routes on that web hostname all pass through Access.

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

Verify the two policy clauses separately. A failed-posture device proves only the `Require` rule. The production rollout must also use the trusted device with a second IdP identity that is not in the `Include` list and confirm Access denies it.

Do not change the account's instant-authentication setting merely to make `curl` output easier to recognize. During setup, record whether the reused Perseus login method uses the Cloudflare Access login page or instant authentication, then use the same mode for both DTXWeb applications and configure the verification helper to recognize that tenant's actual Access interception signal: a redirect when present, or HTTP `403` with both `cf-access-aud` and `cf-access-domain` headers.

Do not add Service Auth, Managed OAuth, or service tokens. API and other non-browser traffic stay outside these Access applications.

## Rollout Order

1. Add the dedicated DTXWeb Zero Trust operator runbook.
2. Record the current Perseus identity provider, instant-authentication mode, intended operator identity, and serial-number posture rule without copying personal identifiers into git.
3. Harden and dry-run the runbook's HTTP verification helpers against both a reachable URL and an intentionally invalid hostname; the invalid hostname must fail.
4. Create the hostname-wide pre-production Access application.
5. Run the runbook's complete pre-production verification section, including password login, Google OAuth, posture denial, and API non-interception.
6. If any pre-production check fails, disable/remove the pre-production Access app and stop. Do not touch production.
7. Create the production application with only `/app` and `/app/*`.
8. Run the runbook's complete production header matrix, including `/app/`, `/app/__data.json`, the real `/preview/1` route, `/tool/*`, `/game`, and both API exclusions.
9. Verify the Access `Include` identity rule independently on the trusted device with a non-allowed IdP identity.
10. Run the trusted-device production browser and desktop-login checks, including standalone `tauri dev` against production.
11. Characterize an expired Access session during a SvelteKit client-side navigation to `/app` and record the observed recovery behavior.
12. Record final non-sensitive outcomes and deferred limitations.

## Request Flows And Consequences

### Production browser

1. Browser requests `/app` or a descendant.
2. Cloudflare Access evaluates the operator identity and device posture.
3. A denied request never reaches DTXWeb.
4. An allowed request reaches SvelteKit and the existing Supabase guard.
5. Without a Supabase session, SvelteKit redirects to public `/login`.
6. After Supabase login, the browser returns to protected `/app` and must still satisfy the Access gate.

A normal Supabase user who does not match the Access policy is intentionally denied when returning to `/app`. If they now hold a Supabase session, `/login` will redirect them back into the denied `/app` surface and the current UI offers no public logout. Clearing the production Supabase cookies is the documented recovery until a separate logout UX decision is implemented.

### Production desktop login

1. Desktop opens public `/login?redirect=desktop&desktop_callback=...`.
2. `/login` preserves the callback for the post-login handoff.
3. Password or Google login returns the browser to `/app?redirect=desktop...`.
4. Cloudflare Access gates that `/app` return.
5. Only the configured operator on a trusted device can reach the `/app` handoff that generates and forwards the desktop magic link.

Standalone `tauri dev` using a deployed `VITE_DTX_SERVER_URL` is therefore operator-only. In the current operator setup it targets production and is a required production acceptance check. The full local-stack `dev:local-web` path remains available without Cloudflare Access because it explicitly uses localhost.

### SvelteKit client-side navigation

The root server layout has a server `load`, so SvelteKit client-side navigation uses framework data requests such as `/app/__data.json`. Those requests are within `/app/*` and must be Access-protected too.

Cloudflare checks every request for a valid application token. When a long-lived tab loses its Access session, a client-side data request may encounter the Access reauthentication redirect instead of normal SvelteKit data. The rollout must deliberately expire/logout the Access session and navigate client-side from a public production page into `/app`, record what the user sees, and confirm a direct reload of `/app` provides a usable reauthentication path. Any opaque fetch-error UX is a documented limitation/follow-up, not a reason to widen the Access destinations.

### Pre-production

Any request to `pre-prod.dtx.hapadona.com` reaches Access first. Once the browser has a valid Access session, the existing Supabase login and callback routes on that same hostname run normally behind the gate.

Because no non-interactive Access credential is introduced, unattended Playwright/CI use of the pre-production hostname is unsupported by this slice even though the harness can point `PLAYWRIGHT_BASE_URL` at another host.

### API traffic

Requests to the two GraphQL API hostnames do not pass through these Access applications. Existing Supabase/API authorization stays unchanged and API/desktop callers require no Cloudflare Access credential.

## Repository Changes

Implementation creates one focused runbook:

- `docs/superpowers/runbooks/2026-08-17-cloudflare-zero-trust-web-access.md`

The runbook is the single executable source of truth for dashboard configuration, header helpers, route matrices, browser/desktop checks, known limitations, and rollback. The implementation plan references named runbook sections rather than restating their command blocks.

Do not edit the historical Phase 4 API migration runbook except for a future independent documentation cleanup; it is useful precedent for human-executed Cloudflare operations but not the ownership location for this permanent Access configuration.

No source or deployment code changes are planned. If verification shows that SvelteKit, desktop, API, or routing code must change for this approved model to work, stop this slice and create a separate follow-up rather than widening scope.

## Verification Requirements

The durable runbook must make a missing HTTP response fail loudly. A DNS failure, connection failure, or timeout may not count as a successful `assert_no_access_interception` result.

The runbook owns one pre-production matrix and one production matrix. The implementation plan must invoke those sections rather than duplicate their commands.

The production matrix must include:

- protected: `/app`, `/app/`, `/app/score`, `/app/__data.json`;
- public: `/`, `/blog`, `/preview/1`, `/editor`, `/tool/dtx-to-midi`, `/game`, `/login`, `/auth/callback`;
- outside Access: both API hostnames.

The policy checks must independently prove:

- allowed identity + trusted posture passes;
- trusted device + non-allowed IdP identity is denied;
- allowed identity on a device that fails posture is denied.

The browser checks must cover:

- pre-production password and Google login before production is configured;
- production `/app -> /login -> /app` for the operator;
- bundled desktop login;
- standalone Tauri-development loopback login against production in the current operator setup;
- expired/logged-out Access session during client-side navigation into `/app`;
- non-operator production login dead-end and documented cookie-clearing recovery.

## Failure Handling And Rollback

If the verification harness cannot prove a real HTTP response, fix the harness before using it to approve any Access change.

If pre-production identity, posture, login, callback, or route-boundary checks fail, disable/delete `DTXWeb Pre-prod` and stop before production.

If any production public route is intercepted, disable `DTXWeb Production App` immediately and correct its destinations before re-enabling it. The accepted production destination set is only `/app` and `/app/*`.

If either API hostname is intercepted, remove the API hostname from Access. Do not add service tokens as a workaround in this slice.

If the trusted production desktop flow cannot complete the `/login -> /app -> desktop` handoff, disable the production Access application and investigate separately. Do not widen the Access policy or add a bypass to make the test pass.

Known/documented UX limitations such as the non-operator sign-out dead end or expired-session client-navigation behavior should be recorded as deferred follow-ups unless they prevent the trusted operator from recovering via normal browser reauthentication.

Rollback is dashboard-only: disable or delete the relevant Access application. No Worker rollback or code deployment is required.

## References

- Cloudflare Access application paths: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/
- Cloudflare self-hosted public applications: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- Cloudflare Access policies: https://developers.cloudflare.com/cloudflare-one/access-controls/policies/
- Cloudflare Access authorization cookie: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/
- Cloudflare Access login page / instant authentication: https://developers.cloudflare.com/learning-paths/clientless-access/customize-ux/login-page/
