# HPA-613 Affected CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Reduce ready-PR GitHub Actions cost while preserving deterministic required checks, repo-wide lint/format coverage, Codecov policy, and current release behavior.

**Sequence:** PR A low-risk savings -> measure -> PR B required-check gates -> PR C CodeQL language selection. The measurement checkpoint can justify revising HPA-613, but PR A alone does not satisfy the current ticket.

## Global constraints

- Required GitHub Actions contexts stay `test` and `lint-and-format`.
- Never add event-level PR `paths` to `unit-test.yml` or `lint-and-format.yml`.
- Rename the Playwright check before path-filtering it; unit and Playwright currently both publish `test`.
- Root `bun run test:coverage` remains all-or-nothing.
- `lint-and-format` always runs install, ESLint, and Prettier.
- Detector failures run more validation, never less.
- Use merge-base changed-file semantics.
- Treat `turbo ls --output=json` as experimental: exact version, tests, real execution, fail-open.
- Keep Codecov project/patch targets at 90% and `threshold: 0%`.
- HPA-613 explicitly requires Codecov uploader failures to be informational, so use `fail_ci_if_error: false`.
- Preserve `preview`, `main`, `v*`, and `workflow_dispatch` packaging/release paths.
- Keep CodeQL full on `main`/schedule and preserve `build-mode: none`.

---

# PR A — low-risk savings first

## A1. Disambiguate the Playwright check

**Modify:** `.github/workflows/e2e-test.yml`

- [ ] Add `name: playwright` to `jobs.test`.
- [ ] Keep the unit job unchanged so it continues publishing `test`.
- [ ] Run `actionlint .github/workflows/e2e-test.yml`.
- [ ] On one ready PR verify GitHub shows `test` from `Run Unit Tests` and `playwright` from `Playwright Tests`.
- [ ] Confirm the ruleset still requires only `test` and `lint-and-format`.

Commit: `ci: disambiguate playwright check`

## A2. Remove ordinary PR packaging

**Modify:** `.github/workflows/desktop-build-deploy.yml`

- [ ] Remove the `pull_request` trigger.
- [ ] Remove PR-only unsigned packaging branches/conditions.
- [ ] Keep `preview`, `main`, `v*`, `workflow_dispatch`, signing, and deployment behavior.
- [ ] Do not add a replacement packaging workflow.
- [ ] Document the accepted risk: Windows/macOS packaging failures may first appear after merge; use `workflow_dispatch` before merge for risky packaging changes.
- [ ] Run `actionlint` and grep the retained triggers.

Commit: `ci: stop packaging desktop apps on pull requests`

## A3. Path-filter non-required validation

**Modify:**
- `.github/workflows/e2e-test.yml`
- `.github/workflows/desktop-e2e-test.yml`
- `.github/workflows/tauri-rust-ci.yml`

### Web E2E PR paths

Include at least:

```yaml
- 'packages/dtx-web/**'
- 'packages/dtx-api/**'
- 'packages/common/**'
- 'packages/ui-components/**'
- 'packages/e2e-web/**'
- 'supabase/**'
- '.github/workflows/e2e-test.yml'
- 'package.json'
- 'bun.lock'
- 'turbo.json'
- 'tsconfig.base.json'
```

Keep push behavior full.

### Desktop E2E

- [ ] Keep the existing shared-package filters.
- [ ] Add `tsconfig.base.json` to the existing path lists.

### Tauri Rust PR paths

Use only:

```yaml
- 'packages/dtx-desktop/**'
- 'packages/e2e-desktop/**'
- '.github/workflows/tauri-rust-ci.yml'
- 'package.json'
- 'bun.lock'
- 'turbo.json'
```

Do not add `packages/common/**` or `packages/ui-components/**` solely because desktop E2E needs them.

- [ ] Run `actionlint` on all three workflows.

Commit: `ci: filter non-required validation by affected paths`

## A4. Fix shared TypeScript invalidation

**Modify:** `turbo.json`

- [ ] Add `tsconfig.base.json` to `globalDependencies`.
- [ ] Do **not** add `.eslintrc.cjs`, `.prettierrc`, `.eslintignore`, or `.prettierignore` merely to force unit coverage; ESLint/Prettier are unconditional.

Commit: `ci: include shared tsconfig in turbo invalidation`

## A5. Add CodeQL's cheap PR source filter

**Modify:** `.github/workflows/codeql.yml`

