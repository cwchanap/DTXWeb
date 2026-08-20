## Task 6: Replace SvelteKit Supabase session plumbing

**Files:**

- Create: `packages/dtx-web/src/lib/auth/client.ts`
- Create: `packages/dtx-web/src/lib/auth/session.ts`
- Create matching tests
- Rewrite: `packages/dtx-web/src/hooks.server.ts`
- Modify: `packages/dtx-web/src/app.d.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.server.ts`
- Rewrite: `packages/dtx-web/src/routes/+layout.ts`
- Modify: `packages/dtx-web/src/routes/+layout.svelte`
- Modify related layout/hook tests

**Interfaces:**

- Reuses `safeAppRedirectPath()` from `$lib/auth/google.ts`; no second redirect helper.
- Uses production/pre-prod `event.platform.env.API` service binding when available.
- Falls back to `PUBLIC_DTX_API_URL` for local Vite/non-Workers execution.

- [ ] **Step 1: Add failing session/guard tests.**

Cover anonymous/authenticated session lookup, service binding preference, public fallback, forwarded cookies, two Set-Cookie propagation, protected `/app` redirect, safe `next`, authenticated `/login` redirect, and API failure.

- [ ] **Step 2: Add Better Auth Svelte client.**

Point it at `PUBLIC_DTX_API_URL`, set `credentials: 'include'`, and register `deviceAuthorizationClient()`.

- [ ] **Step 3: Implement server session lookup without a public production round-trip.**

If `event.platform?.env.API` exists, call its `fetch()` handler with `/api/auth/get-session`. Otherwise fetch `PUBLIC_DTX_API_URL`.

Forward the incoming Cookie header.

For service-binding unsafe GraphQL later, the external trusted origin is `event.url.origin`; session GET itself remains read-only and does not require Origin.

- [ ] **Step 4: Preserve every Set-Cookie value.**

Use the runtime multi-cookie API and append each raw Set-Cookie value to the SvelteKit response. Never use a single `headers.get('set-cookie')` value.

- [ ] **Step 5: Delete old desktop web exceptions.**

Remove from `hooks.server.ts`:

```text
redirect=desktop
desktop_callback
DTXDesktopApp user-agent/x-requested-with CSRF bypass
```

Keep normal SvelteKit form-CSRF behavior and `/app` guard.

- [ ] **Step 6: Simplify layout data.**

Remove Supabase clients/subscriptions/invalidation. Return neutral user/session plus existing locale data.

- [ ] **Step 7: Verify and commit.**

Run focused hook/layout tests, full web tests, and `bun run --filter=dtx-web check`.

---

