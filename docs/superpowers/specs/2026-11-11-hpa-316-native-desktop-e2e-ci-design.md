# HPA-316 — Native desktop E2E CI on macOS and Windows

**Status:** Proposed; planning-only draft PR (implementation and verification will use the **same PR**).  
**Linear:** https://linear.app/cwchanap/issue/HPA-316/ci-run-desktop-e2e-on-macos-and-windows-target-oses-not-ubuntu-latest  
**Implementation plan:** [2026-11-11-hpa-316-native-desktop-e2e-ci.md](../plans/2026-11-11-hpa-316-native-desktop-e2e-ci.md)

## Goal

Execute the desktop app's **existing** full native WebdriverIO/Tauri E2E suite on its two shipped OSes, macOS and Windows, in CI. The suite must start the real debug Tauri executable and exercise the currently checked-in WDIO, relaunch, and crash-recovery scenarios. Do not mistake a successful build for successful native E2E.

## Current repository evidence (main, reviewed 2026-11-11)

- `.github/workflows/desktop-e2e-test.yml` has a single `ubuntu-latest` job. Its Linux-specific steps install WebKit/GTK and wrap tests with `xvfb-run`; Git Bash, `source`, `tee`, and `set -o pipefail` are available on GitHub-hosted Windows runners and already used in `.github/workflows/desktop-build-deploy.yml`.
- `packages/e2e-desktop/wdio.conf.ts` already selects `driverProvider: 'embedded'`, and computes `dtx-desktop.exe` for Windows versus `dtx-desktop` elsewhere, using `target-e2e/debug`.
- `packages/dtx-desktop/src-tauri/src/lib.rs` registers `tauri-plugin-wdio` and `tauri-plugin-wdio-webdriver` only with the E2E feature in debug builds. The E2E Tauri configuration already grants `wdio:default` and `wdio-webdriver:default` and disables bundling.
- `packages/e2e-desktop/package.json`: `e2e:build` builds the debug Tauri app with E2E features and its own target directory; `e2e:run` runs WDIO **plus** the relaunch and Google Drive crash-recovery scripts. Keep all three.
- Five lightweight `bun:test` harness suites exist under `packages/e2e-desktop/{support,scripts}/*.test.mjs`, but the package has no `test` script and `.github/scripts/ci-affected-scope.sh` excludes it from the normal unit-test run. `relaunch-smoke.test.mjs` uses process-global `mock.module` for `standalone-session.ts`; running all harness suites together contaminates tests. Add a **local-and-CI `test:harness` command** that spawns one `bun test` process per file, before the costly native build.
- Current E2E workflow also instruments Rust and uploads `desktop-e2e-rust` LCOV to Codecov; `codecov.yml` gives this flag carry-forward. Preserve it instead of deleting coverage casually.
- `HPA-315` (native folder-dialog automation) is separate work and depends on target-OS CI. Its dialog-specific tests are **not** part of this ticket.

## Decisions

### 1. Two native matrix entries; no new harness

Replace the Ubuntu desktop E2E runner with `macos-latest` and `windows-latest` (one job per OS). Set **`strategy.fail-fast: false`** so a failure on one platform never cancels the other platform's test result or macOS coverage upload. Keep the existing workflow triggers, draft-PR skip guard, pinned toolchain, Bun version, shared-package builds, Rust cache, E2E fixture isolation, existing tests, and `@wdio/tauri-service`. To avoid a skipped-CI deadlock, **mark this same PR ready for review immediately after committing the first workflow implementation**, using the existing `ready_for_review` trigger to run target-OS CI before attempting native fixes. It may remain draft during planning only. No Linux E2E acceptance job, third-party hosted driver, new test framework, or package upgrades.

