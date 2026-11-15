# HPA-315 — Native workspace folder-dialog E2E: implementation plan

**Status:** Planned, docs-only draft PR. Implement and verify in this **same PR**; do not open a separate implementation PR.
**Linear:** https://linear.app/cwchanap/issue/HPA-315/desktop-e2e-automate-native-os-folder-dialogs
**Design (authoritative):** [2026-11-15-hpa-315-native-folder-dialog-e2e-design.md](../specs/2026-11-15-hpa-315-native-folder-dialog-e2e-design.md)
**Prerequisite:** HPA-316 merged in https://github.com/cwchanap/DTXWeb/pull/350.
**Target:** Current production Tauri workspace trust flow, not the generic Export Settings picker.

## One-PR contract

Use one HPA-315 PR for the initial design, test implementation, platform helpers, CI changes, and evidence. This draft is not a throwaway planning PR. Once the first executable change is committed, mark the **same** PR ready for review to trigger the existing native E2E workflow (drafts skip it). Fix CI failures on this branch.

No application feature work, second PR, new UI design, extra test framework, Linux/Android acceptance, or human QA gate.

## Exact change surface

| Path | Purpose |
| --- | --- |
| **packages/e2e-desktop/specs/native-workspace-folder-dialog.e2e.ts** | One focused real-UI WDIO test with selection and cancellation assertions. |
| **packages/e2e-desktop/support/native-folder-dialog.ts** | Small host orchestration wrapper: dispatch by OS, spawn an OS helper, synchronize readiness with the Browse click, bound deadlines, expose meaningful diagnostics. |
| **packages/e2e-desktop/scripts/native-folder-dialog-macos.applescript** | Control the actual app-owned NSOpenPanel/sheet using installed macOS scripting tools; use the fixture's absolute path, confirm and cancel. |
| **packages/e2e-desktop/scripts/native-folder-dialog-windows.ps1** | Control the actual app-owned folder picker with built-in PowerShell/.NET UI Automation; enter the supplied path, confirm and cancel. |
| **.github/workflows/desktop-e2e-test.yml** | Only required GUI-permission preflight and per-OS screenshot artifacts. Retain matrix, existing runner build/test steps, draft guard, path filters, coverage, and logs. |
| **These two planning documents and PR body** | Keep approved boundaries and record measured OS/CI findings, with links to artifacts. |

Exact script filenames can be simplified if a single host helper proves cleaner; do not create a general-purpose GUI automation library.

## Steps, each committed to the same branch

### 1. Verify the real target path and OS capability

- Confirm the existing Library UI selectors: **Clear workspace**, **Workspace menu**, **Browse for folder…**, search input, and fixture song **Critical Workspace Song**. Use the current repository values, not the older ticket's generic select_folder command.
- Confirm clearWorkspaceRoot updates native WorkspaceRootState and the empty-state still renders WorkspaceBookmarksMenu. Confirm the isolated WDIO fixture path from getPreseededWorkspaceFixture and canonicalExpectedPath.
- Validate GUI scripting availability in the **actual native CI environments** before elaborate automation: macOS must be able to interact with an app-owned dialog through System Events/Accessibility; Windows must have a usable interactive desktop and UI Automation. Record tool exit code, stderr, and an actionable permission or session error. Merely finding osascript/PowerShell is not proof of permission.
- If hosted macOS is blocked by TCC/Accessibility, treat it as a blocking feasibility finding on this PR. Identify and prove a viable macOS runner/session approach before declaring acceptance; do not skip macOS or substitute mocked IPC to turn the job green. Avoid unnecessary CI spending from repeated full builds.

### 2. Implement the minimal platform controller

- Build a small host-side TypeScript helper that accepts only **action** (select/cancel) and an absolute fixture directory. Dispatch by process.platform and spawn the checked-in OS script with distinct arguments; no shell interpolation or added Node/Python packages.
- The OS script waits with a bounded deadline for the real folder dialog belonging to the current desktop app, signals that it detected the picker, then completes the requested action. The test should arm the helper **before** WDIO clicks Browse. Use explicit synchronization to avoid races; do not rely on fixed sleeps.
- For macOS identify NSOpenPanel or its sheet in the app's accessibility tree, use Go to Folder to navigate and choose, and support Escape/Cancel. For Windows identify the desktop app's native chooser by process/window ownership and UI Automation accessibility controls, enter the target directory and confirm or cancel.
- Require positive evidence that the dialog appeared and closed. Errors state platform, stage, timeout, process exit code, and stderr. Do not send global keystrokes until the target dialog has been identified, and avoid hard-coded screen positions.
- Keep OS script logic independent of renderer and Rust commands. No fake dialog selections or changes to production Tauri code.

