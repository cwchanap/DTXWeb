# HPA-613 Affected CI Design

## Summary

Reduce ready-PR CI cost and feedback time without replacing the repository's current GitHub Actions structure.

The implementation should be staged by risk:

1. **PR A — low-risk savings first:** disambiguate the required `test` check, remove ordinary PR packaging, add native path filters to non-required workflows, add CodeQL's cheap PR source filter, add Codecov flags/carryforward, and teach Turborepo about the shared TypeScript config.
2. **Measure:** inspect the actual workflow-minute/cost reduction from PR A before adding required-check routing machinery.
3. **PR B — required-check gates:** add one tested fail-open affected-scope script for the required unit and lint jobs.
4. **PR C — CodeQL language selection:** extend the already-proven scope seam to select PR CodeQL languages while preserving `build-mode: none`.

The measurement checkpoint changes implementation order, not the HPA-613 definition of done. PR A alone does not satisfy the ticket's docs-only required-job or per-language CodeQL scope. If measurement shows PR B/C are no longer worth doing, revise HPA-613 explicitly rather than silently declaring the ticket complete.

This remains a CI-routing change, not a new CI framework, dependency-graph service, or workflow consolidation.

Linear: HPA-613

## Verified repository constraints

### Required contexts are exactly `test` and `lint-and-format`

The active `Main` ruleset requires these GitHub Actions contexts:

- `test`
- `lint-and-format`

Neither required workflow may use event-level `pull_request.paths`, because a skipped workflow may never create the context branch protection is waiting for.

### There are currently two GitHub Actions check runs named `test`

Both workflows use a job id of `test` with no explicit job `name`:

- `.github/workflows/unit-test.yml`
- `.github/workflows/e2e-test.yml`

GitHub therefore publishes two check runs named `test` from the same GitHub Actions integration. Before adding paths to Playwright, PR A must give the Playwright job an explicit stable name such as `playwright` and verify on one ready PR that:

- the unit workflow still publishes `test`;
- the Playwright workflow publishes `playwright`;
- the ruleset's required `test` resolves to the unit workflow.

No ruleset edit is needed.

### Root unit coverage stays all-or-nothing

`unit-test.yml` runs root `bun run test:coverage`. HPA-613 does not split that command into package-specific coverage jobs.

The future gate is binary:

- relevant coverage-producing workspace/config changed -> run the existing root coverage command;
- otherwise -> preserve the required `test` context but skip the expensive coverage stack.

### Repo lint/format stays unconditional

`lint-and-format.yml` mixes repo-wide formatting/lint checks with generated/schema/typecheck work.

Always run on ready PRs:

- `bun install --frozen-lockfile`;
- repository ESLint;
- repository Prettier.

Only the heavier workspace/generated block may be gated:

- SvelteKit/common preparation;
- GraphQL schema generation and drift verification;
- generated web client verification;
- web and desktop E2E typechecks.

A docs-only PR still needs the repo-wide Prettier check.

### Turborepo already owns workspace invalidation

Use Turborepo's affected-package graph rather than adding a package dependency map.

`turbo.json` already has `globalDependencies`, but it currently omits `tsconfig.base.json`. That is a real invalidation hole because the shared TypeScript config can change typechecking/build behavior while producing an empty affected package set.

Add `tsconfig.base.json` to `globalDependencies`.

Do **not** add `.eslintrc.cjs`, `.prettierrc`, `.eslintignore`, or `.prettierignore` merely to force unit coverage. ESLint and Prettier remain unconditional, and those files do not justify rerunning the root coverage stack.

### Codecov is reporting policy, not branch protection

The active branch ruleset does not require Codecov statuses. However, HPA-613 explicitly requires uploader failures to be informational rather than turning a green test suite red.

Therefore:

- keep the existing 90% project/patch targets;
- add named flags and carryforward for suites that are intentionally skipped;
- set `fail_ci_if_error: false` as required by HPA-613;
- document the accepted risk that a transport failure can leave Codecov showing carried-forward coverage until a later successful upload.

## Reuse decisions

