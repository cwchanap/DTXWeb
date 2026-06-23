# Desktop App UI Redesign — "Neon Arcade"

**Date:** 2026-06-21
**Package:** `packages/dtx-desktop` (Tauri 2 + Svelte 5 frontend, `src/renderer/`)
**Status:** Design approved (brainstorming) — pending implementation plan

## 1. Summary

Redesign the Drumery desktop app into one cohesive, native-feeling desktop tool with a
distinctive **Neon Arcade** visual identity (violet-black canvas, magenta + cyan neon).
Three changes anchor the work:

1. **Unified app shell** — replace the floating "web-card in a window" look with an
   edge-to-edge **master–detail** layout (nav rail → song list → live detail/preview),
   degrading gracefully to a single-pane layout in small windows.
2. **Redesigned editor** — a **DAW-console** layout: the Phaser chart canvas stays
   dominant and **unchanged**, wrapped by a slim context bar, a collapsible left dock
   (Chart Info / Sounds / Playback), and a neon **transport bar** along the bottom.
3. **New visual identity** — a tokenized Neon Arcade theme, self-hosted display/body/mono
   fonts, glow-based components, and tasteful motion.

All existing functionality is preserved. This is a layout + identity redesign, not a
behavior change.

## 2. Goals & Non-Goals

**Goals**

- Make the app feel like a native desktop instrument, not a web page in a window.
- Eliminate the jarring full-view replacement when selecting a song (master–detail).
- Give the editor a focused, music-tool feel with a persistent transport.
- Establish one consistent, distinctive design language across every screen.
- Add a ⌘K command palette (songs + actions) and a custom top toolbar.

**Non-Goals**

- No changes to the Phaser `Editor` scene's note rendering, lane orientation, or canvas
  internals (explicit user constraint).
- No changes to data models, stores' public APIs, services, Rust backend, or GraphQL.
- No new editing capabilities — the transport surfaces _existing_ preview/EventBus behavior.
- No light theme (Neon Arcade is dark-only); web app is out of scope.

## 3. Hard Constraints

- **Phaser canvas untouched.** The `Editor`/`DesktopPreview` scenes and note rendering
  render exactly as today. We only restyle the Svelte chrome around `gameContainer`.
- **CSP-safe fonts.** `tauri.conf.json` CSP allows `font-src 'self' data:` and no remote
  `style-src`. Fonts must be **self-hosted** (bundled woff2 via `@fontsource/*`), never the
  Google CDN.
- **Stack stays.** Svelte 5 runes, TailwindCSS 4, Lucide icons. Skeleton remains available
  but we replace `Navigation.Rail` with a custom rail for full control of the neon states.
- **Functionality parity.** Every action available today (workspace select/refresh/clear,
  search, sub-workspaces, new song, song details, link/upload/update/export, difficulty
  switch, Main/Sound/Preview, cache clear, login/logout, versions modal, auth/deep-link)
  must remain reachable.
- **Conventions** (CLAUDE.md): `$lib`-style local imports, `const` over `function`,
  `handle*` event names, `class:` directives, early returns, interactive non-buttons get
  `tabindex`/`aria-label`/`on:keydown`, Skeleton components where they fit.

## 4. Visual Identity

### 4.1 Color tokens

Defined once as CSS custom properties and exposed to Tailwind 4 via `@theme`:

| Token        | Hex       | Use                               |
| ------------ | --------- | --------------------------------- |
| `base`       | `#0A0A12` | app background                    |
| `surface-1`  | `#12101F` | panels, rail, cards               |
| `surface-2`  | `#1A1730` | raised/inputs, transport          |
| `surface-3`  | `#221E3A` | hover/raised                      |
| `hairline`   | `#2A2540` | borders/dividers                  |
| `text-hi`    | `#F4F2FB` | headings                          |
| `text`       | `#C9C5DE` | body                              |
| `text-dim`   | `#8682A3` | secondary                         |
| `text-faint` | `#5E5A78` | meta/labels                       |
| `magenta`    | `#FF2D9B` | **primary** accent, active state  |
| `cyan`       | `#21E6FF` | **secondary** accent, focus rings |
| `violet`     | `#A855F7` | tertiary accent                   |
| `amber`      | `#FFB020` | warning / draft                   |
| `green`      | `#34D399` | success / linked                  |
| `red`        | `#FF4D6D` | danger / errors                   |

