# HPA-316 — Native desktop E2E CI: implementation plan

**Status:** Planned (not implemented).  
**Linear:** https://linear.app/cwchanap/issue/HPA-316/ci-run-desktop-e2e-on-macos-and-windows-target-oses-not-ubuntu-latest  
**Design (source of truth):** [2026-11-11-hpa-316-native-desktop-e2e-ci-design.md](../specs/2026-11-11-hpa-316-native-desktop-e2e-ci-design.md)  
**Delivery rule:** **Exactly one PR for HPA-316.** Commit the implementation, tests, and verified results to the **same** draft-PR branch; do not open a follow-up implementation PR.

## Change surface

| File | Intended change |
| --- | --- |
| `.github/workflows/desktop-e2e-test.yml` | Replace Ubuntu E2E with a non-fail-fast macOS + Windows matrix; isolated harness unit-test step; shared Bash build/run; macOS-only Rust E2E coverage; OS-named failure logs. |
| `packages/e2e-desktop/wdio.conf.ts` and `support/standalone-session.ts` | **Only if a real target-OS CI failure proves it necessary:** minimal embedded-driver startup or host-process fix. |
| `packages/e2e-desktop/scripts/*.ts` / focused tests | **Only if needed** to fix a reproduced Windows/macOS relaunch or crash-recovery regression. |
| These two planning docs | Record agreed design decisions and scope changes only. Keep ephemeral CI run URLs and caveats in this PR's Verification checklist. |

Do not edit package versions, Rust business logic, the production Tauri config, or the separate native-dialog automation ticket unless a demonstrated blocker requires it.

## Work sequence (all on this PR)

### 1. Migrate the workflow without changing test semantics

- Change `desktop-e2e` to a 2-entry matrix: `macos-latest`, `windows-latest`, with **`strategy.fail-fast: false`** so either job can fail without canceling the other. Include the OS in job names and failure-log artifact names. Do not add a third Linux entry.
- Preserve the current `push` / `pull_request` affected-path filters, draft-PR guard, permissions, pinned toolchain `1.95.0`, `bun 1.3.9`, checkout, shared-package build, and Rust cache.
- Remove only Linux-specific apt dependencies and `xvfb-run`. Keep **one** shared `shell: bash` build step and **one** shared `shell: bash` run step: Git Bash is already used on Windows in `desktop-build-deploy.yml`. Retain `set -o pipefail` and `tee` in the run step. Prefix each shared step with a macOS-only coverage environment guard: `if [ "$RUNNER_OS" = macOS ]; then source packages/dtx-desktop/src-tauri/coverage-env.sh; fi`. Both platforms then call the same `bun run --filter=dtx-e2e-desktop e2e:build` and `e2e:run` scripts.
- Before the expensive native build, add **one** step on each OS to run the five existing `bun:test` harness suites independently (they currently run nowhere in CI). Do not use one combined `bun test` process: `scripts/relaunch-smoke.test.mjs` installs a process-global `mock.module` that contaminates the `standalone-session` suite.

  ```yaml
  - name: Run E2E harness unit tests
    shell: bash
    working-directory: packages/e2e-desktop
    run: for f in support/*.test.mjs scripts/*.test.mjs; do bun test "./$f" || exit 1; done
  ```

- Keep the E2E build as a debug, feature-gated, non-bundled app. Verify the produced binary path before diagnosing WebDriver issues.

### 2. Preserve Rust E2E coverage without duplicate work

- Add `if: runner.os == 'macOS'` to the existing `cargo-llvm-cov` installation, coverage configuration/clean, report, LCOV artifact and Codecov upload steps. Only coverage steps should be OS-conditioned; the native build and run steps remain shared.
- On macOS, source the generated `coverage-env.sh` in **both** shared Bash steps before running the existing build and test commands; preserve the current report file path and Codecov flag `desktop-e2e-rust`.
- For Windows, build and test without the coverage environment. Keep the test process exit code authoritative and upload platform-labeled logs on failure.
- Do not weaken `codecov.yml` or silently discard `desktop-e2e-rust` coverage if the macOS reporter fails.

### 3. Repair only reproducible target-OS breakage

- Check the service actually creates a session on **both** macOS and Windows; do not accept a build-only green check.
- Check the existing WDIO specs, `scripts/relaunch-smoke.ts`, and `scripts/google-drive-crash-recovery.ts` run on each OS.
- If Windows exposes path, signal, or port-lease problems, use the existing injected-dependencies/focused-test patterns in `support/standalone-session.ts`. The standalone harness's early-exit error currently omits the child exit code. On **either** native OS, a premature exit with code 0 may mean `tauri_plugin_single_instance` rejected a second E2E app launch because an earlier `dtx-desktop` process with identifier `com.hapadona.drumery.e2e` is still alive. Inspect processes and exit codes first; do not mask it with sleeps or arbitrary timeout increases. **Only if CI reproduces this**, add the exit code to that diagnostic and fix the smallest process-lifecycle defect. If macOS exposes driver or profiling issues, likewise fix the demonstrated cause and rerun. Do not implement native folder-dialog automation.
- Keep the scope in this PR. If a limitation is fundamental, document the exact failing step, platform and error rather than marking the task complete.

### 4. Run and record acceptance

- Ensure the workflow itself is changed so affected-path detection schedules it; then mark this PR ready for review when implementation is ready so the existing draft guard does not skip E2E.
- **macOS E2E:** confirm real session startup, all WDIO tests, relaunch, crash recovery, LCOV artifact and `desktop-e2e-rust` Codecov upload.
- **Windows E2E:** confirm real `.exe` session startup and the same WDIO/relaunch/crash-recovery tests. No Windows code-coverage requirement.
- Check distinct matrix outcomes, `fail-fast: false`, isolated harness unit-test results, and OS-specific artifacts; a genuine E2E failure must fail the corresponding job without canceling the other.
- Visually check on macOS and Windows that the native app renders the existing workspace/library UI rather than a blank window. HPA-316 has no UI mockup; no UI redesign or new visual fixture is needed.
- Put completed target-OS CI run links and remaining caveats in this PR's **Verification** checklist before requesting merge, not in the design/plan docs. No required-check migration is planned.

## Done when

- [ ] `macos-latest` runs the isolated harness unit-test files, and native E2E passes end-to-end, including relaunch and crash recovery.
- [ ] `windows-latest` runs the isolated harness unit-test files, and native E2E passes end-to-end, including relaunch and crash recovery.
- [ ] macOS E2E Rust LCOV + Codecov flag remain available; Windows produces no redundant coverage upload.
- [ ] Matrix uses `fail-fast: false`, shared Bash build/run steps, and OS-specific failure-log artifacts; no Linux-only commands, new dialog automation, or new framework.
- [ ] Visual desktop workspace/library smoke check passes on macOS and Windows (no mockup is attached to HPA-316).
- [ ] The original draft PR is updated with working code and target-OS CI links in its Verification checklist, rather than creating a second PR.

**Dependency:** Successful native E2E CI enables, but does not implement, [HPA-315](https://linear.app/cwchanap/issue/HPA-315/desktop-e2e-automate-native-os-folder-dialogs).
