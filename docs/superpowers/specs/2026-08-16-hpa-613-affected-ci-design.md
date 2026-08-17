# HPA-613 Affected CI Design

## Summary

Reduce ready-PR CI cost and feedback time without replacing the repository's current GitHub Actions structure.

Use the repository's existing seams:

- keep the two required status-check jobs (`test` and `lint-and-format`) present on every non-draft PR;
- put one small, tested fail-open scope script under `.github/scripts/` so the required jobs and CodeQL do not each grow their own Bash classifier;
- use Turborepo's affected workspace graph for package-aware decisions;
- keep repo-wide formatting and ESLint on every ready PR, while gating only the expensive generated/schema/typecheck portion of `lint-and-format`;
- use native `pull_request.paths` filters for non-required web E2E, desktop E2E, and Tauri Rust workflows;
- remove ordinary pull-request packaging from the Windows/macOS build workflow while preserving `preview`, `main`, release-tag, and manual release behavior;
- keep CodeQL full on `main` and its weekly schedule, but on pull requests select only languages touched by relevant source/workflow paths;
- flag the three Codecov upload streams and enable carryforward so partial CI runs keep the existing 90% coverage policy meaningful;
- make Codecov uploader/service failures non-blocking without weakening project or patch targets.

This is deliberately a CI-routing change, not a new CI framework, dependency-graph service, or workflow consolidation.

Linear: HPA-613

## Why HPA-613 is the next slice

HPA-613 is unblocked and is the current medium-priority DTXWeb backlog item. It targets repeated runner cost on ready PRs without changing product behavior.

The repository already has the pieces needed for a small solution:

- Turborepo already owns the workspace dependency graph;
- `desktop-e2e-test.yml` already demonstrates native GitHub Actions path filtering;
- the active `Main` ruleset requires only the `test` and `lint-and-format` contexts;
- draft PR jobs are already skipped;
- release/deploy workflows already distinguish PR, `preview`, `main`, tag, and manual behavior.

The design should extend those seams rather than add a CI platform.

## Current problem

### Required jobs cannot be path-skipped at the workflow event

The active `Main` ruleset requires exactly:

- `test`
- `lint-and-format`

If either required workflow is excluded at the `pull_request` event through `paths`, GitHub may never create the required context for the PR. Therefore both workflows must continue to start for ready PRs and finish successfully even when their expensive work is unnecessary.

### Unit coverage currently means the whole Turborepo coverage task

`unit-test.yml` runs root `bun run test:coverage`, which is one Turborepo task over every workspace that defines `test:coverage`.

HPA-613 does not split that command package-by-package. The gate is binary:

- relevant coverage-producing workspace/config changed -> run the existing root coverage command;
- no relevant workspace/config changed -> skip dependency installation, tests, and upload while preserving the `test` job context.

The five coverage-producing workspaces are:

- `@dtx/common`
- `@dtx/ui-components`
- `dtx-web`
- `dtx-api`
- `dtx-desktop`

Changes only to `dtx-e2e-web` or `dtx-e2e-desktop` do not make the root unit coverage task useful.

### Lint is not one all-or-nothing expense

`lint-and-format.yml` mixes two kinds of work.

Repository-wide checks:

- `bun install --frozen-lockfile`
- ESLint
- Prettier

Workspace/generated checks:

- SvelteKit/common build preparation
- GraphQL schema generation
- generated web client drift verification
- web and desktop E2E package typechecks

A docs-only PR still needs Prettier because Markdown is included by the repo-wide format check. Skipping the entire lint job would allow formatting failures to merge and only surface on `main`.

Therefore `lint-and-format` always installs dependencies and runs ESLint + Prettier on a ready PR. Only the workspace/generated block is gated.

### The affected query itself is safety-critical

A green required check produced by a broken detector is worse than running too much CI.

The current plan originally duplicated scope Bash in two YAML files and did not execute it before relying on it. It also assumed the wrong `turbo ls --output=json` traversal and did not fail open if `git diff` failed.

The revised design gives the risky logic one ownership seam and requires executable verification before workflow wiring.

## Reuse decisions

