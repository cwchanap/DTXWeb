# HPA-315 — Native workspace folder-dialog E2E on macOS and Windows

**Status:** Proposed. Planning-only draft PR initially; implement and verify on this **same PR**.
**Linear:** https://linear.app/cwchanap/issue/HPA-315/desktop-e2e-automate-native-os-folder-dialogs
**Implementation plan:** [2026-11-15-hpa-315-native-folder-dialog-e2e.md](../plans/2026-11-15-hpa-315-native-folder-dialog-e2e.md)
**Prerequisite:** HPA-316, merged in https://github.com/cwchanap/DTXWeb/pull/350 on 2026-11-14.

## Goal

Prove the shipped desktop app can open a **real native OS folder chooser**, select a workspace, persist the Rust-owned trusted root, and display the selected song library on **macOS and Windows**. Existing Tauri/WebdriverIO E2E tests cover native IPC and preseeded roots but not actual OS folder selection.

## Current repository evidence (main, 2026-11-15)

- **.github/workflows/desktop-e2e-test.yml** already runs macos-latest and windows-latest with fail-fast disabled, builds native debug Tauri binaries, and runs WDIO plus relaunch/crash-recovery. Draft PRs skip this expensive job.
- **packages/e2e-desktop/wdio.conf.ts** creates isolated native app data and a fixture directory, and preseeds dtxweb/workspace.json. The E2E spec glob runs with the embedded WDIO Tauri driver.
- **support/app.ts:openWorkspace()** merely restores the preseeded library; it does not interact with a native folder dialog.
- **Workspace.svelte** renders WorkspaceBookmarksMenu even when no root exists. Its **Workspace menu** → **Browse for folder…** action calls workspaceService.selectWorkspace() → desktopHost.selectWorkspaceFolder().
- **src-tauri/src/workspace.rs:select_workspace_folder** opens a real tauri-plugin-dialog pick_folder and writes the canonical path through WorkspaceRootState. **src-tauri/src/filesystem.rs:select_folder** is a separate generic Export Settings picker. The Linear issue predates this split: test the *trusted workspace* picker, not the wrong command.
- Existing **support/native.ts:getWorkspaceRoot()** reads the real Rust authoritative root; **support/workspace-fixture.ts:getPreseededWorkspaceFixture()** and canonicalExpectedPath() expose the fixture with the song title **Critical Workspace Song**.
- HPA-315 does not include a mockup. The current desktop Library view is the visual baseline.

## Design decisions


### 1. Exercise the native picker through the real UI

Extend existing **packages/e2e-desktop/specs/workspace-library.e2e.ts** with one focused picker scenario **appended after the two existing tests**. Reuse **support/app.ts** openWorkspace()/waitForUiDisplayed(), **support/native.ts** getWorkspaceRoot(), and the existing fixture instead of creating a separate spec/fixture. The E2E runner seeds one shared isolated workspace.json, while this suite's beforeEach(openWorkspace) assumes a populated Library; placing the destructive picker scenario last prevents a mid-test failure after Clear from cascading into the two existing tests as misleading setup timeouts.

From the preseeded, isolated workspace, click **Clear workspace** in the real Library UI and wait until the **native** get_workspace_root result is null. This avoids the false positive of observing the preseeded root. The empty view still renders **Workspace menu → Browse for folder…**. Arm the OS helper **before** WDIO clicks Browse. The helper must see the actual app-owned dialog, select the fixture, and finish only when the picker closes. It must not invoke select_workspace_folder itself or spoof the result, workspace.json, or renderer storage.

