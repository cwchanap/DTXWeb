# HPA-613 Affected CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce ready-PR GitHub Actions cost by running expensive validation only for affected application/native areas while preserving the required `test` and `lint-and-format` status contexts, repo-wide formatting/lint coverage, Codecov's 90% policy, and all current `main`/release behavior.

**Architecture:** Keep the current workflow boundaries. Add one small tested fail-open scope script that uses Git diff plus Turborepo's affected-package JSON; the required unit job uses it as a binary coverage gate, the required lint job gates only schema/codegen/typecheck work while always running install/ESLint/Prettier, and CodeQL reuses it for PR language selection. Non-required E2E/Rust workflows use native path filters, ordinary PR packaging is removed, and Codecov uses carryforward flags for intentionally skipped suites.

**Tech Stack:** GitHub Actions, Bun 1.3.9, Turborepo 2.10.x, Bash/jq, CodeQL, Codecov, Tauri/Rust 1.95.

## Global Constraints

- Keep job ids `test` in `.github/workflows/unit-test.yml` and `lint-and-format` in `.github/workflows/lint-and-format.yml` unchanged; the active `Main` ruleset requires those exact contexts.
- Do not add `pull_request.paths` to either required workflow.
- Keep checkout `fetch-depth: 0` for affected-scope jobs; do not add a second Git-history scheme.
- On any missing ref, Git diff failure, Turbo failure, unexpected Turbo JSON, jq failure, or wrapper failure, run the existing expensive validation rather than silently skipping it.
- Root `bun run test:coverage` remains one all-or-nothing Turborepo command; do not split it into package-specific coverage commands.
- `lint-and-format` always runs dependency installation, repo ESLint, and repo Prettier on ready PRs.
- Keep GraphQL schema generation before generated-client verification.
- Keep Codecov project/patch targets at 90% with `threshold: 0%`; carryforward flags are routing support, not a threshold change.
- Keep `preview`, `main`, `v*`, and `workflow_dispatch` desktop packaging/release entry points.
- Keep CodeQL full on `main` and schedule; PR scans remain language-specific because HPA-613 explicitly requires it.
- No new CI service, dependency graph implementation, remote cache, generic classifier framework, or monolithic CI workflow.

---

## File structure

**Create**

- `.github/scripts/ci-affected-scope.sh` — one fail-open scope implementation for `unit`, `lint`, and `codeql` modes.
- `.github/scripts/fixtures/turbo-ls-web.json` — recorded Turbo JSON with `dtx-web` affected.
- `.github/scripts/fixtures/turbo-ls-empty.json` — recorded Turbo JSON with zero affected packages.
- `.github/scripts/fixtures/turbo-ls-malformed.json` — intentionally invalid/unexpected payload for failure coverage.

**Modify**

- `.github/workflows/unit-test.yml` — preserve required `test`; gate full root coverage.
- `.github/workflows/lint-and-format.yml` — preserve required `lint-and-format`; always lint/format, gate workspace/generated work.
- `.github/workflows/e2e-test.yml` — add web-stack PR paths.
- `.github/workflows/desktop-e2e-test.yml` — add Codecov flag and non-blocking uploader transport behavior only.
- `.github/workflows/tauri-rust-ci.yml` — add narrow native PR paths and Codecov flag/transport behavior.
- `.github/workflows/desktop-build-deploy.yml` — remove ordinary PR packaging and PR-only unsigned branches.
- `.github/workflows/codeql.yml` — add PR source paths and reuse the shared script for language selection.
- `codecov.yml` — define three carryforward flags; keep existing 90% statuses.
- `CLAUDE.md` — document the ready-PR affected-area matrix and fail-open rule.

---

### Task 1: Add and execute the fail-open scope script

**Files:**
- Create: `.github/scripts/ci-affected-scope.sh`
- Create: `.github/scripts/fixtures/turbo-ls-web.json`
- Create: `.github/scripts/fixtures/turbo-ls-empty.json`
- Create: `.github/scripts/fixtures/turbo-ls-malformed.json`