| Proposed work | Existing seam |
| --- | --- |
| Affected workspace calculation | Turborepo `turbo ls --affected --output=json` |
| Comparison refs | `TURBO_SCM_BASE` / `TURBO_SCM_HEAD` with full checkout history |
| Required-job scope logic | new small `.github/scripts/ci-affected-scope.sh`; no existing equivalent |
| Web/native workflow path filtering | existing `desktop-e2e-test.yml` `paths` pattern |
| Unit coverage command | existing root `bun run test:coverage`; do not split |
| GraphQL/codegen drift | existing `lint-and-format.yml` sequence |
| Packaging reduction | existing `desktop-build-deploy.yml` event/PR branches |
| CodeQL languages | existing static four-language matrix, narrowed only on PR |
| Coverage streams | existing three Codecov upload steps, now named by flags |
| Workflow documentation | existing `CLAUDE.md` CI guidance |

## Goals

- Keep required check names deterministic.
- Make scope-detection failure conservative: run more CI, never silently less.
- Skip the full unit-coverage stack on docs-only and E2E-only changes.
- Keep repo-wide lint/format coverage on every ready PR.
- Skip generated/schema/E2E-typecheck lint work when no workspace can be affected.
- Skip web E2E for unrelated PRs.
- Skip Rust CI for changes that cannot affect Rust/native generated contracts.
- Preserve common/shared changes as triggers for desktop E2E and web validation where they matter.
- Stop Windows/macOS packaging on ordinary PRs.
- Keep CodeQL full on `main`/schedule and language-scoped on PRs.
- Keep Codecov's 90% project/patch targets while making partial suite execution compatible with coverage aggregation.
- Document a concrete affected-area matrix.

## Non-goals

- No monolithic `ci.yml`.
- No external classifier service.
- No handwritten package dependency graph.
- No remote Turborepo cache.
- No package-by-package rewrite of root `test:coverage`.
- No removal of unit, E2E, Rust, CodeQL, schema, codegen, or formatting coverage.
- No Codecov threshold change.
- No product/application code changes.
- No general release workflow rewrite.

## Chosen architecture

### 1. One small fail-open scope script

Create:

` .github/scripts/ci-affected-scope.sh`

The script has three explicit modes:

- `unit` -> prints `true` when root unit coverage must run, otherwise `false`;
- `lint` -> prints `true` when the expensive workspace/generated lint block must run, otherwise `false`;
- `codeql` -> prints a non-empty JSON array of CodeQL languages for the PR.

Diagnostics, including the raw affected-package JSON and changed-file list, go to stderr so the machine-readable stdout stays stable.

The script is intentionally not a generic rules engine. Package and path lists stay literal and close to the workflows they serve.

For `unit` and `lint` it:

1. requires `TURBO_SCM_BASE` and `TURBO_SCM_HEAD`;
2. obtains changed files with `git diff --name-only "$TURBO_SCM_BASE" "$TURBO_SCM_HEAD"`;
3. runs `bunx turbo ls --affected --output=json` using the same refs;
4. validates the JSON shape before reading package names;
5. reads names from `packages.items` and validates the reported package count;
6. applies the mode's small allowlist/force-full rules.

Any missing ref, Git failure, Turbo failure, malformed/unexpected JSON, or jq failure exits non-zero. Each workflow wrapper converts that failure to the conservative result (`true` or all CodeQL languages).

`fetch-depth: 0` is the only git-history mechanism. Do not add a second merge-base/fetch scheme.

### 2. Execute the detector before trusting it

The implementation includes recorded Turbo JSON fixtures representing:

- a web workspace affected;
- no workspace affected;
- malformed/unexpected output.

Fixture assertions verify the actual jq traversal used by the script. In addition, the script is run against one real local Git base/head pair so the checked-in Turborepo version, Git refs, and JSON parsing are exercised together.

A `packages/dtx-web/**` case must resolve `unit=true` before any YAML gate is considered complete.

### 3. Required `test` keeps one binary coverage gate

`unit-test.yml` keeps job id `test` and stays event-visible for every ready PR.

After checkout (`fetch-depth: 0`) and Bun setup, a scope step calls the shared script.

