# Workspace Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let dtx-desktop users bookmark workspace folders and switch between them via a one-click dropdown anchored on the current path display.

**Architecture:** A new Svelte writable `bookmarkStore` persists `{ path, name }[]` to `localStorage.workspace_bookmarks` (mirroring the existing `workspace_path` pattern). A new `WorkspaceBookmarksMenu.svelte` replaces the static path display + "Change folder" link in `Workspace.svelte`. Switching calls a new `workspaceService.switchToBookmark` that resets store state and reuses the existing tree-load pipeline. Failures surface through the existing error UI, which gains a conditional "Remove bookmark" button.

**Tech Stack:** Svelte 5, TypeScript, Vitest + jsdom, `@testing-library/svelte`, TailwindCSS, Skeleton UI, `@lucide/svelte`.

**Spec:** `docs/superpowers/specs/2026-05-05-workspace-bookmarks-design.md`

**Test command pattern:** `bun run --filter=dtx-desktop test -- <file>` (run from repo root).

---

## File Structure

**New files:**

- `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts` — store + types + tiny `basename` helper.
- `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts` — store unit tests.
- `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte` — dropdown component.
- `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts` — component tests.

**Modified files:**

- `packages/dtx-desktop/src/renderer/src/services/workspaceService.ts` — add `switchToBookmark`.
- `packages/dtx-desktop/src/renderer/src/services/workspaceService.test.ts` — cover `switchToBookmark`.
- `packages/dtx-desktop/src/renderer/src/components/Workspace.svelte` — drop in the menu component, extend the error block.
- `packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts` — cover the new error-block button.

---

## Task 1: bookmarkStore — types, hydration, subscribe

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts`
- Test: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts`

- [ ] **Step 1: Write failing tests for hydration + subscribe**

```ts
// packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

describe('bookmarkStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.resetModules();
	});

	describe('hydration', () => {
		it('hydrates from valid JSON in localStorage', async () => {
			const stored = [
				{ path: '/a', name: 'A' },
				{ path: '/b', name: 'B' }
			];
			window.localStorage.setItem('workspace_bookmarks', JSON.stringify(stored));

			const { bookmarkStore } = await import('./bookmarkStore');
			expect(get(bookmarkStore)).toEqual(stored);
		});

		it('initializes empty when localStorage has no entry', async () => {
			const { bookmarkStore } = await import('./bookmarkStore');
			expect(get(bookmarkStore)).toEqual([]);
		});

		it('initializes empty when localStorage has malformed JSON', async () => {
			window.localStorage.setItem('workspace_bookmarks', 'not-json');
			const { bookmarkStore } = await import('./bookmarkStore');
			expect(get(bookmarkStore)).toEqual([]);
		});

		it('initializes empty when localStorage has non-array JSON', async () => {
			window.localStorage.setItem('workspace_bookmarks', '{"foo":"bar"}');
			const { bookmarkStore } = await import('./bookmarkStore');
			expect(get(bookmarkStore)).toEqual([]);
		});
	});
});
```

- [ ] **Step 2: Run tests; verify they fail with module not found**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: FAIL — `Cannot find module './bookmarkStore'` (or equivalent).

- [ ] **Step 3: Create the store with hydration only**

```ts
// packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts
import { writable } from 'svelte/store';

export interface WorkspaceBookmark {
	path: string;
	name: string;
}

export type AddResult = { ok: true } | { ok: false; reason: 'duplicate' | 'cap-exceeded' };

const STORAGE_KEY = 'workspace_bookmarks';
const MAX_BOOKMARKS = 20;

export function basename(p: string): string {
	const trimmed = p.replace(/[/\\]+$/, '');
	const parts = trimmed.split(/[/\\]/);
	return parts[parts.length - 1] || trimmed;
}

function hydrate(): WorkspaceBookmark[] {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is WorkspaceBookmark =>
				item != null && typeof item.path === 'string' && typeof item.name === 'string'
		);
	} catch {
		return [];
	}
}

function persist(value: WorkspaceBookmark[]): void {
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function createBookmarkStore() {
	const { subscribe, update } = writable<WorkspaceBookmark[]>(hydrate());

	return {
		subscribe
	};
}

export const bookmarkStore = createBookmarkStore();
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: PASS — all 4 hydration tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts
git commit -m "feat(desktop): add bookmarkStore skeleton with localStorage hydration"
```

---