Glow = colored `box-shadow` (e.g. `0 0 22px -6px var(--magenta)`), used sparingly on
primary actions, focus, active rows, and the transport top edge. Heavy drop shadows are
removed.

### 4.2 Typography (self-hosted)

- **Display** — `Chakra Petch` (600/700): headings, nav labels, buttons, uppercase eyebrows.
- **Body** — `Sora` (400–600): UI text, descriptions, form labels.
- **Mono readouts** — `Martian Mono` (500): BPM, measures, levels, transport.
- **Mono utility** — `JetBrains Mono`: file paths, keys, technical strings.

Packages: `@fontsource/chakra-petch`, `@fontsource/sora`, `@fontsource/martian-mono`,
`@fontsource/jetbrains-mono`, imported in `main.ts` (or `base.css`).

### 4.3 Components

- **Buttons**: primary (magenta fill + glow), secondary (surface-2 + cyan text, cyan border
  on hover), ghost (hairline). Radius ~9px, Chakra Petch label.
- **Inputs**: surface-2, hairline border, focus = cyan ring + soft glow.
- **Badges**: pill, Chakra Petch — `LINKED` (green), `DRAFT` (amber), difficulty (magenta).
- **Cards/rows**: surface-1 + hairline; active row gets inset magenta edge + faint glow.
- **Nav rail item**: icon + label; active = magenta tint + inset left bar + surface-2.
- **Transport bar**: surface-2, magenta top hairline + faint upward glow; circular play
  (magenta glow) / stop; Martian Mono stat readouts; zoom slider with glowing cyan thumb.

### 4.4 Motion (respects `prefers-reduced-motion`)

- Page/section load: staggered fade/translate via `animation-delay`.
- Hover/active: glow and 1px lift transitions (~150–200ms).
- Active/transport: subtle pulse on the play state.
- Reduced-motion: all decorative animation disabled; functional transitions only.

## 5. Information Architecture & App Shell

A single persistent shell replaces the per-route card layouts.

```
┌───────────────────────────────────────────────────────────────┐
│ [native OS controls]   DRUMERY   ⌘K search…           user ▾   │  Top toolbar
├──────┬───────────────────────┬────────────────────────────────┤
│ rail │  list (master)        │  detail / preview (detail)      │
│ ▦    │  ┌─────────────────┐  │  ┌──────────────────────────┐   │
│ ☁    │  │ song row (active)│  │  │ title · badges           │   │
│ ▤    │  │ song row         │  │  │ metadata / lanes preview │   │
│ ⚙    │  │ …                │  │  │ [Open Editor] [Export]…  │   │
│ ◐you │  └─────────────────┘  │  └──────────────────────────┘   │
└──────┴───────────────────────┴────────────────────────────────┘
```

- **Nav rail** (always visible): `Library` (local), `Cloud` (auth only), `Templates`,
  `Settings`; user/account affordance pinned at bottom (replaces navbar email block).
