# HPA-315 — Native workspace folder-dialog E2E: implementation plan

**Status:** Planned, docs-only draft PR. Implement and verify in this **same PR**; do not open a separate implementation PR.
**Linear:** https://linear.app/cwchanap/issue/HPA-315/desktop-e2e-automate-native-os-folder-dialogs
**Design (authoritative):** [2026-11-15-hpa-315-native-folder-dialog-e2e-design.md](../specs/2026-11-15-hpa-315-native-folder-dialog-e2e-design.md)
**Prerequisite:** HPA-316 merged in https://github.com/cwchanap/DTXWeb/pull/350.
**Target:** Current production Tauri workspace trust flow, not the generic Export Settings picker.


## One-PR contract

Keep exactly **one PR for HPA-315**: initial design, early feasibility gate, platform scripts, the existing E2E spec extension, and real CI evidence all land here. The current PR remains a documentation-only draft until the **first executable commit** adds the macOS preflight immediately after checkout. **Mark this same PR ready for review after that commit**, rather than after the native-picker implementation, because drafts skip the existing native matrix.

If the macOS preflight is red, investigate the genuine permission/session blocker before writing elaborate scripts or repeatedly paying for an instrumented macOS build. Do not claim a skipped/mock test as completion.

No second PR, app feature change, separate test framework, redundant Windows preflight, Linux/Android acceptance, or human QA gate.


## Exact change surface

| Path | Smallest intended change |
| --- | --- |
| **.github/workflows/desktop-e2e-test.yml** | **First executable commit:** macOS-only System Events Accessibility preflight directly after checkout. **After script/test work:** reuse existing logs upload with always() and retention-days: 7. Keep both OS jobs and macOS Codecov. |
| **packages/e2e-desktop/support/native-folder-dialog.ts** | Tiny Node stdlib execFile wrapper: action, path, OS dispatch, bounded timeout, plain stderr/exit diagnostics. No readiness protocol, stage enum or helper-specific tests. |
| **packages/e2e-desktop/scripts/native-folder-dialog-macos.applescript** | Poll for app-owned NSOpenPanel sheet in Drumery window; activate app, wait for nested Go-to-Folder field, navigate on first Return, accept folder on second Return, or cancel. Exit only once the outer sheet closes. |
| **packages/e2e-desktop/scripts/native-folder-dialog-windows.ps1** | Poll for the app-owned Win32 Common Item Dialog and verify UI Automation IDs, select or cancel, exit only once closed. |
| **packages/e2e-desktop/specs/workspace-library.e2e.ts** | **Append as the last `it(...)`** in the existing WDIO suite; reuse fixture/native-root helpers, wait for Library DOM after select and cancel, and assert a non-empty screenshot in existing logs/. |
| **Design, plan, PR verification** | Update any verified runner-specific discoveries and link CI/screenshot artifact evidence. |

Avoid new fixtures, another WDIO spec file, another screenshot artifact step, a cross-platform GUI automation framework, or production Rust/renderer modifications.

## Steps, each committed to the same branch


### 1. First executable commit: prove macOS GUI-scripting capability cheaply

- Add one **macOS-only** step **immediately after Checkout code** in the existing desktop-E2E workflow, before setup-bun, setup-Rust, cache, Rust coverage instrumentation and build. The current workflow file is already in its own path filters.
- The probe must touch an actual accessibility UI element (Automation **and** Accessibility permission), rather than merely enumerating processes. Execute the System Events Dock probe:

      osascript -e 'tell application "System Events" to count UI elements of process "Dock"'

- Do not swallow the exit status or suppress stderr. A TCC denial such as -1719/-25211 is an actionable blocked result. No new macOS utility/runtime is required.
- Commit **only this workflow capability gate as the first executable change**, then **mark the existing draft PR ready for review** so the ready_for_review workflow event runs it. On a red macOS gate, stop work on the scripts until a supported native runner/accessibility approach is demonstrated. A green gate is permission evidence only, **not yet a passing app-owned sheet test**.
- **Trigger sequencing caveat (verified on this PR):** marking ready immediately after pushing the gate commit can race GitHub's PR head update — `ready_for_review` ran against the prior docs-only head, and the gate commit's own `synchronize` event was skipped because it was dispatched while the PR still counted as a draft. A skipped draft run is **not** preflight evidence. When this happens, land a follow-up commit so a `synchronize` event fires after the PR reflects the new head and is non-draft; that run is the actual gate.
- **Do not add a Windows preflight**: existing native Windows/WebView2 tests already run on its interactive desktop. Any UI Automation details are diagnosed through the actual Windows picker helper. Do not duplicate E2E jobs or alter the existing OS matrix.