**Interfaces:**
- Consumes: `TURBO_SCM_BASE`, `TURBO_SCM_HEAD`; optional fixture-only `CI_CHANGED_FILES_FILE` and `CI_AFFECTED_JSON_FILE`.
- Produces: stdout is exactly `true`/`false` for `unit`/`lint`, or a non-empty compact JSON language array for `codeql`; diagnostics go to stderr. Unexpected runtime failures exit non-zero so workflow wrappers can fail open.

- [ ] **Step 1: Record representative Turbo JSON fixtures using the live `turbo ls --affected --output=json` schema**

`turbo-ls-web.json`:

```json
{
  "packageManager": "bun",
  "packages": {
    "count": 1,
    "items": [
      {
        "name": "dtx-web",
        "path": "packages/dtx-web"
      }
    ]
  }
}
```

`turbo-ls-empty.json`:

```json
{
  "packageManager": "bun",
  "packages": {
    "count": 0,
    "items": []
  }
}
```

`turbo-ls-malformed.json`:

```text
{"packages":{"count":1,"items":"not-an-array"}}
```

The exact recorded non-package metadata may differ from the fixture above when the implementation is started. If the checked-in Turbo command emits a different real schema, update these fixtures and the parser together **before** wiring any workflow. Do not preserve a parser contradicted by live output.

- [ ] **Step 2: Implement the small shared script**

Create `.github/scripts/ci-affected-scope.sh` with this shape:

```bash
#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
all_codeql='["actions","javascript-typescript","python","rust"]'

case "$mode" in
  unit|lint|codeql) ;;
  *)
    echo "usage: $0 <unit|lint|codeql>" >&2
    exit 2
    ;;
esac

read_changed_files() {
  if [[ -n "${CI_CHANGED_FILES_FILE:-}" ]]; then
    cat "$CI_CHANGED_FILES_FILE"
    return
  fi

  : "${TURBO_SCM_BASE:?TURBO_SCM_BASE is required}"
  : "${TURBO_SCM_HEAD:?TURBO_SCM_HEAD is required}"
  git diff --name-only "$TURBO_SCM_BASE" "$TURBO_SCM_HEAD"
}

read_affected_json() {
  if [[ -n "${CI_AFFECTED_JSON_FILE:-}" ]]; then
    cat "$CI_AFFECTED_JSON_FILE"
    return
  fi

  : "${TURBO_SCM_BASE:?TURBO_SCM_BASE is required}"
  : "${TURBO_SCM_HEAD:?TURBO_SCM_HEAD is required}"
  TURBO_SCM_BASE="$TURBO_SCM_BASE" \
    TURBO_SCM_HEAD="$TURBO_SCM_HEAD" \
    bunx turbo ls --affected --output=json
}

changed_files="$(read_changed_files)"
printf '%s\n' '--- changed files ---' "$changed_files" >&2

if [[ "$mode" == "codeql" ]]; then
  languages=()

  grep -Eq '^\.github/workflows/' <<<"$changed_files" && languages+=(actions)
  grep -Eq '(^|/)[^/]+\.(js|jsx|cjs|mjs|ts|tsx|svelte)$' <<<"$changed_files" \
    && languages+=(javascript-typescript)
  grep -Eq '^scripts/.*\.py$' <<<"$changed_files" && languages+=(python)
  grep -Eq '^packages/dtx-desktop/src-tauri/.*\.rs$' <<<"$changed_files" \
    && languages+=(rust)

  if [[ ${#languages[@]} -eq 0 ]]; then
    printf '%s\n' "$all_codeql"
  else
    printf '%s\n' "${languages[@]}" | jq -R . | jq -sc .
  fi
  exit 0
fi

affected_json="$(read_affected_json)"
printf '%s\n' '--- turbo affected json ---' "$affected_json" >&2

jq -e '
  (.packages | type) == "object" and
  (.packages.count | type) == "number" and
  (.packages.items | type) == "array" and
  .packages.count == (.packages.items | length) and
  all(.packages.items[]; (.name | type) == "string" and (.path | type) == "string")
' <<<"$affected_json" >/dev/null

if [[ "$mode" == "unit" ]]; then
  if grep -Eq '^(\.github/workflows/unit-test\.yml|\.github/scripts/ci-affected-scope\.sh|package\.json|bun\.lock|turbo\.json|codecov\.yml)$' \
    <<<"$changed_files"; then
    echo true
    exit 0
  fi

  if jq -e '
    [.packages.items[].name]
    | any(
        . == "@dtx/common" or
        . == "@dtx/ui-components" or
        . == "dtx-web" or
        . == "dtx-api" or
        . == "dtx-desktop"
      )
  ' <<<"$affected_json" >/dev/null; then
    echo true
  else
    echo false
  fi
  exit 0
fi

if grep -Eq '^(\.github/workflows/lint-and-format\.yml|\.github/scripts/ci-affected-scope\.sh|package\.json|bun\.lock|turbo\.json)$' \
  <<<"$changed_files"; then
  echo true
elif jq -e '.packages.count > 0' <<<"$affected_json" >/dev/null; then
  echo true
else
  echo false
fi
```