- **Master pane**: context-dependent.
    - _Library_: folder tree + sub-workspaces + filter (today's `Workspace` content).
    - _Cloud_: `SimFileList`.
- **Detail pane**: shows the selected song's details/preview (`SongDetails`) **beside** the
  list instead of replacing it. Empty state when nothing is selected.
- **Templates / Settings**: single full-width content pane (no master/detail split).

### 5.1 Routing

Keep the existing hash routing (`workspace` / `editor/:id` / `login`). Internally, the
selected nav section and selected song become shell state (Svelte runes / `workspaceStore`),
not new routes. `editor/:id` still opens the full editor (Section 8). Login renders within
the shell's content area; local/Library features stay usable while unauthenticated, and
auth gates Cloud (exactly as today).

### 5.2 Responsive behavior (small-window support)

Driven by window width (the C→A fallback the user asked for):

| Width                 | Layout                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `≥ 1100px` (wide)     | Full master–detail: rail + list + detail all visible.                                                                            |
| `760–1099px` (medium) | Rail + list; selecting a song opens detail as a **slide-over/overlay** panel over the list.                                      |
| `< 760px` (narrow)    | **Fallback to shell A**: rail + single content pane; the list is a toggle, detail replaces content (today's behavior, restyled). |

Implementation via a `ResizeObserver`/container query on the shell root; the rail may
collapse to icons-only at the narrowest sizes. The detail pane is also user-collapsible at
wide widths.

### 5.3 Window sizing

`tauri.conf.json`: raise defaults to ~`1200×800`, set `minWidth`/`minHeight` (~`640×560`)
so the narrow fallback remains usable. (Current default is 900×670.)

## 6. Window Chrome & Top Toolbar

- Keep **native OS window controls** (decorations on) — no per-platform reimplementation.
- Add a custom **neon top toolbar** as the first app row: brand mark (left), centered/inline
  ⌘K command-palette trigger, account menu (right) housing user info, Clear Cache, Logout
  (relocated from the current `Navbar`).
- On macOS, optionally adopt the overlay/transparent title-bar style later so the toolbar
  blends with the traffic lights; not required for v1.

## 7. Command Palette (⌘K)

A new global overlay component.

- **Trigger**: ⌘K / Ctrl+K, or the toolbar search field.
- **Sources**:
    - _Songs_ — fuzzy search across the workspace tree + cloud simfiles; Enter opens detail
      (or editor with a modifier).
    - _Actions_ — New Song, switch section (Library/Cloud/Templates/Settings), Open Settings,
      Select/Refresh/Clear Workspace, Clear Cache, Login/Logout, Export selected, etc.
- **Behavior**: keyboard-first (↑/↓/Enter/Esc), grouped results, recent/most-relevant first,
  fully accessible (focus trap, `role="dialog"`, `aria-activedescendant`).
- **Architecture**: `CommandPalette.svelte` + a small `commands` registry so actions are
  declared near their owners; song search reuses existing store data (no new services).

## 8. Editor Redesign — DAW Console

Rework `DesktopEditor.svelte` from "tabbed sidebar + canvas" into a console. **The Phaser
canvas region is unchanged.**

```
┌───────────────────────────────────────────────────────────────┐
│ ← Back   Spice & Wolf   [MASTER ▾ diff]            ● saved      │  Context bar
├────────────────┬──────────────────────────────────────────────┤
│ DOCK (collapse)│                                                │
│ ▾ Chart Info   │   PHASER CANVAS (unchanged: vertical lanes,    │
│   (MainTab)    │    note rendering, measures — as today)        │
│ ▾ Sounds       │                                                │
│   (SoundTab)   │                                                │
│ ▾ Playback     │                                                │
│   (PreviewTab) │                                                │
├────────────────┴──────────────────────────────────────────────┤
│ ▶  ⏹   BPM 145   Measure 12/40           ZOOM ──●──            │  Transport
└───────────────────────────────────────────────────────────────┘
```

- **Context bar**: Back-to-shell, song title, difficulty selector (existing
  `switchChartDifficulty`), dirty/saved indicator. Restyled from today's header.
- **Left dock** (resizable + collapsible — keep existing resize/collapse logic, restyled):
  an accordion wrapping the **existing** tab components as sections, so Chart Info and
  Sounds can be open simultaneously instead of mutually-exclusive tabs:
    - `Chart Info` → `MainTab`
    - `Sounds` → `SoundTab`
    - `Playback` → `PreviewTab` (deeper preview settings)
      Validation/chart-load error banners move into the relevant section, restyled.
- **Transport bar** (new Svelte UI, existing behavior only):
    - Play / Stop → bind to the **existing** preview EventBus events (the same ones
      `PreviewTab` triggers, e.g. `EventType.STOP_PREVIEW` and the preview-start path).
    - BPM / Measure readouts → from `store.currentDtxFile` / `store.measureCount`.
    - Zoom → included **only if** the `Editor` scene already exposes a zoom/scale control;
      otherwise deferred (flagged for verification in §16). No canvas changes to add it.

Difficulty switcher and tab logic reuse current handlers; only presentation changes.

## 9. Component Inventory & File-Level Changes

**New components** (`src/renderer/src/components/`)

- `AppShell.svelte` — shell grid (rail + master + detail), responsive controller.
- `NavRail.svelte` — custom neon nav rail (replaces Skeleton `Navigation.Rail`).
- `TopToolbar.svelte` — brand + ⌘K trigger + account menu (absorbs `Navbar` actions).
- `CommandPalette.svelte` (+ `commands.ts` registry).
- `DetailPane.svelte` — wraps `SongDetails` + empty state for master–detail.
- Editor: `EditorDock.svelte` (accordion), `TransportBar.svelte`, `EditorContextBar.svelte`.
- Small primitives if useful: `NeonButton`, `Badge` (or Tailwind utility classes only).

**Reworked**

- `App.svelte` — render `AppShell`; keep routing/auth/effects.
- `Workspace.svelte` — becomes the **Library master pane** content (tree/sub-workspaces/
  filter); rail + header chrome move to shell.
- `SongDetails.svelte` — rendered inside `DetailPane` (logic intact, restyle header/snippets).
- `DesktopEditor.svelte` — recomposed into context bar + dock + transport + canvas
  (initialization, file loading, difficulty, EventBus wiring all preserved).
- `Navbar.svelte` — removed; its functions move into `TopToolbar` / account menu.
- `SimFileList`, `Templates`, `Settings`, `WorkspaceTree`, `SubWorkspaceItem`,
  `WorkspaceBookmarksMenu`, `Login`, `VersionsModal`, `CloudSongAutocomplete` — restyled to
  the new tokens; structure largely intact.

**Theme/assets**

- `assets/base.css` — Neon Arcade tokens via `@theme`, font imports, base element styles.
- `main.ts` — keep forced dark; import `@fontsource/*`.
- `tauri.conf.json` — window default/min sizes (§5.3).

## 10. Theming Implementation

- Define tokens as CSS variables in `base.css`; expose via Tailwind 4 `@theme` so utilities
  like `bg-surface-1`, `text-hi`, `border-hairline`, `text-magenta` exist.
- Prefer scoped `<style>` + `@apply` for complex components (per CLAUDE.md) over long inline
  class strings.
- Keep Skeleton imports for any components still using it, but the rail and bespoke neon
  elements are custom. Avoid fighting the `cerberus` theme — our tokens win for app chrome.

## 11. Data Flow & State

- All stores (`workspaceStore`, `authStore`, `simFileStore`, `settingsStore`,
  `templateStore`, `editorMappingStore`, `bookmarkStore`) keep their current public APIs.
- New shell state: `activeSection` (rail) and `selectedSong` — extend `workspaceStore`
  (it already tracks `selectedSong`/`showSongDetails`) rather than adding a store.
- Services, Rust IPC (`desktopHost`), and GraphQL are unchanged.

## 12. Empty / Loading / Error States

Restyle existing states to the new identity (no behavior change):

- Empty: no-workspace prompt, no-song-selected detail pane, empty search results.
- Loading: neon spinner/skeleton rows.
- Errors: amber/red banners reusing current error variables and retry handlers.

## 13. Accessibility

- Maintain keyboard access throughout; command palette and overlays use focus traps and
  proper ARIA roles.
- Interactive non-button elements keep `tabindex="0"`, `aria-label`, `on:keydown`.
- Preserve the editor's existing keyboard resize affordance for the dock.
- Verify contrast of neon-on-dark text meets AA for body text (accents used for large/bold
  or non-text emphasis).

## 14. Testing

- Reuse global mocks in `__mocks__/` (Phaser, EventBus, audioDecoder, svelte-i18n); follow
  `Preview.test.ts` patterns.
- Update existing component tests (`Navbar.test.ts` → toolbar/account; `Workspace.test.ts`;
  `DesktopEditor.test.ts`; `SongDetails.test.ts`) for the new structure.
- New tests: `AppShell` responsive mode selection, `CommandPalette` search/keyboard/actions,
  `TransportBar` play/stop wiring + readout binding.
- Keep tests logic-focused (no trivial assertions). Run via
  `bun run --filter=dtx-desktop test`.

## 15. Phasing (suggested implementation order)

1. **Theme foundation** — tokens, fonts, base styles; restyle in place (no structure change).
2. **App shell** — `AppShell` + `NavRail` + `TopToolbar`; wire Library/Cloud/Templates/
   Settings; remove `Navbar`.
3. **Master–detail + responsive** — `DetailPane`, breakpoints, window sizing.
4. **Editor console** — context bar + dock accordion + transport (existing behavior only).
5. **Command palette** — ⌘K overlay + registry.
6. **Polish & motion** — staggered reveals, glow micro-interactions, reduced-motion.

Each phase is independently shippable and keeps the app working.

## 16. To Verify During Implementation

- Whether the Phaser `Editor` scene exposes a zoom/scale hook for the transport's zoom
  control. If not, ship the transport without zoom (deferred) — no canvas changes to add it.
- The exact existing EventBus events for **starting** preview (stop is `STOP_PREVIEW`); the
  transport must reuse whatever `PreviewTab` already calls.
- Confirm `@fontsource` woff2 loading passes the Tauri CSP at runtime.
- Confirm container queries / `ResizeObserver` behave correctly inside the Tauri webview for
  the responsive shell.
