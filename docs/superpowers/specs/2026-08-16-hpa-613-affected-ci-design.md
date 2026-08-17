# HPA-613 Affected CI Design

## Summary

Reduce ready-PR CI cost and feedback time without replacing the repository's current GitHub Actions structure.

Use a hybrid model:

- keep the two required status-check jobs (`test` and `lint-and-format`) present on every non-draft PR, but let them stop after a cheap Turborepo affected-package check when no relevant workspace/configuration changed;
- use native `pull_request.paths` filters for non-required web E2E, desktop E2E, and Tauri Rust workflows;
- remove ordinary pull-request packaging from the Windows/macOS build workflow while preserving `preview`, `main`, release-tag, and manual release behavior;
- keep CodeQL on `main` and the weekly schedule, but on pull requests build a dynamic language matrix from changed source/workflow paths;
- make Codecov upload transport failures non-blocking while leaving the existing Codecov project/patch coverage policy unchanged.

This is deliberately a CI-routing change, not a new CI framework or dependency-graph service.

Linear: HPA-613

## Why HPA-613 is the next slice

HPA-613 is the only medium-priority item in the DTXWeb backlog and has no blockers. HPA-614 and HPA-615 are complete, so HPA-616 is now available but remains a low-priority behavior-preserving refactor; HPA-617 is downstream cleanup and HPA-193 is low-priority test hardening.

The current workflows make HPA-613 immediately valuable:

- `unit-test.yml` runs full repository coverage for any ready PR;
- `lint-and-format.yml` installs the full workspace, builds common, regenerates schema/client output, typechecks both E2E packages, lints, and formats for any ready PR;
- `e2e-test.yml` starts Supabase, Playwright, API, and web infrastructure for any ready PR;
- `tauri-rust-ci.yml` runs two Linux Rust jobs for any ready PR;
- `desktop-build-deploy.yml` builds both Windows and macOS packages for any ready PR;
- `codeql.yml` starts four language jobs for any ready PR.

The live `Main` repository ruleset currently requires only the GitHub Actions contexts `test` and `lint-and-format`. That distinction is load-bearing: GitHub documents that a required workflow skipped by event-level path filtering can remain pending, while a job that completes or intentionally skips inside a triggered workflow can satisfy its status context.

## Goals

- Make docs-only and unrelated PRs avoid expensive application/native CI.
- Preserve deterministic required contexts `test` and `lint-and-format`.
- Keep shared changes capable of triggering both web and desktop validation.
- Keep GraphQL schema generation and generated-client drift checks intact.
- Keep all current validation/release behavior on pushes to `main` unless HPA-613 explicitly changes PR-only behavior.
- Stop routine PRs from building Windows/macOS installers.
- Reduce CodeQL PR work to languages that can be affected by the changed paths.
- Keep the implementation understandable from the workflow files and contributor documentation.

## Non-goals

- No new CI SaaS, custom dependency graph, or long-lived CI service.
- No merge of all workflows into one monolithic `ci.yml`.
- No removal of unit tests, web E2E, desktop E2E, Rust tests/clippy/fmt, CodeQL, schema generation, or generated-client drift checks.
- No remote Turborepo cache project.
- No coverage-threshold redesign. `codecov.yml` remains authoritative for project and patch targets.
- No release-channel redesign, signing redesign, or Tauri packaging refactor beyond removing ordinary PR packaging.
- No attempt to infer every possible dependency from file extensions when Turborepo already models workspace dependencies.

## Alternatives considered

### A. Add `paths` to every workflow

This is the smallest YAML diff, but it is wrong for `unit-test.yml` and `lint-and-format.yml`: those jobs back the required `test` and `lint-and-format` contexts. If GitHub filters the whole workflow before it starts, a required check can remain pending and block merge.

Reject this for required workflows.

### B. Replace all CI with one workflow and one central classifier

One scope job could feed every test/build job, but it would combine six independently understandable workflows and the release workflow into a larger orchestration file. That is more migration risk and maintenance work than the ticket justifies.

Reject this as over-engineering.

### C. Hybrid required-job gate + native path filters

Keep required workflows triggered, detect workspace impact cheaply inside their existing required jobs, and use event-level path filters only where missing workflow checks cannot block branch protection. Handle CodeQL separately because its unit of work is language rather than package.

Choose this option.

## Chosen design

### 1. Required `test` stays present, but expensive coverage runs only for relevant workspace changes

Keep `unit-test.yml` triggered on ready pull requests exactly as today. Do not add a PR `paths` filter.

Before `bun install`, add a small scope step after checkout/setup-Bun:

1. on `push`, set `run_expensive=true` so `main` behavior stays full;
2. on `pull_request`, check out enough Git history and set `TURBO_SCM_BASE` / `TURBO_SCM_HEAD` from the PR base/head SHAs;
3. run Turborepo's package query (`turbo ls --affected --output=json`);
4. set `run_expensive=true` when one of the unit-test-bearing packages is affected:
   - `@dtx/common`
   - `@dtx/ui-components`
   - `dtx-api`
   - `dtx-web`
   - `dtx-desktop`
5. also force the full job when `unit-test.yml`, `package.json`, `bun.lock`, `turbo.json`, or `codecov.yml` changes.

All current expensive steps (`bun install`, SvelteKit sync, common build, `bun run test:coverage`, Codecov upload) receive the same step-level condition. A docs-only PR therefore still gets a successful `test` job/context, but the job exits after checkout/setup/scope detection.

Do **not** change `bun run test:coverage` to partial package coverage in this ticket. The current Codecov project/patch policy expects one coherent TypeScript coverage upload; package-selective coverage is a separate problem and could make the coverage signal harder to interpret.

### 2. Required `lint-and-format` uses the same cheap package query, with a broader relevant set

Keep `lint-and-format.yml` triggered on every ready PR and keep job id `lint-and-format` unchanged.

The scope step uses the same Turborepo base/head comparison. Run the existing full lint/codegen sequence when any workspace package is affected, including `dtx-e2e-web` and `dtx-e2e-desktop`, because this workflow typechecks both E2E packages.

Also force the full sequence for root lint/format/build configuration changes:

- `.editorconfig`
- `.eslintignore`
- `.eslintrc.cjs`
- `.prettierignore`
- `.prettierrc`
- `package.json`
- `bun.lock`
- `turbo.json`
- `.github/workflows/lint-and-format.yml`

Keep the current schema/client order exactly:

1. generate SvelteKit types;
2. build `@dtx/common`;
3. regenerate and diff `packages/dtx-api/dist/schema.graphql`;
4. run `dtx-web lint:codegen`;
5. typecheck both E2E packages;
6. lint;
7. Prettier check.

This deliberately favors one complete lint/codegen gate over trying to micro-filter every lint command.

### 3. Web E2E gets a PR path filter

`e2e-test.yml` is not a required context, so use native `pull_request.paths` and avoid starting a runner at all when the web stack cannot be affected.

Trigger web E2E for PR changes under:

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

Keep push-to-`main` behavior unchanged and keep the existing draft guard.

This intentionally does not trigger web E2E for desktop-only or `e2e-desktop`-only changes.

### 4. Desktop E2E keeps its existing path gate and documents the matrix

`desktop-e2e-test.yml` already has the correct basic shape. Keep and verify these PR-impact paths:

- `packages/dtx-desktop/**`
- `packages/e2e-desktop/**`
- `packages/common/**`
- `packages/ui-components/**`
- `.github/workflows/desktop-e2e-test.yml`
- `package.json`
- `bun.lock`
- `turbo.json`

Do not add web/API paths merely because the desktop app talks to the API at runtime; the native E2E harness uses its own deterministic test environment and HPA-613's scope calls out desktop/common/UI/E2E/native/shared configuration.

### 5. Tauri Rust CI gets a PR path filter, while `main` remains full

Add `pull_request.paths` to `tauri-rust-ci.yml` for:

- `packages/dtx-desktop/**`
- `packages/e2e-desktop/**`
- `packages/common/**`
- `packages/ui-components/**`
- `.github/workflows/tauri-rust-ci.yml`
- `package.json`
- `bun.lock`
- `turbo.json`

Keep the `push` trigger broad on `main`/`master`. The two existing Rust jobs and generated-TypeScript drift verification remain unchanged when the workflow runs.

The path set is intentionally conservative: a renderer/shared change can still affect Tauri command contracts and generated native types, so HPA-613 should not try to distinguish renderer-only from native-only changes inside `dtx-desktop`.

### 6. Ordinary PRs stop running cross-platform packaging

Remove the `pull_request` trigger from `desktop-build-deploy.yml`.

Preserve these existing entry points:

- push to `preview`;
- push to `main`;
- `v*` tags;
- `workflow_dispatch`.

Because PRs no longer invoke this workflow, remove PR-only dead branches from the workflow where they become unreachable (for example unsigned PR build steps and `github.event_name == 'pull_request'` conditions), but do not redesign release signing or deployment.

Manual dispatch remains the escape hatch when a packaging-specific change needs pre-merge validation.

### 7. CodeQL keeps full `main`/scheduled scanning and selects languages on PRs