For pull requests:

- script success controls `run_expensive`;
- script failure sets `run_expensive=true`.

For pushes to `main`/`master`, `run_expensive=true` without scope reduction.

Only when `run_expensive=true` run:

- dependency installation;
- SvelteKit/common preparation;
- root `bun run test:coverage`;
- TypeScript Codecov upload.

Do not split the root coverage task into per-package test commands.

Force full unit coverage when scope infrastructure or root dependency/config files change, including the unit workflow itself, the shared scope script, `package.json`, `bun.lock`, `turbo.json`, and `codecov.yml`.

### 4. Required `lint-and-format` is two-tier

`lint-and-format.yml` keeps job id `lint-and-format` and remains event-visible.

Always on ready PRs:

- checkout;
- setup Bun;
- `bun install --frozen-lockfile`;
- repository ESLint;
- repository Prettier check.

Run the workspace/generated block when:

- any workspace package is affected; or
- root dependency/Turborepo config, lint workflow, or shared scope script changes; or
- scope detection fails.

The gated block preserves the current ordering:

1. SvelteKit/common build preparation;
2. common build;
3. API GraphQL schema generation and tracked-schema drift check;
4. generated web client verification;
5. web and desktop E2E typechecks.

This keeps docs formatting guarded without paying schema/codegen/typecheck cost on docs-only PRs.

### 5. Non-required workflows use native path filters

#### Web E2E

Add PR paths for surfaces that can affect the web stack:

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

Keep `main`/`master` push behavior full.

#### Desktop E2E

Keep the existing path-filter model. It already covers renderer/shared/E2E dependencies and should continue to trigger on `packages/common/**` and `packages/ui-components/**`.

#### Tauri Rust CI

Narrow PR paths to actual native/generated-contract inputs:

- `packages/dtx-desktop/**`
- `packages/e2e-desktop/**`
- `.github/workflows/tauri-rust-ci.yml`
- `package.json`
- `bun.lock`
- `turbo.json`

Do not add `packages/common/**` or `packages/ui-components/**` merely because desktop E2E needs them. Rust CI's generated-type drift files live under desktop/E2E-desktop, and desktop E2E already exercises shared renderer changes.

Keep `main`/`master` push behavior full.

### 6. Ordinary PR packaging disappears

Remove the `pull_request` trigger from `desktop-build-deploy.yml`.

Delete PR-only unsigned build branches and simplify conditions/env setup that existed only for ordinary PR packaging.

Keep:

- push to `preview`;
- push to `main`;
- `v*` tags;
- `workflow_dispatch`;
- signed release behavior and deployment semantics.

No replacement packaging-validation workflow is added in HPA-613.

### 7. CodeQL stays language-scoped on PRs

HPA-613 explicitly requires PR analysis to be limited to source/workflow changes relevant to each language, so the language selector remains in scope rather than being deferred.

Reduce its machinery in two ways:

1. add a PR-level `paths` filter so docs-only PRs never start CodeQL;
2. use the same tested scope script's `codeql` mode rather than another inline Bash classifier.

PR language mapping:

- `actions` for `.github/workflows/**`;
- `javascript-typescript` for JS/TS/Svelte source/config files;
- `python` for `scripts/**/*.py`;
- `rust` for `packages/dtx-desktop/src-tauri/**/*.rs`.

Unexpected/no mapping after a triggered PR is conservative: analyze all four languages.

Pushes to `main` and scheduled scans always analyze all four languages.

### 8. Codecov uses three carryforward flags

Keep current project and patch targets at 90% with `threshold: 0%` and current status behavior.

Name the existing upload streams:

- root TypeScript/Vitest coverage -> `typescript`;
- Tauri Rust unit coverage -> `tauri-rust`;
- desktop E2E Rust coverage -> `desktop-e2e-rust`.

Set `carryforward: true` for all three flags in `codecov.yml` and pass the matching flag from each upload action.

This lets Codecov reuse the previous flag's coverage when that suite is intentionally skipped on the current commit, instead of treating affected CI as an incomplete coverage model.

