# API Migration Phase 4 — Dual-path e2e parity gate + pre-prod cutover validation

**Date:** 2026-05-29
**Parent spec:** [docs/superpowers/specs/2026-05-16-api-server-migration-design.md](2026-05-16-api-server-migration-design.md)
**Phase 0 plan:** [docs/superpowers/plans/2026-05-16-api-migration-phase-0.md](../plans/2026-05-16-api-migration-phase-0.md) (complete)
**Phase 1 plan:** [docs/superpowers/plans/2026-05-18-api-migration-phase-1.md](../plans/2026-05-18-api-migration-phase-1.md) (complete)
**Phase 2 plan:** [docs/superpowers/plans/2026-05-19-api-migration-phase-2.md](../plans/2026-05-19-api-migration-phase-2.md) (complete)
**Phase 3 plan:** [docs/superpowers/plans/2026-05-25-api-migration-phase-3.md](../plans/2026-05-25-api-migration-phase-3.md) (complete)
**Phase 3 spec:** [docs/superpowers/specs/2026-05-25-api-migration-phase-3-design.md](2026-05-25-api-migration-phase-3-design.md)
**Packages/areas:** modifies `e2e/`, `playwright.config.ts`, `.github/workflows/e2e-test.yml`, and adds docs. No changes to `packages/dtx-api`, `packages/dtx-web` app code, `packages/dtx-desktop`, or `packages/common`.

## Goal