Keep push-to-`main` and weekly scheduled CodeQL behavior as a full four-language scan.

For pull requests:

1. add a combined source/workflow `paths` filter so docs-only PRs do not start CodeQL at all;
2. add one lightweight selector job that diffs PR base/head files and emits a JSON matrix;
3. map changed paths to the existing CodeQL languages:
   - `actions`: `.github/workflows/**` (and `.github/actions/**` if that directory is introduced);
   - `javascript-typescript`: JS/TS/Svelte source/config/package-manifest changes;
   - `python`: `scripts/**/*.py` and Python dependency/config files;
   - `rust`: `packages/dtx-desktop/src-tauri/**`;
4. feed only selected languages into the existing `analyze` matrix.

Do not split CodeQL into four duplicated jobs. The current `analyze` implementation remains one matrix job; only matrix construction changes.

CodeQL is not a required status context in the current ruleset, so omitted language jobs do not need placeholder checks.

### 8. Codecov upload outages stop failing otherwise-green test jobs

Change `fail_ci_if_error: true` to `false` for every current Codecov upload action:

- TypeScript coverage in `unit-test.yml`;
- Rust coverage in `tauri-rust-ci.yml`;
- desktop E2E Rust coverage in `desktop-e2e-test.yml`.

Do **not** change `codecov.yml` targets or make Codecov's project/patch statuses informational. HPA-613 only prevents uploader/network/service failures from turning a successful test suite red.

### 9. Document one affected-area matrix in `CLAUDE.md`

Add a concise CI section explaining:

| Change | Unit `test` | `lint-and-format` | Web E2E | Desktop E2E | Tauri Rust | PR packaging | CodeQL PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| docs only | cheap gate only | cheap gate only | no | no | no | no | no |
| `dtx-web` | full | full | yes | no | no | no | JS/TS |
| `dtx-api` | full | full | yes | no | no | no | JS/TS |
| `dtx-desktop` | full | full | no | yes | yes | no | JS/TS and/or Rust by path |
| `common` | full | full | yes | yes | yes | no | JS/TS |
| `ui-components` | full | full | yes | yes | yes | no | JS/TS |
| `e2e-web` | cheap/no unit work | full | yes | no | no | no | JS/TS |
| `e2e-desktop` | cheap/no unit work | full | no | yes | yes | no | JS/TS |
| shared root package config | full | full | yes | yes | yes | no | relevant language(s) |
| workflow-only | workflow-specific | workflow-specific | workflow-specific | workflow-specific | workflow-specific | no ordinary PR packaging | Actions |

Also document that `test` and `lint-and-format` are the two required status contexts, which is why those workflows gate *inside* the job instead of using PR-level path filtering.

## Error handling and safety

- If Turborepo cannot determine the PR diff (missing ref/history, malformed output, query failure), required jobs must fail open to **run the existing expensive validation**, not silently skip it.
- Root dependency/config changes should be conservative and run more validation, not less.
- `main`, scheduled, tag, preview, and manual release events must not depend on PR-only scope outputs.
- The CodeQL selector should emit all four languages if its PR diff calculation fails.
- No secrets or release signing material move into new jobs.

## Validation

### Workflow syntax

Run `actionlint` over every changed workflow before implementation is considered complete.

### Turborepo scope behavior

Use explicit PR base/head SHAs and inspect `turbo ls --affected --output=json` for representative changes. The important invariant is that shared package changes include their dependent application packages; no handwritten dependency graph should duplicate Turborepo's workspace graph.

### Dry-run matrix

Document and manually verify at least these cases in the implementation PR:

1. docs-only;
2. web-only;
3. API-only;
4. desktop renderer-only;
5. desktop Rust-only;
6. `packages/common/**`;
7. `packages/ui-components/**`;
8. `packages/e2e-web/**`;
9. `packages/e2e-desktop/**`;
10. root `package.json` / `bun.lock` / `turbo.json`;
11. workflow-only changes;
12. push to `main`;
13. manual desktop release.

### Branch-protection invariant

Re-read the active repository ruleset after the workflow change. The required contexts must still be named exactly `test` and `lint-and-format`.

## Expected implementation file scope

Modify:

- `.github/workflows/unit-test.yml`
- `.github/workflows/lint-and-format.yml`
- `.github/workflows/e2e-test.yml`
- `.github/workflows/desktop-e2e-test.yml`
- `.github/workflows/tauri-rust-ci.yml`
- `.github/workflows/desktop-build-deploy.yml`
- `.github/workflows/codeql.yml`
- `CLAUDE.md`

No application/package source files are required.