After the native chooser closes, **wait for the Library search field and Critical Workspace Song to reappear** through waitForUiDisplayed() before asserting that native root equals **fixture.workspaceRoot** (getPreseededWorkspaceFixture() already canonicalizes it) and that the populated UI has no loading error. Save a named screenshot through browser.saveScreenshot() to **packages/e2e-desktop/logs/**, resolving the path relative to the spec's import.meta.url and explicitly asserting the file exists and has nonzero size. Reopen the real picker from the selected workspace, positively detect and cancel it, and **wait again** for the search field and song to reappear before asserting unchanged root/Library. The workspaceService trust transition temporarily replaces the Library with a loading view even when the picker is ultimately cancelled; native window closure alone is not proof that Rust IPC/Svelte finished. A passing test ends with the original fixture root restored.


### 2. Keep the existing harness; add tiny platform adapters

Keep one small TypeScript wrapper under **packages/e2e-desktop/support/native-folder-dialog.ts**, calling Node standard-library **execFile(command, [script, action, directory], { timeout })**. Script polling itself detects the dialog; the wrapper need not parse a readiness handshake or a stage enum. Start the promise before Browse, then await the script after clicking. Script exits 0 only after positively detecting the dialog and its subsequent closure. On failure, expose stderr, exit code and timeout (e.g. "dialog not found after 20s"). No helper-only test suite, blind/global keystrokes, screen coordinates, or new Python/driver dependency.

The lockfile selects **rfd 0.17.2**, **tauri-plugin-dialog 2.8.4** and **tauri-plugin-wdio-webdriver 1.5.1**. Based on their expected behavior and the E2E config, use these *starting hypotheses* and verify them in the actual native runner:

- **macOS:** Expect **NSOpenPanel as a sheet**, attached to main window **Drumery** in process **dtx-desktop** (Tauri bundling is disabled). Try **sheet 1 of window "Drumery" of process "dtx-desktop"** in System Events. Positively identify it and set the app frontmost; Cmd+Shift+G opens the **nested Go-to-Folder field**, which must be detected before typing. The **first Return navigates** the file dialog to that path; after confirming navigation completes, a **second Return (or Open button)** accepts the directory and closes the *outer* sheet. Cancel via Escape after detecting the actual picker. Never type into an unrelated window. Treat this as the candidate flow to verify on macOS CI, not as completed test evidence.
- **Windows:** Expect rfd's Win32 **Common Item Dialog** (IFileOpenDialog + FOS_PICKFOLDERS), **not** SHBrowseForFolder or the WinRT IFileOpenPicker. Try the top-level **#32770** window owned by the **dtx-desktop** process. Probe the candidate accessibility/control IDs **1152** (filename edit), **1** (confirm), **2** (cancel) before relying on them. Use built-in PowerShell/.NET UI Automation, not localized captions.

Keep the host helper deadline below the Mocha test timeout; because this scenario opens two dialogs and waits for Library reloads, set an explicit test timeout above the combined bounded helper waits (the default in wdio.conf.ts is 60 seconds). Non-target platforms and denied native access must **fail**, never pass by skipping.

### Early macOS-only feasibility gate

The **first executable commit** must add a **macOS-only** Accessibility/Automation preflight step to the current desktop E2E workflow **directly after Checkout code**, before Bun/Rust installs or Tauri compilation. Then mark **the same PR ready for review** to trigger the current ready_for_review workflow path. Check a *real UI element*, not merely process enumeration:

    osascript -e 'tell application "System Events" to count UI elements of process "Dock"'

This exercises Automation (osascript → System Events) and Accessibility (reading UI elements). Capture useful failure output; -1719/-25211 can indicate TCC denial. Failure stops the macOS job before the costly build. A green probe is only a capability gate: the real app-owned sheet must still pass the later E2E.

**No Windows preflight:** current Windows WebView2 native E2E already proves an interactive session. Let the real Windows dialog helper report any UIA failure. If macOS permissions fail, treat the gate as blocked and establish a viable target-OS approach on **this same PR**; do not skip or mock selection.


### 3. Reuse CI and collect visual evidence

Reuse the current **macos-latest/windows-latest** matrix, build/run/harness, affected-path triggers, and macOS-only Codecov setup. Beyond the early macOS preflight, the only workflow edit is to reuse **Upload desktop e2e logs**: change **if: failure()** to **if: always()** and set **retention-days: 7**. It already uploads **packages/e2e-desktop/logs/** with the OS in the artifact name, so no new screenshot upload action or extra job.

The spec creates its logs/ directory, resolves the screenshot from **import.meta.url** (not cwd), saves with browser.saveScreenshot(), and immediately asserts **existsSync(path) && statSync(path).size > 0**. An artifact upload alone cannot prove screenshot presence: logs/runner.log always exists and if-no-files-found: warn does not require a particular file. The **automated visual check** is this nonempty screenshot plus the Library DOM assertions (visible search field and fixture title, no error) **after both selection and cancellation settle**; the existing per-OS artifact retains the screenshot. No UI mockup is attached and **no human inspection is an acceptance gate**.

### 4. One PR per ticket

Initial docs-only draft PR becomes the **single** implementation and verification PR for HPA-315. After the early macOS preflight is committed, mark it ready for review to exercise the gate before implementing OS drivers; record CI runs, screenshots and permission findings in its PR body. Do not create a separate implementation PR.


## Automated E2E acceptance criteria

| Target | Required outcome |
| --- | --- |
| **macOS** | Preflight reads actual System Events UI elements **before any build**. The **last workspace-library scenario** clears Rust root, detects the real app-owned NSOpenPanel and its Go-to-Folder field, completes two-step navigation/confirmation, and waits for canonical root plus Library DOM. Reopens and cancels the real picker, waits for Library content to return, and verifies unchanged state. The screenshot saved under logs/ is verified nonempty by the spec. |
| **Windows** | The last workspace-library scenario clears Rust root, drives the real Common Item Dialog, waits for canonical root and Library DOM, then detects/cancels the second picker and waits for the Library to return before checking unchanged state. The screenshot saved under logs/ is verified nonempty by the spec. |
| **CI/checks** | Both OS matrix jobs execute the picker scenario and existing E2E suite; package typecheck, harness, lint/format, relaunch/crash recovery remain unchanged. Existing logs artifact uploads with **always()** and 7-day retention. No fake selection, permission-based skip, extra jobs, second PR or human acceptance. |

## Risks and non-goals

- macOS Accessibility/Automation privileges are the primary feasibility risk. The early System Events UI-element probe must pass on the hosted runner, and the later real NSOpenPanel test must also pass; local macOS success does not substitute. Fail clearly and adjust the plan using real CI evidence.
- Native sheet/window identification and OS localization must use roles and app ownership rather than screen coordinates or localized labels where possible.
- Compare Rust canonical paths with the existing canonicalExpectedPath() helper (Windows 8.3 path and verbatim-prefix handling); do not use unnormalized typed strings.
- An open native dialog steals focus from the WebView; coordinate host-side dialog readiness and completion before new WDIO DOM assertions.
- The test may clear only its isolated E2E native data and must select the original fixture on success.

**Non-goals:** generic Export Settings select_folder; Google Drive or scores file pickers; Linux/Android E2E acceptance; production UI/IPC changes; a new test framework or matrix; manual QA sign-off.
