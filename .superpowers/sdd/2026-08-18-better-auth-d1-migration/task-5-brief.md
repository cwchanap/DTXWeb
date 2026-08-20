## Task 5: Remove the custom magic-link/desktop web handoff

**Files:**

- Delete: `packages/dtx-api/src/services/magicLink.ts`
- Delete: `packages/dtx-api/src/services/magicLink.test.ts`
- Delete: `packages/dtx-api/src/schema/auth.ts`
- Delete: `packages/dtx-api/src/schema/auth.test.ts`
- Modify: `packages/dtx-api/src/schema/index.ts`
- Delete: `packages/dtx-web/src/lib/api/operations/auth.graphql`
- Delete: `packages/dtx-web/src/lib/api/auth.ts`
- Delete: `packages/dtx-web/src/lib/api/auth.test.ts`
- Modify/regenerate: `packages/dtx-web/src/lib/api/generated/graphql.ts`
- Rewrite: `packages/dtx-web/src/routes/(app)/app/+page.svelte`
- Modify: `packages/dtx-web/src/routes/(app)/app/app-page.test.ts`
- Delete: `packages/dtx-web/src/routes/(app)/app/app-page-redirect.test.ts`
- Modify: `packages/dtx-api/package.json`

- [ ] **Step 1: Change schema expectations first.**

Assert `generateMagicLink` disappears, remove schema registration, regenerate GraphQL schema/client output.

- [ ] **Step 2: Remove server magic-link code.**

Delete service, mutation, tests, magic-link service-role usage, callback allowlist, magic-link KV keys, and local `MAGIC_LINK_HOURLY_LIMIT` override.

Keep `RATE_LIMIT_API` because downloads still use it.

- [ ] **Step 3: Remove `/app?redirect=desktop` UI handoff.**

Remove magic-link generation and callback URL forwarding from the dashboard. Do not add Device Authorization here; Task 9 adds `/app/desktop-auth`.

- [ ] **Step 4: Verify and commit.**

```bash
bun run --filter=dtx-api gen-schema
bun run --filter=dtx-web codegen
bun run --filter=dtx-api test
bun run --filter=dtx-web test
bun run --filter=dtx-api check
bun run --filter=dtx-web check
```

Commit server/schema/generated-web removals together.

---

