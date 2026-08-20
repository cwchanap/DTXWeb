## Task 15: Full verification and pre-production cutover proof

**Files:**

- Modify only files required by failed verification.
- Update runbook with corrected non-secret assumptions/results.

- [ ] **Step 1: Run static/unit/Rust verification.**

```bash
bun run format
bun run lint
bun run check
bun run test
git diff --check
cargo fmt --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml --check
cargo test --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path packages/dtx-desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
```

Do not run deleted root `gen-types`.

- [ ] **Step 2: Run generated-artifact gates.**

```bash
bun run --filter=dtx-api auth:schema:check
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run gen:native-types
git diff --exit-code
```

- [ ] **Step 3: Run auth/trust residue gates.**

Confirm:

```text
no runtime Supabase import/config
no getAccessTokenOrNull/token.ts
no desktop auth callback vars
no production auth deep-link/loopback/JWT/refresh code
no root/turbo Supabase gen-types
auth trustedOrigins comes from DTX_WEB_URL, not CORS_ALLOWED_ORIGINS
prod/pre-prod cookie prefixes differ
credentialed CORS true on preflight and normal responses
production dtx-web has API service binding
/get-session is exempt from DB-backed rate limiting
```

- [ ] **Step 4: Run E2E.**

```bash
bun run e2e:web
bun run e2e:desktop
```

Expected: PASS without Supabase credentials.

- [ ] **Step 5: Prove pre-production.**

Using the runbook:

- configure pre-prod Better Auth/Google secrets/callback;
- confirm `DTX_WEB_URL=https://pre-prod.dtx.hapadona.com`;
- confirm `AUTH_COOKIE_PREFIX=dtx-preprod`;
- apply D1 migration;
- generate/review/apply sanitized identity-import SQL to pre-prod only;
- reconcile every application owner ID;
- deploy API then web;
- verify SvelteKit SSR uses service binding;
- build desktop candidate pointed at pre-prod;
- execute password, Google, linking, GraphQL, upload/download, Device Authorization approve/deny/expiry, restore/logout, and Access checks;
- verify localhost CORS origins do not become Better Auth trusted origins;
- verify production `dtx.*` cookie is not interpreted as pre-production session;
- verify candidate no longer needs Supabase runtime access.

- [ ] **Step 6: Record evidence and stop before production.**

Record only non-secret outcomes. Production go/no-go requires all checks, exact owner reconciliation, callbacks/secrets, rollback artifacts, and reviewed runbook.

Do not run production `0008`, production identity import, production deploy, desktop publication, or credential removal from this task.

- [ ] **Step 7: Final repository verification.**

```bash
git status --short
git diff --check
```

Commit only verification-driven corrections.

## Risks

### Foundation/cutover drift

PR A intentionally adds unused Better Auth infrastructure while Supabase remains live. PR B must start from merged PR A and must not reintroduce a dual-auth application authorization path.

### Cookie collision

Production domain cookie scope includes nested pre-production hosts. Distinct `AUTH_COOKIE_PREFIX` values are required before browser Better Auth sessions are used.

### Origin confusion

`CORS_ALLOWED_ORIGINS` contains deployed pre-production localhost entries. It is never an auth trust list. `DTX_WEB_URL` is the only trusted application web origin.

### SSR hot path

Production session lookup must use the service binding, and `/get-session` must be exempt from DB rate limiting.

### Desktop E2E seam

Existing debug E2E currently assumes access + refresh tokens. Task 10/11 must migrate the seed and renderer storage before Task 15 runs `e2e:desktop`.

### Identity mismatch

No application ownership FK is added; exact import reconciliation is therefore a hard pre-production/production gate.

## Completion Definition

HPA-644 is ready for production operator execution when:

- [ ] Foundation PR A merged/deployed and additive pre-production proof passed.
- [ ] Cutover PR B static/type/unit/Rust/web-E2E/desktop-E2E gates pass.
- [ ] Better Auth/CLI are pinned to the same reviewed 1.6.x patch.
- [ ] D1 holds Better Auth core, Device Authorization, and rate-limit tables.
- [ ] Existing application owner UUIDs are preserved by import tooling.
- [ ] Password and Google web sign-in use Better Auth.
- [ ] Explicit linking works; implicit linking/signup remain disabled.
- [ ] `DTX_WEB_URL` is the auth trust origin; `CORS_ALLOWED_ORIGINS` is CORS-only.
- [ ] Production/pre-prod/local cookies have distinct prefixes.
- [ ] Credentialed CORS is enabled on preflight and normal responses.
- [ ] Multi-value Set-Cookie survives CORS and SvelteKit forwarding.
- [ ] Production SSR uses the `API -> dtx-api` service binding.
- [ ] `/get-session` does not use database-backed rate limiting.
- [ ] Browser GraphQL/REST/downloads use cookie sessions and unsafe-method canonical-Origin validation.
- [ ] Desktop uses Device Authorization + opaque Bearer sessions.
- [ ] Desktop retains valid/invalid/not-configured and Drive session-epoch semantics.
- [ ] Desktop E2E uses Better Auth-shaped `{ sessionToken, user }` and no fake refresh token.
- [ ] No production auth magic-link/deep-link/loopback/JWT/refresh-token machinery remains.
- [ ] No active package/config/test depends on Supabase.
- [ ] Obsolete root/turbo Supabase `gen-types` is removed.
- [ ] Full pre-production acceptance passes.
- [ ] Production runbook is ready for separate operator execution.
