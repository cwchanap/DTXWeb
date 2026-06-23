# Desktop App UI Redesign ("Neon Arcade") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Drumery desktop frontend into a unified, native-feeling master–detail shell with a redesigned DAW-console editor and a distinctive "Neon Arcade" visual identity, preserving all existing functionality.

**Architecture:** A single persistent app shell (custom neon top toolbar + nav rail + master/detail panes) replaces today's per-route floating cards. The editor is recomposed around the **unchanged** Phaser canvas with a context bar, a collapsible Chart Info / Sounds / Playback dock, and a bottom transport bar that drives existing EventBus/store behavior. A ⌘K command palette spans songs + actions. The redesign ships in 6 independently-shippable phases.

**Tech Stack:** Svelte 5 (runes), TailwindCSS 4 (`@theme` tokens), Tauri 2, Lucide, Vitest + `@testing-library/svelte`, self-hosted `@fontsource` fonts, `@dtx/common` (Phaser game + editor tabs + shared `store`).

**Spec:** `docs/superpowers/specs/2026-06-21-desktop-ui-redesign-design.md`

## Global Constraints

Every task implicitly inherits these. Copied from the spec:

- **Phaser canvas untouched.** Do not modify `@dtx/common` `Editor`/`DesktopPreview` scenes or note rendering. Only restyle the Svelte chrome around `gameContainer`.
- **CSP-safe fonts.** Fonts must be self-hosted via `@fontsource/*` (bundled woff2). Never reference the Google Fonts CDN at runtime (`tauri.conf.json` CSP allows only `font-src 'self' data:`).
- **Stack stays.** Svelte 5 runes, TailwindCSS 4, Lucide icons. No new runtime libraries unless a task says so; implement small utilities (e.g. fuzzy search) in-repo rather than adding deps.
- **Functionality parity.** Every action available today must remain reachable: workspace select/refresh/clear, search/filter, sub-workspaces, new song, song details (link/upload/update/export), difficulty switch, Main/Sound/Preview, cache clear, login/logout, versions modal, deep-link auth.
- **Dark-only.** Keep forced dark mode (`document.documentElement.classList.add('dark')` in `main.ts`).
- **Conventions (CLAUDE.md):** `const` over `function`; `handle*` event-handler names; `class:` directives over ternaries in class lists; early returns; top-level/`$lib`-style imports (no relative cross-package); interactive non-`<button>` elements need `tabindex="0"` + `aria-label` + `on:keydown`; use `@apply` in scoped `<style>` for complex components instead of giant inline class strings; only build `@dtx/common` if you changed it (you won't).
- **Testing:** Vitest + jsdom; follow `Preview.test.ts`/`Navbar.test.ts` patterns (`vi.mock` at top, `beforeEach`/`afterEach` cleanup). Mock `@lucide/svelte`, services, and `@dtx/common`/`@dtx/common/game` as needed. No trivial tests. Run with `bun run --filter=dtx-desktop test`.
- **Working dir for commands:** repo root `/Users/chanwaichan/workspace/drumery` unless noted.

## File Structure

New files (all under `packages/dtx-desktop/src/renderer/src/`):

| File                                        | Responsibility                                               |
| ------------------------------------------- | ------------------------------------------------------------ | -------- | ---------- |
| `lib/shellMode.ts`                          | Pure `resolveShellMode(width)` → `'wide'                     | 'medium' | 'narrow'`. |
| `lib/fuzzy.ts`                              | Pure `fuzzyScore(query, text)` + `searchItems`.              |
| `commands/commands.ts`                      | `buildCommands(ctx)` → command registry for ⌘K.              |
| `components/shell/AppShell.svelte`          | Top-level shell: toolbar + rail + master/detail; responsive. |
| `components/shell/TopToolbar.svelte`        | Brand + ⌘K trigger + account menu (absorbs `Navbar`).        |
| `components/shell/NavRail.svelte`           | Neon nav rail (Library/Cloud/Templates/Settings).            |
| `components/shell/DetailPane.svelte`        | Wraps `SongDetails` + empty state.                           |
| `components/shell/CommandPalette.svelte`    | ⌘K overlay.                                                  |
| `components/editor/EditorContextBar.svelte` | Editor top bar (back/title/difficulty/dirty).                |
| `components/editor/EditorDock.svelte`       | Collapsible Chart Info / Sounds / Playback accordion.        |
| `components/editor/TransportBar.svelte`     | Play/stop/BPM/measures/zoom.                                 |
| `lib/motion.css` (or in `base.css`)         | Reveal/glow keyframes + reduced-motion guards.               |

Modified: `stores/workspaceStore.ts`, `App.svelte`, `components/Workspace.svelte`, `components/SongDetails.svelte`, `components/DesktopEditor.svelte`, `assets/base.css`, `main.ts`, `package.json`, `src-tauri/tauri.conf.json`, plus restyle of `SimFileList`, `Templates`, `Settings`, `WorkspaceTree`, `SubWorkspaceItem`, `WorkspaceBookmarksMenu`, `Login`, `VersionsModal`, `NewSong`, `CloudSongAutocomplete`. Removed: `components/Navbar.svelte` (+ `Navbar.test.ts` → `TopToolbar.test.ts`).

**Spec reconciliation:** account controls (user/clear-cache/logout/login) live in **`TopToolbar`** only (single source); the nav rail holds just the four sections. This supersedes the spec's note about an account block in the rail.

> **CSS-only tasks** (tokens, base styles, motion, pure restyles) cannot be unit-tested meaningfully. For those, the "test" step is `bun run --filter=dtx-desktop typecheck` plus the existing component tests still passing; the executing human/agent verifies visually when running the app. Logic tasks use real TDD.

---

# Phase 1 — Theme Foundation

## Task 1: Self-host fonts

**Files:**

- Modify: `packages/dtx-desktop/package.json` (dependencies)
- Modify: `packages/dtx-desktop/src/renderer/src/main.ts`

**Interfaces:**

- Produces: global availability of font families `Chakra Petch`, `Sora`, `Martian Mono`, `JetBrains Mono` (used by Task 2 `@theme`).

- [ ] **Step 1: Add font dependencies**

Run:

```bash
cd packages/dtx-desktop && bun add @fontsource/chakra-petch @fontsource/sora @fontsource/martian-mono @fontsource/jetbrains-mono
```

Expected: four `@fontsource/*` entries added to `package.json` dependencies; install succeeds.

- [ ] **Step 2: Import the weights we use in `main.ts`**

Add near the top of `main.ts`, after `import './assets/main.css';`:

```ts
// Self-hosted fonts (bundled woff2 — CSP-safe, no Google CDN)
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/martian-mono/400.css';
import '@fontsource/martian-mono/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
```

- [ ] **Step 3: Verify typecheck and tests still pass**

Run:

```bash
bun run --filter=dtx-desktop typecheck && bun run --filter=dtx-desktop test
```

Expected: PASS (no type/test regressions).

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-desktop/package.json packages/dtx-desktop/src/renderer/src/main.ts bun.lock
git commit -m "feat(desktop): self-host Neon Arcade fonts via @fontsource"
```

## Task 2: Neon Arcade theme tokens + base styles

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/assets/base.css`

**Interfaces:**

- Produces: Tailwind utilities `bg-base`, `bg-surface-1|2|3`, `border-hairline`, `text-hi|text-base|text-dim|text-faint`, `text-magenta|cyan|violet|amber|green|red` (+ `bg-*` equivalents), and `font-display|font-body|font-mono|font-mono-alt`. Consumed by every later component task.

- [ ] **Step 1: Append the `@theme` token block and base styles to `base.css`**

Append after the existing imports:

```css
@theme {
	--color-base: #0a0a12;
	--color-surface-1: #12101f;
	--color-surface-2: #1a1730;
	--color-surface-3: #221e3a;
	--color-hairline: #2a2540;
	--color-hi: #f4f2fb;
	--color-base-text: #c9c5de;
	--color-dim: #8682a3;
	--color-faint: #5e5a78;
	--color-magenta: #ff2d9b;
	--color-cyan: #21e6ff;
	--color-violet: #a855f7;
	--color-amber: #ffb020;
	--color-green: #34d399;
	--color-red: #ff4d6d;

	--font-display: 'Chakra Petch', sans-serif;
	--font-body: 'Sora', sans-serif;
	--font-mono: 'Martian Mono', monospace;
	--font-mono-alt: 'JetBrains Mono', monospace;
}

:root {
	color-scheme: dark;
}

body {
	background-color: var(--color-base);
	color: var(--color-base-text);
	font-family: var(--font-body);
}

::selection {
	background: color-mix(in srgb, var(--color-magenta) 40%, transparent);
	color: var(--color-hi);
}

/* Neon scrollbars */
::-webkit-scrollbar {
	width: 10px;
	height: 10px;
}
::-webkit-scrollbar-track {
	background: var(--color-surface-1);
}
::-webkit-scrollbar-thumb {
	background: var(--color-surface-3);
	border-radius: 6px;
	border: 2px solid var(--color-surface-1);
}
::-webkit-scrollbar-thumb:hover {
	background: color-mix(in srgb, var(--color-magenta) 50%, var(--color-surface-3));
}
```

Note: `text-base` already exists in Tailwind as a font-size utility, so the body text color token is named `--color-base-text` → use `text-base-text`. Headings use `text-hi`.

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run --filter=dtx-desktop typecheck`
Expected: PASS. (CSS tokens are validated when components consume them in later tasks; a Tailwind build error would surface in `bun run --filter=dtx-desktop test` via component renders.)

- [ ] **Step 3: Run the existing test suite to confirm no regression**

Run: `bun run --filter=dtx-desktop test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/assets/base.css
git commit -m "feat(desktop): add Neon Arcade theme tokens and base styles"
```

---

# Phase 2 — App Shell State + Chrome

## Task 3: Add `activeSection` to the workspace store

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts`
- Test: `packages/dtx-desktop/src/renderer/src/stores/workspaceStore.test.ts`

**Interfaces:**

- Produces: `WorkspaceState.activeSection: ShellSection` where `type ShellSection = 'library' | 'cloud' | 'templates' | 'settings'`; method `setActiveSection(section: ShellSection): void`. Consumed by `NavRail`, `AppShell`.

- [ ] **Step 1: Write the failing test**

Add to `workspaceStore.test.ts`:

```ts
describe('activeSection', () => {
	beforeEach(() => workspaceStore.reset());

	it('defaults to library', () => {
		const s = get(workspaceStore);
		expect(s.activeSection).toBe('library');
	});

	it('setActiveSection switches section and clears song selection', () => {
		workspaceStore.selectSong({ name: 'x', path: '/x' } as TreeNode);
		workspaceStore.setActiveSection('cloud');
		const s = get(workspaceStore);
		expect(s.activeSection).toBe('cloud');
		expect(s.selectedSong).toBeNull();
		expect(s.showSongDetails).toBe(false);
		expect(s.showTemplates).toBe(false);
	});

	it('setActiveSection("templates") sets showTemplates true', () => {
		workspaceStore.setActiveSection('templates');
		expect(get(workspaceStore).showTemplates).toBe(true);
	});
});
```

Ensure `import { get } from 'svelte/store';` and `TreeNode` import exist in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- workspaceStore.test.ts`
Expected: FAIL (`activeSection` undefined / `setActiveSection` is not a function).

- [ ] **Step 3: Implement**

In `workspaceStore.ts`: add the type and field, and the method.

```ts
export type ShellSection = 'library' | 'cloud' | 'templates' | 'settings';
```

Add `activeSection: ShellSection;` to `WorkspaceState`, `activeSection: 'library'` to `initialState`, and inside the returned object:

```ts
setActiveSection: (section: ShellSection) => {
	update((state) => ({
		...state,
		activeSection: section,
		showTemplates: section === 'templates',
		selectedSong: null,
		showSongDetails: false,
		showNewSong: false
	}));
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- workspaceStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/stores/workspaceStore.ts packages/dtx-desktop/src/renderer/src/stores/workspaceStore.test.ts
git commit -m "feat(desktop): add activeSection shell state to workspace store"
```

## Task 4: `resolveShellMode` responsive helper

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/lib/shellMode.ts`
- Test: `packages/dtx-desktop/src/renderer/src/lib/shellMode.test.ts`

**Interfaces:**

- Produces: `type ShellMode = 'wide' | 'medium' | 'narrow'`; `resolveShellMode(width: number): ShellMode`. Consumed by `AppShell`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveShellMode } from './shellMode';

describe('resolveShellMode', () => {
	it('returns wide at >= 1100', () => {
		expect(resolveShellMode(1100)).toBe('wide');
		expect(resolveShellMode(1600)).toBe('wide');
	});
	it('returns medium between 760 and 1099', () => {
		expect(resolveShellMode(760)).toBe('medium');
		expect(resolveShellMode(1099)).toBe('medium');
	});
	it('returns narrow below 760', () => {
		expect(resolveShellMode(759)).toBe('narrow');
		expect(resolveShellMode(320)).toBe('narrow');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- shellMode.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export type ShellMode = 'wide' | 'medium' | 'narrow';

export const resolveShellMode = (width: number): ShellMode => {
	if (width >= 1100) return 'wide';
	if (width >= 760) return 'medium';
	return 'narrow';
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- shellMode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/lib/shellMode.ts packages/dtx-desktop/src/renderer/src/lib/shellMode.test.ts
git commit -m "feat(desktop): add resolveShellMode responsive helper"
```

## Task 5: `NavRail` component

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/shell/NavRail.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/shell/NavRail.test.ts`

**Interfaces:**

- Consumes: `workspaceStore` (`activeSection`, `setActiveSection`), `authStore` (`isAuthenticated`).
- Produces: a vertical rail rendering sections; `Cloud` only when authenticated. Emits selection via `workspaceStore.setActiveSection`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');

import NavRail from './NavRail.svelte';

describe('NavRail', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('shows Library, Templates and Settings when unauthenticated', () => {
		render(NavRail);
		expect(screen.getByRole('button', { name: /Library/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Templates/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Cloud/i })).not.toBeInTheDocument();
	});

	it('shows Cloud when authenticated', () => {
		authStore.setUser({ id: 'u1', email: 'a@b.c', name: 'A' });
		render(NavRail);
		expect(screen.getByRole('button', { name: /Cloud/i })).toBeInTheDocument();
	});

	it('switches active section on click', async () => {
		render(NavRail);
		await fireEvent.click(screen.getByRole('button', { name: /Templates/i }));
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('templates');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- NavRail.test.ts`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `NavRail.svelte`**

```svelte
<script lang="ts">
	import { HardDrive, Cloud, FileText, Settings } from '@lucide/svelte';
	import { authStore } from '../../stores/authStore';
	import { workspaceStore, type ShellSection } from '../../stores/workspaceStore';

	type Item = { id: ShellSection; label: string; icon: typeof HardDrive; authOnly?: boolean };

	const items: Item[] = [
		{ id: 'library', label: 'Library', icon: HardDrive },
		{ id: 'cloud', label: 'Cloud', icon: Cloud, authOnly: true },
		{ id: 'templates', label: 'Templates', icon: FileText },
		{ id: 'settings', label: 'Settings', icon: Settings }
	];

	const visible = $derived(items.filter((i) => !i.authOnly || $authStore.isAuthenticated));
	const handleSelect = (id: ShellSection) => workspaceStore.setActiveSection(id);
</script>

<nav
	class="border-hairline bg-surface-1 flex h-full w-20 flex-col items-center gap-2 border-r py-4"
>
	{#each visible as item (item.id)}
		<button
			class="font-display text-dim hover:text-hi flex w-16 flex-col items-center gap-1.5 rounded-xl py-3 text-[10px] tracking-widest transition-colors"
			class:active={$workspaceStore.activeSection === item.id}
			onclick={() => handleSelect(item.id)}
			aria-label={item.label}
			aria-current={$workspaceStore.activeSection === item.id ? 'page' : undefined}
		>
			<item.icon size={24} />
			<span>{item.label.toUpperCase()}</span>
		</button>
	{/each}
</nav>

<style>
	.active {
		color: var(--color-magenta);
		background: var(--color-surface-2);
		box-shadow:
			inset 3px 0 0 var(--color-magenta),
			0 0 24px -12px var(--color-magenta);
	}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- NavRail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/shell/NavRail.svelte packages/dtx-desktop/src/renderer/src/components/shell/NavRail.test.ts
git commit -m "feat(desktop): add neon NavRail component"
```

## Task 6: `TopToolbar` component (replaces `Navbar`)

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.svelte`
- Create (rename of Navbar test): `packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.test.ts`
- Delete: `packages/dtx-desktop/src/renderer/src/components/Navbar.svelte`, `packages/dtx-desktop/src/renderer/src/components/Navbar.test.ts`

**Interfaces:**

- Consumes: `authStore`, `authService.login/logout`, `simFileService.clearCache`.
- Produces: a top toolbar with brand, a ⌘K trigger button (`aria-label="Open command palette"`) that calls a passed `onOpenPalette` prop, and an account menu (user info + Clear Cache + Logout, or Login).
- Props: `{ onOpenPalette: () => void }`.

- [ ] **Step 1: Write the failing test**

Port `Navbar.test.ts` to `TopToolbar.test.ts` with the new structure (brand text is `DRUMERY`; add palette-trigger test). Full file:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({
	authService: {
		login: vi.fn().mockResolvedValue(undefined),
		logout: vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('../../services/simFileService', () => ({ simFileService: { clearCache: vi.fn() } }));

import TopToolbar from './TopToolbar.svelte';
import { authService } from '../../services/authService';
import { simFileService } from '../../services/simFileService';

describe('TopToolbar', () => {
	beforeEach(() => {
		authStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('shows brand', () => {
		render(TopToolbar, { onOpenPalette: vi.fn() });
		expect(screen.getByText('DRUMERY')).toBeInTheDocument();
	});

	it('calls onOpenPalette when the search trigger is clicked', async () => {
		const onOpenPalette = vi.fn();
		render(TopToolbar, { onOpenPalette });
		await fireEvent.click(screen.getByRole('button', { name: /Open command palette/i }));
		expect(onOpenPalette).toHaveBeenCalled();
	});

	it('shows Login when unauthenticated and calls authService.login', async () => {
		render(TopToolbar, { onOpenPalette: vi.fn() });
		const btn = screen.getByRole('button', { name: /Login to access cloud features/i });
		await fireEvent.click(btn);
		expect(authService.login).toHaveBeenCalled();
	});

	describe('authenticated', () => {
		beforeEach(() =>
			authStore.setUser({ id: 'u1', email: 'test@example.com', name: 'Test User' })
		);

		it('shows user name and email', () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			expect(screen.getByText('Test User')).toBeInTheDocument();
			expect(screen.getByText('test@example.com')).toBeInTheDocument();
		});
		it('calls logout', async () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			await fireEvent.click(screen.getByRole('button', { name: /Logout/i }));
			expect(authService.logout).toHaveBeenCalled();
		});
		it('calls clearCache and removes song_templates', async () => {
			render(TopToolbar, { onOpenPalette: vi.fn() });
			await fireEvent.click(screen.getByRole('button', { name: /Clear cache/i }));
			expect(simFileService.clearCache).toHaveBeenCalled();
			expect(window.localStorage.removeItem).toHaveBeenCalledWith('song_templates');
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- TopToolbar.test.ts`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `TopToolbar.svelte`**

Reuse `Navbar.svelte`'s logic (`handleLogout`, `handleClearCache`, login) and present it as a slim neon toolbar. Account info+actions can render inline (no dropdown needed for tests to pass; a menu is optional polish).

```svelte
<script lang="ts">
	import { authStore } from '../../stores/authStore';
	import { authService } from '../../services/authService';
	import { simFileService } from '../../services/simFileService';
	import { Music, LogOut, User, RefreshCw, Search } from '@lucide/svelte';

	interface Props {
		onOpenPalette: () => void;
	}
	let { onOpenPalette }: Props = $props();

	let isClearing = $state(false);

	const handleLogout = async () => {
		await authService.logout();
	};
	const handleClearCache = async () => {
		isClearing = true;
		try {
			simFileService.clearCache();
			localStorage.removeItem('song_templates');
		} finally {
			setTimeout(() => (isClearing = false), 1000);
		}
	};
</script>

<header class="border-hairline bg-surface-1 flex h-12 items-center gap-3 border-b px-4">
	<div class="flex items-center gap-2">
		<Music size={18} class="text-magenta" />
		<span class="font-display text-hi text-sm font-bold tracking-[0.18em]">DRUMERY</span>
	</div>

	<button
		class="border-hairline bg-surface-2 text-dim hover:border-cyan ml-4 flex h-8 max-w-md flex-1 items-center gap-2 rounded-lg border px-3 text-xs transition-colors"
		onclick={onOpenPalette}
		aria-label="Open command palette"
	>
		<Search size={14} />
		<span class="font-mono-alt">⌘K · search songs or run a command</span>
	</button>

	<div class="ml-auto flex items-center gap-3">
		{#if $authStore.isAuthenticated}
			<div class="text-right leading-tight">
				<p class="text-hi text-xs font-medium">{$authStore.user?.name || 'User'}</p>
				<p class="font-mono-alt text-dim text-[10px]">{$authStore.user?.email}</p>
			</div>
			<button
				class="bg-surface-2 text-cyan hover:border-cyan flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
				onclick={handleClearCache}
				disabled={isClearing}
				aria-label="Clear cache"
			>
				<RefreshCw size={13} class={isClearing ? 'animate-spin' : ''} />
				{isClearing ? 'Clearing…' : 'Clear Cache'}
			</button>
			<button
				class="bg-surface-2 text-red hover:text-hi flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
				onclick={handleLogout}
				aria-label="Logout"><LogOut size={13} /> Logout</button
			>
		{:else}
			<button
				class="bg-magenta font-display flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-semibold text-[#16001a]"
				style="box-shadow:0 0 22px -6px var(--color-magenta)"
				onclick={async () => authService.login()}
				aria-label="Login to access cloud features"
			>
				<User size={14} /> Login
			</button>
		{/if}
	</div>
</header>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- TopToolbar.test.ts`
Expected: PASS.

- [ ] **Step 5: Delete the old Navbar and its test**

```bash
git rm packages/dtx-desktop/src/renderer/src/components/Navbar.svelte packages/dtx-desktop/src/renderer/src/components/Navbar.test.ts
```

- [ ] **Step 6: Run the full suite to confirm nothing imports Navbar**

Run: `bun run --filter=dtx-desktop test && bun run --filter=dtx-desktop typecheck`
Expected: PASS. (If `App.svelte` still imports `Navbar`, it is replaced in Task 9 — temporarily leave `App.svelte` importing Navbar will break typecheck, so do Task 9 in the same branch before pushing; or comment the Navbar render now. Simplest: proceed directly to Task 9 next.)

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.svelte packages/dtx-desktop/src/renderer/src/components/shell/TopToolbar.test.ts
git commit -m "feat(desktop): add TopToolbar, remove legacy Navbar"
```

---

# Phase 3 — Master–Detail Shell

## Task 7: `DetailPane` component

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/shell/DetailPane.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/shell/DetailPane.test.ts`

**Interfaces:**

- Consumes: `workspaceStore.selectedSong`; renders `SongDetails` when a song is selected, else an empty state.
- Produces: nothing exported.

- [ ] **Step 1: Write the failing test**

Mock `SongDetails` so the test is isolated:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');
vi.mock('../SongDetails.svelte', () => ({
	default: (await import('../../../tests/StubSongDetails.svelte')).default
}));

import DetailPane from './DetailPane.svelte';

describe('DetailPane', () => {
	beforeEach(() => workspaceStore.reset());
	afterEach(() => cleanup());

	it('shows empty state when no song selected', () => {
		render(DetailPane);
		expect(screen.getByText(/select a song/i)).toBeInTheDocument();
	});

	it('renders song details when a song is selected', async () => {
		workspaceStore.selectSong({ name: 'Tank', path: '/tank' } as never);
		render(DetailPane);
		expect(screen.getByTestId('stub-song-details')).toBeInTheDocument();
	});
});
```

> Note: if mocking `SongDetails` via a stub file is awkward, instead `vi.mock('../SongDetails.svelte')` returning an inline stub component string is acceptable — the goal is to assert DetailPane's branching, not SongDetails internals. Adjust to whatever stub mechanism the codebase already uses; do not assert SongDetails content here.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- DetailPane.test.ts`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `DetailPane.svelte`**

```svelte
<script lang="ts">
	import { Music } from '@lucide/svelte';
	import { workspaceStore } from '../../stores/workspaceStore';
	import SongDetails from '../SongDetails.svelte';
</script>

<div class="bg-surface-1 h-full overflow-auto">
	{#if $workspaceStore.selectedSong}
		<SongDetails song={$workspaceStore.selectedSong} />
	{:else}
		<div class="text-faint flex h-full flex-col items-center justify-center gap-3">
			<Music size={40} />
			<p class="font-display text-sm tracking-widest">SELECT A SONG TO SEE DETAILS</p>
		</div>
	{/if}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- DetailPane.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/shell/DetailPane.svelte packages/dtx-desktop/src/renderer/src/components/shell/DetailPane.test.ts
git commit -m "feat(desktop): add DetailPane with empty state"
```

## Task 8: `AppShell` component (responsive master–detail)

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/shell/AppShell.test.ts`

**Interfaces:**

- Consumes: `workspaceStore.activeSection`/`selectedSong`/`showNewSong`, `authStore`, `resolveShellMode`, `NavRail`, `TopToolbar`, `DetailPane`, `Workspace` (master content), `SimFileList`, `Templates`, `Settings`, `NewSong`, `CommandPalette` (added Task 13).
- Produces: the full shell layout. Master content per section; detail pane for library/cloud per shell mode.
- Internal: `let width = $state(window.innerWidth)`; `ResizeObserver` on root sets `width`; `const mode = $derived(resolveShellMode(width))`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('../../services/simFileService', () => ({
	simFileService: { clearCache: vi.fn(), fetchUserSimFiles: vi.fn() }
}));
vi.mock('../../services/workspaceService', () => ({
	workspaceService: {
		selectWorkspace: vi.fn(),
		loadSubWorkspaces: vi.fn(),
		loadTreeStructure: vi.fn(),
		clearWorkspace: vi.fn()
	}
}));

// Stub heavy children so the shell test stays focused
vi.mock('../Workspace.svelte', () => ({ default: stub('stub-workspace') }));
vi.mock('./DetailPane.svelte', () => ({ default: stub('stub-detail') }));
vi.mock('../Templates.svelte', () => ({ default: stub('stub-templates') }));
vi.mock('../Settings.svelte', () => ({ default: stub('stub-settings') }));
vi.mock('../SimFileList.svelte', () => ({ default: stub('stub-simfilelist') }));
vi.mock('../NewSong.svelte', () => ({ default: stub('stub-newsong') }));
vi.mock('./CommandPalette.svelte', () => ({ default: stub('stub-palette') }));

import AppShell from './AppShell.svelte';

// minimal stub-component helper (returns a Svelte component rendering a div[data-testid])
function stub(id: string) {
	/* see note */ return makeStub(id);
}

describe('AppShell', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
	});
	afterEach(() => cleanup());

	it('renders toolbar, rail and library master content by default', () => {
		render(AppShell);
		expect(screen.getByText('DRUMERY')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Library/i })).toBeInTheDocument();
		expect(screen.getByTestId('stub-workspace')).toBeInTheDocument();
	});

	it('renders Templates content when section is templates', () => {
		workspaceStore.setActiveSection('templates');
		render(AppShell);
		expect(screen.getByTestId('stub-templates')).toBeInTheDocument();
	});
});
```

> Implementation note for `makeStub`: define a tiny helper at the top of the test that returns a component via `@testing-library/svelte`-compatible Svelte component. The simplest robust approach in this repo is to create one reusable stub at `src/tests/Stub.svelte` that renders `<div data-testid={id}></div>` from a prop, and `vi.mock(... => ({ default: Stub }))` passing the id through a wrapper. If that is heavier than desired, assert on real (unmocked) children instead and only mock services. Choose the lighter path that this codebase's existing tests already use; do not invent new infra.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- AppShell.test.ts`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement `AppShell.svelte`**

```svelte
<script lang="ts">
	import TopToolbar from './TopToolbar.svelte';
	import NavRail from './NavRail.svelte';
	import DetailPane from './DetailPane.svelte';
	import CommandPalette from './CommandPalette.svelte';
	import Workspace from '../Workspace.svelte';
	import SimFileList from '../SimFileList.svelte';
	import Templates from '../Templates.svelte';
	import Settings from '../Settings.svelte';
	import NewSong from '../NewSong.svelte';
	import { workspaceStore } from '../../stores/workspaceStore';
	import { resolveShellMode } from '../../lib/shellMode';
	import { onMount } from 'svelte';

	let width = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
	let paletteOpen = $state(false);
	const mode = $derived(resolveShellMode(width));
	const section = $derived($workspaceStore.activeSection);
	const isListSection = $derived(section === 'library' || section === 'cloud');
	const showDetail = $derived(isListSection && !!$workspaceStore.selectedSong);

	let rootEl: HTMLElement;
	onMount(() => {
		const ro = new ResizeObserver((entries) => {
			width = entries[0].contentRect.width;
		});
		ro.observe(rootEl);
		return () => ro.disconnect();
	});
</script>

<div bind:this={rootEl} class="bg-base text-base-text flex h-screen flex-col">
	<TopToolbar onOpenPalette={() => (paletteOpen = true)} />
	<div class="flex min-h-0 flex-1">
		<NavRail />
		<div class="flex min-h-0 flex-1">
			{#if section === 'settings'}
				<Settings />
			{:else if section === 'templates'}
				<Templates />
			{:else if $workspaceStore.showNewSong}
				<NewSong />
			{:else}
				<!-- master pane -->
				<div
					class="border-hairline min-w-0 flex-1 overflow-auto border-r"
					class:hidden={mode === 'narrow' && showDetail}
				>
					{#if section === 'cloud'}<SimFileList />{:else}<Workspace />{/if}
				</div>
				<!-- detail pane -->
				{#if showDetail}
					<div
						class:w-[420px]={mode === 'wide'}
						class:flex-1={mode !== 'wide'}
						class="min-w-0"
					>
						<DetailPane />
					</div>
				{/if}
			{/if}
		</div>
	</div>
	<CommandPalette open={paletteOpen} onClose={() => (paletteOpen = false)} />
</div>
```

Behavior by mode: **wide** → master + 420px detail side-by-side; **medium** → detail takes the row (overlay-like) when a song is selected; **narrow** → master hidden while detail shown (single-pane fallback). This satisfies the spec's C→A degradation. (`CommandPalette` is a no-op stub until Task 13; create a minimal placeholder now if executing strictly in order — see Task 13 note.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- AppShell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte packages/dtx-desktop/src/renderer/src/components/shell/AppShell.test.ts
git commit -m "feat(desktop): add responsive AppShell (master-detail)"
```

## Task 9: Wire `AppShell` into `App.svelte`; convert `Workspace` to master content

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/App.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Workspace.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts`

**Interfaces:**

- Consumes: `AppShell`. `App.svelte` keeps routing/auth/effects; renders `AppShell` for the non-editor, non-login routes instead of `Navbar` + `main` + `Workspace`.
- `Workspace.svelte` loses its `Navigation.Rail` + header chrome (now in shell) and becomes the **library master content** only: bookmarks, search filter, sub-workspaces, tree. Song selection calls `workspaceStore.selectSong` (it already does via `WorkspaceTree`/`SubWorkspaceItem`). New Song button stays.

- [ ] **Step 1: Update `App.svelte`**

Replace the `Navbar` import and `<main>` block. Keep all `<script>` logic (routing, auth effects, listeners). New markup:

```svelte
<script lang="ts">
	import Login from './components/Login.svelte';
	import DesktopEditor from './components/DesktopEditor.svelte';
	import AppShell from './components/shell/AppShell.svelte';
	import VersionsModal from './components/VersionsModal.svelte';
	/* ...unchanged store/service imports and all existing logic... */
</script>

{#if currentRoute === 'login'}
	<div class="bg-base flex min-h-screen items-center justify-center p-8">
		<div
			class="border-hairline bg-surface-1 w-full max-w-3xl overflow-hidden rounded-2xl border"
		>
			<Login />
		</div>
	</div>
{:else if currentRoute === 'editor'}
	<DesktopEditor simFileId={routeParams.simFileId} />
{:else}
	<AppShell />
{/if}

{#if $authStore.isAuthenticated}
	<VersionsModal />
{/if}
```

Remove the old `Navbar`, `NewSong`, `Workspace` imports from `App.svelte` (they now live inside `AppShell`).

- [ ] **Step 2: Strip rail/header chrome from `Workspace.svelte`**

Remove the Skeleton `Navigation.Rail` block and the outer `grid grid-cols-[10%_90%]` card wrapper and the section-title header. Keep: bookmarks menu, search filter, sub-workspaces list, tree, no-workspace empty state, loading/error states, New Song button. The root becomes:

```svelte
<div class="bg-surface-1 flex h-full flex-col p-6">
	<!-- header row: title + New Song / Refresh / Clear (library only) -->
	<!-- search filter -->
	<!-- sub-workspaces -->
	<!-- tree -->
</div>
```

Remove now-unused imports (`Navigation`, `Cloud`, `HardDrive`, `FileText`, `Settings as SettingsIcon`, `SimFileList`, `Templates`, `Settings`) and the `activeTab` state + its `$effect`s (section state now lives in `workspaceStore.activeSection`; this component only renders library content). Restyle remaining elements to tokens (`bg-surface-1/2`, `border-hairline`, `text-hi/dim`, magenta primary button).

- [ ] **Step 3: Update `Workspace.test.ts`**

Remove assertions about the rail tabs / "Online SimFiles" / Settings tab (those moved to shell). Keep/adjust tests for: no-workspace empty state, search filter behavior, tree rendering, New Song button. Mock `workspaceService` as today.

- [ ] **Step 4: Run tests + typecheck**

Run: `bun run --filter=dtx-desktop test && bun run --filter=dtx-desktop typecheck`
Expected: PASS. Fix any remaining references to removed `Navbar`/tabs.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/App.svelte packages/dtx-desktop/src/renderer/src/components/Workspace.svelte packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts
git commit -m "feat(desktop): mount AppShell and convert Workspace to master content"
```

## Task 10: Restyle `SongDetails` header for the detail pane

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte`

**Interfaces:**

- Consumes: unchanged props/logic. Only the header `{#snippet header()}` and status banners restyle to tokens. The "Back to Workspace" button becomes "Close" calling the existing `handleClose` (`workspaceStore.closeSongDetails`).

- [ ] **Step 1: Restyle header + banners (both linked and unlinked branches)**

Replace the slate/blue/green gradient classes in the two `{#snippet header()}` blocks and the `desktop_info` status banners with token classes: container `border-b border-hairline bg-surface-1`, title `text-hi font-display`, primary buttons `bg-magenta text-[#16001a]` with glow, secondary `bg-surface-2 text-cyan`, success banners `bg-green/10 text-green border border-green/40`, warning `amber`, error `red`. Keep all handlers (`handleOpenEditor`, `handleExportToZip`, `handleClose`) and snippet structure intact. Change the close button label/icon to `Close`.

- [ ] **Step 2: Verify existing SongDetails test still passes**

Run: `bun run --filter=dtx-desktop test -- SongDetails.test.ts && bun run --filter=dtx-desktop typecheck`
Expected: PASS. If the test asserts the old "Back to Workspace" label, update that assertion to the new label.

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/SongDetails.svelte packages/dtx-desktop/src/renderer/src/components/SongDetails.test.ts
git commit -m "style(desktop): restyle SongDetails for neon detail pane"
```

## Task 11: Window sizing for master–detail

**Files:**

- Modify: `packages/dtx-desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: Update the window block**

In `app.windows[0]`, set:

```json
{
	"label": "main",
	"title": "Drumery",
	"width": 1200,
	"height": 800,
	"minWidth": 640,
	"minHeight": 560,
	"resizable": true
}
```

- [ ] **Step 2: Verify JSON parses (typecheck/build config is untouched)**

Run: `node -e "JSON.parse(require('fs').readFileSync('packages/dtx-desktop/src-tauri/tauri.conf.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-desktop/src-tauri/tauri.conf.json
git commit -m "feat(desktop): widen default window and add min size for master-detail"
```

---

# Phase 4 — Editor Console

## Task 12: `EditorContextBar`

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/editor/EditorContextBar.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/editor/EditorContextBar.test.ts`

**Interfaces:**

- Props: `{ songName: string | null; simFileId?: string; difficulties: { name: string }[]; currentDtx: string; onBack: () => void; onSwitchDifficulty: (name: string) => void }`.
- Produces: back button (calls `onBack`), title, difficulty `<select>` (calls `onSwitchDifficulty`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
vi.mock('@lucide/svelte');
import EditorContextBar from './EditorContextBar.svelte';

const base = {
	songName: 'Tank',
	simFileId: undefined,
	difficulties: [{ name: 'mas.dtx' }, { name: 'bas.dtx' }],
	currentDtx: 'mas.dtx',
	onBack: vi.fn(),
	onSwitchDifficulty: vi.fn()
};

describe('EditorContextBar', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('shows the song name', () => {
		render(EditorContextBar, base);
		expect(screen.getByText(/Tank/)).toBeInTheDocument();
	});
	it('calls onBack', async () => {
		render(EditorContextBar, base);
		await fireEvent.click(screen.getByRole('button', { name: /Back to library/i }));
		expect(base.onBack).toHaveBeenCalled();
	});
	it('calls onSwitchDifficulty on change', async () => {
		render(EditorContextBar, base);
		await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bas.dtx' } });
		expect(base.onSwitchDifficulty).toHaveBeenCalledWith('bas.dtx');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- EditorContextBar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	interface Props {
		songName: string | null;
		simFileId?: string;
		difficulties: { name: string }[];
		currentDtx: string;
		onBack: () => void;
		onSwitchDifficulty: (name: string) => void;
	}
	let { songName, simFileId, difficulties, currentDtx, onBack, onSwitchDifficulty }: Props =
		$props();
	const title = $derived(
		songName ? `· ${songName}` : simFileId ? `· ${simFileId}` : '· New Chart'
	);
</script>

<div class="border-hairline bg-surface-1 flex h-12 items-center gap-4 border-b px-4">
	<button
		class="bg-surface-2 text-base-text hover:text-hi flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
		onclick={onBack}
		aria-label="Back to library"><ArrowLeft size={15} /> Back</button
	>
	<h1 class="font-display text-hi text-sm font-semibold">
		DTX EDITOR <span class="text-dim">{title}</span>
	</h1>
	{#if difficulties.length > 1}
		<select
			class="border-hairline bg-surface-2 font-mono-alt text-hi focus:border-cyan ml-auto rounded-lg border px-3 py-1.5 text-xs focus:outline-none"
			value={currentDtx}
			onchange={(e) => onSwitchDifficulty((e.target as HTMLSelectElement).value)}
		>
			{#each difficulties as d}<option value={d.name}
					>{d.name.replace('.dtx', '').toUpperCase()}</option
				>{/each}
		</select>
	{/if}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- EditorContextBar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/editor/EditorContextBar.svelte packages/dtx-desktop/src/renderer/src/components/editor/EditorContextBar.test.ts
git commit -m "feat(desktop): add EditorContextBar"
```

## Task 13: `TransportBar` (reuses existing preview/zoom behavior)

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/editor/TransportBar.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/editor/TransportBar.test.ts`

**Interfaces:**

- Consumes: `@dtx/common` `store` (`isPreviewing`, `currentDtxFile`, `measureCount`), `@dtx/common/game` `EventBus`/`EventType`.
- Props: `{ isEditorReady?: boolean }`.
- Behavior: play toggles `store.isPreviewing` + emits `START_PREVIEW(bpm)` / `STOP_PREVIEW` (mirrors `PreviewTab.handlePlay`). Zoom slider emits `CELL_HEIGHT_UPDATE(value)` (mirrors `MainTab`). Readouts: BPM from `currentDtxFile.bpm`, total measures from `measureCount`.

- [ ] **Step 1: Write the failing test**

Mock `@dtx/common` and `@dtx/common/game` (pattern from `PreviewTab.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { writable } from 'svelte/store';

vi.mock('@lucide/svelte');
const emit = vi.fn();
vi.mock('@dtx/common/game', () => ({
	EventBus: { emit, on: vi.fn(), off: vi.fn() },
	EventType: {
		START_PREVIEW: 'start-preview',
		STOP_PREVIEW: 'stop-preview',
		CELL_HEIGHT_UPDATE: 'cell-height-update'
	}
}));
vi.mock('@dtx/common', () => ({
	store: {
		isPreviewing: writable(false),
		currentDtxFile: writable({ bpm: 145 }),
		measureCount: writable(40)
	}
}));

import TransportBar from './TransportBar.svelte';

describe('TransportBar', () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(() => cleanup());

	it('shows BPM and measure readouts', () => {
		render(TransportBar, { isEditorReady: true });
		expect(screen.getByText('145')).toBeInTheDocument();
		expect(screen.getByText('40')).toBeInTheDocument();
	});

	it('emits START_PREVIEW with bpm when play clicked', async () => {
		render(TransportBar, { isEditorReady: true });
		await fireEvent.click(screen.getByRole('button', { name: /play preview/i }));
		expect(emit).toHaveBeenCalledWith('start-preview', 145);
	});

	it('emits STOP_PREVIEW on second click', async () => {
		render(TransportBar, { isEditorReady: true });
		const btn = screen.getByRole('button', { name: /play preview/i });
		await fireEvent.click(btn);
		await fireEvent.click(btn);
		expect(emit).toHaveBeenCalledWith('stop-preview');
	});

	it('emits CELL_HEIGHT_UPDATE when zoom changes', async () => {
		render(TransportBar, { isEditorReady: true });
		await fireEvent.input(screen.getByRole('slider', { name: /zoom/i }), {
			target: { value: '30' }
		});
		expect(emit).toHaveBeenCalledWith('cell-height-update', 30);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- TransportBar.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
	import { Play, Square } from '@lucide/svelte';
	import { store } from '@dtx/common';
	import { EventBus, EventType } from '@dtx/common/game';

	interface Props {
		isEditorReady?: boolean;
	}
	let { isEditorReady = false }: Props = $props();

	let isPreviewing = $state(false);
	let bpm = $state(120);
	let measures = $state(0);
	let zoom = $state(20);

	$effect(() => {
		const u1 = store.isPreviewing.subscribe((v) => (isPreviewing = v));
		const u2 = store.currentDtxFile.subscribe((v) => (bpm = v?.bpm ?? 120));
		const u3 = store.measureCount.subscribe((v) => (measures = v));
		return () => {
			u1();
			u2();
			u3();
		};
	});

	const handlePlay = () => {
		const next = !isPreviewing;
		store.isPreviewing.set(next);
		if (next) EventBus.emit(EventType.START_PREVIEW, bpm);
		else EventBus.emit(EventType.STOP_PREVIEW);
	};
	const handleZoom = (e: Event) => {
		zoom = Number((e.target as HTMLInputElement).value);
		EventBus.emit(EventType.CELL_HEIGHT_UPDATE, zoom);
	};
</script>

<div
	class="border-magenta bg-surface-2 flex h-16 items-center gap-6 border-t px-5"
	style="box-shadow:0 -10px 30px -20px var(--color-magenta)"
>
	<button
		class="border-magenta text-magenta flex h-10 w-10 items-center justify-center rounded-full border disabled:opacity-40"
		style="box-shadow:0 0 18px -4px var(--color-magenta)"
		onclick={handlePlay}
		disabled={!isEditorReady}
		aria-label={isPreviewing ? 'Stop preview' : 'Play preview'}
	>
		{#if isPreviewing}<Square size={16} />{:else}<Play size={16} />{/if}
	</button>
	<div class="flex flex-col">
		<span class="font-display text-faint text-[9px] tracking-widest">BPM</span>
		<span class="text-hi font-mono text-base">{bpm}</span>
	</div>
	<div class="flex flex-col">
		<span class="font-display text-faint text-[9px] tracking-widest">MEASURES</span>
		<span class="text-hi font-mono text-base">{measures}</span>
	</div>
	<label
		class="font-display text-dim ml-auto flex items-center gap-2 text-[10px] tracking-widest"
	>
		ZOOM
		<input
			type="range"
			min="8"
			max="48"
			value={zoom}
			oninput={handleZoom}
			aria-label="Zoom"
			class="accent-cyan"
		/>
	</label>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- TransportBar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/editor/TransportBar.svelte packages/dtx-desktop/src/renderer/src/components/editor/TransportBar.test.ts
git commit -m "feat(desktop): add editor TransportBar reusing preview/zoom events"
```

## Task 14: `EditorDock` accordion

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/editor/EditorDock.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/editor/EditorDock.test.ts`

**Interfaces:**

- Consumes: `@dtx/common/components` `MainTab`, `SoundTab`, `PreviewTab`.
- Props: `{ simfileId: string | null; bucketUrl?: string; isEditorReady?: boolean; chartLoadError?: string | null; validationError?: string | null }`.
- Produces: three collapsible sections — `Chart Info`(MainTab), `Sounds`(SoundTab), `Playback`(PreviewTab). Chart Info + Sounds open by default; multiple may be open at once.

- [ ] **Step 1: Write the failing test**

Mock the three tab components and lucide:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
vi.mock('@lucide/svelte');
vi.mock('@dtx/common/components', () => ({
	MainTab: stubA,
	SoundTab: stubB,
	PreviewTab: stubC
}));
import EditorDock from './EditorDock.svelte';

describe('EditorDock', () => {
	afterEach(() => cleanup());
	it('renders the three section headers', () => {
		render(EditorDock, { simfileId: null });
		expect(screen.getByRole('button', { name: /Chart Info/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Sounds/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Playback/i })).toBeInTheDocument();
	});
	it('toggles a section open/closed', async () => {
		render(EditorDock, { simfileId: null });
		const playback = screen.getByRole('button', { name: /Playback/i });
		// Playback closed by default → expanding reveals its panel
		expect(playback.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(playback);
		expect(playback.getAttribute('aria-expanded')).toBe('true');
	});
});
```

> Use the same lightweight stub approach chosen in Task 8 for `stubA/B/C`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- EditorDock.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { MainTab, SoundTab, PreviewTab } from '@dtx/common/components';

	interface Props {
		simfileId: string | null;
		bucketUrl?: string;
		isEditorReady?: boolean;
		chartLoadError?: string | null;
		validationError?: string | null;
	}
	let {
		simfileId,
		bucketUrl = '',
		isEditorReady = false,
		chartLoadError = null,
		validationError = null
	}: Props = $props();

	let open = $state({ main: true, sound: true, playback: false });
	const toggle = (k: 'main' | 'sound' | 'playback') => (open[k] = !open[k]);
</script>

<div class="bg-surface-1 flex h-full flex-col gap-2 overflow-auto p-3">
	<section>
		<button
			class="bg-surface-2 font-display text-hi flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs tracking-widest"
			onclick={() => toggle('main')}
			aria-expanded={open.main}
			aria-label="Chart Info"
		>
			CHART INFO <ChevronDown
				size={15}
				class={open.main ? 'rotate-180 transition' : 'transition'}
			/>
		</button>
		{#if open.main}
			<div class="p-3">
				{#if chartLoadError}<div
						class="border-red/40 bg-red/10 text-red mb-3 rounded-md border p-2 text-xs"
					>
						{chartLoadError}
					</div>{/if}
				{#if validationError}<div
						class="border-red/40 bg-red/10 text-red mb-3 rounded-md border p-2 text-xs"
					>
						{validationError}
					</div>{/if}
				<MainTab />
			</div>
		{/if}
	</section>
	<section>
		<button
			class="bg-surface-2 font-display text-hi flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs tracking-widest"
			onclick={() => toggle('sound')}
			aria-expanded={open.sound}
			aria-label="Sounds"
		>
			SOUNDS <ChevronDown
				size={15}
				class={open.sound ? 'rotate-180 transition' : 'transition'}
			/>
		</button>
		{#if open.sound}<div class="p-3"><SoundTab simfileID={simfileId} {bucketUrl} /></div>{/if}
	</section>
	<section>
		<button
			class="bg-surface-2 font-display text-hi flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs tracking-widest"
			onclick={() => toggle('playback')}
			aria-expanded={open.playback}
			aria-label="Playback"
		>
			PLAYBACK <ChevronDown
				size={15}
				class={open.playback ? 'rotate-180 transition' : 'transition'}
			/>
		</button>
		{#if open.playback}<div class="p-3"><PreviewTab {isEditorReady} /></div>{/if}
	</section>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- EditorDock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/editor/EditorDock.svelte packages/dtx-desktop/src/renderer/src/components/editor/EditorDock.test.ts
git commit -m "feat(desktop): add EditorDock accordion (Chart Info/Sounds/Playback)"
```

## Task 15: Recompose `DesktopEditor` into the console layout

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/DesktopEditor.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/DesktopEditor.test.ts`

**Interfaces:**

- Consumes: `EditorContextBar`, `EditorDock`, `TransportBar`. All existing initialization, file-loading, difficulty-switching, EventBus wiring, and the `gameContainer` div + Phaser bootstrapping stay **unchanged**.
- Tracks editor-ready: set a `let isEditorReady = $state(false)` flipped to `true` in the existing `game.events.once('ready', …)` callback; pass to `EditorDock`/`TransportBar`.

- [ ] **Step 1: Replace the editor markup (script logic preserved)**

Keep the entire `<script>` (only add `isEditorReady` state + set it in the `ready` handler, and compute `difficulties`/`currentDtx` from `currentChart`). Replace the `<div class="h-screen …">` template body with:

```svelte
<div class="bg-base text-base-text flex h-screen flex-col">
	<EditorContextBar
		songName={currentSongName}
		{simFileId}
		difficulties={currentChart?.dtxFiles ?? []}
		currentDtx={currentChart?.currentDTX ?? ''}
		onBack={handleBackToWorkspace}
		onSwitchDifficulty={switchChartDifficulty}
	/>
	<div class="flex min-h-0 flex-1">
		{#if !isSidebarCollapsed}
			<div
				class="border-hairline relative border-r"
				style="width:{sidebarWidth}px;max-width:{maxSidebarWidth}px"
			>
				<EditorDock
					simfileId={isLocalEditingMode ? null : simFileId}
					{chartLoadError}
					{validationError}
					{isEditorReady}
				/>
				<button
					type="button"
					class="hover:bg-cyan/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
					class:bg-cyan={isDragging}
					onmousedown={handleMouseDown}
					onkeydown={handleKeyResize}
					tabindex="0"
					aria-label="Resize sidebar"
				></button>
			</div>
		{:else}
			<div
				class="border-hairline hover:bg-surface-2 relative w-3 cursor-col-resize border-r"
				onclick={expandSidebar}
				onmousedown={handleMouseDown}
				onkeydown={(e) => e.key === 'Enter' && expandSidebar()}
				role="button"
				tabindex="0"
				title="Expand dock"
				aria-label="Expand dock"
			></div>
		{/if}
		<div class="bg-base min-w-0 flex-1">
			<div bind:this={gameContainer} class="h-full w-full">
				{#if !isGameInitialized}
					<div class="text-dim flex h-full items-center justify-center">
						Initializing editor…
					</div>
				{/if}
			</div>
		</div>
	</div>
	<TransportBar {isEditorReady} />
</div>
```

Add imports for the three new components. Keep `handleMouseDown/Move/Up`, `handleKeyResize`, `expandSidebar`, sidebar width state, `switchChartDifficulty`, `handleBackToWorkspace`, and all of `onMount`/Phaser setup verbatim. Set `isEditorReady = true` inside the existing `game.events.once('ready', …)` callback (alongside the current `EventBus.emit(NOTE_IMPORT, …)`).

- [ ] **Step 2: Update `DesktopEditor.test.ts`**

The previous tests likely asserted the old header tabs ("Main"/"Sound"/"Preview") and "Back to Workspace". Update to the new structure: assert the context bar renders (Back button `name: /Back/i`), the dock section headers exist, and the transport play button exists. Keep Phaser mocked (global `__mocks__/phaser.ts`). Mock `@dtx/common/components` tabs and `@dtx/common/game` as the existing test already does.

- [ ] **Step 3: Run tests + typecheck**

Run: `bun run --filter=dtx-desktop test -- DesktopEditor.test.ts && bun run --filter=dtx-desktop typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/DesktopEditor.svelte packages/dtx-desktop/src/renderer/src/components/DesktopEditor.test.ts
git commit -m "feat(desktop): recompose DesktopEditor into DAW console (canvas unchanged)"
```

---

# Phase 5 — Command Palette

> If executing strictly in order, a minimal `CommandPalette.svelte` placeholder was needed by Task 8. If you created one, this phase replaces it. Otherwise create it now and ensure `AppShell` imports it.

## Task 16: Fuzzy search utility

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/lib/fuzzy.ts`
- Test: `packages/dtx-desktop/src/renderer/src/lib/fuzzy.test.ts`

**Interfaces:**

- Produces: `fuzzyScore(query: string, text: string): number` (0 = no match, higher = better); `searchItems<T>(query: string, items: T[], key: (t: T) => string): T[]` (filtered, sorted by score desc; empty query returns items unchanged). Consumed by `commands.ts` and `CommandPalette`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { fuzzyScore, searchItems } from './fuzzy';

describe('fuzzyScore', () => {
	it('returns 0 when characters are missing in order', () => {
		expect(fuzzyScore('xyz', 'tank')).toBe(0);
	});
	it('returns >0 for subsequence match', () => {
		expect(fuzzyScore('tnk', 'tank')).toBeGreaterThan(0);
	});
	it('scores a contiguous/prefix match higher than a scattered one', () => {
		expect(fuzzyScore('tan', 'tank')).toBeGreaterThan(fuzzyScore('tan', 'titan'));
	});
	it('is case-insensitive', () => {
		expect(fuzzyScore('TANK', 'tank')).toBeGreaterThan(0);
	});
});

describe('searchItems', () => {
	const items = [{ n: 'Tank' }, { n: 'Titan' }, { n: 'Spice and Wolf' }];
	it('returns all items unchanged for empty query', () => {
		expect(searchItems('', items, (i) => i.n)).toEqual(items);
	});
	it('filters and ranks by score', () => {
		const r = searchItems('tan', items, (i) => i.n);
		expect(r[0].n).toBe('Tank');
		expect(r.find((i) => i.n === 'Spice and Wolf')).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- fuzzy.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export const fuzzyScore = (query: string, text: string): number => {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (q.length === 0) return 1;
	let score = 0;
	let ti = 0;
	let streak = 0;
	for (let qi = 0; qi < q.length; qi++) {
		const ch = q[qi];
		let found = -1;
		for (let j = ti; j < t.length; j++) {
			if (t[j] === ch) {
				found = j;
				break;
			}
		}
		if (found === -1) return 0;
		// contiguity bonus; prefix bonus
		streak = found === ti ? streak + 1 : 0;
		score += 1 + streak + (found === 0 ? 2 : 0);
		ti = found + 1;
	}
	return score;
};

export const searchItems = <T>(query: string, items: T[], key: (t: T) => string): T[] => {
	if (query.trim().length === 0) return items;
	return items
		.map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((r) => r.item);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- fuzzy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/lib/fuzzy.ts packages/dtx-desktop/src/renderer/src/lib/fuzzy.test.ts
git commit -m "feat(desktop): add in-repo fuzzy search utility"
```

## Task 17: Command registry

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/commands/commands.ts`
- Test: `packages/dtx-desktop/src/renderer/src/commands/commands.test.ts`

**Interfaces:**

- Produces:
    ```ts
    export type Command = { id: string; title: string; group: 'Navigation' | 'Workspace' | 'Account'; run: () => void };
    export type CommandContext = { isAuthenticated: boolean; handlers: CommandHandlers };
    export type CommandHandlers = {
    	goToSection: (s: ShellSection) => void; newSong: () => void;
    	selectWorkspace: () => void; refreshWorkspace: () => void; clearWorkspace: () => void;
    	clearCache: () => void; login: () => void; logout: () => void;
    };
    export const buildCommands = (ctx: CommandContext): Command[];
    ```
- Consumed by `CommandPalette`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildCommands } from './commands';

const handlers = {
	goToSection: vi.fn(),
	newSong: vi.fn(),
	selectWorkspace: vi.fn(),
	refreshWorkspace: vi.fn(),
	clearWorkspace: vi.fn(),
	clearCache: vi.fn(),
	login: vi.fn(),
	logout: vi.fn()
};

describe('buildCommands', () => {
	it('includes Login (not Logout) when unauthenticated', () => {
		const ids = buildCommands({ isAuthenticated: false, handlers }).map((c) => c.id);
		expect(ids).toContain('account.login');
		expect(ids).not.toContain('account.logout');
		expect(ids).not.toContain('nav.cloud');
	});
	it('includes Logout and Cloud nav when authenticated', () => {
		const ids = buildCommands({ isAuthenticated: true, handlers }).map((c) => c.id);
		expect(ids).toContain('account.logout');
		expect(ids).toContain('nav.cloud');
	});
	it('run() invokes the matching handler', () => {
		const cmds = buildCommands({ isAuthenticated: true, handlers });
		cmds.find((c) => c.id === 'workspace.newSong')!.run();
		expect(handlers.newSong).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { ShellSection } from '../stores/workspaceStore';

export type Command = {
	id: string;
	title: string;
	group: 'Navigation' | 'Workspace' | 'Account';
	run: () => void;
};
export type CommandHandlers = {
	goToSection: (s: ShellSection) => void;
	newSong: () => void;
	selectWorkspace: () => void;
	refreshWorkspace: () => void;
	clearWorkspace: () => void;
	clearCache: () => void;
	login: () => void;
	logout: () => void;
};
export type CommandContext = { isAuthenticated: boolean; handlers: CommandHandlers };

export const buildCommands = ({ isAuthenticated, handlers: h }: CommandContext): Command[] => {
	const cmds: Command[] = [
		{
			id: 'nav.library',
			title: 'Go to Library',
			group: 'Navigation',
			run: () => h.goToSection('library')
		},
		{
			id: 'nav.templates',
			title: 'Go to Templates',
			group: 'Navigation',
			run: () => h.goToSection('templates')
		},
		{
			id: 'nav.settings',
			title: 'Open Settings',
			group: 'Navigation',
			run: () => h.goToSection('settings')
		},
		{ id: 'workspace.newSong', title: 'New Song', group: 'Workspace', run: h.newSong },
		{
			id: 'workspace.select',
			title: 'Select Workspace Folder',
			group: 'Workspace',
			run: h.selectWorkspace
		},
		{
			id: 'workspace.refresh',
			title: 'Refresh Workspace',
			group: 'Workspace',
			run: h.refreshWorkspace
		},
		{
			id: 'workspace.clear',
			title: 'Clear Workspace',
			group: 'Workspace',
			run: h.clearWorkspace
		}
	];
	if (isAuthenticated) {
		cmds.splice(1, 0, {
			id: 'nav.cloud',
			title: 'Go to Cloud',
			group: 'Navigation',
			run: () => h.goToSection('cloud')
		});
		cmds.push({
			id: 'account.clearCache',
			title: 'Clear Cache',
			group: 'Account',
			run: h.clearCache
		});
		cmds.push({ id: 'account.logout', title: 'Logout', group: 'Account', run: h.logout });
	} else {
		cmds.push({ id: 'account.login', title: 'Login', group: 'Account', run: h.login });
	}
	return cmds;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/commands/commands.ts packages/dtx-desktop/src/renderer/src/commands/commands.test.ts
git commit -m "feat(desktop): add command registry for palette"
```

## Task 18: `CommandPalette` component + global ⌘K

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/shell/CommandPalette.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/shell/CommandPalette.test.ts`

**Interfaces:**

- Props: `{ open: boolean; onClose: () => void }`.
- Consumes: `buildCommands`, `searchItems`, `workspaceStore` (`treeStructure` for song results + `setActiveSection`/`selectSong`/`showNewSongForm`/etc.), `authStore`, `authService`, `simFileService`, `workspaceService`. Builds handlers internally from these.
- Behavior: searches commands + songs (flattened tree), ↑/↓ moves selection, Enter runs/opens, Esc/backdrop closes. `role="dialog"`, focus the input on open.

- [ ] **Step 1: Write the failing test**

Mock services + stores' service deps; render with `open: true`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('../../services/simFileService', () => ({ simFileService: { clearCache: vi.fn() } }));
vi.mock('../../services/workspaceService', () => ({
	workspaceService: {
		selectWorkspace: vi.fn(),
		loadSubWorkspaces: vi.fn(),
		loadTreeStructure: vi.fn(),
		clearWorkspace: vi.fn()
	}
}));

import CommandPalette from './CommandPalette.svelte';

describe('CommandPalette', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('does not render when closed', () => {
		render(CommandPalette, { open: false, onClose: vi.fn() });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
	it('lists commands when open', () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		expect(screen.getByText('New Song')).toBeInTheDocument();
		expect(screen.getByText('Open Settings')).toBeInTheDocument();
	});
	it('filters by query', async () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'settings' } });
		expect(screen.getByText('Open Settings')).toBeInTheDocument();
		expect(screen.queryByText('New Song')).not.toBeInTheDocument();
	});
	it('Esc closes', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
	});
	it('Enter runs the selected command and closes', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'settings' } });
		await fireEvent.keyDown(window, { key: 'Enter' });
		expect(workspaceStore.subscribe).toBeDefined(); // sanity
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('settings');
		expect(onClose).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter=dtx-desktop test -- CommandPalette.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
	import { authStore } from '../../stores/authStore';
	import { workspaceStore, type TreeNode } from '../../stores/workspaceStore';
	import { authService } from '../../services/authService';
	import { simFileService } from '../../services/simFileService';
	import { workspaceService } from '../../services/workspaceService';
	import { buildCommands, type Command } from '../../commands/commands';
	import { searchItems } from '../../lib/fuzzy';

	interface Props {
		open: boolean;
		onClose: () => void;
	}
	let { open, onClose }: Props = $props();

	let query = $state('');
	let selected = $state(0);
	let inputEl: HTMLInputElement | undefined;

	const handlers = {
		goToSection: (s: Parameters<typeof workspaceStore.setActiveSection>[0]) =>
			workspaceStore.setActiveSection(s),
		newSong: () => workspaceStore.showNewSongForm(),
		selectWorkspace: () => void workspaceService.selectWorkspace(),
		refreshWorkspace: () => {
			void workspaceService.loadSubWorkspaces();
			void workspaceService.loadTreeStructure();
		},
		clearWorkspace: () => workspaceService.clearWorkspace(),
		clearCache: () => {
			simFileService.clearCache();
			localStorage.removeItem('song_templates');
		},
		login: () => void authService.login(),
		logout: () => void authService.logout()
	};

	const flatten = (nodes: TreeNode[], acc: TreeNode[] = []): TreeNode[] => {
		for (const n of nodes) {
			if (n.containsDtxFiles) acc.push(n);
			flatten(n.children, acc);
		}
		return acc;
	};

	const commands = $derived(
		buildCommands({ isAuthenticated: $authStore.isAuthenticated, handlers })
	);
	const songs = $derived(flatten($workspaceStore.treeStructure));
	const cmdResults = $derived(searchItems(query, commands, (c) => c.title));
	const songResults = $derived(
		searchItems(query, songs, (s) => s.songTitle || s.name).slice(0, 8)
	);
	const flatResults = $derived([
		...cmdResults.map((c) => ({ kind: 'command' as const, c })),
		...songResults.map((s) => ({ kind: 'song' as const, s }))
	]);

	$effect(() => {
		if (open) {
			query = '';
			selected = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});

	const runAt = (i: number) => {
		const r = flatResults[i];
		if (!r) return;
		if (r.kind === 'command') r.c.run();
		else {
			workspaceStore.setActiveSection('library');
			workspaceStore.selectSong(r.s);
		}
		onClose();
	};

	const handleKey = (e: KeyboardEvent) => {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selected = Math.min(selected + 1, flatResults.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			runAt(selected);
		}
	};
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]"
		onclick={onClose}
		role="presentation"
	>
		<div
			class="border-hairline bg-surface-1 w-full max-w-xl overflow-hidden rounded-2xl border"
			style="box-shadow:0 0 60px -12px var(--color-magenta)"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.stopPropagation()}
		>
			<input
				bind:this={inputEl}
				bind:value={query}
				role="textbox"
				class="bg-surface-2 font-mono-alt text-hi w-full px-4 py-3 text-sm outline-none"
				placeholder="Search songs or run a command…"
				aria-label="Command palette search"
			/>
			<ul class="max-h-80 overflow-auto py-2">
				{#each flatResults as r, i (r.kind === 'command' ? r.c.id : r.s.path)}
					<li>
						<button
							class="flex w-full items-center justify-between px-4 py-2 text-left text-sm"
							class:bg-surface-3={i === selected}
							onclick={() => runAt(i)}
						>
							<span class={r.kind === 'command' ? 'text-hi' : 'text-cyan'}>
								{r.kind === 'command' ? r.c.title : r.s.songTitle || r.s.name}
							</span>
							<span class="font-display text-faint text-[10px] tracking-widest">
								{r.kind === 'command' ? r.c.group.toUpperCase() : 'SONG'}
							</span>
						</button>
					</li>
				{/each}
				{#if flatResults.length === 0}
					<li class="text-faint px-4 py-3 text-sm">No results</li>
				{/if}
			</ul>
		</div>
	</div>
{/if}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter=dtx-desktop test -- CommandPalette.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the global ⌘K trigger in `AppShell`**

In `AppShell.svelte` `<script>`, add a keydown handler and `<svelte:window>`:

```svelte
<svelte:window
	onkeydown={(e) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			paletteOpen = true;
		}
	}}
/>
```

- [ ] **Step 6: Run shell + palette tests + typecheck**

Run: `bun run --filter=dtx-desktop test -- AppShell.test.ts CommandPalette.test.ts && bun run --filter=dtx-desktop typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/shell/CommandPalette.svelte packages/dtx-desktop/src/renderer/src/components/shell/CommandPalette.test.ts packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte
git commit -m "feat(desktop): add ⌘K command palette (songs + actions)"
```

---

# Phase 6 — Polish & Motion + Remaining Restyle

## Task 19: Motion utilities (reduced-motion aware)

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/assets/base.css`

- [ ] **Step 1: Append motion utilities**

```css
@keyframes neon-rise {
	from {
		opacity: 0;
		transform: translateY(8px);
	}
	to {
		opacity: 1;
		transform: translateY(0);
	}
}
.reveal {
	animation: neon-rise 0.4s ease both;
}
.reveal-1 {
	animation-delay: 0.05s;
}
.reveal-2 {
	animation-delay: 0.1s;
}
.reveal-3 {
	animation-delay: 0.15s;
}

@media (prefers-reduced-motion: reduce) {
	*,
	*::before,
	*::after {
		animation-duration: 0.001ms !important;
		animation-iteration-count: 1 !important;
		transition-duration: 0.001ms !important;
	}
}
```

- [ ] **Step 2: Apply `reveal` classes to the shell panes**

In `AppShell.svelte`, add `reveal` to the master pane wrapper and `reveal reveal-1` to the detail wrapper; in `NavRail` items optional. Keep it subtle.

- [ ] **Step 3: Verify tests + typecheck**

Run: `bun run --filter=dtx-desktop test && bun run --filter=dtx-desktop typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/assets/base.css packages/dtx-desktop/src/renderer/src/components/shell/AppShell.svelte
git commit -m "feat(desktop): add reduced-motion-aware reveal animations"
```

## Task 20: Restyle remaining components to tokens

**Files (restyle only — no logic/behavior change):**

- `components/SimFileList.svelte`, `components/Templates.svelte`, `components/Settings.svelte`,
  `components/WorkspaceTree.svelte`, `components/SubWorkspaceItem.svelte`,
  `components/WorkspaceBookmarksMenu.svelte`, `components/Login.svelte`,
  `components/VersionsModal.svelte`, `components/NewSong.svelte`, `components/CloudSongAutocomplete.svelte`

**Mapping to apply (find → replace, per file):**

- `bg-white` / `dark:bg-slate-800` → `bg-surface-1`
- `bg-slate-50` / `dark:bg-slate-900` → `bg-base` (page) or `bg-surface-2` (insets)
- `bg-slate-100` / `dark:bg-slate-700` → `bg-surface-2`
- `border-slate-200` / `dark:border-slate-700` → `border-hairline`
- text: headings `text-hi`, body `text-base-text`, muted `text-dim`, faint labels `text-faint`
- blue/indigo gradient buttons → `bg-magenta text-[#16001a]` (primary) or `bg-surface-2 text-cyan` (secondary), with `style="box-shadow:0 0 22px -6px var(--color-magenta)"` on primary
- success green → `text-green` / `border-green/40 bg-green/10`; warning → `amber`; error → `red`
- headings/labels: add `font-display`; numeric/path text: `font-mono`/`font-mono-alt`

- [ ] **Step 1: Restyle each file** applying the mapping above. Do not change props, handlers, or markup structure — only class strings (and add scoped `<style>` with `@apply` where a class string gets unwieldy, per conventions).

- [ ] **Step 2: Run the full suite + typecheck after each file (or as a batch)**

Run: `bun run --filter=dtx-desktop test && bun run --filter=dtx-desktop typecheck`
Expected: PASS. Update any test that asserts an old literal color class (rare; most assert text/roles).

- [ ] **Step 3: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components
git commit -m "style(desktop): restyle remaining components to Neon Arcade tokens"
```

## Task 21: Full verification pass

- [ ] **Step 1: Lint, typecheck, test, format**

Run:

```bash
bun run --filter=dtx-desktop test
bun run --filter=dtx-desktop typecheck
bun run lint
bun run format
```

Expected: all PASS / clean. Fix any fallout.

- [ ] **Step 2: Manual smoke (executor runs the app — only if the user approves running it)**

Per CLAUDE.md, do not run `bun run dev` unless the user asks. If approved: verify shell at wide/medium/narrow widths, song select → detail, ⌘K palette, editor console (back/difficulty/dock/transport play+zoom), login/logout, clear cache, export.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "chore(desktop): redesign verification fixes"
```

---

## Self-Review Notes (author)

- **Spec coverage:** identity/tokens/fonts (T1–T2, T19–T20), master–detail shell + responsive C→A (T4, T8, T9, T11), native-controls + neon toolbar (T6), nav rail (T5), detail pane (T7), editor DAW console with unchanged canvas (T12–T15), transport reusing existing events (T13), ⌘K full palette (T16–T18), a11y (roles/aria/keyboard in T5/T8/T12/T18), testing throughout, phasing matches spec §15. The spec's "verify zoom hook" item is resolved: zoom uses the confirmed `CELL_HEIGHT_UPDATE` event.
- **Stub infra caveat:** Tasks 8/14 reference a lightweight Svelte stub for child components. The executor should reuse whatever stub pattern this repo already uses (or mock only services and assert against real children). This is the one place the plan defers to existing test conventions rather than prescribing new infra — chosen deliberately to avoid inventing test scaffolding that conflicts with the codebase.
- **Type consistency:** `ShellSection`/`ShellMode`, `buildCommands`/`Command`/`CommandHandlers`, `resolveShellMode`, `fuzzyScore`/`searchItems`, and the `TransportBar`/`EditorDock` props are used consistently across tasks.