The existing `embedded` provider is supported on both platforms and does **not** need `tauri-driver` or a separate Edge driver installation. See [Tauri WebDriver documentation](https://tauri.app/develop/tests/webdriver/) and [WebdriverIO platform support](https://webdriver.io/docs/desktop-testing/tauri/platform-support). Validate this against the actual pinned versions and hosted runners; documentation is not proof of a passing CI session.

### 2. Use platform-neutral build/test commands

Set job-level `defaults.run.shell: bash` to keep dependency installation, shared package builds, coverage, and E2E commands consistent across macOS and Windows (where Actions otherwise defaults to PowerShell). Keep **one shared Bash build step and one shared Bash run step** for both OSes. Remove only Linux-specific `apt-get` and `xvfb-run`; retain `set -o pipefail` and `tee` so failures are not masked. In each shared step, source `packages/dtx-desktop/src-tauri/coverage-env.sh` **only** when `RUNNER_OS=macOS`. Condition coverage preparation/report/upload steps with `if: runner.os == 'macOS'`; do not fork the build and test steps by OS.

Add `packages/e2e-desktop/scripts/run-harness-tests.mjs` and a package-level `test:harness` script. The runner discovers the five `support/*.test.mjs` and `scripts/*.test.mjs` files, sorts them, spawns the current Bun executable (`process.execPath`) with `test <file>` for **each file in its own process** (`node:child_process`), streams output, and fails immediately on any nonzero exit or spawn error. No dependencies or shell globs. Developers and CI both run:

```bash
bun run --filter=dtx-e2e-desktop test:harness
```

This avoids the cross-suite `mock.module` leak without introducing a new test framework or duplicating CI-only shell logic.

Keep `DTX_DESKTOP_BINARY` optional: the existing `wdio.conf.ts` and standalone scripts already resolve the correct host binary. **Before the first native CI run**, add the child `exitCode` and `signalCode` to early-exit diagnostics in `support/standalone-session.ts` and a focused `bun:test` regression (including exit code 0). Capture these values when exit is detected, rather than when readiness begins; preserve the current early-exit-versus-retry behavior. If hosted runners expose a genuine path or process issue beyond this diagnostic, correct the reproduced defect in the same PR, not with a harness rewrite.

### 3. Retain E2E Rust coverage on macOS only

To minimize runner cost and implementation complexity, instrument the **macOS** native E2E build using the existing `cargo llvm-cov show-env --sh` / `cargo llvm-cov clean --workspace` approach, then run the same existing E2E commands under that instrumentation. Produce and upload the LCOV artifact + the current `desktop-e2e-rust` Codecov flag from macOS only. Artifact names should be unique per OS for logs, and coverage should not upload twice.

On **Windows**, compile and run uninstrumented native E2E. Windows Rust coverage is not an acceptance criterion; it adds a second shell-specific coverage path without providing an additional platform UX assertion. The existing separate `tauri-rust-ci.yml` Rust checks remain unchanged. If macOS profiling cannot be made reliable, explicitly resolve the coverage impact in this PR rather than silently dropping the existing E2E flag.

### 4. Keep failures attributable to the correct OS

With `strategy.fail-fast: false`, both OS matrix entries independently report success or failure, even if the other fails. Upload per-OS E2E logs on failure; preserve nonzero process exits using `set -o pipefail`. Set the PR ready immediately after the first workflow implementation commit so the native matrix runs during iteration; preserve the draft-skip guard for other draft PRs. Record CI-run evidence and caveats in the **PR body Verification checklist**, not in the design/plan files. Only add small diagnostic steps (binary existence, WebDriver startup logs) if CI indicates they are needed. Do not broaden this issue to unrelated production code changes.

## Acceptance contract

| Target | Required end-to-end evidence |
| --- | --- |
| macOS | On a hosted macOS runner: pass isolated harness unit tests; build debug E2E binary, launch and connect the embedded WebDriver session, complete WDIO specs plus relaunch and crash-recovery scripts; generate Rust E2E LCOV and upload the `desktop-e2e-rust` flag. Visually confirm the normal desktop workspace/library UI is rendered. |
| Windows | On a hosted Windows runner: pass isolated harness unit tests; build the debug `.exe`, launch and connect an embedded WebDriver session in WebView2, complete the **same** WDIO, relaunch and crash-recovery scripts without any Linux setup, native-driver installer, or Rust coverage requirement. Visually confirm the normal desktop workspace/library UI is rendered. |
| CI | Mark this PR ready for review after the first workflow implementation commit. Its `ready_for_review` event starts two distinct target-OS jobs with `fail-fast: false`; a failing platform does not cancel the other. Setup uses Bash on both OSes, `test:harness` is runnable locally and in CI, and an early-exiting app reports exit code/signal. Existing path triggers and draft skip behavior remain intact. |

No UI mockup is attached to HPA-316; the visual checks compare to the existing desktop UI rather than to a proposed redesign. No Android or Linux E2E acceptance. Existing independent CI for those environments, if any, is outside this ticket.

## Risks and limits

- **Native single-instance guard:** `tauri_plugin_single_instance` runs on macOS and Windows, and the E2E app uses the same `com.hapadona.drumery.e2e` identifier for sequential WDIO/relaunch/crash-recovery launches. If a prior process is still alive, a subsequent app launch can exit early (possibly with exit code 0), appearing to be a WebDriver startup failure. Add exit code and signal diagnostics *before* the first native CI run; inspect for an existing `dtx-desktop` process if the failure occurs. Do **not** add sleeps or blindly raise timeouts; fix only the demonstrated lifecycle defect.
- **Host GUI / WebView differences:** an embedded driver documented as cross-platform may still fail to start in hosted macOS or Windows sessions. Prove real session startup in CI; investigate Tauri bundle path, process lifetime, and runner display permissions before increasing timeouts.
- **Windows process and shell semantics:** the current relaunch and crash-recovery scripts deliberately own PIDs and ports. A platform-specific failure must be fixed locally, without replacing the ownership handshake with a less reliable generic helper.
- **Coverage preservation:** the macOS instrumented app must still launch and collect LCOV. Do not duplicate Codecov uploads or weaken coverage configuration as a workaround.
- **Hosted-runner cost:** macOS/Windows minutes cost more than Ubuntu. Keep one OS per job, existing affected-path triggers, cached Rust artifacts, and no additional architecture variants or redundant coverage jobs.

## Explicit non-goals

- Automating NSOpenPanel/Windows folder dialogs (HPA-315).
- New native UI scenarios, a new test framework, or production application features.
- Linux/Android acceptance testing, release signing/bundling, or changing unrelated CI workflows.
- Upgrading WDIO, Rust, Tauri, Bun, or Dependabot dependencies merely as part of this runner change.
