## Task 12: Add ID-preserving identity import and Better Auth web E2E seed

**Files:**

- Create: `packages/dtx-api/src/scripts/migrate-supabase-auth.ts`
- Create: `packages/dtx-api/src/scripts/migrate-supabase-auth.test.ts`
- Create sanitized fixtures under `packages/dtx-api/src/scripts/fixtures/`
- Modify: `packages/dtx-api/package.json`
- Delete: `packages/e2e-web/setup/create-local-supabase-user.ts`
- Create: `packages/e2e-web/setup/seed-better-auth-user.ts`
- Modify: `packages/e2e-web/setup/prepare-stack.ts`
- Modify: `packages/e2e-web/playwright.config.ts`
- Modify: `packages/e2e-web/test-config.ts`
- Modify: `packages/e2e-web/global.setup.ts`
- Modify: `packages/e2e-web/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Specify import invariants.**

Test exact UUID preservation, email/name/verification/timestamps, Google identity, no sessions/tokens, deterministic account IDs, SQL escaping, duplicate rejection, unsupported-provider rejection, and owner-ID reconciliation.

- [ ] **Step 2: Implement local-only import tool.**

Consume sanitized Supabase Admin export JSON and emit reviewed D1 SQL under ignored `tmp/auth-migration/`. Do not import `@supabase/supabase-js`; do not write remote D1 directly.

- [ ] **Step 3: Handle credential users without bcrypt compatibility.**

Require explicit replacement password input and hash it with the pinned Better Auth password helper. No replacement password means no credential account.

- [ ] **Step 4: Seed local Better Auth web user.**

After `prepare-stack.ts` applies every migration, seed Better Auth user/account rows into the same D1 using the fixed test UUID already used by application seed rows.

- [ ] **Step 5: Retarget Playwright env/setup and verify.**

Remove Supabase E2E URL/anon/service-role inputs. Keep fail-loud CI behavior for incomplete Better Auth test config. Run import tests, local stack prep, Playwright setup, and E2E typecheck.

---

