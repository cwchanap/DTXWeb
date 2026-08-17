# HPA-613 Affected CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce ready-PR GitHub Actions cost by running expensive validation only for affected application/native areas while preserving the required `test` and `lint-and-format` status contexts and all current `main`/release behavior.

**Architecture:** Keep the current workflow boundaries. The two required jobs perform a cheap Turborepo affected-package query inside the existing job and conditionally skip expensive steps; non-required workflows use PR path filters; packaging stops running on ordinary PRs; CodeQL dynamically selects relevant languages on PRs while remaining full on `main` and schedule.

**Tech Stack:** GitHub Actions, Bun 1.3.9, Turborepo 2.10.x, Bash/jq, CodeQL, Codecov, Tauri/Rust 1.95.

## Global Constraints

- Keep job ids `test` in `.github/workflows/unit-test.yml` and `lint-and-format` in `.github/workflows/lint-and-format.yml` unchanged; the active `Main` ruleset requires those exact contexts.
- Do not add `pull_request.paths` to either required workflow.
- On any scope-detection error, run the existing expensive validation rather than silently skipping it.
- Pushes to `main` keep full validation behavior.
- Keep GraphQL schema generation before generated-client verification.
- Keep Codecov project/patch targets in `codecov.yml` unchanged; only uploader failures become non-blocking.
- Keep `preview`, `main`, `v*`, and `workflow_dispatch` desktop packaging/release entry points.
- No new CI service, dependency graph implementation, remote cache, or monolithic CI workflow.

---

## File map

- `.github/workflows/unit-test.yml` — required `test` context and TypeScript coverage upload.
- `.github/workflows/lint-and-format.yml` — required lint/codegen/typecheck/format context.
- `.github/workflows/e2e-test.yml` — web/Supabase/Playwright E2E path gate.
- `.github/workflows/desktop-e2e-test.yml` — existing desktop path gate and Codecov uploader behavior.
- `.github/workflows/tauri-rust-ci.yml` — Rust PR path gate and Codecov uploader behavior.
- `.github/workflows/desktop-build-deploy.yml` — release-only cross-platform packaging after this change.
- `.github/workflows/codeql.yml` — PR path gate, changed-language selector, and dynamic matrix.
- `CLAUDE.md` — contributor-facing affected-area matrix and required-check explanation.

---

### Task 1: Make the two required jobs cheap on unrelated PRs

**Files:**
- Modify: `.github/workflows/unit-test.yml`
- Modify: `.github/workflows/lint-and-format.yml`

**Interfaces:**
- Consumes: PR base/head SHAs from `github.event.pull_request`, the repository workspace graph from Turborepo, and the existing job ids.
- Produces: `steps.scope.outputs.run_expensive` (`true` or `false`) used only by later steps in the same required job.

- [ ] **Step 1: Preserve full git history in the required workflows**

In both workflows, keep `actions/checkout@v7` but add:

```yaml
with:
  fetch-depth: 0
```

The scope query needs both PR SHAs locally. Do not add workflow-level path filters.

- [ ] **Step 2: Add the unit-test scope step before dependency installation**

After `Setup Bun`, add this step to `unit-test.yml`:

```yaml
- name: Detect affected unit-test packages
  id: scope
  shell: bash
  env:
    EVENT_NAME: ${{ github.event_name }}
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  run: |
    set -euo pipefail

    if [[ "$EVENT_NAME" != "pull_request" ]]; then
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    changed_files="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")"
    if grep -Eq '^(\.github/workflows/unit-test\.yml|package\.json|bun\.lock|turbo\.json|codecov\.yml)$' <<<"$changed_files"; then
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    if ! affected="$(
      TURBO_SCM_BASE="$BASE_SHA" \
      TURBO_SCM_HEAD="$HEAD_SHA" \
      bunx turbo@2.10.9 ls --affected --output=json
    )"; then
      echo "::warning::Affected-package detection failed; running full unit coverage."
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    if jq -e '
      [.packages[].name]
      | any(
          . == "@dtx/common"
          or . == "@dtx/ui-components"
          or . == "dtx-api"
          or . == "dtx-web"
          or . == "dtx-desktop"
        )
    ' <<<"$affected" >/dev/null; then
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
    else
      echo "run_expensive=false" >> "$GITHUB_OUTPUT"
      echo "No unit-test-bearing workspace package is affected; required test context will finish after the cheap gate."
    fi
```

