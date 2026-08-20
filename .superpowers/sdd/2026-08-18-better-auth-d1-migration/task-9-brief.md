## Task 9: Add the desktop Device Authorization approval page

**Files:**

- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/+page.svelte`
- Create: `packages/dtx-web/src/routes/(app)/app/desktop-auth/desktop-auth-page.test.ts`
- Modify: `packages/dtx-web/src/lib/auth/client.ts`
- Modify: `packages/dtx-web/src/routes/layout.test.ts`

- [ ] **Step 1: Add failing approval-page tests.**

Cover prefilled/manual code, normalization, claim success, invalid/expired code, approve, deny, double-submit prevention, and unauthenticated return-through-login.

- [ ] **Step 2: Implement claim.**

Normalize code by trim/remove dashes/uppercase, call the pinned Better Auth Device Authorization verification method, and rely on `/app` guard for auth/next.

- [ ] **Step 3: Implement explicit approve/deny.**

Show user code and fixed `dtx-desktop` client identity. Disable both buttons while processing. Show terminal success/denial text; never redirect to a desktop callback.

- [ ] **Step 4: Verify and commit.**

Run page/layout tests plus web typecheck.

---