| Proposed work                   | Decision                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Affected workspace calculation  | Reuse Turborepo `turbo ls --affected --output=json`                                 |
| Root config invalidation        | Extend existing `turbo.json` `globalDependencies` with `tsconfig.base.json`         |
| Non-required workflow filtering | Reuse native `pull_request.paths`; desktop E2E already demonstrates the pattern     |
| Root unit coverage              | Reuse `bun run test:coverage`; do not split                                         |
| Required-job routing            | New only if PR B proceeds: one small `.github/scripts/ci-affected-scope.sh`         |
| Scope regression coverage       | New only with PR B: `.github/scripts/ci-affected-scope.test.sh` plus small fixtures |
| Packaging reduction             | Reuse existing release triggers; delete ordinary PR packaging branches              |
| CodeQL                          | PR A uses native `paths`; PR C adds language selection using the proven scope seam  |
| Coverage aggregation            | Extend existing three Codecov uploads with flags/carryforward                       |

## Goals

- Preserve deterministic required-check behavior.
- Take the highest-value, lowest-risk CI savings first.
- Stop Windows/macOS packaging on ordinary PRs while preserving release behavior.
- Skip unrelated web E2E and Rust CI through native path filters.
- Keep docs formatting guarded on every ready PR.
- Eventually make docs-only PRs skip full unit coverage and generated/schema/typecheck work.
- Keep all detector failures conservative: run more CI rather than silently less.
- Keep CodeQL full on `main`/schedule and relevant-language-only on PRs.
- Keep Codecov's 90% policy compatible with intentionally partial suite execution.

## Non-goals

- No monolithic `ci.yml`.
- No external classifier service.
- No handwritten dependency graph.
- No remote Turborepo cache project.
- No package-by-package rewrite of root coverage.
- No coverage-threshold change.
- No general release workflow rewrite.
- No product/application code changes.

## Chosen architecture

## PR A — low-risk savings first

PR A contains no custom changed-file script.

### 1. Disambiguate Playwright from the required `test` check

In `.github/workflows/e2e-test.yml`, keep job id `test` if desired, but add:

```yaml
name: playwright
```

Do this before adding PR paths.

Verify on one ready PR that GitHub publishes exactly one GitHub Actions check named `test` from `Run Unit Tests` and one named `playwright` from `Playwright Tests`.

### 2. Remove ordinary PR packaging

Remove the `pull_request` trigger from `.github/workflows/desktop-build-deploy.yml` and delete PR-only unsigned packaging branches.

Preserve:

- push to `preview`;
- push to `main`;
- `v*` tags;
- `workflow_dispatch`;
- signed release/deploy behavior.

No replacement cross-platform packaging job is added.

### 3. Add native path filters to non-required workflows

#### Web E2E

Run PR Playwright only for web/API/shared/E2E-web inputs and the small root config set that can affect the web test stack.

At minimum:

- `packages/dtx-web/**`
- `packages/dtx-api/**`
- `packages/common/**`
- `packages/ui-components/**`
- `packages/e2e-web/**`
- `supabase/**`
- `.github/workflows/e2e-test.yml`
- `package.json`
- `bun.lock`
- `turbo.json`
- `tsconfig.base.json`

Keep push-to-main behavior unchanged.

#### Desktop E2E

Keep the existing path-filter model and shared package triggers. Add `tsconfig.base.json` because the desktop E2E TypeScript surfaces inherit shared compiler behavior.

#### Tauri Rust CI

Use a narrower PR path list:

- `packages/dtx-desktop/**`
- `packages/e2e-desktop/**`
- `.github/workflows/tauri-rust-ci.yml`
- `package.json`
- `bun.lock`
- `turbo.json`

Do not add `packages/common/**` or `packages/ui-components/**` solely because desktop E2E needs them. Rust CI's checked generated-contract outputs live under desktop/E2E-desktop; shared renderer behavior is covered by desktop E2E.

### 4. Add CodeQL's cheap PR source filter

Keep push-to-main and schedule unchanged.

Under `pull_request.paths`, include only source/workflow paths that can map to one of the four current CodeQL languages. This removes docs-only CodeQL immediately without adding a selector job.

Per-language selection remains for PR C because HPA-613 explicitly requires it.

### 5. Add Codecov flags and carryforward

Define three streams:

- `typescript`
- `tauri-rust`
- `desktop-e2e-rust`

Set `carryforward: true` for each and pass the matching `flags:` value from each existing upload action.

Keep:

```yaml
fail_ci_if_error: false
```

This is an explicit HPA-613 requirement. Do not present Codecov as a branch-protection gate; it is coverage reporting/policy hygiene.