Set `fail_ci_if_error: false` on all three uploads. This only makes uploader/service transport failures informational; coverage policy remains enforced by `codecov.yml`.

The implementation PR changes all three upload/workflow surfaces plus `codecov.yml`, so it should run all three streams and establish a flagged baseline before later PRs rely on carryforward.

### 9. Documentation records the matrix, not implementation history

Update `CLAUDE.md` with the resulting ready-PR matrix and fail-open rule.

Document behavior such as:

| Change | Required unit coverage | Repo lint/format | Heavy lint/codegen | Web E2E | Desktop E2E | Rust CI | Packaging | CodeQL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs only | skip | run | skip | skip | skip | skip | skip | skip |
| `dtx-web` | run | run | run | run | skip | skip | skip | JS/TS |
| `dtx-api` | run | run | run | run | skip | skip | skip | JS/TS |
| `common` | run | run | run | run | run | skip | skip | JS/TS |
| `ui-components` | run | run | run | run | run | skip | skip | JS/TS |
| desktop renderer | run | run | run | skip | run | run | skip | JS/TS |
| desktop Rust | run | run | run | skip | run | run | skip | Rust |
| web E2E only | skip | run | run | run | skip | skip | skip | JS/TS if source changes |
| desktop E2E only | skip | run | run | skip | run | run | skip | JS/TS if source changes |
| shared/root CI config | conservative full where relevant | run | run | according to path filters | according to path filters | according to path filters | no PR packaging | mapped/all on failure |

## Error handling

Scope reduction is an optimization, never a correctness dependency.

- missing `TURBO_SCM_BASE` / `TURBO_SCM_HEAD` -> full relevant validation;
- `git diff` failure -> full relevant validation;
- `turbo ls` failure -> full relevant validation;
- malformed or unexpected Turbo JSON -> full relevant validation;
- jq failure -> full relevant validation;
- CodeQL mapping failure -> all four languages;
- Codecov uploader/service failure -> informational upload failure, not a replacement for coverage policy.

Raw scope inputs/results are logged so a wrong skip can be diagnosed from one workflow run.

## Testing and verification

### Scope script

Before workflow wiring is accepted:

- shell syntax check;
- recorded web-affected JSON -> `unit=true`;
- recorded empty-affected JSON -> `unit=false` and `lint=false`;
- malformed JSON -> wrapper chooses full validation;
- missing/invalid Git refs -> wrapper chooses full validation;
- real local base/head pair executes the checked-in Turbo command successfully;
- raw affected JSON appears in diagnostics.

### Workflow syntax

Run `actionlint` over every changed workflow.

### Required checks

Confirm job ids remain exactly `test` and `lint-and-format` and neither required workflow has event-level PR `paths` filtering.

### Path matrix

Inspect/dry-run the documented cases for docs, web, API, common, UI, desktop renderer, desktop Rust, web E2E, desktop E2E, and root CI configuration.

### Release behavior

Verify `desktop-build-deploy.yml` still has `preview`, `main`, `v*`, and manual entry points, and no ordinary PR trigger.

### Codecov

Verify all three uploads use their configured flags, all three flags have carryforward enabled, and 90% project/patch targets are unchanged.

### Final implementation-PR gate

Before treating HPA-613 implementation as complete, a PR changing `packages/dtx-web/**` must demonstrably resolve the detector to unit coverage enabled. The expensive-gate logic is not considered proven solely because `actionlint` passes.

## Expected file scope

New:

- `.github/scripts/ci-affected-scope.sh`
- `.github/scripts/fixtures/turbo-ls-web.json`
- `.github/scripts/fixtures/turbo-ls-empty.json`
- `.github/scripts/fixtures/turbo-ls-malformed.json`

Modify:

- `.github/workflows/unit-test.yml`
- `.github/workflows/lint-and-format.yml`
- `.github/workflows/e2e-test.yml`
- `.github/workflows/desktop-e2e-test.yml` only for Codecov flag/transport handling
- `.github/workflows/tauri-rust-ci.yml`
- `.github/workflows/desktop-build-deploy.yml`
- `.github/workflows/codeql.yml`
- `codecov.yml`
- `CLAUDE.md`

No application source files are changed.