Stand up a **dual-path end-to-end parity gate** that proves the Phase 3 `lib/api/` dispatch layer behaves identically with `PUBLIC_USE_GRAPHQL_API` OFF (REST against `dtx-web`'s own `/api/*` routes) and ON (GraphQL against `dtx-api`), plus a committed **runbook** for the live pre-prod cutover validation that a human executes.

Phase 4 ships test/CI code and documentation only. It does **not** change the app's behavior and does **not** flip the flag in any deployed stanza — the committed `PUBLIC_USE_GRAPHQL_API` stays `false` everywhere. The "run the four e2e suites twice in CI (flag OFF and ON)" transition gate described in the parent spec is the central deliverable; it does not exist yet and is built here.

## Current state (start of Phase 4)

- Phase 3 is complete on `main`. `dtx-web` ships the dual-path `src/lib/api/*` layer behind `PUBLIC_USE_GRAPHQL_API`; `dtx-desktop` is hard-cut to GraphQL; codegen output is committed; `wrangler.jsonc` declares the `API` service binding on `pre-prod` (`dtx-api-pre-prod`) and `pre-prod-prod-data` (`dtx-api-pre-prod-prod-data`) stanzas. The flag is `"false"` on all three stanzas.
- `dtx-api` is deployed at `api.pre-prod.dtx.hapadona.com` with the full GraphQL surface + REST sidecars (`/upload`, `/downloads/:id`, `/downloads/bulk`).
- The Phase 3 **dual-path unit tests** already assert byte-identical return shapes across both flag states for every `lib/api/` call-site. The runtime/network/auth/CORS paths against a real `dtx-api` are the part not yet exercised by automated browser tests.
- The e2e suite has eight specs (`blog`, `chart-list`, `dtx-file-upload`, `dtx-to-midi`, `midi-to-dtx`, `midi-preview`, `editor`, `next-display-id`). They are **unauthenticated** tool/UI tests: none log in, none exercise the flag-sensitive authenticated call-sites, and `next-display-id.spec.ts` only asserts a `401` on the REST route.
- `playwright.config.ts` runs once against `bun run --filter=dtx-web dev` (plain `vite dev` on `localhost:5173`). The webServer sets `VITE_E2E=true` (which only flips a `data-e2e-hydrated` attribute in `+layout.svelte` for hydration sync — there is **no** e2e auth bypass or seeded data) and points `VITE_DTX_SERVER_URL` at itself. There is no GraphQL backend wired for a flag-ON run.
- `.github/workflows/e2e-test.yml` runs `bunx playwright test` once with `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY` from the `Production` GitHub environment.
- `dtx-api` validates bearer tokens by calling `supabase.auth.getUser(token)` against its configured `SUPABASE_URL` (`packages/dtx-api/src/auth/verifyToken.ts`). There is **no** offline/shared-secret/JWKS verification path. A fully offline e2e is therefore impossible without changing that file, which Phase 4 deliberately will not touch.
- Both `dtx-web` and `dtx-api` have `wrangler dev` available. `dtx-web` uses `@sveltejs/adapter-cloudflare`. D1 migrations live at `packages/dtx-web/d1-migrations/0001_initial_schema.sql`. There is no seed tooling and no e2e test user today.

## Non-goals

- Flipping `PUBLIC_USE_GRAPHQL_API=true` in any committed/deployed stanza (that is a manual runbook step on pre-prod, and Phase 5 for prod).
- Any change to `packages/dtx-api` business logic or `verifyToken.ts` — Phase 4 depends on the deployed verification behavior as-is.
- Production deploy of `dtx-api`, production web flag flip, or a desktop GitHub release (all Phase 5).
- Deleting `packages/dtx-web/src/routes/api/*` or removing `dtx-web` bindings (Phase 6).
- Expanding e2e beyond the four critical journeys — the parent spec keeps the e2e suite deliberately minimal.
- Changing `packages/dtx-web` app code, `packages/dtx-desktop`, or `packages/common`. Delta fixes uncovered during the live runbook are explicitly allowed but land as a **follow-up PR**, not as part of the gate scaffolding. (The harness may add a root-level dev dependency or test-config wiring — e.g. a Supabase client for `global.setup` — if one is required; that is gate scaffolding, not app code.)

## Design

### Architecture overview — the hermetic dual-path harness

The same four journey specs run in two **independent legs** selected by a CI matrix (`use_graphql: [false, true]`). Parity is proven by the _same assertions_ passing in both legs; the legs do not share data with each other.

```text
LEG A — flag OFF (REST path)
┌──────────────────────────────────────────────────────┐
│ Playwright (chromium) on localhost                     │
│   browser → dtx-web (localhost:5173)                   │
│     PUBLIC_USE_GRAPHQL_API=false                       │
│     client call-sites → dtx-web /api/*                 │
│     blog SSR + /api/* → platform.env.DB / R2 / KV      │ ← local Miniflare
│   auth: Supabase session cookie (test project)         │
└──────────────────────────────────────────────────────┘

LEG B — flag ON (GraphQL path)
┌──────────────────────────────────────────────────────┐
│ Playwright (chromium) on localhost                     │
│   browser → dtx-web (localhost:5173)                   │
│     PUBLIC_USE_GRAPHQL_API=true                        │
│     PUBLIC_DTX_API_URL=http://localhost:8787           │
│     client call-sites → dtx-api /graphql, /upload,     │
│                         /downloads/:id, /downloads/bulk │
│     blog SSR still → dtx-web platform.env.DB           │
│   ┌ dtx-web (5173) ┐  shared --persist-to .e2e-state    │
│   └ dtx-api (8787) ┘  → ONE local D1 + R2              │ ← local Miniflare
│   auth: Supabase bearer (test project)                 │
│         → dtx-api verifyToken → getUser(test Supabase) │
└──────────────────────────────────────────────────────┘
```

Principles:

- **Two independent legs, not one shared dataset.** Each matrix leg is a fresh CI job with its own Miniflare instance, its own persistence directory, and its own per-leg seed. Parity = identical observable outcomes, not shared bytes. This keeps the legs isolated and parallelizable.
- **One shared local D1/R2 _within_ Leg B.** In the flag-ON leg, `dtx-web`'s blog SSR reads `dtx-web`'s D1 directly (the SSR read is not migrated until Phase 6), while the client's anonymous download hits `dtx-api`'s R2. Both must observe the same seeded chart, so `dtx-web` and `dtx-api` run their Miniflare against a **shared `--persist-to` directory** in Leg B. Leg A only needs `dtx-web`'s bindings.
- **Real Supabase control plane, local data plane.** The dedicated test Supabase project issues and validates tokens for both paths (cookie for `dtx-web`, bearer for `dtx-api`). All _application_ data (charts, files, user profiles) lives in local Miniflare D1/R2 — never in Supabase, never in pre-prod.
- **Flag toggling via public env vars at dev-server launch.** An `E2E_USE_GRAPHQL` switch read by `playwright.config.ts` selects the `dtx-web` webServer env (`PUBLIC_USE_GRAPHQL_API`, plus `PUBLIC_DTX_API_URL` when ON) and decides whether to also boot the `dtx-api` webServer.
- **`dtx-web` bindings in dev.** Default approach: `@sveltejs/adapter-cloudflare`'s platformProxy surfaces `platform.env` from `wrangler.jsonc` bindings against local Miniflare under `vite dev`. Fallback if that does not surface cleanly: run `dtx-web` via `wrangler dev` on the built worker. This is the single piece proven out first in the implementation plan; nothing else depends on which option wins.

### The four critical-journey specs

A Playwright `global.setup` project signs the test user in once (`supabase.auth.signInWithPassword` against the test project) and saves `storageState` — the Supabase session, which carries both the cookie (consumed by `dtx-web` SSR via `@supabase/ssr`) and the `access_token` (read by `lib/api/token.ts` for the bearer path). Authenticated specs reuse that `storageState`; a single browser login therefore covers both the REST cookie path and the GraphQL bearer path.

A seed step (authenticated API calls against the running local stack) creates one published, uploaded chart for the anonymous journeys. The lifecycle journey self-seeds (create → … → delete).

| #   | Journey                                                                       | Auth      | Flag-sensitive call-sites exercised                                               |
| --- | ----------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- |
| 1   | Chart lifecycle: create a chart → see it in `/app` list → edit title → delete | logged in | `createSimfile`, `listSimfiles(MINE)`, `updateSimfile`, `deleteSimfile`           |
| 2   | Upload a `.dtx` to a chart → file appears in the chart's files list           | logged in | upload (`/upload` multipart), `getSimfile { files }`                              |
| 3   | Anonymous blog browse → open a published chart → single download              | anonymous | `listSimfiles(PUBLISHED)` SSR, `getSimfile`, `downloadSimfile` (`/downloads/:id`) |
| 4   | Select two charts → bulk ZIP download                                         | anonymous | `bulkDownload` (`/downloads/bulk`)                                                |

Each journey asserts only on visible UI, URL, and downloaded-file outcomes, so the _same_ assertions hold whether the bytes came from REST or GraphQL — that is the parity proof. The existing eight unauthenticated tool/UI specs remain unchanged and continue to run in both legs (cheap, and they confirm the client-only paths are flag-agnostic).

### Test Supabase project + secrets

A dedicated Supabase project (e.g. `drumery-e2e`) used **only** by the parity gate:

- Holds the e2e test user(s); zero overlap with prod or pre-prod auth.
- Email confirmation disabled / auto-confirm so the test user is provisioned once and signed in headlessly.
- Local `dtx-web` and `dtx-api` both point `SUPABASE_URL`/`SUPABASE_ANON_KEY` at this project during e2e so cookie auth (`dtx-web`) and bearer verification (`dtx-api` `verifyToken`) resolve against the same identity.

New CI vars/secrets (GitHub Actions):

| Name                     | Kind   | Use                                      |
| ------------------------ | ------ | ---------------------------------------- |
| `E2E_SUPABASE_URL`       | var    | test project URL (`dtx-web` + `dtx-api`) |
| `E2E_SUPABASE_ANON_KEY`  | secret | test project anon key                    |
| `E2E_TEST_USER_EMAIL`    | secret | login in `global.setup`                  |
| `E2E_TEST_USER_PASSWORD` | secret | login in `global.setup`                  |

For the parity gate, the existing `PUBLIC_SUPABASE_*` wiring in `e2e-test.yml` is sourced from these `E2E_*` values. The test user is created once out-of-band (documented in the runbook), not on every run.

### CI workflow — the parity matrix

`.github/workflows/e2e-test.yml` gains a matrix leg:

```yaml
strategy:
    matrix:
        use_graphql: [false, true]
env:
    E2E_USE_GRAPHQL: ${{ matrix.use_graphql }}
    PUBLIC_SUPABASE_URL: ${{ vars.E2E_SUPABASE_URL }}
    PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.E2E_SUPABASE_ANON_KEY }}
    E2E_TEST_USER_EMAIL: ${{ secrets.E2E_TEST_USER_EMAIL }}
    E2E_TEST_USER_PASSWORD: ${{ secrets.E2E_TEST_USER_PASSWORD }}
    # dtx-api SUPABASE_* are set to the same test project for the flag-ON leg
```

- `playwright.config.ts` reads `E2E_USE_GRAPHQL`. It sets the `dtx-web` webServer env (`PUBLIC_USE_GRAPHQL_API`, and `PUBLIC_DTX_API_URL=http://localhost:8787` when ON), and — when ON — declares a **second `webServer`** that boots `dtx-api` via `wrangler dev` with a shared `--persist-to` directory.
- D1 migrations (`packages/dtx-web/d1-migrations/`) are applied to the local D1 before the suites in both legs; the seed runs in `global.setup`.
- Both legs must be green for the job to pass. This realizes the parent spec's "run twice" transition gate.

### Cutover runbook (committed markdown, executed by a human)

`docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md` — a checklist authored here but **run by the operator**, because it requires the Cloudflare dashboard, a real interactive login, and human observation:

1. **One-time setup:** create the test Supabase project; create the e2e test user; add the four `E2E_*` CI vars/secrets.
2. **Flag-ON on pre-prod:** deploy `dtx-web` to pre-prod with `PUBLIC_USE_GRAPHQL_API` overridden to `true` (CLI var override or dashboard). The committed config stays `false`.
3. **Manual smoke** of every web call-site against `api.pre-prod.dtx.hapadona.com`: login, list, edit, delete, single + bulk download, magic link. DevTools Network confirms requests hit `api.pre-prod`.
4. **Worker-log parity capture:** `wrangler tail` on both `dtx-web` (pre-prod) and `dtx-api-pre-prod` during the smoke; save logs for delta comparison against a flag-OFF baseline run.
5. **Delta-triage:** record any response/behavior delta. Fixes land in `dtx-web` or `dtx-api` as a **follow-up PR** (allowed in Phase 4), each with a regression assertion added to the relevant journey spec or Phase 3 unit test.
6. **Flip back** to `false` to leave pre-prod in steady state.
7. **Desktop pre-prod build:** `VITE_DTX_SERVER_URL=https://api.pre-prod.dtx.hapadona.com bun run --filter=dtx-desktop build`; smoke list / upload `.dtx` / edit / delete / magic-link locally. No GitHub release.
8. **Phase 5 handoff:** record what must hold before the prod cutover (gate green on `main`, zero unresolved deltas, desktop pre-prod smoke clean).

### Parity / error model

The gate proves parity at the **observable-outcome** layer (rendered UI, navigations, downloaded files), which is the layer users experience. The **response-shape** layer is already covered by the Phase 3 dual-path unit tests (`lib/api/*.test.ts` assert byte-identical shapes across flag states). The **runtime/transport/auth/CORS** layer against a real deployed `dtx-api` is covered by the live runbook's manual smoke + worker-log capture. Together the three layers cover the cutover surface without duplicating each other.

### Risks & mitigations

| Risk                                                                                 | Mitigation                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| adapter-cloudflare platformProxy does not surface `platform.env` under `vite dev`    | Proven out in the plan's first task before journeys are written; fallback is `wrangler dev` on the built `dtx-web` worker. Blocks nothing downstream.                                |
| Shared `--persist-to` race between `dtx-web` and `dtx-api` in Leg B                  | Apply migrations + seed before either server accepts traffic; Playwright `webServer.url` health-gates startup ordering; seed is idempotent.                                          |
| Cross-leg test/data bleed                                                            | Each matrix leg is a fresh CI job with its own Miniflare + persist dir + per-leg seed. No cross-leg shared state.                                                                    |
| Real Supabase dependency makes the gate flaky if Supabase is unavailable             | Accepted and bounded: only token issuance/validation touches Supabase. Documented; existing `retries: 2` (on CI) absorbs transient failures.                                         |
| Access-token expiry mid-suite                                                        | `global.setup` signs in fresh per run; suites are short; access-token TTL far exceeds suite runtime.                                                                                 |
| CI secrets unavailable on fork PRs                                                   | Authenticated legs require `E2E_*` secrets; on fork PRs they are skipped (documented), matching today's secret-gated workflow. Same-repo PRs and pushes to `main` run the full gate. |
| Bulk-download rate limit (`RATE_LIMIT` / `RATE_LIMIT_API` KV) trips during the suite | Local KV is empty per leg; the suite seeds/selects only two charts — well within limits.                                                                                             |
| Doubling CI time (two legs)                                                          | Legs run in parallel via the matrix; the flag-OFF leg is the existing cost, the flag-ON leg adds a `wrangler dev` boot. Acceptable for a pre-cutover gate.                           |

### Decisions log (pinned by this spec)

1. **Phase 4 delivers both the automated dual-path parity gate and the live cutover runbook.** (Scope chosen over runbook-only / gate-only / decompose.)
2. **The parity gate uses a hermetic local stack:** local Miniflare D1/R2, real Supabase only for token issuance/validation. No offline-JWT path is introduced.
3. **A dedicated test Supabase project** backs e2e auth — isolated from prod and pre-prod identities.
4. **Two independent CI legs** (`use_graphql: [false, true]`) prove parity via identical assertions, rather than sharing one dataset across flag states.
5. **`dtx-web` and `dtx-api` share one `--persist-to` dir within the flag-ON leg** so blog SSR (dtx-web D1) and anonymous download (dtx-api R2) see the same seed.
6. **No change to `packages/dtx-api`** (including `verifyToken.ts`) and **no change to deployed flag values.** Delta fixes from the runbook land as a separate follow-up PR.
7. **The four journeys match the parent spec exactly** — lifecycle, presigned/multipart upload, anonymous single download, bulk download — kept deliberately minimal.
8. **The runbook is authored here but executed by a human operator** (Cloudflare dashboard + interactive login + observation are out of an agent's reach).

### Open questions deferred to implementation

- platformProxy vs `wrangler dev` for `dtx-web`'s dev-server bindings (default platformProxy; decided by the plan's first task).
- Exact local ports for `dtx-api` (`8787` assumed) and the `--persist-to` path (`.e2e-state` assumed); finalized in `playwright.config.ts`.
- Whether the seed runs entirely in `global.setup` via API calls or partly via `wrangler d1 execute` for the published-chart fixture; default: API calls so the seed is path-honest, with a direct R2/D1 write only if an API-only seed proves circular.
- Whether to model the two legs as a GitHub matrix (assumed) or as two Playwright `projects` with separate webServers in one job; default: matrix for isolation + parallelism.
- Whether fork-PR runs skip the gate entirely or run only the unauthenticated specs; default: run unauthenticated specs, skip the authenticated legs.

### What Phase 5 will need (handoff)

- The parity gate green on `main` with zero unresolved deltas, and the pre-prod desktop smoke clean, as the prod-cutover readiness signal.
- The runbook's worker-log parity artifacts captured at least once on pre-prod.
- Any delta-fix follow-up PRs merged before prod flip.

## Done criteria

- `e2e/` contains four journey specs (chart lifecycle, `.dtx` upload, single download, bulk download) plus a `global.setup` that logs in the test user and seeds one published+uploaded chart; all pass locally with both `E2E_USE_GRAPHQL=false` and `=true`.
- `playwright.config.ts` reads `E2E_USE_GRAPHQL`, sets the flag + `PUBLIC_DTX_API_URL` on the `dtx-web` webServer, and boots a `dtx-api` `wrangler dev` webServer with a shared `--persist-to` on the flag-ON leg; D1 migrations are applied before the suites in both legs.
- `.github/workflows/e2e-test.yml` runs the `use_graphql: [false, true]` matrix; both legs must be green for the job to pass; the gate is wired to the `E2E_*` test-Supabase vars/secrets.
- The dedicated test Supabase project and the four `E2E_*` CI vars/secrets are documented in the runbook.
- `docs/superpowers/runbooks/2026-05-29-phase-4-preprod-cutover.md` is committed and complete (no TBDs).
- No change to `packages/dtx-api` logic, `packages/dtx-web`/`dtx-desktop`/`common` app code, or any deployed `PUBLIC_USE_GRAPHQL_API` value.
- Existing unit/component suites and `bun run --filter=@dtx/common test` still pass; root `bun run lint` passes.
- Zero changes outside `e2e/`, `playwright.config.ts`, `.github/workflows/`, the new `docs/` files, and (if required by the harness) root-level test dev-dependencies/config. No app-code or deployed-config changes.