## Task 2: bookmarkStore.add()

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts`

- [ ] **Step 1: Write failing tests for add()**

Append to `bookmarkStore.test.ts` (inside the top-level `describe('bookmarkStore', ...)`):

```ts
describe('add', () => {
	it('appends a bookmark and returns ok', async () => {
		const { bookmarkStore } = await import('./bookmarkStore');
		const result = bookmarkStore.add('/foo/bar', 'My Folder');
		expect(result).toEqual({ ok: true });
		expect(get(bookmarkStore)).toEqual([{ path: '/foo/bar', name: 'My Folder' }]);
	});

	it('defaults name to basename of path when name omitted', async () => {
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.add('/foo/bar/MySongs');
		expect(get(bookmarkStore)).toEqual([{ path: '/foo/bar/MySongs', name: 'MySongs' }]);
	});

	it('handles Windows-style paths in basename default', async () => {
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.add('C:\\Users\\jack\\Songs');
		expect(get(bookmarkStore)).toEqual([{ path: 'C:\\Users\\jack\\Songs', name: 'Songs' }]);
	});

	it('returns duplicate and does not mutate when path already exists', async () => {
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.add('/foo', 'First');
		const result = bookmarkStore.add('/foo', 'Second');
		expect(result).toEqual({ ok: false, reason: 'duplicate' });
		expect(get(bookmarkStore)).toEqual([{ path: '/foo', name: 'First' }]);
	});

	it('returns cap-exceeded and does not mutate when at 20 entries', async () => {
		const stored = Array.from({ length: 20 }, (_, i) => ({
			path: `/p${i}`,
			name: `n${i}`
		}));
		window.localStorage.setItem('workspace_bookmarks', JSON.stringify(stored));
		const { bookmarkStore } = await import('./bookmarkStore');
		const result = bookmarkStore.add('/new', 'New');
		expect(result).toEqual({ ok: false, reason: 'cap-exceeded' });
		expect(get(bookmarkStore)).toEqual(stored);
	});

	it('persists to localStorage on successful add', async () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.add('/foo', 'Foo');
		expect(setItem).toHaveBeenCalledWith(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/foo', name: 'Foo' }])
		);
		setItem.mockRestore();
	});
});
```

- [ ] **Step 2: Run tests; verify the add tests fail**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: FAIL — `bookmarkStore.add is not a function` for the 6 new tests; the 4 hydration tests still pass.

- [ ] **Step 3: Implement add()**

Edit `bookmarkStore.ts`. Replace the `createBookmarkStore` body so it returns `add` along with `subscribe`:

```ts
function createBookmarkStore() {
	const { subscribe, update } = writable<WorkspaceBookmark[]>(hydrate());

	return {
		subscribe,
		add(path: string, name?: string): AddResult {
			let result: AddResult = { ok: true };
			update((current) => {
				if (current.some((b) => b.path === path)) {
					result = { ok: false, reason: 'duplicate' };
					return current;
				}
				if (current.length >= MAX_BOOKMARKS) {
					result = { ok: false, reason: 'cap-exceeded' };
					return current;
				}
				const next = [...current, { path, name: name?.trim() || basename(path) }];
				persist(next);
				return next;
			});
			return result;
		}
	};
}
```

- [ ] **Step 4: Run tests; verify all pass**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: PASS — all hydration + add tests (10 total).

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts
git commit -m "feat(desktop): add bookmarkStore.add with duplicate and cap guards"
```

---

## Task 3: bookmarkStore.remove()

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts`

- [ ] **Step 1: Write failing tests for remove()**

Append to `bookmarkStore.test.ts` inside the top-level `describe`:

```ts
describe('remove', () => {
	it('removes the matching path', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([
				{ path: '/a', name: 'A' },
				{ path: '/b', name: 'B' }
			])
		);
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.remove('/a');
		expect(get(bookmarkStore)).toEqual([{ path: '/b', name: 'B' }]);
	});

	it('is a no-op when path is not present', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/a', name: 'A' }])
		);
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.remove('/missing');
		expect(get(bookmarkStore)).toEqual([{ path: '/a', name: 'A' }]);
	});

	it('persists remaining entries to localStorage', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([
				{ path: '/a', name: 'A' },
				{ path: '/b', name: 'B' }
			])
		);
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.remove('/a');
		expect(setItem).toHaveBeenCalledWith(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/b', name: 'B' }])
		);
		setItem.mockRestore();
	});
});
```

- [ ] **Step 2: Run tests; verify remove tests fail**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: FAIL — `bookmarkStore.remove is not a function`.

- [ ] **Step 3: Implement remove()**

In `bookmarkStore.ts`, add `remove` to the returned object:

```ts
		remove(path: string): void {
			update((current) => {
				if (!current.some((b) => b.path === path)) return current;
				const next = current.filter((b) => b.path !== path);
				persist(next);
				return next;
			});
		},
```

- [ ] **Step 4: Run tests; verify all pass**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts
git commit -m "feat(desktop): add bookmarkStore.remove"
```

---

## Task 4: bookmarkStore.rename()

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts`

- [ ] **Step 1: Write failing tests for rename()**

Append to `bookmarkStore.test.ts` inside the top-level `describe`:

```ts
describe('rename', () => {
	it('updates the name for the matching path', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/a', name: 'Old' }])
		);
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.rename('/a', 'New');
		expect(get(bookmarkStore)).toEqual([{ path: '/a', name: 'New' }]);
	});

	it('trims surrounding whitespace from the new name', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/a', name: 'Old' }])
		);
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.rename('/a', '   spaced   ');
		expect(get(bookmarkStore)).toEqual([{ path: '/a', name: 'spaced' }]);
	});

	it('falls back to basename when new name is empty after trim', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/foo/bar/MySongs', name: 'Old' }])
		);
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.rename('/foo/bar/MySongs', '   ');
		expect(get(bookmarkStore)).toEqual([{ path: '/foo/bar/MySongs', name: 'MySongs' }]);
	});

	it('is a no-op when path does not exist', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/a', name: 'A' }])
		);
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.rename('/missing', 'Whatever');
		expect(get(bookmarkStore)).toEqual([{ path: '/a', name: 'A' }]);
	});

	it('persists to localStorage on rename', async () => {
		window.localStorage.setItem(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/a', name: 'Old' }])
		);
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const { bookmarkStore } = await import('./bookmarkStore');
		bookmarkStore.rename('/a', 'New');
		expect(setItem).toHaveBeenCalledWith(
			'workspace_bookmarks',
			JSON.stringify([{ path: '/a', name: 'New' }])
		);
		setItem.mockRestore();
	});
});
```

- [ ] **Step 2: Run tests; verify rename tests fail**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: FAIL — `bookmarkStore.rename is not a function`.

- [ ] **Step 3: Implement rename()**

In `bookmarkStore.ts`, add `rename` to the returned object:

```ts
		rename(path: string, newName: string): void {
			update((current) => {
				const idx = current.findIndex((b) => b.path === path);
				if (idx === -1) return current;
				const trimmed = newName.trim();
				const finalName = trimmed === '' ? basename(path) : trimmed;
				if (current[idx].name === finalName) return current;
				const next = current.map((b, i) => (i === idx ? { ...b, name: finalName } : b));
				persist(next);
				return next;
			});
		}