### 6. Add the real shared-config invalidation input

Add only `tsconfig.base.json` to `turbo.json` `globalDependencies` in this slice.

This makes a shared TypeScript compiler change affect the workspace graph used later by PR B and also improves normal Turborepo cache invalidation.

## Measurement checkpoint

After PR A lands, inspect several representative ready PRs and GitHub Actions usage:

- docs-only;
- web-only;
- desktop renderer-only;
- desktop Rust;
- shared/common.

Record whether the expensive packaging/E2E reductions already produce the expected cost improvement.

This checkpoint can justify revising HPA-613, but it does not by itself remove PR B/C from the current ticket. As currently written, HPA-613 still requires cheap required-job behavior for docs-only PRs and relevant-language PR CodeQL.

## PR B — tested required-check gates

Only after the low-risk savings are established, add one new detector seam for the two required workflows.

### Script contract

Create `.github/scripts/ci-affected-scope.sh` with only two initial modes:

- `unit` -> stdout exactly `true` or `false`;
- `lint` -> stdout exactly `true` or `false`.

Diagnostics go to stderr.

The script:

1. requires `TURBO_SCM_BASE` and `TURBO_SCM_HEAD`;
2. gets changed files with merge-base semantics:

```bash
git diff --name-only --merge-base "$TURBO_SCM_BASE" "$TURBO_SCM_HEAD"
```

3. runs the exact Turborepo version the implementation is written against, initially:

```bash
bunx turbo@2.10.9 ls --affected --output=json
```

4. validates the live JSON shape before consuming `packages.items`;
5. validates the package count;
6. applies only the small unit/lint decisions.

Any missing ref, Git failure, Turbo failure, unexpected JSON, jq failure, or wrapper failure exits non-zero. Workflow wrappers convert any error to `run_expensive=true`.

`--output=json` is treated as an experimental contract: pin it, test it, and fail open.

When the repo intentionally upgrades Turborepo, update the explicit script version and recorded fixture/test in the same change.

### Checked-in regression test

Create `.github/scripts/ci-affected-scope.test.sh` plus minimal recorded fixtures.

The test covers at least:

- web workspace affected -> `unit=true`;
- empty affected set -> `unit=false`, `lint=false`;
- shared `tsconfig.base.json` change -> affected/full behavior;
- E2E-only change -> unit false, lint true where E2E typechecking is required;
- malformed JSON -> non-zero;
- Git/detector failure -> wrapper chooses full validation;
- merge-base changed-file behavior.

Run this test from the always-on tier of `lint-and-format` so a parser regression cannot silently turn into a green skipped required check.

Also execute the script once against a real base/head pair before accepting the implementation PR. `actionlint` alone is not proof of detector correctness.

### Required unit job

Keep job id `test` and no event-level paths.

For PRs, call the script and gate only the existing expensive unit stack. On detection failure, run full coverage.

Pushes to `main`/`master` keep full behavior.

Do not split `bun run test:coverage`.

### Required lint job

Keep job id `lint-and-format` and no event-level paths.

Always run:

- dependency installation;
- scope regression test;
- ESLint;
- Prettier.

Gate only the SvelteKit/common/schema/codegen/E2E-typecheck block. On detection failure, run that block.

## PR C — relevant-language PR CodeQL

After PR B proves the shared Git/path seam, add `codeql` mode rather than a second selector implementation.

### Mapping

- `.github/workflows/**` -> `actions`
- JS/TS/Svelte source/config -> `javascript-typescript`
- `scripts/**/*.py` -> `python`
- `packages/dtx-desktop/src-tauri/**/*.rs` -> `rust`

Unexpected or empty mapping after the workflow has triggered -> all four languages.

### Preserve build mode

The current CodeQL matrix sets `build-mode: none` for every language. A flat language array must not accidentally drop that behavior.

Keep the selector output simple and hardcode:

```yaml
with:
    languages: ${{ matrix.language }}
    build-mode: none
```

Do not rely on `matrix.build-mode` after replacing the current `matrix.include` shape.

Pushes to `main` and scheduled runs always analyze all four languages.

## Error handling

Scope reduction is an optimization, never a correctness dependency.

PR B/C detector failures are conservative:

- missing refs -> full relevant validation;
- merge-base/diff failure -> full relevant validation;
- Turbo failure -> full unit/lint validation;
- malformed/unexpected Turbo JSON -> full unit/lint validation;
- jq failure -> full relevant validation;
- CodeQL mapping failure -> all four languages.

