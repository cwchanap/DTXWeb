## Task 14: Add E2E coverage and write/reconcile the production runbook

**Files:**

- Modify/create authenticated specs under `packages/e2e-web/`
- Modify/create desktop auth specs under `packages/e2e-desktop/`
- Revisit: `packages/e2e-desktop/wdio.conf.ts`
- Revisit: `packages/e2e-desktop/support/standalone-session.ts`
- Revisit: `packages/e2e-desktop/support/standalone-session.test.mjs`
- Revisit: `packages/e2e-desktop/specs/google-drive-upload.e2e.ts`
- Revisit: `packages/e2e-desktop/scripts/google-drive-crash-recovery.ts`
- Revisit: `packages/e2e-desktop/scripts/google-drive-crash-recovery.test.mjs`
- Create: `docs/superpowers/runbooks/2026-08-18-better-auth-d1-cutover.md`
- After PR #221 lands, modify its Zero Trust spec/plan/runbook documents

- [ ] **Step 1: Update web E2E.**

Cover password login, `/app` guard, authenticated GraphQL/score flow, authenticated download, logout, and invalid-session redirect without Supabase credentials.

- [ ] **Step 2: Cover real Device Authorization at API/web integration level.**

Against local API/D1: request code, authenticate browser, claim, approve, poll, validate user, and revoke. Cover deny and expiry.

Do not add a production or API-wide test-auth endpoint. It is acceptable to retain the existing native `e2e + debug_assertions` seed seam for WDIO desktop tests; that path is already compile-time excluded from release builds.

- [ ] **Step 3: Re-run desktop E2E session-shape audit.**

```bash
rg -n "auth_access_token|auth_refresh_token|auth_user_data|e2e-supabase|refresh_token|DTX_E2E_DRUMERY_USER_ID" \
  packages/e2e-desktop packages/dtx-desktop/src-tauri/src
```

Expected after intended debug-only identifiers are accounted for: no Supabase-shaped renderer session seed or fake refresh token remains.

- [ ] **Step 4: Update desktop E2E.**

Cover renderer auth state and authenticated desktop behavior using the debug-only native seed plus Better Auth-shaped `{ sessionToken, user }` storage. Keep one manual real-browser-open Device Authorization handoff check in the runbook because OS browser launch is outside stable WDIO coverage.

- [ ] **Step 5: Write production runbook.**

Include exact sections for backup/export, pinned version, cookie prefixes/domains, trusted web origins, service binding, Google callbacks, Wrangler secrets, Supabase Admin export, generated import SQL review, D1 order, owner reconciliation, deployment order, web matrix, desktop matrix, Access matrix, go/no-go, production cutover, Supabase-disable proof, and rollback.

Production actions remain operator instructions.

- [ ] **Step 6: Reconcile PR #221 documentation.**

Replace Supabase inner gate with Better Auth and `/login?redirect=desktop` callbacks with `/app/desktop-auth` Device Authorization. Preserve production `/app` operator policy, pre-prod Access behavior, and public API hostnames.

- [ ] **Step 7: Verify and commit.**

Run web E2E, desktop E2E, formatting, and `git diff --check`.

---