Keep the literal rules here. Do not introduce config files, reusable workflow abstractions, or a generic rule DSL.

- [ ] **Step 3: Make the script executable and syntax-check it**

Run:

```bash
chmod +x .github/scripts/ci-affected-scope.sh
bash -n .github/scripts/ci-affected-scope.sh
```

Expected: exit 0.

- [ ] **Step 4: Verify the package parser against fixtures before any YAML wiring**

Create an empty changed-files fixture temporarily:

```bash
empty_changed="$(mktemp)"
: > "$empty_changed"
```

Run:

```bash
CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-web.json \
  .github/scripts/ci-affected-scope.sh unit
```

Expected stdout:

```text
true
```

Run:

```bash
CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-empty.json \
  .github/scripts/ci-affected-scope.sh unit
```

Expected stdout:

```text
false
```

Run:

```bash
CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-empty.json \
  .github/scripts/ci-affected-scope.sh lint
```

Expected stdout:

```text
false
```

Run:

```bash
CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-malformed.json \
  .github/scripts/ci-affected-scope.sh unit
```

Expected: non-zero. This is intentional; the workflow wrapper added in Tasks 2/3 turns it into full validation.

- [ ] **Step 5: Verify force-full root changes**

```bash
changed="$(mktemp)"
printf '%s\n' 'codecov.yml' > "$changed"
CI_CHANGED_FILES_FILE="$changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-empty.json \
  .github/scripts/ci-affected-scope.sh unit
```

Expected stdout: `true`.

- [ ] **Step 6: Execute the script with a real Git/Turborepo comparison**

Run from a branch with at least one parent commit:

```bash
TURBO_SCM_BASE="$(git rev-parse HEAD^)" \
TURBO_SCM_HEAD="$(git rev-parse HEAD)" \
  .github/scripts/ci-affected-scope.sh unit
```

Expected: exit 0 and stderr contains the raw `turbo ls --affected --output=json` payload. The boolean result depends on the actual last commit.

This step is load-bearing. Do not proceed to workflow gating if the live Turbo JSON contradicts the fixture/parser.

- [ ] **Step 7: Verify a dtx-web fixture still turns coverage on**

Re-run the web fixture from Step 4 immediately before committing. Expected: `true`.

- [ ] **Step 8: Commit the detector seam**

```bash
git add .github/scripts/ci-affected-scope.sh .github/scripts/fixtures/
git commit -m "ci: add affected scope detector"
```

---

### Task 2: Gate the required root unit-coverage job

**Files:**
- Modify: `.github/workflows/unit-test.yml`

**Interfaces:**
- Consumes: `.github/scripts/ci-affected-scope.sh unit`.
- Produces: existing required job id `test`; output `steps.scope.outputs.run_expensive` controls the existing coverage stack.

- [ ] **Step 1: Give checkout full history**

Change checkout to:

```yaml
- name: Checkout code
  uses: actions/checkout@v7
  with:
    fetch-depth: 0
```

Keep the existing draft job guard.

- [ ] **Step 2: Add the fail-open scope wrapper after Bun setup and before install**

```yaml
- name: Determine unit coverage scope
  id: scope
  shell: bash
  env:
    TURBO_SCM_BASE: ${{ github.event.pull_request.base.sha }}
    TURBO_SCM_HEAD: ${{ github.event.pull_request.head.sha }}
  run: |
    if [[ "${{ github.event_name }}" != "pull_request" ]]; then
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    if run_expensive="$(.github/scripts/ci-affected-scope.sh unit)"; then
      echo "run_expensive=$run_expensive" >> "$GITHUB_OUTPUT"
    else
      echo "Affected-scope detection failed; running full unit coverage." >&2
      echo "run_expensive=true" >> "$GITHUB_OUTPUT"
    fi
```

