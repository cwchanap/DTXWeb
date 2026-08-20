## Task 13: Remove Supabase residue and obsolete typegen

**Files:**

- Modify: root `package.json`
- Modify: `turbo.json`
- Modify: `packages/dtx-api/package.json`
- Modify: `packages/dtx-web/package.json`
- Modify: `packages/dtx-desktop/package.json`
- Modify: `packages/common/package.json`
- Modify: `bun.lock`
- Delete: `packages/common/src/lib/types/supabase.types.ts`
- Modify: `packages/common/src/lib/index.ts`
- Modify: `packages/dtx-web/.env.types-only`
- Modify: `packages/dtx-web/vitest.config.ts`
- Modify: `packages/dtx-desktop/vitest.config.ts`
- Modify: `.env.example`
- Modify affected mocks/tests/workflows
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run residue gate before edits.**

```bash
rg -n -i "@supabase|supabase|PUBLIC_SUPABASE|SUPABASE_" \
  packages package.json turbo.json .env.example CLAUDE.md __mocks__ .github
```

Historical migration docs and the one-shot import tool may describe Supabase as an input format; runtime/config/tests may not depend on it.

- [ ] **Step 2: Remove packages/types/mocks.**

Remove `@supabase/ssr`, `@supabase/supabase-js`, common peer dependency, generated Supabase types/exports, and provider mocks.

- [ ] **Step 3: Remove environment/workflow residue.**

Delete Supabase URL/anon/service-role variables, magic-link limit, callback vars, Turbo env entries, and old E2E secret requirements.

- [ ] **Step 4: Delete obsolete root typegen.**

Remove:

```text
package.json scripts.gen-types
turbo.json tasks.gen-types
```

Keep API GraphQL schema generation, dtx-web codegen, and root `gen:native-types`.

- [ ] **Step 5: Verify and commit.**

Run residue gate, lockfile/install check, all package typechecks, and unit tests.

---