- [ ] Keep `main` and schedule unchanged.
- [ ] Add PR `paths` for workflow files plus JS/TS/Svelte, `scripts/**/*.py`, and desktop Rust source.
- [ ] Do not change the language matrix yet.
- [ ] Run `actionlint`.

Commit: `ci: skip codeql for non-source pull requests`

## A6. Add Codecov flags + carryforward

**Modify:**
- `codecov.yml`
- `.github/workflows/unit-test.yml`
- `.github/workflows/tauri-rust-ci.yml`
- `.github/workflows/desktop-e2e-test.yml`

- [ ] Keep 90% project/patch targets unchanged.
- [ ] Define carryforward flags `typescript`, `tauri-rust`, and `desktop-e2e-rust`.
- [ ] Pass the matching flag from each upload action.
- [ ] Use `fail_ci_if_error: false` on all three uploads because HPA-613 explicitly asks transport failures to be informational.
- [ ] Update comments so Codecov is described as coverage reporting/policy, not a branch-protection gate.
- [ ] Run `actionlint` and grep the flags/targets.

Commit: `ci: carry forward partial coverage streams`

## A7. Measure before adding detector machinery

- [ ] Compare workflow duration/usage for docs-only, web-only, desktop-renderer, desktop-Rust, and shared/common PRs.
- [ ] Record the observed savings in the implementation PR or HPA-613 comment.

Expected after PR A:

| Change | Result |
| --- | --- |
| docs only | required unit/lint still full; packaging/E2E/Rust/CodeQL skip |
| web-only | web E2E runs; desktop/Rust/packaging skip |
| desktop renderer | desktop E2E + Rust CI run; web E2E skips unless shared/web input changed |
| desktop Rust | Rust CI + desktop E2E run; packaging skips |
| common/shared | web E2E + desktop E2E run; Rust CI stays skipped without native changes |

**Decision rule:** measurement can justify editing HPA-613, but do not silently mark the issue done. As written, the ticket still requires cheap docs-only required jobs and relevant-language PR CodeQL.

---

# PR B — required-check gates

## B1. Add one tested fail-open detector

**Create:**
- `.github/scripts/ci-affected-scope.sh`
- `.github/scripts/ci-affected-scope.test.sh`
- minimal Turbo JSON fixtures under `.github/scripts/fixtures/`

Initial modes:

- `unit` -> stdout exactly `true`/`false`
- `lint` -> stdout exactly `true`/`false`

Rules:

- [ ] Require `TURBO_SCM_BASE` and `TURBO_SCM_HEAD`.
- [ ] Changed files use:

```bash
git diff --name-only --merge-base "$TURBO_SCM_BASE" "$TURBO_SCM_HEAD"
```

- [ ] Run the exact initial tool version:

```bash
bunx turbo@2.10.9 ls --affected --output=json
```

- [ ] Record the live JSON shape, parse `packages.items`, and validate `packages.count`.
- [ ] Unexpected JSON/Git/Turbo/jq errors exit non-zero.
- [ ] When Turborepo is intentionally upgraded, update the explicit version and fixture/test together.

Checked-in test cases:

- web affected -> `unit=true`
- empty affected -> `unit=false`, `lint=false`
- E2E-only -> `unit=false`, `lint=true`
- malformed JSON -> non-zero
- invalid refs -> wrapper runs full validation
- `tsconfig.base.json` -> full/affected behavior through Turbo global invalidation
- merge-base comparison excludes unrelated commits added to base after branch-off

- [ ] Run `bash -n` on both scripts.
- [ ] Run `.github/scripts/ci-affected-scope.test.sh`.
- [ ] Run the real detector once against an actual base/head pair before wiring required checks.

Commit: `ci: add tested affected scope detector`

## B2. Gate root unit coverage

**Modify:** `.github/workflows/unit-test.yml`

- [ ] Keep job id `test`; no PR `paths`.
- [ ] Checkout with `fetch-depth: 0`.
- [ ] After Bun setup, call `ci-affected-scope.sh unit` for PRs.
- [ ] Script failure -> `run_expensive=true`.
- [ ] Pushes to `main`/`master` -> `run_expensive=true`.
- [ ] Gate the existing install/preparation/root coverage/TypeScript Codecov steps.
- [ ] Do not split `bun run test:coverage`.
- [ ] Verify a docs-only PR still publishes a successful `test` context.

Commit: `ci: skip root coverage when unaffected`

## B3. Gate only heavy lint/codegen work

