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

Add one focused WebdriverIO spec under **packages/e2e-desktop/specs/**. Start with the existing isolated fixture, **clear the workspace using the Library UI**, then verify the Rust native root is null. This removes the false-positive possibility of simply observing the preseeded root.

Drive **Workspace menu → Browse for folder…** with WebdriverIO. A host-side OS helper must positively identify the **real dialog belonging to the desktop app** before supplying the existing fixture path. It must not directly invoke select_workspace_folder, inject a fake result, rewrite workspace.json, or spoof renderer storage.

Once the dialog closes, assert (1) Rust get_workspace_root returns the canonical fixture path, (2) the Library search field and **Critical Workspace Song** are visible with no loading error, and (3) a deterministic post-selection screenshot is saved. Then reopen the picker through the menu, cancel it, and assert the native root, selected song, and Library UI are unchanged. A successful run ends at the original preseeded root, preserving later test assumptions.

### 2. Keep the existing harness; add tiny platform adapters

Use a small TypeScript helper in **packages/e2e-desktop/support/** to select one OS-specific script, start watching for the picker **before** the Browse click, and await success/failure with a bounded timeout. Use child-process argument arrays, not interpolated shell commands. Include stderr, exit code, and failure stage in diagnostics: dialog never appeared, accessibility denied, selection failed, or dialog did not close. No fixed pixel positions, blind global keyboard injection, or arbitrary sleeps as proof of success.

- **macOS:** Prefer installed osascript/System Events to identify the app-owned NSOpenPanel or sheet, use its *Go to Folder* navigation, confirm the selected fixture, and support cancellation. Apple notes GUI scripting requires Accessibility/Automation permissions: https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html. A GUI/permissions **preflight on the hosted runner** is mandatory, not assumed.
- **Windows:** Prefer a checked-in PowerShell script using built-in .NET UI Automation to identify the application-owned folder-picker, enter the fixture path, select/cancel, and observe dialog closure. Use existing Windows runner tooling; add Python/pywinauto or other dependencies only if a reproduced failure proves the built-in path inadequate.
- **Other platforms:** Fail with an explicit unsupported-platform error. Android and Linux are not acceptance targets.

WebdriverIO owns the renderer click and the final Rust/DOM assertions. The platform scripts interact only with the native OS dialog. No production Tauri or workspace-state change.

### 3. Reuse CI and collect visual evidence

Keep the HPA-316 macOS/Windows matrix, frozen install, existing embedded driver, test build, harness checks, and affected-path triggers. Add only a small platform-automation preflight and the necessary screenshot upload to the current job. Preserve existing per-OS logs; upload named screenshots on both pass and fail with bounded artifact retention.

The visual check is the screenshot of the normal, correctly populated desktop Library **and** automatic assertions for the actual selected folder and song. No new mockup, golden-image snapshot framework, or human sign-off gate.

**Fail, never skip**, when the native dialog does not appear, cannot be controlled, or the runner lacks Accessibility privileges. Particularly on macOS, a noninteractive permission prompt is a blocking CI capability result, not an accepted test skip. Establish feasibility before adding heavier automation; if a hosted runner cannot support the minimal approach, revise **this same PR** toward a demonstrated viable target-OS UI automation method before claiming acceptance.

### 4. One PR per ticket

Initial docs-only draft PR becomes the **single** implementation and verification PR for HPA-315. After the first executable implementation commit, mark it ready for review so the existing ready_for_review trigger runs native CI; record CI runs, screenshots and permission findings in its PR body. Do not create a separate implementation PR.

## Automated E2E acceptance criteria

| Target | Required outcome |
| --- | --- |
| **macOS** | WDIO opens the real NSOpenPanel from the Library menu. After clearing the native root, the dialog chooses the fixture and Rust reports the canonical path. The Library search and **Critical Workspace Song** render correctly. Reopening and canceling leaves root and UI unchanged. Save a post-selection UI screenshot and inspect against the existing Library layout (no mockup attached). |
| **Windows** | Same actual folder-picker flow on the Windows .exe/WebView2 application, with canonical Windows path normalization, selection and cancellation assertions, and a post-selection Library screenshot. |
| **CI/checks** | Both independent native E2E matrix jobs execute the new spec and preserve logs/screenshots. Pass the E2E package typecheck, existing test:harness, and relevant repository lint/format CI. No mock selection, permission-based skip, second PR, or human acceptance step. |

## Risks and non-goals

- macOS Accessibility/Automation privileges are the primary feasibility risk; local macOS success **does not** substitute for a successful hosted runner. Fail clearly and adjust the plan using real CI evidence.
- Native sheet/window identification and OS localization must use roles and app ownership rather than screen coordinates or localized labels where possible.
- Compare Rust canonical paths with the existing canonicalExpectedPath() helper (Windows 8.3 path and verbatim-prefix handling); do not use unnormalized typed strings.
- An open native dialog steals focus from the WebView; coordinate host-side dialog readiness and completion before new WDIO DOM assertions.
- The test may clear only its isolated E2E native data and must select the original fixture on success.

**Non-goals:** generic Export Settings select_folder; Google Drive or scores file pickers; Linux/Android E2E acceptance; production UI/IPC changes; a new test framework or matrix; manual QA sign-off.
