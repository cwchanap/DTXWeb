# HPA-316 — Native desktop E2E CI on macOS and Windows

**Status:** Proposed; planning-only draft PR (implementation and verification will use the **same PR**).  
**Linear:** https://linear.app/cwchanap/issue/HPA-316/ci-run-desktop-e2e-on-macos-and-windows-target-oses-not-ubuntu-latest  
**Implementation plan:** [2026-11-11-hpa-316-native-desktop-e2e-ci.md](../plans/2026-11-11-hpa-316-native-desktop-e2e-ci.md)

## Goal

Execute the desktop app's **existing** full native WebdriverIO/Tauri E2E suite on its two shipped OSes, macOS and Windows, in CI. The suite must start the real debug Tauri executable and exercise the currently checked-in WDIO, relaunch, and crash-recovery scenarios. Do not mistake a successful build for successful native E2E.

## Current repository evidence (main, reviewed 2026-11-11)

- `.github/workflows/desktop-e2e-test.yml` has a single `ubuntu-latest` job. It installs Linux WebKit/GTK and uses `xvfb-run`, POSIX `source` and `tee`; these steps cannot be copied unchanged onto Windows.
- `packages/e2e-desktop/wdio.conf.ts` already selects `driverProvider: 'embedded'`, and computes `dtx-desktop.exe` for Windows versus `dtx-desktop` elsewhere, using `target-e2e/debug`.
- `packages/dtx-desktop/src-tauri/src/lib.rs` registers `tauri-plugin-wdio` and `tauri-plugin-wdio-webdriver` only with the E2E feature in debug builds. The E2E Tauri configuration already grants `wdio:default` and `wdio-webdriver:default` and disables bundling.
- `packages/e2e-desktop/package.json`: `e2e:build` builds the debug Tauri app with E2E features and its own target directory; `e2e:run` runs WDIO **plus** the relaunch and Google Drive crash-recovery scripts. Keep all three.
- Current E2E workflow also instruments Rust and uploads `desktop-e2e-rust` LCOV to Codecov; `codecov.yml` gives this flag carry-forward. Preserve it instead of deleting coverage casually.
- `HPA-315` (native folder-dialog automation) is separate work and depends on target-OS CI. Its dialog-specific tests are **not** part of this ticket.

## Decisions

### 1. Two native matrix entries; no new harness

Replace the Ubuntu desktop E2E runner with `macos-latest` and `windows-latest` (one job per OS). Keep the existing workflow triggers, draft-PR skip behavior, pinned toolchain, Bun version, shared-package builds, Rust cache, E2E fixture isolation, existing tests, and `@wdio/tauri-service`. No Linux E2E acceptance job, third-party hosted driver, new test framework, or package upgrades.

The existing `embedded` provider is supported on both platforms and does **not** need `tauri-driver` or a separate Edge driver installation. See [Tauri WebDriver documentation](https://tauri.app/develop/tests/webdriver/) and [WebdriverIO platform support](https://webdriver.io/docs/desktop-testing/tauri/platform-support). Validate this against the actual pinned versions and hosted runners; documentation is not proof of a passing CI session.

### 2. Use platform-neutral build/test commands

Invoke the existing Bun scripts for the actual build and test on both OSes; avoid Linux-only `apt-get` and `xvfb-run`. Do not require `source coverage-env.sh` on Windows. Prefer small OS-conditional workflow steps to new cross-platform shell abstractions.

Keep `DTX_DESKTOP_BINARY` optional: the existing `wdio.conf.ts` and standalone scripts already resolve the correct host binary. If hosted runners expose a genuine path or process issue, correct it in the same PR with a targeted regression test, not a rewrite of the harness.

### 3. Retain E2E Rust coverage on macOS only

To minimize runner cost and implementation complexity, instrument the **macOS** native E2E build using the existing `cargo llvm-cov show-env --sh` / `cargo llvm-cov clean --workspace` approach, then run the same existing E2E commands under that instrumentation. Produce and upload the LCOV artifact + the current `desktop-e2e-rust` Codecov flag from macOS only. Artifact names should be unique per OS for logs, and coverage should not upload twice.

On **Windows**, compile and run uninstrumented native E2E. Windows Rust coverage is not an acceptance criterion; it adds a second shell-specific coverage path without providing an additional platform UX assertion. The existing separate `tauri-rust-ci.yml` Rust checks remain unchanged. If macOS profiling cannot be made reliable, explicitly resolve the coverage impact in this PR rather than silently dropping the existing E2E flag.

### 4. Keep failures attributable to the correct OS

Both OS matrix entries must independently report test failure. Upload per-OS E2E logs on failure; preserve nonzero process exits instead of letting a pipe or log step conceal them. Only add small diagnostic steps (binary existence, WebDriver startup logs) if CI indicates they are needed. Do not broaden this issue to unrelated production code changes.

## Acceptance contract

| Target | Required end-to-end evidence |
| --- | --- |
| macOS | On a hosted macOS runner: build debug E2E binary, launch and connect the embedded WebDriver session, complete WDIO specs plus relaunch and crash-recovery scripts; generate the Rust E2E LCOV report and upload the `desktop-e2e-rust` flag. |
| Windows | On a hosted Windows runner: build the debug `.exe`, launch and connect an embedded WebDriver session in WebView2, complete the **same** WDIO, relaunch and crash-recovery scripts without any Linux setup, native-driver installer, or Rust coverage requirement. |
| CI | A ready-for-review PR touching the E2E workflow produces two distinct target-OS jobs. A failing platform fails its matrix entry; diagnostics identify the OS. Scope-based workflow triggers and existing draft skip behavior remain intact. |

No Android or Linux E2E acceptance. Existing independent CI for those environments, if any, is outside this ticket.

## Risks and limits

- **Host GUI / WebView differences:** an embedded driver documented as cross-platform may still fail to start in hosted macOS or Windows sessions. Prove real session startup in CI; investigate Tauri bundle path, process lifetime, and runner display permissions before increasing timeouts.
- **Windows process and shell semantics:** the current relaunch and crash-recovery scripts deliberately own PIDs and ports. A platform-specific failure must be fixed locally, without replacing the ownership handshake with a less reliable generic helper.
- **Coverage preservation:** the macOS instrumented app must still launch and collect LCOV. Do not duplicate Codecov uploads or weaken coverage configuration as a workaround.
- **Hosted-runner cost:** macOS/Windows minutes cost more than Ubuntu. Keep one OS per job, existing affected-path triggers, cached Rust artifacts, and no additional architecture variants or redundant coverage jobs.

## Explicit non-goals

- Automating NSOpenPanel/Windows folder dialogs (HPA-315).
- New native UI scenarios, a new test framework, or production application features.
- Linux/Android acceptance testing, release signing/bundling, or changing unrelated CI workflows.
- Upgrading WDIO, Rust, Tauri, Bun, or Dependabot dependencies merely as part of this runner change.