Keep the full `bun run test:coverage` command when the gate is true. Do not switch to partial-package coverage in this task.

- [ ] **Step 3: Condition all expensive unit-test steps on the scope output**

Add this condition to the existing steps from `Install dependencies` through `Upload coverage to Codecov`:

```yaml
if: steps.scope.outputs.run_expensive == 'true'
```

The required job itself must still run and finish successfully when the condition is false.

- [ ] **Step 4: Make the TypeScript Codecov uploader non-blocking**

Change only the uploader transport behavior:

```yaml
with:
  token: ${{ secrets.CODECOV_TOKEN }}
  fail_ci_if_error: false
```

Do not edit `codecov.yml`.

- [ ] **Step 5: Add the broader lint/codegen scope step**

After `Setup Bun` in `lint-and-format.yml`, add:

```yaml
- name: Detect affected lint/codegen scope
  id: scope
  shell: bash
  env:
    EVENT_NAME: ${{ github.event_name }}
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  run: |
    set -euo pipefail

    if [[ "$EVENT_NAME" != "pull_request" ]]; then
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    changed_files="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")"
    if grep -Eq '^(\.editorconfig|\.eslintignore|\.eslintrc\.cjs|\.prettierignore|\.prettierrc|\.github/workflows/lint-and-format\.yml|package\.json|bun\.lock|turbo\.json)$' <<<"$changed_files"; then
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    if ! affected="$(
      TURBO_SCM_BASE="$BASE_SHA" \
      TURBO_SCM_HEAD="$HEAD_SHA" \
      bunx turbo@2.10.9 ls --affected --output=json
    )"; then
      echo "::warning::Affected-package detection failed; running full lint/codegen validation."
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    if jq -e '.packages | length > 0' <<<"$affected" >/dev/null; then
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
    else
      echo "run_expensive=false" >> "$GITHUB_OUTPUT"
      echo "No workspace package is affected; required lint-and-format context will finish after the cheap gate."
    fi
```

- [ ] **Step 6: Condition the existing full lint/codegen sequence without reordering it**

Add:

```yaml
if: steps.scope.outputs.run_expensive == 'true'
```

to every existing step after scope detection:

- `Install dependencies`
- `Generate SvelteKit types`
- `Build packages`
- `Generate and verify GraphQL schema`
- `Verify generated GraphQL client`
- `Typecheck e2e packages`
- `Run linting`
- `Run formatting check`

Do not split schema generation and client drift into separate gates.

- [ ] **Step 7: Validate the required-job YAML and status names**

Run:

```bash
actionlint .github/workflows/unit-test.yml .github/workflows/lint-and-format.yml
grep -n '^  test:' .github/workflows/unit-test.yml
grep -n '^  lint-and-format:' .github/workflows/lint-and-format.yml
git diff --check
```

Expected: `actionlint` and `git diff --check` are clean; the existing job ids are unchanged.

- [ ] **Step 8: Commit the required-job gate**

```bash
git add .github/workflows/unit-test.yml .github/workflows/lint-and-format.yml
git commit -m "ci: gate required checks by affected workspace"
```

---

### Task 2: Add PR path gates to the non-required web/native test workflows

**Files:**
- Modify: `.github/workflows/e2e-test.yml`
- Modify: `.github/workflows/desktop-e2e-test.yml`
- Modify: `.github/workflows/tauri-rust-ci.yml`

**Interfaces:**
- Consumes: GitHub's native `pull_request.paths` evaluation.
- Produces: web E2E, desktop E2E, and Tauri Rust workflows that are not created for unrelated PRs; push behavior remains unchanged.

- [ ] **Step 1: Gate web E2E by the web/API/shared path set**

Keep the existing `push` trigger broad. Add only this PR path list under `pull_request` in `e2e-test.yml`:

```yaml
paths:
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
```

Do not add desktop paths.

- [ ] **Step 2: Keep the existing desktop E2E path set and make its Codecov uploader non-blocking**

Verify `desktop-e2e-test.yml` still includes:

```yaml
paths:
  - 'packages/dtx-desktop/**'
  - 'packages/e2e-desktop/**'
  - 'packages/common/**'
  - 'packages/ui-components/**'
  - '.github/workflows/desktop-e2e-test.yml'
  - 'package.json'
  - 'bun.lock'
  - 'turbo.json'
```

Then change its Codecov action to:

```yaml
fail_ci_if_error: false
```

Do not change coverage generation or artifact upload behavior.

- [ ] **Step 3: Add the desktop/shared PR path set to Tauri Rust CI**

Keep `push` on `main`/`master` unchanged. Add under `pull_request`:

```yaml
paths:
  - 'packages/dtx-desktop/**'
  - 'packages/e2e-desktop/**'
  - 'packages/common/**'
  - 'packages/ui-components/**'
  - '.github/workflows/tauri-rust-ci.yml'
  - 'package.json'
  - 'bun.lock'
  - 'turbo.json'
```

Keep both existing Rust jobs and the generated-TypeScript drift check unchanged.

- [ ] **Step 4: Make the Tauri Rust Codecov uploader non-blocking**

Change:

```yaml
fail_ci_if_error: true
```

to:

```yaml
fail_ci_if_error: false
```

Only for the Codecov upload action. Test/coverage generation failures still fail the job.

- [ ] **Step 5: Validate workflow syntax**

Run:

```bash
actionlint \
  .github/workflows/e2e-test.yml \
  .github/workflows/desktop-e2e-test.yml \
  .github/workflows/tauri-rust-ci.yml
git diff --check
```

Expected: clean.

- [ ] **Step 6: Commit the non-required test gates**

```bash
git add \
  .github/workflows/e2e-test.yml \
  .github/workflows/desktop-e2e-test.yml \
  .github/workflows/tauri-rust-ci.yml
git commit -m "ci: skip unaffected web and desktop validation"
```

---

### Task 3: Remove ordinary PR packaging while preserving release channels

**Files:**
- Modify: `.github/workflows/desktop-build-deploy.yml`

**Interfaces:**
- Consumes: existing `preview`, `main`, tag, and manual-dispatch events.
- Produces: Windows/macOS packaging only for those release/preproduction entry points; no ordinary PR packaging runs.

- [ ] **Step 1: Remove the PR trigger**

Delete only the `pull_request` event block. The top-level trigger must remain equivalent to:

```yaml
on:
  push:
    branches:
      - preview
      - main
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Semver version (MAJOR.MINOR.PATCH) written to the updater manifest. Must exceed the currently installed version to be offered as an update.'
        required: true
        type: string
```

- [ ] **Step 2: Remove job conditions that only existed to admit/skip PR builds**

Delete the Windows/macOS job-level conditions shaped like:

```yaml
if: github.event_name != 'pull_request' || (...)
```

All remaining triggers are intended packaging events.

- [ ] **Step 3: Retarget Google Drive environment conditions to `preview` vs release only**

For both Windows and macOS jobs, change preproduction selection to:

```yaml
if: github.ref == 'refs/heads/preview'
```

and production selection to:

```yaml
if: github.ref != 'refs/heads/preview'
```

Do not change the validation scripts or environment variable names.

- [ ] **Step 4: Delete unsigned PR build steps and make the existing signed build the single build step**

Remove both platform steps named like:

```text
Build Tauri App for ... (PR, unsigned)
```

Rename the signed steps to normal platform build names and remove their now-always-true `if: github.event_name != 'pull_request'` conditions. Keep the signing-key environment variables exactly as they are.

- [ ] **Step 5: Remove stale PR-only comments and prove no PR condition remains**

Run:

```bash
grep -n "pull_request" .github/workflows/desktop-build-deploy.yml
```

Expected: no matches.

Do not rewrite unrelated release/version/signing comments.

- [ ] **Step 6: Validate and commit**

```bash
actionlint .github/workflows/desktop-build-deploy.yml
git diff --check
git add .github/workflows/desktop-build-deploy.yml
git commit -m "ci: reserve desktop packaging for release flows"
```

---

### Task 4: Select only relevant CodeQL languages on pull requests

**Files:**
- Modify: `.github/workflows/codeql.yml`

