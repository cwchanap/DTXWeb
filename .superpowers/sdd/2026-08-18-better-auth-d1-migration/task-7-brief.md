## Task 7: Move web sign-in, logout, and Google linking to Better Auth

**Files:**

- Modify: `packages/dtx-web/src/lib/auth/google.ts`
- Modify: `packages/dtx-web/src/lib/auth/google.test.ts`
- Rewrite: `packages/dtx-web/src/routes/(login)/login/+page.svelte`
- Delete/replace: `packages/dtx-web/src/routes/(login)/login/+page.server.ts`
- Retarget: `packages/dtx-web/src/routes/(login)/login/page.server.test.ts`
- Delete: `packages/dtx-web/src/routes/auth/callback/+server.ts`
- Retarget/delete after migration: `packages/dtx-web/src/routes/auth/callback/server.test.ts`
- Modify: `packages/dtx-web/src/routes/(app)/+layout.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/layout.svelte.test.ts`
- Rewrite: `packages/dtx-web/src/routes/(app)/app/account/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/account/account-page.test.ts`

- [ ] **Step 1: Move existing redirect/error assertions before route deletion.**

Retarget existing callback/login tests for safe `/app` paths, external/protocol-relative rejection, provider cancellation/failure sanitization, existing-account-only copy, and explicit-link conflict copy.

- [ ] **Step 2: Implement password sign-in.**

```ts
await authClient.signIn.email({ email, password });
window.location.assign(safeAppRedirectPath(next));
```

Preserve `/app` as the missing-next default.

- [ ] **Step 3: Implement Google sign-in/linking.**

Use `signIn.social({ provider: 'google', callbackURL })` for login and `linkSocial({ provider: 'google', callbackURL })` on the account page. Keep implicit linking/signup disabled.

- [ ] **Step 4: Delete old SvelteKit OAuth callback.**

Better Auth `/api/auth/callback/google` is authoritative. Delete only old Supabase callback URL builders after callers/tests move.

- [ ] **Step 5: Implement logout and verify.**

Call `authClient.signOut()` then full-navigate to `/login`. Run web auth tests/typecheck and commit.

---

