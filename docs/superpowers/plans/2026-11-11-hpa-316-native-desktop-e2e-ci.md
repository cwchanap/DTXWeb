# HPA-316 — Native desktop E2E CI: implementation plan

**Status:** Planned (not implemented).  
**Linear:** https://linear.app/cwchanap/issue/HPA-316/ci-run-desktop-e2e-on-macos-and-windows-target-oses-not-ubuntu-latest  
**Design (source of truth):** [2026-11-11-hpa-316-native-desktop-e2e-ci-design.md](../specs/2026-11-11-hpa-316-native-desktop-e2e-ci-design.md)  
**Delivery rule:** **Exactly one PR for HPA-316.** Commit the implementation, tests, and verified results to the **same** draft-PR branch; do not open a follow-up implementation PR.

## Change surface

| File | Intended change |
| --- | --- |
| `.github/workflows/desktop-e2e-test.yml` | Replace Ubuntu-only E2E with macOS + Windows matrix; native runner setup/build/run; macOS-only Rust E2E coverage; OS-named failure logs. |
| `packages/e2e-desktop/wdio.conf.ts` and `support/standalone-session.ts` | **Only if a real target-OS CI failure proves it necessary:** minimal embedded-driver startup or host-process fix. |
| `packages/e2e-desktop/scripts/*.ts` / focused tests | **Only if needed** to fix a reproduced Windows/macOS relaunch or crash-recovery regression. |
| These two planning docs | Record the observed CI results and any approved scope changes, in the same PR. |

Do not edit package versions, Rust business logic, the production Tauri config, or the separate native-dialog automation ticket unless a demonstrated blocker requires it.

## Work sequence (all on this PR)

### 1. Migrate the workflow without changing test semantics

- Change `desktop-e2e` to a 2-entry matrix: `macos-latest`, `windows-latest`; include OS in job names and artifact names.
- Preserve the current `push` / `pull_request` affected-path filters, draft-PR guard, permissions, pinned toolchain `1.95.0`, `bun 1.3.9`, checkout, shared-package build, and Rust cache.
- Remove Linux-specific apt dependencies, `xvfb-run`, and any unconditional Bash-sourced environment from Windows. Invoke `bun run --filter=dtx-e2e-desktop e2e:build` and `e2e:run` on the native runner.
- Keep the E2E build as a debug, feature-gated, non-bundled app. Verify the produced binary path before diagnosing WebDriver issues.

### 2. Preserve Rust E2E coverage without duplicate work

- Condition coverage install, export, clean, report, artifact upload, and Codecov upload to the macOS matrix entry.
- For macOS, ensure the coverage environment is active for **both** the native E2E build and test process; preserve the existing report file path and Codecov flag `desktop-e2e-rust`.
- For Windows, build and test without the coverage environment. Keep the test process exit code authoritative and upload platform-labeled logs on failure.
- Do not weaken `codecov.yml` or silently discard `desktop-e2e-rust` coverage if the macOS reporter fails.

### 3. Repair only reproducible target-OS breakage

- Check the service actually creates a session on **both** macOS and Windows; do not accept a build-only green check.
- Check the existing WDIO specs, `scripts/relaunch-smoke.ts`, and `scripts/google-drive-crash-recovery.ts` run on each OS.
- If Windows exposes path, signal, or port-lease problems, use the existing injected-dependencies/focused-test patterns in `support/standalone-session.ts`. If macOS exposes driver or profiling issues, fix the smallest cause and rerun. Do not implement native folder-dialog automation.
- Keep the scope in this PR. If a limitation is fundamental, document the exact failing step, platform and error rather than marking the task complete.

### 4. Run and record acceptance

- Ensure the workflow itself is changed so affected-path detection schedules it; then mark this PR ready for review when implementation is ready so the existing draft guard does not skip E2E.
- **macOS E2E:** confirm real session startup, all WDIO tests, relaunch, crash recovery, LCOV artifact and `desktop-e2e-rust` Codecov upload.
- **Windows E2E:** confirm real `.exe` session startup and the same WDIO/relaunch/crash-recovery tests. No Windows code-coverage requirement.
- Check distinct matrix outcomes and OS-specific artifacts; a genuine E2E failure must fail the corresponding job.
- Record links to the completed target-OS CI runs and any remaining caveats in these docs before requesting merge.

## Done when

- [ ] `macos-latest` native E2E runs and passes end-to-end, including relaunch and crash recovery.
- [ ] `windows-latest` native E2E runs and passes end-to-end, including relaunch and crash recovery.
- [ ] macOS E2E Rust LCOV + Codecov flag remain available; Windows produces no redundant coverage upload.
- [ ] No Linux-only commands remain in native E2E steps; no new dialog automation or framework introduced.
- [ ] The original draft PR is updated with working code and target-OS CI evidence, rather than creating a second PR.

**Dependency:** Successful native E2E CI enables, but does not implement, [HPA-315](https://linear.app/cwchanap/issue/HPA-315/desktop-e2e-automate-native-os-folder-dialogs).