**Modify:** `.github/workflows/lint-and-format.yml`

- [ ] Keep job id `lint-and-format`; no PR `paths`.
- [ ] Checkout with `fetch-depth: 0`.
- [ ] Always run install, `.github/scripts/ci-affected-scope.test.sh`, ESLint, and Prettier.
- [ ] Call `ci-affected-scope.sh lint` for PRs.
- [ ] Script failure -> run the full heavy block.
- [ ] Gate only SvelteKit/common prep, common build, GraphQL schema/drift, generated client verification, and E2E typechecks.
- [ ] Keep push behavior full.
- [ ] Verify docs-only skips the heavy block but still runs the always-on tier.

Commit: `ci: gate generated lint work by affected scope`

## B4. Prove fail-open behavior

Before merging PR B:

- [ ] malformed Turbo output -> full unit/lint work
- [ ] invalid Git refs -> full unit/lint work
- [ ] real web change -> `unit=true`
- [ ] real docs-only change -> `unit=false`, `lint=false`
- [ ] the checked-in detector regression test runs in `lint-and-format`
- [ ] `actionlint` passes, but is not treated as detector proof

---

# PR C — CodeQL relevant-language selection

## C1. Extend the proven detector

**Modify:** both scope scripts.

Add `codeql` mode mapping:

- `.github/workflows/**` -> `actions`
- JS/TS/Svelte source/config -> `javascript-typescript`
- `scripts/**/*.py` -> `python`
- `packages/dtx-desktop/src-tauri/**/*.rs` -> `rust`

- [ ] Reuse the same merge-base changed-file list.
- [ ] Detector/mapping failure -> all four languages.
- [ ] Add single-language and mixed-language tests.

Commit: `ci: add codeql language scope mode`

## C2. Wire CodeQL without dropping build mode

**Modify:** `.github/workflows/codeql.yml`

- [ ] Add a selector job that calls the shared script for PRs; main/schedule return all four languages.
- [ ] Replace only the language matrix source.
- [ ] If using a flat language array, hardcode CodeQL init:

```yaml
with:
  languages: ${{ matrix.language }}
  build-mode: none
```

Do not leave `build-mode: ${{ matrix.build-mode }}` after removing the current `matrix.include` structure.

- [ ] Verify a Rust-only PR runs Rust CodeQL with `build-mode: none`, not autobuild.
- [ ] Verify mixed workflow + TypeScript changes select only `actions` and `javascript-typescript`.
- [ ] Verify main/schedule remain all-language scans.
- [ ] Run `actionlint` and the scope regression test.

Commit: `ci: scope codeql by changed language`

---

# Final documentation and verification

## D1. Update `CLAUDE.md`

Document the final matrix and invariants:

| Change | Unit | ESLint/Prettier | Heavy lint | Web E2E | Desktop E2E | Rust CI | Packaging | CodeQL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs only | skip | run | skip | skip | skip | skip | skip | skip |
| web/API | run | run | run | run | skip | skip | skip | JS/TS |
| common/ui | run | run | run | run | run | skip | skip | JS/TS |
| desktop renderer | run | run | run | skip | run | run | skip | JS/TS |
| desktop Rust | run | run | run | skip | run | run | skip | Rust |
| `tsconfig.base.json` | run | run | run | run | run | skip | skip | JS/TS |

Also document:

- required `test` belongs to the unit workflow;
- Playwright check is `playwright`;
- required workflows are never event-level path-skipped;
- detector errors fail open;
- Codecov upload transport is informational by ticket design;
- manual packaging is available for risky pre-merge desktop changes.

## D2. Final evidence

- [ ] `actionlint` all changed workflows.
- [ ] Run `.github/scripts/ci-affected-scope.test.sh`.
- [ ] Run one real detector base/head comparison.
- [ ] Verify the active ruleset still requires `test` and `lint-and-format`.
- [ ] Verify one ready PR has exactly the intended `test` and `playwright` checks.
- [ ] Verify Rust CodeQL stays `build-mode: none`.
- [ ] Verify `preview`, `main`, `v*`, and `workflow_dispatch` packaging paths remain.
- [ ] Verify 90% Codecov targets plus all three carryforward flags and informational uploader behavior.
- [ ] Record observed workflow usage after the full change.

## Definition of done

HPA-613 is complete when the final affected-area behavior is implemented and verified. If PR A's measurement shows PR B/C are not worth maintaining, change the Linear issue scope/acceptance criteria explicitly before stopping.