Do not use a bare `git diff` in the YAML. Git/Turbo/jq failures belong behind the wrapper and must resolve to `true`.

- [ ] **Step 3: Condition the existing expensive steps, not the job**

Add:

```yaml
if: steps.scope.outputs.run_expensive == 'true'
```

to the existing steps for:

- `bun install --frozen-lockfile`;
- SvelteKit type preparation;
- `@dtx/common` build;
- `bun run test:coverage`;
- Codecov upload.

Do not change root `bun run test:coverage` itself.

- [ ] **Step 4: Validate workflow syntax and required context**

Run:

```bash
actionlint .github/workflows/unit-test.yml
grep -n '^  test:' .github/workflows/unit-test.yml
grep -n 'paths:' .github/workflows/unit-test.yml || true
```

Expected:

- actionlint passes;
- job id remains `test`;
- no PR event-level `paths` was introduced.

- [ ] **Step 5: Re-run the detector web fixture before accepting the workflow gate**

```bash
empty_changed="$(mktemp)"
: > "$empty_changed"
CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-web.json \
  .github/scripts/ci-affected-scope.sh unit
```

Expected: `true`. If not, stop; a green required `test` would be unsafe.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/unit-test.yml
git commit -m "ci: gate root unit coverage by affected scope"
```

---

### Task 3: Keep repo lint/format always-on and gate only heavy lint work

**Files:**
- Modify: `.github/workflows/lint-and-format.yml`

**Interfaces:**
- Consumes: `.github/scripts/ci-affected-scope.sh lint`.
- Produces: existing required job id `lint-and-format`; `steps.scope.outputs.run_workspace_checks` controls only build/schema/codegen/E2E typecheck steps.

- [ ] **Step 1: Give checkout full history**

```yaml
- name: Checkout code
  uses: actions/checkout@v7
  with:
    fetch-depth: 0
```

- [ ] **Step 2: Add the fail-open heavy-work wrapper after Bun setup**

```yaml
- name: Determine workspace lint scope
  id: scope
  shell: bash
  env:
    TURBO_SCM_BASE: ${{ github.event.pull_request.base.sha }}
    TURBO_SCM_HEAD: ${{ github.event.pull_request.head.sha }}
  run: |
    if [[ "${{ github.event_name }}" != "pull_request" ]]; then
      echo "run_workspace_checks=true" >> "$GITHUB_OUTPUT"
      exit 0
    fi

    if run_workspace_checks="$(.github/scripts/ci-affected-scope.sh lint)"; then
      echo "run_workspace_checks=$run_workspace_checks" >> "$GITHUB_OUTPUT"
    else
      echo "Affected-scope detection failed; running full workspace lint checks." >&2
      echo "run_workspace_checks=true" >> "$GITHUB_OUTPUT"
    fi
```

- [ ] **Step 3: Leave install, ESLint, and Prettier unconditional**

These steps must have **no** `if: steps.scope...` condition:

```yaml
- name: Install dependencies
  run: bun install --frozen-lockfile

- name: Run linting
  run: bun run lint

- name: Run formatting check
  run: bunx prettier --check .
```

This is what keeps a docs-only PR from merging Markdown that fails the repo format check.

- [ ] **Step 4: Gate only the workspace/generated sequence**

Add:

```yaml
if: steps.scope.outputs.run_workspace_checks == 'true'
```

to the existing steps that:

- generate SvelteKit types / prepare the web package;
- build `@dtx/common`;
- generate and verify the API GraphQL schema;
- verify the generated web GraphQL client;
- typecheck `dtx-e2e-web` and `dtx-e2e-desktop`.

Keep schema generation before `lint:codegen`.

- [ ] **Step 5: Verify docs-only still reaches repo-wide checks**

Run:

```bash
actionlint .github/workflows/lint-and-format.yml
grep -n 'Run linting\|Run formatting check' .github/workflows/lint-and-format.yml
grep -n '^  lint-and-format:' .github/workflows/lint-and-format.yml
```

Inspect the two repo-wide steps and confirm they have no affected-scope `if`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/lint-and-format.yml
git commit -m "ci: gate generated lint work by affected scope"
```