### 2. Implement a minimal platform controller after the preflight

- Reuse the installed OS scripting facilities. Create the smallest host wrapper in **support/native-folder-dialog.ts** with **execFile(command, [script, action, directory], { timeout })**. The script itself waits/polls for the dialog. No extra ready-handshake message, multiple stage enums, shell interpolation, helper-only test suite or new packages.
- Start its promise before the WDIO Browse click, then await it after the click. Require scripts to positively identify the app-owned dialog and return **exit 0 only after it closes**. Fail with readable stderr (e.g. "dialog not found after 20s"), exit code or timeout if the dialog never appeared/closed.
- **macOS expected shape:** rfd 0.17.2/tauri-plugin-dialog 2.8.4 opens an **NSOpenPanel sheet** on app window **Drumery** in binary/process **dtx-desktop** (Tauri E2E bundling disabled). Probe **sheet 1 of window "Drumery" of process "dtx-desktop"** and verify it exists. Bring the app frontmost; Cmd+Shift+G opens a **nested Go-to-Folder field/sheet**. Explicitly wait for that input before typing the fixture path; press **Return once to navigate**, wait for the outer panel's destination to update, then press **Return again (or click Open/Select Folder)** to accept the folder and close the original NSOpenPanel sheet. Cancel with Escape from the detected outer dialog; never type into an unrelated window or assume the first Return completed selection.
- **Windows expected shape:** rfd Common Item Dialog using **IFileOpenDialog + FOS_PICKFOLDERS**, *not* WinRT IFileOpenPicker or SHBrowseForFolder. Probe **#32770** owned by dtx-desktop and check standard control IDs **1152** (filename edit), **1** (OK/Select Folder), and **2** (Cancel). Verify actual IDs in the Windows spike before relying on them; use built-in PowerShell/.NET UI Automation, not localized text and not pywinauto.
- Preserve genuine native picker behavior; scripts interact with OS dialog only, never invoke Rust directly or edit the E2E fixture's persistence file. Unsupported OS must fail.
- Set a helper timeout within the test-level budget. The existing **Mocha 60s default** is insufficient for two up-to-20s dialogs plus Library loading; explicitly raise the one test's timeout to cover the bounded sequence. No blanket retry/sleep inflation.


### 3. Extend the existing workspace-library E2E spec

- Reuse **specs/workspace-library.e2e.ts**, the existing openWorkspace()/waitForUiDisplayed() helpers, fixtureSongTitle, getPreseededWorkspaceFixture(), and getWorkspaceRoot(). **Append the new `it(...)` last, after the two existing Library tests.** The WDIO config seeds one shared isolated `dtxweb/workspace.json`, and existing `beforeEach(openWorkspace)` requires the Library search field. If a picker test fails after clearing the native root, running it earlier would cause misleading `beforeEach` timeouts in those tests; placing it last confines the failed state to the picker test. No new fixture/reset machinery or second spec file.
- From the preseeded Library, click the real **Clear workspace** button, wait for the empty-state menu, and **waitUntil(getWorkspaceRoot() === null)**. If root remains preseeded, the test must fail.
- Start **driveDialog('select', fixture.workspaceRoot)**; via WDIO open **Workspace menu → Browse for folder…**; await the script's observed dialog closure. Wait until getWorkspaceRoot() matches the already canonicalized **fixture.workspaceRoot**; **also wait for `waitForUiDisplayed('input[placeholder="Search songs and folders..."]')` and `waitForUiDisplayed('span', { text: fixtureSongTitle })`** before asserting no visible loading error. The chooser closing does not prove the async Rust command and Svelte Library rendering have settled.
- Save the post-selection UI with **browser.saveScreenshot(screenshotPath)**. Resolve `screenshotPath` from the spec's `import.meta.url` (e.g. `fileURLToPath(new URL('../logs/native-workspace-picker.png', import.meta.url))`), **not the shell working directory**. Make its parent directory with `mkdirSync(dirname(screenshotPath), { recursive: true })` and immediately **assert `existsSync(screenshotPath) && statSync(screenshotPath).size > 0`** after the screenshot call; the existing artifact upload's `if-no-files-found: warn` and pre-existing `logs/runner.log` cannot enforce screenshot presence. The screenshot plus passing Library DOM assertions are the automated visual evidence; no golden image or human sign-off.
- Start the helper again in **cancel** mode, reopen the real picker from Workspace menu, wait for it to positively identify then cancel the dialog. **Wait again for `waitForUiDisplayed` on both the Library search input and fixture song** before asserting root and rendered content are unchanged. During `workspaceService.selectWorkspace()` (including cancellation), `queueTrustTransition()` starts a loading state that temporarily unmounts the Library search/tree; OS dialog closure can precede the native command's completion and `finishLoading()`. Successful completion leaves the fixture root selected.
- Define one test-level Mocha timeout greater than the sum of the two bounded helper waits and app Library transitions. Do not drive DOM while the native picker has keyboard focus.