### 3. Write one end-to-end spec

- Begin with the normal preseeded WDIO fixture. Navigate to the Library UI, click **Clear workspace**, wait for the empty state, and assert the **native** getWorkspaceRoot() is null.
- Arm platform folder-picker automation, open **Workspace menu → Browse for folder…** via WDIO, and let the OS script select the fixture path in the **real** native dialog.
- Wait for the picker and native command to complete; assert getWorkspaceRoot() equals canonicalExpectedPath(fixture.workspaceRoot). Also assert the Library search field and **Critical Workspace Song** are visible and no workspace-load error is shown.
- Save a screenshot of the populated Library view to a deterministic E2E artifact directory. The assertion and screenshot together constitute a UI visual check against the existing Library presentation; HPA-315 has no attached Linear mockup.
- Arm cancel mode, reopen the picker through the real menu, cancel through OS chrome, and assert both Rust native root and visible Library contents are unchanged. A green test finishes with the fixture root selected, so it doesn't contaminate later specs.
- Keep the spec runnable only on supported target OSes; an unexpected OS fails explicitly rather than recording a green skip.

### 4. Integrate with existing CI

- Preserve the macOS/Windows two-platform matrix and existing single shared build and test scripts. The new spec is picked up by the current **specs/**/*.e2e.ts** glob. Do not add a second native CI job or install another WebDriver.
- Add a small host capability check where needed; it must fail clearly on GUI permission denial. Keep native dialog failure logs in the OS-specific artifact, including script diagnostics.
- Capture platform-named screenshots (on success for evidence, and on failure where possible) and upload them using the existing artifact action with a short retention period. Avoid a snapshot-testing library or golden-image infrastructure.
- Preserve macOS-only desktop-e2e-rust Codecov upload and all existing relaunch/crash-recovery tests.
- After the first implementation commit, mark this **same** PR ready for review; use actual workflow evidence to refine it. Draft PR CI is intentionally skipped.

### 5. Automated validation and evidence

Use existing package and repository scripts, including:

- **bun install --frozen-lockfile**
- **bun run --filter=dtx-e2e-desktop check**
- **bun run --filter=dtx-e2e-desktop test:harness**
- **bun run lint** and repository formatter/prettier check used by CI
- **bun run --filter=dtx-e2e-desktop e2e:run** after a debug E2E build on a native target OS, or the same command through the existing two-OS GitHub workflow

Do not claim these have run at the planning-only stage. Record native macOS and Windows CI run URLs, script preflight diagnostics, actual dialog observations, and screenshot artifact links in the PR's Verification section. Review screenshots for the normal Library view, populated search field and song, and absence of a visible error. The screenshot verification is observable evidence; **human approval is not a pass condition**.

## Acceptance criteria

- [ ] **macOS native E2E:** Starting with an isolated root, the real GUI clears it and Rust reports null; WDIO opens the Library Browse action, macOS NSOpenPanel is detected and selects the fixture; Rust reports the expected canonical workspace root; the fixture song/search UI renders; the real picker can reopen and cancel without changing the root or UI.
- [ ] **Windows native E2E:** The same full UI → real Windows folder dialog → Rust canonical root → Library UI → cancel flow passes in the Windows Tauri/WebView2 app. Expected path comparisons account for Windows canonicalization.
- [ ] **Visual:** Each OS produces a correctly populated Library screenshot showing the current layout and fixture song (no new mockup is available); the screenshot is kept as a CI artifact and the corresponding DOM assertions pass.
- [ ] **CI:** Both existing native desktop-E2E matrix jobs run the new spec and complete independently, with diagnostic logs and screenshots. A dialog that cannot open/be controlled or a permission failure is a failure, not a skip.
- [ ] **Quality:** Existing package typecheck, harness tests, relevant lint/format checks, WDIO specs and native relaunch/crash-recovery checks pass; no production app change, new framework, Android/Linux acceptance, or second HPA-315 PR.

## Explicitly deferred

Generic export-directory select_folder; Google Drive web-based Picker; scores/database pick_file; multi-dialog localization matrix; unrelated UI changes; production-side test-only APIs; redesigning WDIO/CI; fallback test mocks that bypass the OS dialog.