```

- [ ] **Step 4: Run tests; verify all pass**

Run: `bun run --filter=dtx-desktop test -- bookmarkStore.test.ts`
Expected: PASS — all hydration + add + remove + rename tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.ts packages/dtx-desktop/src/renderer/src/stores/bookmarkStore.test.ts
git commit -m "feat(desktop): add bookmarkStore.rename with whitespace handling"
```

---

## Task 5: workspaceService.switchToBookmark

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/services/workspaceService.ts`
- Modify: `packages/dtx-desktop/src/renderer/src/services/workspaceService.test.ts`

- [ ] **Step 1: Write failing tests for switchToBookmark**

Append to `workspaceService.test.ts` (inside the top-level `describe('WorkspaceService', ...)`). Note the existing mock for `workspaceStore` (lines 9–23) is missing `reset` — extend the mock first:

In the mock object at the top of the file, add a new property:

```ts
		reset: vi.fn(),
```

Add this `describe` block at the bottom of the top-level describe:

```ts
describe('switchToBookmark', () => {
	it('resets, sets the path, and reloads sub-workspaces and tree in order', async () => {
		const calls: string[] = [];
		(workspaceStore.reset as any).mockImplementation(() => calls.push('reset'));
		(workspaceStore.setPath as any).mockImplementation(() => calls.push('setPath'));

		(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
			cb({ path: '/bm/path', currentSubWorkspace: null, subWorkspaces: [] });
			return vi.fn();
		});
		(window.electron.ipcRenderer.invoke as any).mockImplementation((channel: string) => {
			if (channel === 'list-directories') {
				calls.push('list-directories');
				return Promise.resolve([]);
			}
			if (channel === 'load-tree-structure') {
				calls.push('load-tree-structure');
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		});

		await workspaceService.switchToBookmark({ path: '/bm/path', name: 'BM' });

		expect(workspaceStore.reset).toHaveBeenCalledTimes(1);
		expect(workspaceStore.setPath).toHaveBeenCalledWith('/bm/path');
		expect(calls.indexOf('reset')).toBeLessThan(calls.indexOf('setPath'));
		expect(calls.indexOf('setPath')).toBeLessThan(calls.indexOf('list-directories'));
		expect(calls.indexOf('list-directories')).toBeLessThan(
			calls.indexOf('load-tree-structure')
		);
	});

	it('surfaces tree-load errors via setError without clearing the path', async () => {
		(workspaceStore.subscribe as any).mockImplementation((cb: any) => {
			cb({ path: '/bm/path', currentSubWorkspace: null, subWorkspaces: [] });
			return vi.fn();
		});
		(window.electron.ipcRenderer.invoke as any).mockImplementation((channel: string) => {
			if (channel === 'list-directories') return Promise.resolve([]);
			if (channel === 'load-tree-structure') {
				return Promise.reject(new Error('boom'));
			}
			return Promise.resolve([]);
		});

		await workspaceService.switchToBookmark({ path: '/bm/path', name: 'BM' });

		expect(workspaceStore.setError).toHaveBeenCalledWith('Failed to load tree structure');
		expect(workspaceStore.clearWorkspace).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `bun run --filter=dtx-desktop test -- workspaceService.test.ts`
Expected: FAIL — `workspaceService.switchToBookmark is not a function`.

- [ ] **Step 3: Implement switchToBookmark**

Add to `workspaceService.ts`. First, add the import alongside the existing imports:

```ts
import type { WorkspaceBookmark } from '../stores/bookmarkStore';
```

Then add this method to the `workspaceService` object (after `selectWorkspace`):

```ts
	/**
	 * Switches to a saved workspace bookmark: resets workspace state, sets the new path,
	 * and reloads sub-workspaces and tree.
	 */
	switchToBookmark: async (bookmark: WorkspaceBookmark): Promise<void> => {
		workspaceStore.reset();
		workspaceStore.setPath(bookmark.path);
		await workspaceService.loadSubWorkspaces();
		await workspaceService.loadTreeStructure();
	},
```

- [ ] **Step 4: Run tests; verify all pass**

Run: `bun run --filter=dtx-desktop test -- workspaceService.test.ts`
Expected: PASS — including the existing tests and the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/services/workspaceService.ts packages/dtx-desktop/src/renderer/src/services/workspaceService.test.ts
git commit -m "feat(desktop): add workspaceService.switchToBookmark"
```

---

## Task 6: WorkspaceBookmarksMenu — trigger button + dropdown open/close

**Files:**

- Create: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- Test: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`

- [ ] **Step 1: Write failing tests for trigger render + open/close**

```ts
// packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

vi.mock('../stores/workspaceStore', () => {
	let state = { path: null as string | null };
	const listeners: Array<(s: typeof state) => void> = [];
	return {
		workspaceStore: {
			subscribe: vi.fn((cb: (s: typeof state) => void) => {
				cb(state);
				listeners.push(cb);
				return () => listeners.splice(listeners.indexOf(cb), 1);
			}),
			setState: (next: Partial<typeof state>) => {
				state = { ...state, ...next };
				listeners.forEach((cb) => cb(state));
			}
		}
	};
});

vi.mock('../stores/bookmarkStore', () => {
	let value: Array<{ path: string; name: string }> = [];
	const listeners: Array<(v: typeof value) => void> = [];
	return {
		bookmarkStore: {
			subscribe: vi.fn((cb: (v: typeof value) => void) => {
				cb(value);
				listeners.push(cb);
				return () => listeners.splice(listeners.indexOf(cb), 1);
			}),
			setValue: (next: typeof value) => {
				value = next;
				listeners.forEach((cb) => cb(value));
			},
			add: vi.fn(),
			remove: vi.fn(),
			rename: vi.fn()
		}
	};
});

vi.mock('../services/workspaceService', () => ({
	workspaceService: {
		switchToBookmark: vi.fn(),
		selectWorkspace: vi.fn()
	}
}));

import WorkspaceBookmarksMenu from './WorkspaceBookmarksMenu.svelte';
import { workspaceStore } from '../stores/workspaceStore';

describe('WorkspaceBookmarksMenu', () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
		(workspaceStore as any).setState({ path: '/foo/bar/MySongs' });
	});

	it('renders the basename of the current path on the trigger', () => {
		render(WorkspaceBookmarksMenu);
		expect(screen.getByRole('button', { name: /workspace menu/i })).toHaveTextContent(
			'MySongs'
		);
	});

	it('does not render the dropdown initially', () => {
		render(WorkspaceBookmarksMenu);
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('opens the dropdown on trigger click and closes on Escape', async () => {
		render(WorkspaceBookmarksMenu);
		const trigger = screen.getByRole('button', { name: /workspace menu/i });

		await fireEvent.click(trigger);
		expect(screen.getByRole('menu')).toBeInTheDocument();

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('shows the full current path inside the dropdown', async () => {
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		expect(screen.getByText('/foo/bar/MySongs')).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Create the component skeleton**

```svelte
<!-- packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceStore } from '../stores/workspaceStore';
	import { bookmarkStore, basename, type WorkspaceBookmark } from '../stores/bookmarkStore';
	import { workspaceService } from '../services/workspaceService';
	import { ChevronDown } from '@lucide/svelte';

	let isOpen = $state(false);
	let currentPath = $state<string | null>(null);
	let bookmarks = $state<WorkspaceBookmark[]>([]);

	const unsubWs = workspaceStore.subscribe((s) => {
		currentPath = s.path;
	});
	const unsubBm = bookmarkStore.subscribe((v) => {
		bookmarks = v;
	});

	const handleTriggerClick = () => {
		isOpen = !isOpen;
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && isOpen) {
			isOpen = false;
		}
	};

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			unsubWs();
			unsubBm();
		};
	});

	const triggerLabel = $derived(currentPath ? basename(currentPath) : 'No workspace');