### 4. Reuse the existing logs artifact for screenshots

- Keep the current macOS and Windows E2E matrix, WDIO spec glob, shared build/run, Rust coverage, existing failure logging, and affected-path triggers.
- The **only later CI edit** (after the first-commit macOS preflight) is to change the existing **Upload desktop e2e logs** step from **if: failure()** to **if: always()** and set **retention-days: 7**. It already uploads **packages/e2e-desktop/logs/** with a per-OS artifact name. No additional screenshot-upload action or matrix job.
- The spec itself verifies its screenshot **exists and is nonempty** after selection; relying on the artifact action is insufficient because `logs/runner.log` already exists and `if-no-files-found: warn` only checks for any files. If picker selection fails before capture, logs and helper stderr remain the failure diagnostics.
- Preserve all original relaunch and Google Drive crash-recovery checks and macOS-only desktop-e2e-rust Codecov upload.


### 5. Automated validation and evidence

Run the existing commands after the first native implementation commit:

- **bun install --frozen-lockfile**
- **bun run --filter=dtx-e2e-desktop check**
- **bun run --filter=dtx-e2e-desktop test:harness**
- **bun run lint** and the repository's relevant formatter/prettier check
- **bun run --filter=dtx-e2e-desktop e2e:run** after a native E2E build, or through the two-OS GitHub Actions job

Do not claim implementation tests have run during this design-review stage. Put the early macOS TCC probe result, full macOS and Windows native E2E CI run URLs, and each screenshot artifact link in the **PR verification section**, not as new infrastructure or unrelated documents. Screenshot-file presence + automatic DOM assertions are the visual acceptance evidence. No manual test/approval criterion.


## Acceptance criteria

- [ ] **macOS feasibility:** The early macOS-only osascript System Events probe reads an actual Dock UI element on the hosted runner, before any Rust/Tauri build; a permission denial fails the job.
- [ ] **macOS native E2E:** The **last Library spec** clears the trusted root to null, detects the app-owned NSOpenPanel and nested Go-to-Folder field, performs two-stage navigation/confirmation to select the fixture, then waits for the canonical native root and rendered Library. It detects/cancels a second sheet, waits for the Library to reappear, and verifies unchanged root/UI.
- [ ] **Windows native E2E:** The real UI opens a Win32 Common Item Dialog in dtx-desktop, selects the fixture after root clearance, verifies canonical native root and populated Library, and cancels a second real dialog without changing root/UI.
- [ ] **Automated visual evidence:** After `browser.saveScreenshot` the WDIO spec asserts a **nonempty** screenshot file at a path derived from `import.meta.url`; each OS's existing logs artifact contains the named Library screenshot. Post-select and post-cancel Library DOM waits/assertions confirm the search input and fixture song (no mockup, no human sign-off).
- [ ] **CI and quality:** Both original matrix jobs independently pass the complete E2E suite, relaunch and crash-recovery; existing package typecheck, test:harness and lint/format checks pass. Existing artifact step uses always() with 7-day retention. No mock selection, extra matrix, Android/Linux acceptance, production app changes, or second HPA-315 PR.

## Explicitly deferred

Generic export-directory select_folder; Google Drive web-based Picker; scores/database pick_file; multi-dialog localization matrix; unrelated UI changes; production-side test-only APIs; redesigning WDIO/CI; fallback test mocks that bypass the OS dialog.