**Interfaces:**
- Consumes: changed PR file paths.
- Produces: `select-languages.outputs.matrix` and `select-languages.outputs.should_run`; the existing `analyze` job consumes the dynamic matrix.

- [ ] **Step 1: Add a combined PR source-path trigger without changing push/schedule**

Under `pull_request`, add:

```yaml
paths:
  - '.github/workflows/**'
  - '.github/actions/**'
  - '**/*.js'
  - '**/*.cjs'
  - '**/*.mjs'
  - '**/*.ts'
  - '**/*.svelte'
  - '**/package.json'
  - 'bun.lock'
  - 'scripts/**/*.py'
  - 'scripts/**/requirements*.txt'
  - 'packages/dtx-desktop/src-tauri/**'
```

CodeQL is not a required context, so workflow-level path filtering is safe here.

- [ ] **Step 2: Add a `select-languages` job before `analyze`**

Add:

```yaml
select-languages:
  runs-on: ubuntu-latest
  permissions:
    contents: read
  outputs:
    matrix: ${{ steps.select.outputs.matrix }}
    should_run: ${{ steps.select.outputs.should_run }}
  steps:
    - name: Checkout repository
      uses: actions/checkout@v7
      with:
        fetch-depth: 0

    - name: Select CodeQL languages
      id: select
      shell: bash
      env:
        EVENT_NAME: ${{ github.event_name }}
        BASE_SHA: ${{ github.event.pull_request.base.sha }}
        HEAD_SHA: ${{ github.event.pull_request.head.sha }}
      run: |
        set -euo pipefail

        languages='[]'
        add_language() {
          local language="$1"
          languages="$(jq -c --arg language "$language" '. + [{language: $language, "build-mode": "none"}]' <<<"$languages")"
        }

        if [[ "$EVENT_NAME" != "pull_request" ]]; then
          add_language actions
          add_language javascript-typescript
          add_language python
          add_language rust
        else
          if ! changed_files="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")"; then
            echo "::warning::Could not calculate PR diff; scanning all CodeQL languages."
            add_language actions
            add_language javascript-typescript
            add_language python
            add_language rust
          else
            if grep -Eq '^\.github/(workflows|actions)/' <<<"$changed_files"; then
              add_language actions
            fi

            if grep -Eq '(^|/)(package\.json)$|^bun\.lock$|\.(js|cjs|mjs|ts|svelte)$' <<<"$changed_files"; then
              add_language javascript-typescript
            fi

            if grep -Eq '^scripts/.*\.py$|^scripts/.*/requirements[^/]*\.txt$|^scripts/requirements[^/]*\.txt$' <<<"$changed_files"; then
              add_language python
            fi

            if grep -Eq '^packages/dtx-desktop/src-tauri/' <<<"$changed_files"; then
              add_language rust
            fi
          fi
        fi

        matrix="$(jq -cn --argjson include "$languages" '{include: $include}')"
        echo "matrix=$matrix" >> "$GITHUB_OUTPUT"

        if [[ "$(jq 'length' <<<"$languages")" -gt 0 ]]; then
          echo "should_run=true" >> "$GITHUB_OUTPUT"
        else
          echo "should_run=false" >> "$GITHUB_OUTPUT"
        fi
```

The failure fallback is intentionally all languages.

- [ ] **Step 3: Feed the selector into the existing analyze job**

Add:

```yaml
needs: select-languages
if: >-
  ${{
    (github.event_name != 'pull_request' || github.event.pull_request.draft == false)
    && needs.select-languages.outputs.should_run == 'true'
  }}
```

Replace the static matrix `include` block with:

```yaml
strategy:
  fail-fast: false
  matrix: ${{ fromJSON(needs.select-languages.outputs.matrix) }}
```

Keep the existing dynamic job name, runner choice, permissions, CodeQL init, and analyze steps unchanged.

- [ ] **Step 4: Validate the four mapping cases directly**

Before committing, copy the selector shell into a temporary local shell function or inspect it with representative newline-separated paths and verify:

```text
.github/workflows/unit-test.yml                     -> actions
packages/dtx-web/src/routes/+page.svelte           -> javascript-typescript
scripts/cli.py                                      -> python
packages/dtx-desktop/src-tauri/src/api.rs           -> rust
```