---

### Task 4: Add native PR path filters to non-required validation

**Files:**
- Modify: `.github/workflows/e2e-test.yml`
- Modify: `.github/workflows/tauri-rust-ci.yml`

**Interfaces:**
- Consumes: GitHub Actions native event path matching.
- Produces: web E2E starts only for web/shared/E2E/root-test inputs; Rust CI starts only for native/generated-contract/root-build inputs. `main`/`master` pushes remain full.

- [ ] **Step 1: Add web E2E PR paths**

Under `pull_request` in `e2e-test.yml`, keep the existing branches/types and add:

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

Do not add this path filter to the push trigger; `main`/`master` web E2E stays full.

- [ ] **Step 2: Add a narrower Tauri Rust PR path set**

Under `pull_request` in `tauri-rust-ci.yml`, add:

```yaml
paths:
  - 'packages/dtx-desktop/**'
  - 'packages/e2e-desktop/**'
  - '.github/workflows/tauri-rust-ci.yml'
  - 'package.json'
  - 'bun.lock'
  - 'turbo.json'
```

Do **not** include `packages/common/**` or `packages/ui-components/**`. The Rust workflow's generated drift outputs live under desktop/E2E-desktop, while the existing desktop E2E workflow already covers renderer/shared changes.

Do not path-filter the Rust push trigger; `main`/`master` remains full.

- [ ] **Step 3: Leave desktop E2E's existing shared paths intact**

Do not narrow `desktop-e2e-test.yml` in this task. It should continue to include `packages/common/**` and `packages/ui-components/**` because those are real desktop-renderer/E2E dependencies.

- [ ] **Step 4: Validate syntax**

```bash
actionlint .github/workflows/e2e-test.yml .github/workflows/tauri-rust-ci.yml
git diff --check
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/e2e-test.yml .github/workflows/tauri-rust-ci.yml
git commit -m "ci: scope e2e and rust checks by path"
```

---

### Task 5: Remove ordinary PR desktop packaging

**Files:**
- Modify: `.github/workflows/desktop-build-deploy.yml`

**Interfaces:**
- Consumes: existing `preview`, `main`, `v*`, and `workflow_dispatch` entry points.
- Produces: no Windows/macOS packaging for ordinary PRs; current release/preview paths remain.

- [ ] **Step 1: Remove the pull-request trigger**

Delete the `pull_request` block from `on:`. Keep:

```yaml
on:
  push:
    branches:
      - preview
      - main
    tags:
      - 'v*'
  workflow_dispatch:
```

Preserve existing manual inputs below `workflow_dispatch`.

- [ ] **Step 2: Remove job conditions that only filtered PRs**

Delete/simplify conditions such as:

```yaml
if: github.event_name != 'pull_request' || (github.event.pull_request.draft == false && github.head_ref != 'preview')
```

They are unnecessary once the workflow has no PR event.

- [ ] **Step 3: Remove both unsigned PR build steps**

Delete Windows/macOS steps whose only branch is:

```yaml
if: github.event_name == 'pull_request'
```

Keep the existing non-PR signed build commands and their signing secrets.

- [ ] **Step 4: Simplify preproduction/production configuration conditions without changing preview semantics**

Change preproduction Google Drive configuration from PR-or-preview to preview only.

Keep production configuration for non-preview release paths.

Do not change updater versioning, artifact layout, signing, R2 deployment, release manifests, or target architectures.

- [ ] **Step 5: Validate release entry points and syntax**

```bash
actionlint .github/workflows/desktop-build-deploy.yml
grep -n 'pull_request' .github/workflows/desktop-build-deploy.yml || true
grep -n 'preview\|main\|v\*\|workflow_dispatch' .github/workflows/desktop-build-deploy.yml
```

