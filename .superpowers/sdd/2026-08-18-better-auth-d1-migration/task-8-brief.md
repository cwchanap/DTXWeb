## Task 8: Convert every web API call from Bearer to cookies

**Files:**

- Modify: `packages/dtx-web/src/lib/api/transport.ts`
- Modify: `packages/dtx-web/src/lib/api/transport.test.ts`
- Modify: `packages/dtx-web/src/lib/api/client.ts`
- Modify: `packages/dtx-web/src/lib/api/client.test.ts`
- Modify: `packages/dtx-web/src/lib/api/download.ts`
- Modify: `packages/dtx-web/src/lib/api/download.test.ts`
- Modify: `packages/dtx-web/src/lib/api/index.test.ts`
- Modify token-mocking tests including `chart.test.ts`, `score.test.ts`, `user.test.ts`
- Modify affected bulk-download component/helper tests
- Delete only at end: `packages/dtx-web/src/lib/api/token.ts`
- Delete only at end: `packages/dtx-web/src/lib/api/token.test.ts`

- [ ] **Step 1: Add browser GraphQL tests.**

Assert browser GraphQL uses `credentials: 'include'` and no Authorization header.

- [ ] **Step 2: Replace token-shaped `ClientCtx`.**

```ts
export type ClientCtx = {
  fetch?: typeof fetch;
  platform?: App.Platform;
  cookieHeader?: string | null;
  origin?: string | null;
};
```

- [ ] **Step 3: Rewrite service-binding GraphQL.**

Forward:

```text
content-type: application/json
cookie: <incoming cookie>
origin: <canonical DTX web origin>
```

The Origin must be the external trusted web origin, not an internal service-binding URL.

- [ ] **Step 4: Rewrite download helpers.**

`downloadSimfile()` fetches with `credentials: 'include'`. `bulkDownloadHeaders()` stops adding Bearer; the actual bulk fetch also sets `credentials: 'include'`.

- [ ] **Step 5: Remove all token mocks/imports before deleting helper.**

```bash
rg -n "getAccessTokenOrNull|getAccessToken|tokenFromSession|from './token'|mock.*token" packages/dtx-web/src
```

Delete `token.ts` only after the search is clean.

- [ ] **Step 6: Verify and commit.**

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-web check
```

---