A path list containing both renderer TypeScript and Rust must emit both languages exactly once.

- [ ] **Step 5: Validate and commit**

```bash
actionlint .github/workflows/codeql.yml
git diff --check
git add .github/workflows/codeql.yml
git commit -m "ci: scope CodeQL PR analysis by language"
```

---

### Task 5: Document the affected-area matrix and perform final verification

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the final workflow path/gate behavior from Tasks 1-4.
- Produces: one contributor-facing matrix that future workflow edits can compare against.

- [ ] **Step 1: Add an `Affected-area CI` subsection near the development/testing commands**

Document these invariants:

```markdown
### Affected-area CI

The `Main` ruleset requires the `test` and `lint-and-format` job contexts. Those two workflows always start for a ready PR and perform a cheap Turborepo affected-package gate inside the existing required job; do not add PR-level `paths` filters to them.

| PR change | `test` | `lint-and-format` | Web E2E | Desktop E2E | Tauri Rust | PR packaging | CodeQL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| docs only | cheap gate | cheap gate | no | no | no | no | no |
| `dtx-web` | full | full | yes | no | no | no | JS/TS |
| `dtx-api` | full | full | yes | no | no | no | JS/TS |
| `dtx-desktop` renderer | full | full | no | yes | yes | no | JS/TS |
| `dtx-desktop/src-tauri` | full | full | no | yes | yes | no | Rust (+ JS/TS only when JS/TS files also change) |
| `common` | full | full | yes | yes | yes | no | JS/TS |
| `ui-components` | full | full | yes | yes | yes | no | JS/TS |
| `e2e-web` | cheap/no unit work | full | yes | no | no | no | JS/TS |
| `e2e-desktop` | cheap/no unit work | full | no | yes | yes | no | JS/TS |
| `package.json` / `bun.lock` / `turbo.json` | full | full | yes | yes | yes | no | JS/TS |

Windows/macOS packaging runs only from `preview`, `main`, `v*` tags, or manual dispatch. `main`/scheduled CodeQL remains a full language scan.
```

Keep the wording concise; this is an operational matrix, not a second design document.

- [ ] **Step 2: Run final workflow lint and diff checks**

```bash
actionlint .github/workflows/*.yml
git diff --check
```

Expected: clean.

- [ ] **Step 3: Re-check the active required status contexts**

With authenticated `gh`:

```bash
gh api repos/cwchanap/DTXWeb/rulesets/6439239 \
  --jq '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context'
```

Expected output contains exactly:

```text
test
lint-and-format
```

If the live ruleset changed since planning, update the gate strategy before merging rather than assuming these contexts.

- [ ] **Step 4: Review the documented dry-run matrix against every workflow**

For each row in `CLAUDE.md`, point to the corresponding PR `paths` list or required-job scope condition. Specifically verify `packages/common/**` and `packages/ui-components/**` fan out to both web and desktop validation, and a docs-only PR reaches only the two cheap required gates.

- [ ] **Step 5: Confirm release behavior is unchanged for non-PR events**

Inspect `desktop-build-deploy.yml` and verify all of these remain present:

```text
preview branch push
main branch push
v* tag push
workflow_dispatch
```

Inspect `unit-test.yml`, `lint-and-format.yml`, `e2e-test.yml`, `tauri-rust-ci.yml`, and `codeql.yml` and verify push-to-`main` remains full rather than affected-only.

- [ ] **Step 6: Commit the contributor documentation**

```bash
git add CLAUDE.md
git commit -m "docs: explain affected-area CI matrix"
```

- [ ] **Step 7: Final branch verification**

```bash
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
actionlint .github/workflows/*.yml
git diff --check main...HEAD
```

Expected: clean worktree, only the seven workflow files plus `CLAUDE.md` changed, and every workflow passes `actionlint`.

## Implementation PR verification notes

When the implementation branch is marked ready for review, record which jobs actually ran/skipped for the branch's changed paths. The branch itself changes workflows and `CLAUDE.md`, so it is not a pure docs-only example; use the matrix above as the acceptance artifact rather than creating throwaway test infrastructure solely to manufacture every path combination.