Expected: no executable PR trigger/PR-only build branches remain; release entry points remain present.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/desktop-build-deploy.yml
git commit -m "ci: stop packaging desktop apps on pull requests"
```

---

### Task 6: Keep PR CodeQL language-scoped without a third classifier

**Files:**
- Modify: `.github/workflows/codeql.yml`
- Reuse: `.github/scripts/ci-affected-scope.sh`

**Interfaces:**
- Consumes: `.github/scripts/ci-affected-scope.sh codeql` and GitHub PR source path filtering.
- Produces: non-empty JSON language matrix; main/schedule always use all four existing languages.

- [ ] **Step 1: Add PR-level source/workflow paths**

Keep push-to-main and schedule unchanged. Under `pull_request`, add paths matching at least one CodeQL language:

```yaml
paths:
  - '.github/workflows/**'
  - '**/*.js'
  - '**/*.jsx'
  - '**/*.cjs'
  - '**/*.mjs'
  - '**/*.ts'
  - '**/*.tsx'
  - '**/*.svelte'
  - 'scripts/**/*.py'
  - 'packages/dtx-desktop/src-tauri/**/*.rs'
```

This is the cheap docs-only filter. It does not replace per-language PR selection.

- [ ] **Step 2: Add a selector job that reuses the shared script**

Add before `analyze`:

```yaml
select-languages:
  runs-on: ubuntu-latest
  permissions:
    contents: read
  outputs:
    languages: ${{ steps.scope.outputs.languages }}
  steps:
    - name: Checkout repository
      if: github.event_name == 'pull_request'
      uses: actions/checkout@v7
      with:
        fetch-depth: 0

    - name: Select CodeQL languages
      id: scope
      shell: bash
      env:
        TURBO_SCM_BASE: ${{ github.event.pull_request.base.sha }}
        TURBO_SCM_HEAD: ${{ github.event.pull_request.head.sha }}
      run: |
        all='["actions","javascript-typescript","python","rust"]'

        if [[ "${{ github.event_name }}" != "pull_request" ]]; then
          echo "languages=$all" >> "$GITHUB_OUTPUT"
          exit 0
        fi

        if languages="$(.github/scripts/ci-affected-scope.sh codeql)"; then
          echo "languages=$languages" >> "$GITHUB_OUTPUT"
        else
          echo "CodeQL scope detection failed; analyzing all languages." >&2
          echo "languages=$all" >> "$GITHUB_OUTPUT"
        fi
```

The script returns all four on an unexpected empty mapping after the workflow has triggered, so the matrix is never empty.

- [ ] **Step 3: Replace the static analyze matrix source**

Add:

```yaml
needs: select-languages
```

and change the matrix to:

```yaml
strategy:
  fail-fast: false
  matrix:
    language: ${{ fromJSON(needs.select-languages.outputs.languages) }}
```

Retain the existing runner selection, permissions, CodeQL init, and analysis steps.

- [ ] **Step 4: Fixture-check language mapping**

```bash
changed="$(mktemp)"
printf '%s\n' \
  '.github/workflows/unit-test.yml' \
  'packages/dtx-web/src/lib/example.ts' \
  'packages/dtx-desktop/src-tauri/src/api.rs' > "$changed"

CI_CHANGED_FILES_FILE="$changed" \
  .github/scripts/ci-affected-scope.sh codeql
```

Expected JSON contains exactly:

```json
["actions", "javascript-typescript", "rust"]
```

(order may be compacted but stays deterministic from the script).

- [ ] **Step 5: Validate workflow syntax**

```bash
actionlint .github/workflows/codeql.yml
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/codeql.yml
git commit -m "ci: scope PR CodeQL by changed language"
```

---

### Task 7: Make partial coverage uploads compatible with Codecov policy

**Files:**
- Modify: `codecov.yml`
- Modify: `.github/workflows/unit-test.yml`
- Modify: `.github/workflows/tauri-rust-ci.yml`
- Modify: `.github/workflows/desktop-e2e-test.yml`

**Interfaces:**
- Produces three named coverage streams: `typescript`, `tauri-rust`, and `desktop-e2e-rust`, each with carryforward enabled.

- [ ] **Step 1: Add carryforward flag definitions without touching thresholds**

Extend `codecov.yml`:

```yaml
coverage:
  status:
    project:
      default:
        target: 90%
        threshold: 0%
        informational: false
        if_not_found: failure
    patch:
      default:
        target: 90%
        threshold: 0%
        informational: false
        if_not_found: failure

flags:
  typescript:
    carryforward: true
  tauri-rust:
    carryforward: true
  desktop-e2e-rust:
    carryforward: true