</script>

<div class="relative inline-block">
	<button
		type="button"
		class="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
		aria-label="Workspace menu"
		aria-haspopup="menu"
		aria-expanded={isOpen}
		onclick={handleTriggerClick}
	>
		<span>{triggerLabel}</span>
		<ChevronDown size={14} />
	</button>

	{#if isOpen}
		<div
			role="menu"
			class="absolute left-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
		>
			{#if currentPath}
				<div class="px-2 py-1">
					<div class="text-xs font-medium text-slate-500 dark:text-slate-400">
						Current
					</div>
					<div
						class="mt-1 truncate font-mono text-xs text-slate-700 dark:text-slate-200"
						title={currentPath}
					>
						{currentPath}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts
git commit -m "feat(desktop): add WorkspaceBookmarksMenu trigger and dropdown shell"
```

---

## Task 7: WorkspaceBookmarksMenu — "Bookmark this folder" action

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`

- [ ] **Step 1: Write failing tests for the bookmark action**

Append to the top-level `describe` in `WorkspaceBookmarksMenu.test.ts`:

```ts
describe('Bookmark this folder action', () => {
	it('shows "Bookmark this folder" when current path is not bookmarked', async () => {
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		expect(screen.getByRole('menuitem', { name: /bookmark this folder/i })).toBeInTheDocument();
	});

	it('calls bookmarkStore.add and closes dropdown on click', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		(bookmarkStore.add as any).mockReturnValue({ ok: true });

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

		expect(bookmarkStore.add).toHaveBeenCalledWith('/foo/bar/MySongs');
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('shows "Bookmarked as <name>" indicator when current path is bookmarked', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		(bookmarkStore as any).setValue([{ path: '/foo/bar/MySongs', name: 'My Faves' }]);

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

		expect(screen.getByText(/bookmarked as my faves/i)).toBeInTheDocument();
		expect(screen.queryByRole('menuitem', { name: /bookmark this folder/i })).toBeNull();
	});

	it('shows an error message when add returns cap-exceeded', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		(bookmarkStore.add as any).mockReturnValue({ ok: false, reason: 'cap-exceeded' });

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('menuitem', { name: /bookmark this folder/i }));

		expect(screen.getByText(/maximum of 20 bookmarks/i)).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: FAIL — the bookmark menuitem doesn't exist yet.

- [ ] **Step 3: Add the action to the component**

In `WorkspaceBookmarksMenu.svelte` `<script>` block, add:

```ts
import { Star, CheckCircle2 } from '@lucide/svelte';

let addError = $state<string | null>(null);

const isCurrentBookmarked = $derived(
	!!currentPath && bookmarks.some((b) => b.path === currentPath)
);
const currentBookmark = $derived(
	currentPath ? (bookmarks.find((b) => b.path === currentPath) ?? null) : null
);

const handleBookmarkCurrent = () => {
	if (!currentPath) return;
	const result = bookmarkStore.add(currentPath);
	if (result.ok) {
		addError = null;
		isOpen = false;
	} else if (result.reason === 'cap-exceeded') {
		addError = 'Maximum of 20 bookmarks reached';
	} else {
		addError = null;
	}
};
```

In the dropdown panel, after the "Current" block, add:

```svelte
{#if currentPath && !isCurrentBookmarked}
	<button
		type="button"
		role="menuitem"
		class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
		onclick={handleBookmarkCurrent}
	>
		<Star size={16} />
		<span>Bookmark this folder</span>
	</button>
{:else if currentBookmark}
	<div class="flex items-center gap-2 px-2 py-2 text-sm text-emerald-700 dark:text-emerald-300">
		<CheckCircle2 size={16} />
		<span>Bookmarked as {currentBookmark.name}</span>
	</div>
{/if}
{#if addError}
	<div class="px-2 py-1 text-xs text-red-600 dark:text-red-300">{addError}</div>
{/if}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts
git commit -m "feat(desktop): add 'Bookmark this folder' action to bookmarks menu"
```

---

## Task 8: WorkspaceBookmarksMenu — bookmark list with switch click + active marker

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`

- [ ] **Step 1: Write failing tests for list rendering, switch click, and active marker**

Append to the top-level `describe`:

```ts
describe('Bookmark list', () => {
	it('renders no Bookmarks heading when list is empty', async () => {
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		expect(screen.queryByText(/^bookmarks$/i)).toBeNull();
	});

	it('renders each bookmark with name and path', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		(bookmarkStore as any).setValue([
			{ path: '/a', name: 'Alpha' },
			{ path: '/b', name: 'Beta' }
		]);

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

		expect(screen.getByText('Alpha')).toBeInTheDocument();
		expect(screen.getByText('/a')).toBeInTheDocument();
		expect(screen.getByText('Beta')).toBeInTheDocument();
		expect(screen.getByText('/b')).toBeInTheDocument();
	});

	it('clicking a non-active bookmark calls switchToBookmark and closes the dropdown', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		const { workspaceService } = await import('../services/workspaceService');
		(bookmarkStore as any).setValue([{ path: '/a', name: 'Alpha' }]);

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('menuitem', { name: /switch to alpha/i }));

		expect(workspaceService.switchToBookmark).toHaveBeenCalledWith({
			path: '/a',
			name: 'Alpha'
		});
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('marks the active bookmark and does not call switchToBookmark on click', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		const { workspaceService } = await import('../services/workspaceService');
		(bookmarkStore as any).setValue([{ path: '/foo/bar/MySongs', name: 'Active' }]);

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));

		const activeRow = screen.getByTestId('bookmark-row-/foo/bar/MySongs');
		expect(activeRow).toHaveAttribute('data-active', 'true');

		await fireEvent.click(activeRow);
		expect(workspaceService.switchToBookmark).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: FAIL — list and rows are not rendered yet.

- [ ] **Step 3: Add bookmark list rendering and click handling**

Add a handler in the `<script>`:

```ts
const handleSwitchTo = (b: WorkspaceBookmark) => {
	if (b.path === currentPath) return;
	isOpen = false;
	void workspaceService.switchToBookmark(b);
};
```

Inside the dropdown panel, after the "Bookmark this folder" block, add:

```svelte
{#if bookmarks.length > 0}
	<div class="my-1 border-t border-slate-200 dark:border-slate-700"></div>
	<div class="px-2 pt-2 pb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
		Bookmarks
	</div>
	<ul class="max-h-72 overflow-auto">
		{#each bookmarks as bookmark (bookmark.path)}
			{@const isActive = bookmark.path === currentPath}
			<li
				role="menuitem"
				aria-label={isActive ? `${bookmark.name} (current)` : `Switch to ${bookmark.name}`}
				aria-disabled={isActive}
				data-testid={`bookmark-row-${bookmark.path}`}
				data-active={isActive ? 'true' : 'false'}
				tabindex="0"
				class="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
				class:cursor-default={isActive}
				class:bg-slate-50={isActive}
				class:dark:bg-slate-700={isActive}
				onclick={() => handleSwitchTo(bookmark)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						handleSwitchTo(bookmark);
					}
				}}
			>
				<div class="min-w-0 flex-1">
					<div class="truncate text-slate-800 dark:text-slate-100">
						{bookmark.name}
					</div>
					<div
						class="truncate font-mono text-xs text-slate-500 dark:text-slate-400"
						title={bookmark.path}
					>
						{bookmark.path}
					</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts
git commit -m "feat(desktop): render bookmark list and wire switch-on-click"
```

---

## Task 9: WorkspaceBookmarksMenu — inline rename via pencil icon

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`

- [ ] **Step 1: Write failing tests for rename**

Append to the top-level `describe`:

```ts
describe('Inline rename', () => {
	beforeEach(async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		(bookmarkStore as any).setValue([{ path: '/a', name: 'Alpha' }]);
	});

	it('clicking pencil swaps name for an input with current value', async () => {
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

		const input = screen.getByRole('textbox', { name: /rename alpha/i });
		expect(input).toHaveValue('Alpha');
	});

	it('Enter saves the new name via bookmarkStore.rename', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

		const input = screen.getByRole('textbox', { name: /rename alpha/i });
		await fireEvent.input(input, { target: { value: 'Renamed' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(bookmarkStore.rename).toHaveBeenCalledWith('/a', 'Renamed');
	});

	it('Escape cancels the rename without calling rename', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

		const input = screen.getByRole('textbox', { name: /rename alpha/i });
		await fireEvent.input(input, { target: { value: 'Discard' } });
		await fireEvent.keyDown(input, { key: 'Escape' });

		expect(bookmarkStore.rename).not.toHaveBeenCalled();
		expect(screen.queryByRole('textbox', { name: /rename alpha/i })).toBeNull();
	});

	it('blur saves the current input value', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('button', { name: /rename alpha/i }));

		const input = screen.getByRole('textbox', { name: /rename alpha/i });
		await fireEvent.input(input, { target: { value: 'BlurSaved' } });
		await fireEvent.blur(input);

		expect(bookmarkStore.rename).toHaveBeenCalledWith('/a', 'BlurSaved');
	});
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: FAIL — pencil button doesn't exist yet.

- [ ] **Step 3: Implement inline rename**

In the `<script>` block, add:

```ts
import { Pencil } from '@lucide/svelte';

let editingPath = $state<string | null>(null);
let editingValue = $state('');

const startEditing = (b: WorkspaceBookmark) => {
	editingPath = b.path;
	editingValue = b.name;
};

const commitEditing = () => {
	if (editingPath === null) return;
	const path = editingPath;
	const value = editingValue;
	editingPath = null;
	bookmarkStore.rename(path, value);
};

const cancelEditing = () => {
	editingPath = null;
};

const handleEditKeydown = (event: KeyboardEvent) => {
	if (event.key === 'Enter') {
		event.preventDefault();
		commitEditing();
	} else if (event.key === 'Escape') {
		event.preventDefault();
		cancelEditing();
	}
};
```

In the bookmark `<li>` row template, replace the name `<div>` (the one rendering `{bookmark.name}`) with a conditional. Locate this block:

```svelte
<div class="truncate text-slate-800 dark:text-slate-100">
	{bookmark.name}
</div>
```

Replace with:

```svelte
{#if editingPath === bookmark.path}
	<!-- svelte-ignore a11y_autofocus -->
	<input
		type="text"
		class="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
		aria-label={`Rename ${bookmark.name}`}
		bind:value={editingValue}
		onkeydown={handleEditKeydown}
		onblur={commitEditing}
		onclick={(e) => e.stopPropagation()}
		autofocus
	/>
{:else}
	<div class="truncate text-slate-800 dark:text-slate-100">
		{bookmark.name}
	</div>
{/if}
```

Then, inside the `<li>`, after the path line and outside the `min-w-0 flex-1` div, add the pencil button:

```svelte
<button
	type="button"
	class="rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-600 dark:hover:text-slate-200"
	aria-label={`Rename ${bookmark.name}`}
	onclick={(e) => {
		e.stopPropagation();
		startEditing(bookmark);
	}}
>
	<Pencil size={14} />
</button>
```

Also add `class="group …"` to the `<li>` so the `group-hover:opacity-100` reveals the icon. Update the existing `<li>` opening tag's `class:` list — replace `class="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700"` with `class="group flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700"`.

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts
git commit -m "feat(desktop): add inline rename for bookmarks via pencil icon"
```

---

## Task 10: WorkspaceBookmarksMenu — trash icon to remove bookmark

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`

- [ ] **Step 1: Write failing tests for remove**

Append to the top-level `describe`:

```ts
describe('Trash remove', () => {
	it('clicking trash calls bookmarkStore.remove without confirmation', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		(bookmarkStore as any).setValue([{ path: '/a', name: 'Alpha' }]);

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }));

		expect(bookmarkStore.remove).toHaveBeenCalledWith('/a');
	});

	it('clicking trash does not trigger switch on the row', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		const { workspaceService } = await import('../services/workspaceService');
		(bookmarkStore as any).setValue([{ path: '/a', name: 'Alpha' }]);

		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }));

		expect(workspaceService.switchToBookmark).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: FAIL — trash button missing.

- [ ] **Step 3: Add the trash button**

In the `<script>`:

```ts
import { Trash2 } from '@lucide/svelte';

const handleRemove = (b: WorkspaceBookmark) => {
	bookmarkStore.remove(b.path);
};
```

In the `<li>`, after the pencil button, add the trash button:

```svelte
<button
	type="button"
	class="rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-red-600 dark:hover:bg-slate-600 dark:hover:text-red-400"
	aria-label={`Remove ${bookmark.name}`}
	onclick={(e) => {
		e.stopPropagation();
		handleRemove(bookmark);
	}}
>
	<Trash2 size={14} />
</button>
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts
git commit -m "feat(desktop): add trash icon to remove bookmarks"
```

---

## Task 11: WorkspaceBookmarksMenu — "Browse for folder…" entry

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts`

- [ ] **Step 1: Write failing test for Browse entry**

Append to the top-level `describe`:

```ts
describe('Browse for folder', () => {
	it('clicking "Browse for folder…" calls selectWorkspace and closes the dropdown', async () => {
		const { workspaceService } = await import('../services/workspaceService');
		render(WorkspaceBookmarksMenu);
		await fireEvent.click(screen.getByRole('button', { name: /workspace menu/i }));
		await fireEvent.click(screen.getByRole('menuitem', { name: /browse for folder/i }));

		expect(workspaceService.selectWorkspace).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole('menu')).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests; verify it fails**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: FAIL — Browse menuitem not found.

- [ ] **Step 3: Add the Browse entry**

In the `<script>`:

```ts
import { FolderOpen } from '@lucide/svelte';

const handleBrowse = () => {
	isOpen = false;
	void workspaceService.selectWorkspace();
};
```

At the bottom of the dropdown panel (after the bookmark list, still inside the panel `<div role="menu">`):

```svelte
<div class="my-1 border-t border-slate-200 dark:border-slate-700"></div>
<button
	type="button"
	role="menuitem"
	class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
	onclick={handleBrowse}
>
	<FolderOpen size={16} />
	<span>Browse for folder…</span>
</button>
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- WorkspaceBookmarksMenu.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.svelte packages/dtx-desktop/src/renderer/src/components/WorkspaceBookmarksMenu.test.ts
git commit -m "feat(desktop): add Browse-for-folder entry to bookmarks menu"
```

---

## Task 12: Wire WorkspaceBookmarksMenu into Workspace.svelte

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/Workspace.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts`

- [ ] **Step 1: Update Workspace.test.ts mock and add a render test**

In `Workspace.test.ts`, add the bookmark store mock and the new component mock alongside the others:

```ts
vi.mock('../stores/bookmarkStore', () => {
	let value: Array<{ path: string; name: string }> = [];
	const listeners: Array<(v: typeof value) => void> = [];
	return {
		bookmarkStore: {
			subscribe: vi.fn((cb: (v: typeof value) => void) => {
				cb(value);
				listeners.push(cb);
				return () => listeners.splice(listeners.indexOf(cb), 1);
			}),
			setValue: (next: typeof value) => {
				value = next;
				listeners.forEach((cb) => cb(value));
			},
			add: vi.fn(),
			remove: vi.fn(),
			rename: vi.fn()
		},
		basename: (p: string) => p.split('/').pop() ?? p
	};
});

vi.mock('./WorkspaceBookmarksMenu.svelte', () => ({ default: vi.fn() }));
```

Add a test inside the existing top-level `describe` (after the existing tests, but before the closing brace of `describe('Workspace', …)`):

```ts
it('renders WorkspaceBookmarksMenu in place of the legacy Change folder link when a path is set', async () => {
	const WorkspaceBookmarksMenu = (await import('./WorkspaceBookmarksMenu.svelte')).default;

	(workspaceStore as any).setState({ path: '/test/workspace' });
	render(Workspace);

	expect(screen.queryByRole('link', { name: /change folder/i })).toBeNull();
	expect(WorkspaceBookmarksMenu).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests; verify it fails**

Run: `bun run --filter=dtx-desktop test -- Workspace.test.ts`
Expected: FAIL — `Change folder` text still present (the legacy block still exists).

- [ ] **Step 3: Replace the legacy path-display block with the new menu**

In `Workspace.svelte`, add the import alongside other component imports:

```ts
import WorkspaceBookmarksMenu from './WorkspaceBookmarksMenu.svelte';
```

Find this block (lines ~302–322):

```svelte
<!-- Workspace Content -->
<div class="mb-4">
	<div class="mb-2 flex items-center">
		<span class="mr-2 text-sm font-medium text-slate-500 dark:text-slate-400"
			>Current workspace:</span
		>
		<span class="rounded bg-slate-100 px-2 py-1 font-mono text-sm dark:bg-slate-700">
			{workspacePath}
		</span>
	</div>
	<button
		class="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
		onclick={handleSelectWorkspace}
		tabindex="0"
		aria-label="Change workspace folder"
	>
		Change folder
	</button>
</div>
```

Replace with:

```svelte
<!-- Workspace Content -->
<div class="mb-4">
	<WorkspaceBookmarksMenu />
</div>
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- Workspace.test.ts`
Expected: PASS — existing tests still pass plus the new render test.

Then run the full desktop test suite to make sure nothing else regressed:

Run: `bun run --filter=dtx-desktop test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/Workspace.svelte packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts
git commit -m "feat(desktop): swap legacy path display for WorkspaceBookmarksMenu"
```

---

## Task 13: Error block — "Remove bookmark" button when failure path is bookmarked

**Files:**

- Modify: `packages/dtx-desktop/src/renderer/src/components/Workspace.svelte`
- Modify: `packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts`

- [ ] **Step 1: Write failing tests**

Append inside the top-level `describe('Workspace', …)` in `Workspace.test.ts`:

```ts
describe('Remove bookmark error action', () => {
	it('does not show the button when failure path is not in bookmarkStore', () => {
		(workspaceStore as any).setState({
			path: '/missing',
			error: 'Failed to load tree structure'
		});
		render(Workspace);
		expect(screen.queryByRole('button', { name: /remove bookmark/i })).toBeNull();
	});

	it('shows the button when failure path is in bookmarkStore', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		(bookmarkStore as any).setValue([{ path: '/missing', name: 'Missing' }]);
		(workspaceStore as any).setState({
			path: '/missing',
			error: 'Failed to load tree structure'
		});
		render(Workspace);
		expect(screen.getByRole('button', { name: /remove bookmark/i })).toBeInTheDocument();
	});

	it('clicking the button calls bookmarkStore.remove and workspaceService.clearWorkspace', async () => {
		const { bookmarkStore } = await import('../stores/bookmarkStore');
		const { workspaceService } = await import('../services/workspaceService');
		(bookmarkStore as any).setValue([{ path: '/missing', name: 'Missing' }]);
		(workspaceStore as any).setState({
			path: '/missing',
			error: 'Failed to load tree structure'
		});

		render(Workspace);
		await fireEvent.click(screen.getByRole('button', { name: /remove bookmark/i }));

		expect(bookmarkStore.remove).toHaveBeenCalledWith('/missing');
		expect(workspaceService.clearWorkspace).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `bun run --filter=dtx-desktop test -- Workspace.test.ts`
Expected: FAIL — Remove bookmark button doesn't exist yet.

- [ ] **Step 3: Add the button to the error block**

In `Workspace.svelte` `<script>` block, add the bookmark store import and wire derived state:

```ts
import { bookmarkStore } from '../stores/bookmarkStore';

let bookmarks = $state<Array<{ path: string; name: string }>>([]);
const unsubBookmarks = bookmarkStore.subscribe((v) => {
	bookmarks = v;
});

const isCurrentPathBookmarked = $derived(
	!!workspacePath && bookmarks.some((b) => b.path === workspacePath)
);

const handleRemoveBookmark = () => {
	if (!workspacePath) return;
	bookmarkStore.remove(workspacePath);
	workspaceService.clearWorkspace();
};
```

Update the existing `onMount` cleanup so `unsubBookmarks` is called too. Replace:

```ts
onMount(() => {
	if (workspacePath) {
		void workspaceService.loadSubWorkspaces();
		void workspaceService.loadTreeStructure();
	}

	return unsubscribe;
});
```

With:

```ts
onMount(() => {
	if (workspacePath) {
		void workspaceService.loadSubWorkspaces();
		void workspaceService.loadTreeStructure();
	}

	return () => {
		unsubscribe();
		unsubBookmarks();
	};
});
```

In the error block (around lines 266–279), find:

```svelte
						{:else if error}
							<div
								class="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-900/20 dark:text-red-300"
							>
								<p>{error}</p>
								<button
									class="mt-2 rounded bg-red-100 px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-200 dark:bg-red-800/30 dark:text-red-200 dark:hover:bg-red-800/50"
									onclick={handleSelectWorkspace}
									tabindex="0"
									aria-label="Try again"
								>
									Try Again
								</button>
							</div>
```

Replace with:

```svelte
						{:else if error}
							<div
								class="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-900/20 dark:text-red-300"
							>
								<p>{error}</p>
								<div class="mt-2 flex flex-wrap gap-2">
									<button
										class="rounded bg-red-100 px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-200 dark:bg-red-800/30 dark:text-red-200 dark:hover:bg-red-800/50"
										onclick={handleSelectWorkspace}
										tabindex="0"
										aria-label="Try again"
									>
										Try Again
									</button>
									{#if isCurrentPathBookmarked}
										<button
											class="rounded bg-red-100 px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-200 dark:bg-red-800/30 dark:text-red-200 dark:hover:bg-red-800/50"
											onclick={handleRemoveBookmark}
											tabindex="0"
											aria-label="Remove bookmark"
										>
											Remove bookmark
										</button>
									{/if}
								</div>
							</div>
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `bun run --filter=dtx-desktop test -- Workspace.test.ts`
Expected: PASS.

Run the full desktop suite for a final regression check:

Run: `bun run --filter=dtx-desktop test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-desktop/src/renderer/src/components/Workspace.svelte packages/dtx-desktop/src/renderer/src/components/Workspace.test.ts
git commit -m "feat(desktop): add Remove bookmark action to workspace error UI"
```

---

## Done

After Task 13:

- All 4 spec sections (data model + storage, UI dropdown, switching, error handling) are implemented.
- 13 commits, each independently reviewable.
- Test counts: ~18 store tests, 2 service tests, ~19 menu component tests, 4 workspace tests added.
- No e2e changes (desktop is unit-only).
