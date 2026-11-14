# HPA-316 — Native desktop E2E CI: implementation plan

**Status:** Planned (not implemented).  
**Linear:** https://linear.app/cwchanap/issue/HPA-316/ci-run-desktop-e2e-on-macos-and-windows-target-oses-not-ubuntu-latest  
**Design (source of truth):** [2026-11-11-hpa-316-native-desktop-e2e-ci-design.md](../specs/2026-11-11-hpa-316-native-desktop-e2e-ci-design.md)  
**Delivery rule:** **Exactly one PR for HPA-316.** Commit the implementation, tests, and verified results to the **same** draft-PR branch; do not open a follow-up implementation PR.

## Change surface

| File                                                                                           | Intended change                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/desktop-e2e-test.yml`                                                       | Replace Ubuntu E2E with a non-fail-fast macOS + Windows matrix; job-level Bash default; portable harness unit-test step; shared build/run; macOS-only Rust E2E coverage; OS-named failure logs. |
| `packages/e2e-desktop/package.json` and `scripts/run-harness-tests.mjs`                        | Add one reusable cross-platform `test:harness` command; run each of the five Bun test files in a separate child process to isolate process-global mocks.                                        |
| `packages/e2e-desktop/support/standalone-session.ts` and `support/standalone-session.test.mjs` | **Upfront diagnostic only:** include child exit code and signal in early-readiness failures and add focused regression coverage; other harness fixes require reproduced target-OS CI evidence.  |
| `packages/e2e-desktop/wdio.conf.ts`                                                            | **Only if real CI failure proves it necessary:** targeted embedded driver startup fix.                                                                                                          |
| `packages/e2e-desktop/scripts/*.ts` / focused tests                                            | **Only if needed** to fix a reproduced Windows/macOS relaunch or crash-recovery regression.                                                                                                     |
| These two planning docs                                                                        | Record agreed design decisions and scope changes only. Keep ephemeral CI run URLs and caveats in this PR's Verification checklist.                                                              |

Do not edit package versions, Rust business logic, the production Tauri config, or the separate native-dialog automation ticket unless a demonstrated blocker requires it.

## Work sequence (all on this PR)

### 1. Migrate the workflow without changing test semantics

- Change `desktop-e2e` to a 2-entry matrix: `macos-latest`, `windows-latest`, with **`strategy.fail-fast: false`** so either job can fail without canceling the other. Include the OS in job names and failure-log artifact names. Do not add a third Linux entry.
- Preserve the current `push` / `pull_request` affected-path filters, draft-PR guard, permissions, pinned toolchain `1.95.0`, `bun 1.3.9`, checkout, shared-package build, and Rust cache. **After the first workflow implementation commit, mark this same PR ready for review immediately**: its `ready_for_review` event launches the native E2E matrix so Step 3 can be driven by actual failures. Keeping the PR draft until Step 4 would skip every CI iteration.
- Set job-level `defaults.run.shell: bash` so install/build/test/coverage commands run consistently on Windows (rather than PowerShell) and macOS. Remove only Linux-specific apt dependencies and `xvfb-run`. Keep **one** shared Bash build step and **one** shared Bash run step: Git Bash is already used on Windows in `desktop-build-deploy.yml`. Retain `set -o pipefail` and `tee` in the run step. Prefix each shared step with a macOS-only coverage environment guard: `if [ "$RUNNER_OS" = macOS ]; then source packages/dtx-desktop/src-tauri/coverage-env.sh; fi`. Both platforms then call the same `bun run --filter=dtx-e2e-desktop e2e:build` and `e2e:run` scripts.
- Add `test:harness` to `packages/e2e-desktop/package.json` as `bun scripts/run-harness-tests.mjs`. Implement the small runner in `packages/e2e-desktop/scripts/run-harness-tests.mjs`: enumerate `support/*.test.mjs` and `scripts/*.test.mjs` with Node filesystem APIs, sort paths, and spawn `process.execPath test ./<path>` for **each file in its own process** via `node:child_process` with inherited stdio; stop at the first failed exit/spawn error. No new test dependency or shell glob. The separate processes isolate `relaunch-smoke.test.mjs`'s process-global `mock.module` from `standalone-session.test.mjs`.
- Before the expensive native build, run `bun run --filter=dtx-e2e-desktop test:harness` in the two-OS matrix. Verify the **same command locally on macOS and Windows**, rather than requiring developers to copy a Bash loop from CI.

- Before the **first** native CI run, add the minimal early-exit diagnostic to `support/standalone-session.ts`: when the child exits during embedded WebDriver readiness, include its actual `exitCode` and `signalCode` in the thrown error. Construct or refresh the message _when the exit is observed_ (not before spawning), while keeping current readiness/retry semantics. Apply consistently to the invoke-bridge early-exit path if it shares the same issue; no new abstraction is needed. Add focused regression tests for a clean code-0 exit and a failed exit/signal in `standalone-session.test.mjs`, run through `test:harness`.
- Keep the E2E build as a debug, feature-gated, non-bundled app. Verify the produced binary path before diagnosing WebDriver issues.

### 2. Preserve Rust E2E coverage without duplicate work

- Add `if: runner.os == 'macOS'` to the existing `cargo-llvm-cov` installation, coverage configuration/clean, report, LCOV artifact and Codecov upload steps. Only coverage steps should be OS-conditioned; the native build and run steps remain shared.
- On macOS, source the generated `coverage-env.sh` in **both** shared Bash steps before running the existing build and test commands; preserve the current report file path and Codecov flag `desktop-e2e-rust`.
- For Windows, build and test without the coverage environment. Keep the test process exit code authoritative and upload platform-labeled logs on failure.
- Do not weaken `codecov.yml` or silently discard `desktop-e2e-rust` coverage if the macOS reporter fails.

### 3. Repair only reproducible target-OS breakage

- Check the service actually creates a session on **both** macOS and Windows; do not accept a build-only green check.
- Check the existing WDIO specs, `scripts/relaunch-smoke.ts`, and `scripts/google-drive-crash-recovery.ts` run on each OS.
- If Windows exposes path, signal, or port-lease problems, use the existing injected-dependencies/focused-test patterns in `support/standalone-session.ts`. The upfront exit-code/signal diagnostics from Step 1 should already be present. On **either** native OS, a premature exit with code 0 may mean `tauri_plugin_single_instance` rejected a second E2E app launch because an earlier `dtx-desktop` process with identifier `com.hapadona.drumery.e2e` is still alive. Inspect processes and exit codes first; do not mask it with sleeps or arbitrary timeout increases. **Only if CI reproduces a lifecycle defect**, fix the smallest cause and rerun. If macOS exposes driver or profiling issues, likewise fix the demonstrated cause. Do not implement native folder-dialog automation.
- Keep the scope in this PR. If a limitation is fundamental, document the exact failing step, platform and error rather than marking the task complete.

### 4. Run and record acceptance

- Confirm PR #350 was marked ready for review **immediately after Step 1**, not deferred until all implementation work is done. The existing `ready_for_review` trigger is expected to schedule macOS/Windows E2E on the first code iteration; subsequent pushes rerun the matrix.
- **macOS E2E:** confirm real session startup, all WDIO tests, relaunch, crash recovery, LCOV artifact and `desktop-e2e-rust` Codecov upload.
- **Windows E2E:** confirm real `.exe` session startup and the same WDIO/relaunch/crash-recovery tests. No Windows code-coverage requirement.
- Check distinct matrix outcomes, `fail-fast: false`, the shared `test:harness` script locally and on both runners, early-exit code/signal diagnostics, and OS-specific artifacts; a genuine E2E failure must fail the corresponding job without canceling the other.
- Visually check on macOS and Windows that the native app renders the existing workspace/library UI rather than a blank window. HPA-316 has no UI mockup; no UI redesign or new visual fixture is needed.
- Put completed target-OS CI run links and remaining caveats in this PR's **Verification** checklist before requesting merge, not in the design/plan docs. No required-check migration is planned.

## Done when

- [ ] `bun run --filter=dtx-e2e-desktop test:harness` passes locally on macOS and Windows and as a pre-build step in both CI jobs, running the five suites in separate Bun processes.
- [ ] `macos-latest` runs native E2E end-to-end, including relaunch and crash recovery.
- [ ] `windows-latest` runs native E2E end-to-end, including relaunch and crash recovery.
- [ ] A first-iteration early native-app exit shows the child exit code and signal (with focused harness regression tests).
- [ ] macOS E2E Rust LCOV + Codecov flag remain available; Windows produces no redundant coverage upload.
- [ ] PR #350 is marked ready after the first workflow implementation commit; matrix uses `fail-fast: false`, job-level `defaults.run.shell: bash`, shared Bash build/run, and OS-specific failure-log artifacts; no Linux-only commands, new dialog automation, or new framework.
- [ ] Visual desktop workspace/library smoke check passes on macOS and Windows (no mockup is attached to HPA-316).
- [ ] The original draft PR is updated with working code and target-OS CI links in its Verification checklist, rather than creating a second PR.

**Dependency:** Successful native E2E CI enables, but does not implement, [HPA-315](https://linear.app/cwchanap/issue/HPA-315/desktop-e2e-automate-native-os-folder-dialogs).