```

Do not change the 90% values, threshold, or informational settings.

- [ ] **Step 2: Flag root TypeScript coverage and make uploader transport informational**

In `unit-test.yml`:

```yaml
with:
  token: ${{ secrets.CODECOV_TOKEN }}
  flags: typescript
  fail_ci_if_error: false
```

Keep the upload step under the Task 2 `run_expensive` gate.

- [ ] **Step 3: Flag Tauri Rust unit coverage**

In `tauri-rust-ci.yml`:

```yaml
with:
  token: ${{ secrets.CODECOV_TOKEN }}
  files: packages/dtx-desktop/src-tauri/lcov.info
  flags: tauri-rust
  fail_ci_if_error: false
```

- [ ] **Step 4: Flag desktop E2E Rust coverage**

In `desktop-e2e-test.yml`:

```yaml
with:
  token: ${{ secrets.CODECOV_TOKEN }}
  files: packages/dtx-desktop/src-tauri/e2e-lcov.info
  flags: desktop-e2e-rust
  fail_ci_if_error: false
```

- [ ] **Step 5: Verify the implementation PR establishes all three flags**

Because this implementation changes `unit-test.yml`, `tauri-rust-ci.yml`, `desktop-e2e-test.yml`, and `codecov.yml`, all three coverage-producing workflows should be selected on the implementation PR. Confirm Codecov receives one upload for each flag before relying on carryforward on later PRs.

- [ ] **Step 6: Validate thresholds and upload settings**

```bash
grep -n 'target: 90%\|threshold: 0%\|carryforward: true' codecov.yml
grep -R -n 'flags: \|fail_ci_if_error:' \
  .github/workflows/unit-test.yml \
  .github/workflows/tauri-rust-ci.yml \
  .github/workflows/desktop-e2e-test.yml
actionlint \
  .github/workflows/unit-test.yml \
  .github/workflows/tauri-rust-ci.yml \
  .github/workflows/desktop-e2e-test.yml
```

Expected: three carryforward flags, three matching uploader flags, all uploader transport failures non-blocking, 90% policy unchanged.

- [ ] **Step 7: Commit**

```bash
git add codecov.yml \
  .github/workflows/unit-test.yml \
  .github/workflows/tauri-rust-ci.yml \
  .github/workflows/desktop-e2e-test.yml
git commit -m "ci: carry forward partial coverage suites"
```

---

### Task 8: Document and verify the complete affected-area matrix

**Files:**
- Modify: `CLAUDE.md`
- Verify: every HPA-613 workflow/script/config change

**Interfaces:**
- Produces: contributor-visible CI rules and final evidence that scope reduction cannot silently suppress required validation.

- [ ] **Step 1: Add the ready-PR matrix to `CLAUDE.md`**

Document these cases:

| Change | Unit coverage | ESLint/Prettier | Heavy lint/codegen | Web E2E | Desktop E2E | Rust CI | Packaging | CodeQL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| docs only | skip | run | skip | skip | skip | skip | skip | skip |
| `dtx-web` | run | run | run | run | skip | skip | skip | JS/TS |
| `dtx-api` | run | run | run | run | skip | skip | skip | JS/TS |
| `common` | run | run | run | run | run | skip | skip | JS/TS |
| `ui-components` | run | run | run | run | run | skip | skip | JS/TS |
| desktop renderer | run | run | run | skip | run | run | skip | JS/TS |
| desktop Rust | run | run | run | skip | run | run | skip | Rust |
| web E2E only | skip | run | run | run | skip | skip | skip | JS/TS when source matches |
| desktop E2E only | skip | run | run | skip | run | run | skip | JS/TS when source matches |

Also state:

- `test` and `lint-and-format` must remain event-visible required contexts;
- scope-detection failures run more CI, never less;
- ordinary PR packaging is intentionally absent;
- `main` and scheduled CodeQL remain full;
- skipped coverage suites use Codecov carryforward flags.

- [ ] **Step 2: Re-run script verification**

```bash
bash -n .github/scripts/ci-affected-scope.sh

empty_changed="$(mktemp)"
: > "$empty_changed"

CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-web.json \
  .github/scripts/ci-affected-scope.sh unit | grep -qx true

CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-empty.json \
  .github/scripts/ci-affected-scope.sh unit | grep -qx false

CI_CHANGED_FILES_FILE="$empty_changed" \
CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-empty.json \
  .github/scripts/ci-affected-scope.sh lint | grep -qx false
```

Expected: all pass.

- [ ] **Step 3: Prove the malformed detector path fails open at wrapper level**

Run the script directly and require failure:

```bash
if CI_CHANGED_FILES_FILE="$empty_changed" \
  CI_AFFECTED_JSON_FILE=.github/scripts/fixtures/turbo-ls-malformed.json \
  .github/scripts/ci-affected-scope.sh unit; then
  echo 'expected malformed Turbo JSON to fail' >&2
  exit 1
fi
```

Then inspect `unit-test.yml` and `lint-and-format.yml` and confirm their `else` branches write `true` to the relevant outputs.

- [ ] **Step 4: Re-run one real Turbo comparison**

```bash
TURBO_SCM_BASE="$(git rev-parse HEAD^)" \
TURBO_SCM_HEAD="$(git rev-parse HEAD)" \
  .github/scripts/ci-affected-scope.sh unit
```

Expected: exits 0 and logs raw changed files plus affected JSON.

- [ ] **Step 5: Validate every changed workflow**

```bash
actionlint \
  .github/workflows/unit-test.yml \
  .github/workflows/lint-and-format.yml \
  .github/workflows/e2e-test.yml \
  .github/workflows/desktop-e2e-test.yml \
  .github/workflows/tauri-rust-ci.yml \
  .github/workflows/desktop-build-deploy.yml \
  .github/workflows/codeql.yml
```

Expected: pass.

- [ ] **Step 6: Verify required checks and release entry points stayed deterministic**

```bash
grep -n '^  test:' .github/workflows/unit-test.yml
grep -n '^  lint-and-format:' .github/workflows/lint-and-format.yml
grep -n 'preview\|main\|v\*\|workflow_dispatch' .github/workflows/desktop-build-deploy.yml
```

Expected: required job ids unchanged; release entry points retained.

- [ ] **Step 7: Verify no PR packaging remains**

```bash
if grep -n 'pull_request' .github/workflows/desktop-build-deploy.yml; then
  echo 'ordinary PR packaging reference remains' >&2
  exit 1
fi
```

Expected: no match.

- [ ] **Step 8: Verify Codecov routing without policy drift**

```bash
grep -n 'target: 90%\|threshold: 0%' codecov.yml
grep -n 'typescript:\|tauri-rust:\|desktop-e2e-rust:\|carryforward: true' codecov.yml
```

Expected: 90%/0% policy unchanged and all three flags present.

- [ ] **Step 9: Run repository formatting validation for the changed docs/config**

```bash
bunx prettier --check \
  .github/workflows/unit-test.yml \
  .github/workflows/lint-and-format.yml \
  .github/workflows/e2e-test.yml \
  .github/workflows/desktop-e2e-test.yml \
  .github/workflows/tauri-rust-ci.yml \
  .github/workflows/desktop-build-deploy.yml \
  .github/workflows/codeql.yml \
  codecov.yml \
  CLAUDE.md

git diff --check
```

Expected: pass.

- [ ] **Step 10: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: document affected CI matrix"
```

- [ ] **Step 11: Final implementation-PR proof before declaring HPA-613 complete**

On the implementation PR, inspect the scope step log for a commit that changes `packages/dtx-web/**` (the implementation branch may include such a fixture/tested comparison rather than manufacturing a product change). The detector must show the web package in raw Turbo JSON and resolve unit coverage to `true`.

Do not accept `actionlint` alone as proof of scope correctness.

---

## Expected implementation commit sequence

1. `ci: add affected scope detector`
2. `ci: gate root unit coverage by affected scope`
3. `ci: gate generated lint work by affected scope`
4. `ci: scope e2e and rust checks by path`
5. `ci: stop packaging desktop apps on pull requests`
6. `ci: scope PR CodeQL by changed language`
7. `ci: carry forward partial coverage suites`
8. `docs: document affected CI matrix`

Each commit is independently reviewable after the detector seam exists. Do not start relying on path filters or packaging reductions until Task 1 has executed successfully against both fixture JSON and one real Turborepo comparison.