Codecov is intentionally different: HPA-613 requires upload transport failure to be informational. That can temporarily leave carried-forward coverage visible for a commit; the test suite result remains authoritative for CI success.

## Risks and accepted tradeoffs

### Required `test` context ambiguity

**Risk:** Playwright and unit jobs currently publish the same `test` check name; path-filtering Playwright first could make branch protection ambiguous.

**Mitigation:** rename the Playwright check in PR A before any filter and verify the resulting check runs on a ready PR.

### Cross-platform packaging regressions move later

**Risk:** removing ordinary PR packaging means a Windows/macOS packaging failure may first appear after merge on the continuous `main` release channel.

**Accepted tradeoff:** this repository favors CI cost and iteration speed. For a risky desktop packaging change, use the retained `workflow_dispatch` path before merge.

### Experimental Turbo JSON dependency

**Risk:** `turbo ls --output=json` is experimental and its schema may change.

**Mitigation:** exact tool version, live recorded fixture, checked-in parser regression test, one real base/head execution, and fail-open wrappers.

### Informational Codecov upload can carry stale data

**Risk:** if an upload itself fails while `carryforward: true` is enabled, Codecov can continue showing an older flag's coverage.

**Accepted tradeoff:** HPA-613 explicitly asks uploader failures not to fail an otherwise green suite. Coverage thresholds remain unchanged, and later successful uploads refresh the flag.

## Verification

### PR A

- `actionlint` every changed workflow.
- Verify one ready PR publishes `test` from `Run Unit Tests` and `playwright` from `Playwright Tests`.
- Verify ruleset still requires only `test` and `lint-and-format`.
- Verify docs-only no longer starts packaging, web E2E, Rust CI, or CodeQL.
- Verify `preview`, `main`, tag, and manual packaging entry points remain.
- Verify all three Codecov streams carry the intended flags and retain the 90% targets.

### PR B

- `bash -n` both scope scripts.
- Run `.github/scripts/ci-affected-scope.test.sh` locally and in always-on lint CI.
- Run the detector against one real PR base/head.
- Verify invalid refs and malformed JSON produce full-validation behavior.
- Verify `test` and `lint-and-format` remain stable required contexts.

### PR C

- `actionlint` CodeQL workflow.
- Fixture-check each language mapping and mixed-language mapping.
- Verify Rust PR analysis still uses `build-mode: none`.
- Verify main/schedule remain all-language scans.

## Resulting ready-PR matrix after all HPA-613 phases

| Change               | Unit coverage | ESLint/Prettier | Heavy lint/codegen | Web E2E | Desktop E2E | Rust CI | Packaging | CodeQL                    |
| -------------------- | ------------- | --------------- | ------------------ | ------- | ----------- | ------- | --------- | ------------------------- |
| docs only            | skip          | run             | skip               | skip    | skip        | skip    | skip      | skip                      |
| `dtx-web`            | run           | run             | run                | run     | skip        | skip    | skip      | JS/TS                     |
| `dtx-api`            | run           | run             | run                | run     | skip        | skip    | skip      | JS/TS                     |
| `common`             | run           | run             | run                | run     | run         | skip    | skip      | JS/TS                     |
| `ui-components`      | run           | run             | run                | run     | run         | skip    | skip      | JS/TS                     |
| desktop renderer     | run           | run             | run                | skip    | run         | run     | skip      | JS/TS                     |
| desktop Rust         | run           | run             | run                | skip    | run         | run     | skip      | Rust                      |
| web E2E only         | skip          | run             | run                | run     | skip        | skip    | skip      | JS/TS when source matches |
| desktop E2E only     | skip          | run             | run                | skip    | run         | run     | skip      | JS/TS when source matches |
| `tsconfig.base.json` | run           | run             | run                | run     | run         | skip    | skip      | JS/TS                     |

## Decision

Ship HPA-613 in risk order rather than implementation-complexity order.

The expensive non-required workflows should be reduced first. The required-check detector remains in scope because the ticket explicitly asks docs-only PRs to run only cheap repository checks; it simply should not be the first thing merged. CodeQL language selection remains in scope for the same reason: it is an explicit HPA-613 requirement, but it comes after the shared detector seam is proven.
