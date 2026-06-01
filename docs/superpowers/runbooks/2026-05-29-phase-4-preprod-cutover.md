# Phase 4 — Pre-prod Cutover Runbook (operator-executed)

Authored for Phase 4 of the API migration. Steps requiring the Cloudflare
dashboard, an interactive login, or human observation are run by a human, not
an agent.

## 0. CI notes (as implemented)

- **`dtx-web` local-binding mechanism (Task 1): `platformProxy`** — the default
  path won; the `wrangler dev` fallback was NOT needed. `svelte.config.js` gates
  `platformProxy: {}` behind `process.env.E2E_PLATFORM_PROXY === '1'` (inert in
  normal dev/prod).
- **Resolved persist path:** `packages/<pkg>/.wrangler/state` (default;
  `<pkg>` = `dtx-web` for the flag-OFF leg, `dtx-api` for the flag-ON leg).
- **D1/R2 alignment (verified in Task 7):** both `packages/dtx-web/wrangler.jsonc`
  and `packages/dtx-api/wrangler.jsonc` declare D1 `database_name: "dtx-web"`, so
  `wrangler d1 execute dtx-web --local --persist-to .wrangler/state` and the
  worker's `DB` binding resolve to the SAME local Miniflare sqlite. The ON-leg
  `dtx-api` (`wrangler dev`) reads the data `prepare-stack.ts` seeds (confirmed:
  GraphQL list returned the seeded chart and the download served the seeded R2
  object).
- **Playwright project structure (decoupled):** `chromium` runs the 8 pre-existing
  specs + the anonymous download journey with NO login dependency (green without
  the test Supabase project); `chromium-auth` runs the authenticated journey only
  and `dependencies: ['setup']` (the login). So before §1 below, CI's `chromium`
  leg is green and `chromium-auth` is red (expected) until the test project exists.
- **OFF-leg same-origin download shim:** `e2e/blog-download.spec.ts` injects
  `x-forwarded-for: 127.0.0.1` on same-origin (`:5173`) requests only, because the
  REST download endpoint rate-limits by client IP (`cf-connecting-ip` /
  `x-forwarded-for`) and local Miniflare under `vite dev` supplies none. It is a
  request header, not auth; the journey stays anonymous. It is intentionally NOT
  applied to the cross-origin `dtx-api` (`:8787`) requests (would trip a CORS
  preflight that does not allow `x-forwarded-for`).
- **CI secrets removed:** the workflow no longer uses a `Production` environment or
  `PUBLIC_SUPABASE_*` secrets — the test creds live in `e2e/test-config.ts`, so the
  full matrix runs on forks too.

## 1. One-time test-Supabase setup

1. Create a dedicated Supabase project (e.g. `drumery-e2e`). Disable email
   confirmation (Auth → Providers → Email → "Confirm email" off) or enable
   auto-confirm so the test user can sign in headlessly.
2. Create the test user (Auth → Users → Add user): email `e2e@drumery.test`,
   a throwaway password (minimum 6 characters to satisfy Supabase's default requirement).
3. Copy the user's UUID, the project URL, and the anon key (Settings → API).
4. Paste all four into `e2e/test-config.ts` (`TEST_SUPABASE_URL`,
   `TEST_SUPABASE_ANON_KEY`, `TEST_USER_EMAIL` / `TEST_USER_PASSWORD`,
   `TEST_USER_ID`) and commit. No GitHub secrets are needed.
5. Run both legs locally to confirm green:
    - `E2E_USE_GRAPHQL=false bunx playwright test`
    - `E2E_USE_GRAPHQL=true bunx playwright test`

## 2. Flag-ON validation on pre-prod

1. Deploy `dtx-web` to pre-prod with the flag overridden ON, WITHOUT changing
   committed config. `PUBLIC_USE_GRAPHQL_API` is read via `$env/dynamic/public`
   (runtime), so a deploy-time `--var` override works without rebuilding config:
   `cd packages/dtx-web && bun run build && bunx wrangler deploy --env pre-prod --var PUBLIC_USE_GRAPHQL_API:true`
2. In a browser at `https://pre-prod.dtx.hapadona.com`, with DevTools → Network
   open, smoke every web call-site and confirm requests hit
   `api.pre-prod.dtx.hapadona.com`:
    - Log in.
    - `/app/chart`: list loads (mine).
    - Open a chart → detail loads (getSimfile) → edit a field → Update (updateSimfile).
    - Delete a disposable chart (deleteSimfile).
    - `/blog`: list loads (published); click a chart's Download (single download).
    - `/blog`: Select two charts → bulk Download (the native save picker appears) — bulk download.
    - Trigger the desktop handoff (login with `?redirect=desktop`) → magic link generates.

## 3. Worker-log parity capture

1. In two terminals during the smoke:
    - `cd packages/dtx-web && bunx wrangler tail --env pre-prod`
    - `cd packages/dtx-api && bunx wrangler tail --env pre-prod`
2. Save both logs. Compare error rates / status codes against a flag-OFF
   baseline pass of the same smoke.

## 4. Delta triage

- Record any response/behavior delta between OFF and ON.
- Fixes land in `dtx-web` or `dtx-api` as a **follow-up PR** (allowed in Phase
  4), each with a regression assertion added to the relevant journey spec or a
  Phase 3 `lib/api/*.test.ts`.

### Acceptable deltas (defer to follow-up PR if desired)

- Header differences (e.g., `x-request-id`, `via`, `cf-cache-status`) added by
  the GraphQL proxy layer.
- Minor cosmetic UI text changes that do not break functionality.
- Request URL path differences (e.g., `/api/simfiles/…` vs `/graphql`) as long
  as the response payload is equivalent.
- Timing differences where both legs return the same data.

### Blocking deltas (must fix before proceeding)

- Changed HTTP status codes (e.g., 200 → 4xx/5xx) on equivalent requests.
- Missing data fields in responses (e.g., chart title, user ID, file metadata).
- Broken UI flows (e.g., login fails, chart list empty, download errors).
- Auth/session handling differences that cause logout or permission errors.

### Triage checklist

- [ ] Every delta logged with OFF response and ON response side by side.
- [ ] Each delta classified acceptable or blocking using the criteria above.
- [ ] All blocking deltas have a follow-up PR with a regression test.
- [ ] Zero blocking deltas remain before moving to §5.

## 5. Restore steady state

- Re-deploy pre-prod WITHOUT the override so `PUBLIC_USE_GRAPHQL_API` returns to
  the committed `false`:
  `bun run deploy:web:preprod`

## 6. Desktop pre-prod smoke

- `VITE_DTX_SERVER_URL=https://api.pre-prod.dtx.hapadona.com bun run --filter=dtx-desktop build`
- Launch the built app and smoke: chart list, upload a `.dtx`, edit, delete,
  magic-link sign-in. No GitHub release.

## 7. Phase 5 handoff checklist

- [ ] CI parity gate green on `main` (both legs, after §1 test-Supabase setup).
- [ ] Zero unresolved deltas (all delta-fix PRs merged).
- [ ] Worker-log parity artifacts captured at least once on pre-prod.
- [ ] Desktop pre-prod smoke clean.
