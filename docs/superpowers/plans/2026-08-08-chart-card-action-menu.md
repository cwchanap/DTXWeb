# Chart Card Action Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the audio preview and the notation preview into the chart card's top-right `[⋮]` menu, giving public blog cards the menu owner cards already have, and leaving the cover image clean until audio plays.

**Architecture:** Extract the audio playback state that currently lives inside `ImageAudio.svelte` into a standalone reactive unit (`$lib/audioPreview.svelte.ts`), so both the card menu and the cover overlay can read and drive it. `ImageAudio` becomes presentational, `ChartListItem` composes the unit into both surfaces.

**Tech Stack:** TypeScript 5.x, Svelte 5 (runes), SvelteKit 2.x, Skeleton UI `Popover`, Vitest + Testing Library, svelte-i18n.

Design doc: `docs/superpowers/specs/2026-08-08-chart-card-action-menu-design.md`

## Global Constraints

- No database, GraphQL, API, auth, or codegen changes. No desktop/Tauri or Phaser changes.
- No change to `ChartListTableItem.svelte` (the compact table row) or its tests.
- No change to download eligibility, download URLs, or download semantics.
- No change to the owner menu's existing entries: `Open in Editor`, `Edit details`, `Publish`/`Unpublish`, `Delete` — same labels, same order relative to each other, same destinations. Their hardcoded English is pre-existing and stays.
- Playback behaviour must be preserved exactly, including the global rule that starting one card's audio stops any other (via `store.playingAudio`).
- The cover overlay button and the menu entry both resolve their label as: `chart_actions.pause_audio` when playing, otherwise `chart_actions.play_audio`.
- New i18n keys go under `chart_actions` in **both** `en.json` and `jp.json`. Japanese uses the existing vocabulary: `音声` for audio, `一時停止` for pause.
- `preview.open` is reused unchanged for the Preview entry.
- A menu is never rendered empty. On blog cards, if neither entry applies, no `[⋮]` is rendered at all.
- Tests must **not** click the Popover trigger before asserting menu contents — `packages/dtx-web/src/tests/stubs/PopoverStub.svelte` always renders its content snippet.
- Every task ends with `bun run --filter=dtx-web check` passing before commit. **Environment note:** that command reports exactly 1 pre-existing error at `src/hooks.server.ts:53` (a `@supabase/ssr` cookie-typing drift) in a file untouched by this plan. "Check passing" means no errors beyond that one.
- Repo conventions: Prettier with tabs, single quotes, print width 100. Event handlers prefixed `handle`. Prefer `const` over `function`.

---

## File Structure

### New

- `packages/dtx-web/src/lib/audioPreview.svelte.ts`
    - Owns audio playback state and the `store.playingAudio` coordination. Exports `AudioPreview` and `createAudioPreview`. No DOM, no markup.
- `packages/dtx-web/src/lib/audioPreview.test.ts`
    - Direct unit tests for the above. This logic is currently only reachable through component rendering.

### Modified

- `packages/dtx-web/src/lib/components/ImageAudio.svelte`
    - Becomes presentational: renders the cover image and the overlay button, delegates all audio behaviour to an injected `AudioPreview`.
- `packages/dtx-web/src/lib/components/ImageAudio.test.ts`
    - Reworked from internal-state assertions to presentational ones.
- `packages/dtx-web/src/lib/components/ChartListItem.svelte`
    - Creates the `AudioPreview`, passes it to `ImageAudio`, and renders the menu entries on both card types. Loses the footer Preview CTA.
- `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
    - Menu-content coverage per context. Two existing tests are inverted (see Task 4).
- `packages/dtx-web/src/lib/i18n/locales/en.json`, `jp.json`
    - Two new `chart_actions` keys.

---

## Implementation Risks

- **Rune context.** `createAudioPreview` uses `$state` and `$effect` in a `.svelte.ts` module. `$effect` requires an effect context, so the factory must be called during component initialization (top level of a `<script>`), and standalone tests must wrap calls in `$effect.root`. If `$effect.root` fights the repo's Vitest setup, the documented fallback is to add an explicit `dispose(): void` to `AudioPreview` and have `ChartListItem` own the lifecycle — same interface otherwise, no behaviour change. Report this rather than silently changing the design.
- **Sequencing.** Task 2 is a deliberate behaviour-preserving refactor: the overlay still shows when idle. The overlay only flips to playing/loading-only in Task 4, in the _same commit_ that gives blog cards a menu entry. Do not flip it earlier — doing so would ship a commit where blog users cannot start audio at all.
- **Contradicting test.** `ChartListItem.test.ts` currently asserts `does not render action menu in blog mode`. That is exactly what Task 4 changes. It must be inverted, not deleted.
- **Dead capture.** `capturedImageAudioProps` in `ChartListItem.test.ts` is assigned but never asserted. Task 2 removes it rather than porting it.

---

### Task 1: Extract the audio preview unit

**Files:**

- Create: `packages/dtx-web/src/lib/audioPreview.svelte.ts`
- Test: `packages/dtx-web/src/lib/audioPreview.test.ts`

**Interfaces:**

- Consumes: `store.playingAudio` from `$lib/store` (re-exported from `@dtx/common`), a writable store holding the currently-playing `HTMLAudioElement` or `null`.
- Produces:

    ```ts
    export interface AudioPreview {
    	readonly isPlaying: boolean;
    	readonly isLoading: boolean;
    	readonly available: boolean;
    	toggle(): Promise<void>;
    }
    export const createAudioPreview: (getUrl: () => string | null) => AudioPreview;
    ```

    Tasks 2–4 depend on exactly these names.

- [ ] **Step 1: Write the failing tests**

Create `packages/dtx-web/src/lib/audioPreview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get as mockGet } from 'svelte/store';

const mockPlayingAudio = vi.hoisted(() => ({
	subscribe: vi.fn((cb: (v: unknown) => void) => {
		cb(null);
		return () => {};
	}),
	set: vi.fn()
}));

vi.mock('$lib/store', () => ({
	default: { playingAudio: mockPlayingAudio }
}));

const mockAudio = vi.hoisted(() => ({
	play: vi.fn().mockResolvedValue(undefined),
	pause: vi.fn(),
	addEventListener: vi.fn(),
	remove: vi.fn(),
	currentTime: 0,
	src: '',
	load: vi.fn()
}));

import { createAudioPreview } from './audioPreview.svelte';

const URL_A = 'https://cdn.example.com/a.mp3';

// Each test creates the unit inside `$effect.root(...)` so the factory's
// `$effect` calls have a context, then disposes it at the end.

describe('createAudioPreview', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'Audio',
			vi.fn(() => mockAudio)
		);
		mockPlayingAudio.subscribe.mockImplementation((cb: (v: unknown) => void) => {
			cb(null);
			return () => {};
		});
		mockAudio.play.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reports unavailable when there is no source url', () => {
		const dispose = $effect.root(() => {
			const audio = createAudioPreview(() => null);
			expect(audio.available).toBe(false);
		});
		dispose();
	});

	it('constructs and plays the source url on first toggle', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		await audio.toggle();

		expect(global.Audio).toHaveBeenCalledWith(URL_A);
		expect(mockAudio.play).toHaveBeenCalledOnce();
		expect(audio.isPlaying).toBe(true);
		expect(mockPlayingAudio.set).toHaveBeenCalledWith(mockAudio);
		dispose();
	});

	it('pauses on the second toggle and clears the shared store', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		await audio.toggle();
		await audio.toggle();

		expect(mockAudio.pause).toHaveBeenCalledOnce();
		expect(audio.isPlaying).toBe(false);
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(null);
		dispose();
	});

	it('stops another card audio already held in the shared store', async () => {
		const existing = { pause: vi.fn(), remove: vi.fn() };
		vi.mocked(mockGet).mockReturnValueOnce(existing as unknown as HTMLAudioElement);

		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		await audio.toggle();

		expect(existing.pause).toHaveBeenCalled();
		expect(existing.remove).toHaveBeenCalled();
		dispose();
	});

	it('becomes unavailable when playback rejects', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockAudio.play.mockRejectedValueOnce(new Error('NotAllowedError'));

		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		await audio.toggle();

		expect(audio.available).toBe(false);
		expect(audio.isPlaying).toBe(false);
		expect(audio.isLoading).toBe(false);
		dispose();
		consoleSpy.mockRestore();
	});

	it('becomes unavailable when the element emits an error', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		await audio.toggle();

		const errorCall = mockAudio.addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'error'
		);
		expect(errorCall).toBeDefined();
		errorCall![1]();

		expect(audio.available).toBe(false);
		expect(audio.isPlaying).toBe(false);
		dispose();
	});

	it('clears playing state when the element reports it ended', async () => {
		let audio!: ReturnType<typeof createAudioPreview>;
		const dispose = $effect.root(() => {
			audio = createAudioPreview(() => URL_A);
		});
		await audio.toggle();

		const endedCall = mockAudio.addEventListener.mock.calls.find(
			(args: unknown[]) => args[0] === 'ended'
		);
		expect(endedCall).toBeDefined();
		endedCall![1]();

		expect(audio.isPlaying).toBe(false);
		expect(mockPlayingAudio.set).toHaveBeenLastCalledWith(null);
		dispose();
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
bun run --filter=dtx-web test -- src/lib/audioPreview.test.ts
```

Expected: FAIL — the module `./audioPreview.svelte` does not exist.

- [ ] **Step 3: Implement the unit**

Create `packages/dtx-web/src/lib/audioPreview.svelte.ts`:

```ts
import { get } from 'svelte/store';
import { untrack } from 'svelte';
import store from '$lib/store';

export interface AudioPreview {
	readonly isPlaying: boolean;
	readonly isLoading: boolean;
	readonly available: boolean;
	toggle(): Promise<void>;
}

/**
 * Owns preview-audio playback for one chart card.
 *
 * `getUrl` is a getter, not a value, so a card reused for a different chart
 * resets cleanly. Must be called during component initialization: it registers
 * an effect that subscribes to the shared `playingAudio` store, which is what
 * enforces "only one card plays at a time" across the list.
 */
export const createAudioPreview = (getUrl: () => string | null): AudioPreview => {
	let isPlaying = $state(false);
	let isLoading = $state(false);
	let hasError = $state(false);
	let element: HTMLAudioElement | null = null;

	// Reset whenever the source changes.
	$effect(() => {
		getUrl();
		hasError = false;
		untrack(() => {
			if (element) {
				element.pause();
				element.currentTime = 0;
				element.src = '';
				element.load();
			}
			if (isPlaying) {
				isPlaying = false;
				store.playingAudio.set(null);
			}
		});
	});

	// Another card taking over clears the shared store; follow it.
	$effect(() =>
		store.playingAudio.subscribe((playing) => {
			if (playing === null) isPlaying = false;
		})
	);

	const toggle = async () => {
		const url = getUrl();
		if (!url) return;

		if (isPlaying) {
			element?.pause();
			isPlaying = false;
			store.playingAudio.set(null);
			return;
		}

		try {
			isLoading = true;

			const playing = get(store.playingAudio);
			if (playing) {
				playing.pause();
				playing.remove();
				store.playingAudio.set(null);
			}
			if (element) {
				element.pause();
				element.remove();
			}

			element = new Audio(url);
			await element.play();

			isPlaying = true;
			isLoading = false;
			store.playingAudio.set(element);

			element.addEventListener('ended', () => {
				store.playingAudio.set(null);
				isPlaying = false;
			});
			element.addEventListener('error', () => {
				hasError = true;
				isLoading = false;
				isPlaying = false;
				store.playingAudio.set(null);
			});
		} catch (error) {
			console.error('Error playing audio:', error);
			hasError = true;
			isLoading = false;
			isPlaying = false;
			store.playingAudio.set(null);
		}
	};

	return {
		get isPlaying() {
			return isPlaying;
		},
		get isLoading() {
			return isLoading;
		},
		get available() {
			return getUrl() !== null && !hasError;
		},
		toggle
	};
};
```

Note the two `console.log` calls from the original `ImageAudio` implementation are intentionally dropped — they were debug noise. `console.error` is kept.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
bun run --filter=dtx-web test -- src/lib/audioPreview.test.ts
bun run --filter=dtx-web check
```

Expected: PASS, and `check` clean (see the environment note in Global Constraints).

If `$effect.root` cannot be made to work here, STOP and report — do not restructure the interface unilaterally. The fallback is documented in Implementation Risks.

- [ ] **Step 5: Commit**

```bash
git add packages/dtx-web/src/lib/audioPreview.svelte.ts \
  packages/dtx-web/src/lib/audioPreview.test.ts
git commit -m "feat(web): extract card audio preview into a reactive unit"
```

---

### Task 2: Make `ImageAudio` presentational

Behaviour-preserving refactor. The overlay button still appears whenever audio is available, exactly as today. Nothing visible changes.

**Files:**

- Modify: `packages/dtx-web/src/lib/components/ImageAudio.svelte`
- Test: `packages/dtx-web/src/lib/components/ImageAudio.test.ts`
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- Test: `packages/dtx-web/src/lib/components/ChartListItem.test.ts`

**Interfaces:**

- Consumes: `AudioPreview` and `createAudioPreview` from Task 1.
- Produces: `ImageAudio` props become `{ previewUrl: string; audio: AudioPreview; preview?: Snippet }`. The `soundPreviewUrl` prop is removed.

- [ ] **Step 1: Rewrite `ImageAudio.test.ts` against the new prop**

Replace the whole file with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

vi.mock('svelte-i18n');
vi.mock('@lucide/svelte/icons');

import ImageAudio from './ImageAudio.svelte';
import type { AudioPreview } from '$lib/audioPreview.svelte';

const makeAudio = (overrides: Partial<AudioPreview> = {}): AudioPreview => ({
	isPlaying: false,
	isLoading: false,
	available: true,
	toggle: vi.fn().mockResolvedValue(undefined),
	...overrides
});

const previewUrl = 'https://cdn.example.com/preview.jpg';

describe('ImageAudio', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the preview image', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio() } });
		expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
	});

	it('renders the control when audio is available', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio() } });
		expect(
			screen.getByRole('button', { name: 'chart_actions.play_audio' })
		).toBeInTheDocument();
	});

	it('omits the control when audio is unavailable', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio({ available: false }) } });
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('labels the control as pause while playing', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio({ isPlaying: true }) } });
		expect(
			screen.getByRole('button', { name: 'chart_actions.pause_audio' })
		).toBeInTheDocument();
	});

	it('delegates clicks to the audio unit', async () => {
		const audio = makeAudio();
		render(ImageAudio, { props: { previewUrl, audio } });

		await fireEvent.click(screen.getByRole('button'));

		expect(audio.toggle).toHaveBeenCalledOnce();
	});

	it('disables the control while loading', () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio({ isLoading: true }) } });
		expect(screen.getByRole('button')).toBeDisabled();
	});

	it('shows the image error fallback when the image fails to load', async () => {
		render(ImageAudio, { props: { previewUrl, audio: makeAudio() } });
		await fireEvent.error(screen.getByRole('img', { name: 'Preview' }));
		expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: Run and verify the new tests fail**

```bash
bun run --filter=dtx-web test -- src/lib/components/ImageAudio.test.ts
```

Expected: FAIL — the component still expects `soundPreviewUrl` and has no accessible name on its button.

- [ ] **Step 3: Rewrite `ImageAudio.svelte`**

Replace the entire `<script>` block with:

```svelte
<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { Play, CirclePause, Ellipsis } from '@lucide/svelte/icons';
	import type { AudioPreview } from '$lib/audioPreview.svelte';

	interface Props {
		previewUrl: string;
		audio: AudioPreview;
		preview?: import('svelte').Snippet;
	}

	let { previewUrl, audio, preview }: Props = $props();

	let imageError = $state(false);

	// Reset imageError when previewUrl changes so new images can load
	$effect(() => {
		previewUrl;
		imageError = false;
	});

	const controlVisible = $derived(audio.available);
	const controlLabel = $derived(
		audio.isPlaying ? $_('chart_actions.pause_audio') : $_('chart_actions.play_audio')
	);
</script>
```

In the markup, change the `playButton` snippet's `<button>` opening tag to carry the label and delegate:

```svelte
	<button
		class="group absolute top-1/2 left-1/2 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 via-cyan-600 to-amber-600 p-3 shadow-xl backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:shadow-2xl hover:shadow-purple-500/25 focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-slate-900 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
		onclick={() => audio.toggle()}
		disabled={audio.isLoading}
		aria-label={controlLabel}
		title={controlLabel}
	>
```

Inside that button, replace the three-way icon branch with:

```svelte
{#if audio.isPlaying}
	<CirclePause size={20} />
{:else if audio.isLoading}
	<Ellipsis size={20} class="animate-pulse" />
{:else}
	<Play size={20} />
{/if}
```

Replace both `{#if soundPreviewUrl && !audioError}` guards with:

```svelte
			{#if controlVisible}
```

Delete from the component: `store` and `get` imports, `onMount` and `untrack` imports, `isPlaying`, `isLoading`, `audio` element state, `audioError`, `handlePlayPause`, the `soundPreviewUrl` `$effect`, and the `onMount` subscription. The only state left is `imageError`.

- [ ] **Step 4: Wire `ChartListItem.svelte` to the unit**

Add the import alongside the existing ones:

```ts
import { createAudioPreview } from '$lib/audioPreview.svelte';
```

Add after the `titleHref` derivation:

```ts
const audio = createAudioPreview(() =>
	item.id === undefined ? null : buildPreviewUrl(simfileBucketUrl, item.id, 'mp3')
);
```

Change the `ImageAudio` usage to pass the unit instead of the URL:

```svelte
				<ImageAudio
					previewUrl={buildPreviewUrl(simfileBucketUrl, item.id, 'jpg')!}
					{audio}
				/>
```

- [ ] **Step 5: Update the `ImageAudio` mock in `ChartListItem.test.ts`**

`capturedImageAudioProps` is assigned but never asserted anywhere in the file. Remove it rather than porting it. Replace lines 35–42 with:

```ts
vi.mock('$lib/components/ImageAudio.svelte', () => ({
	default: () => ({})
}));
```

- [ ] **Step 6: Verify Task 2**

```bash
bun run --filter=dtx-web test -- \
  src/lib/audioPreview.test.ts \
  src/lib/components/ImageAudio.test.ts \
  src/lib/components/ChartListItem.test.ts
bun run --filter=dtx-web check
```

Expected: PASS. No card behaviour has changed yet — the overlay still appears whenever audio is available.

- [ ] **Step 7: Commit**

```bash
git add packages/dtx-web/src/lib/components/ImageAudio.svelte \
  packages/dtx-web/src/lib/components/ImageAudio.test.ts \
  packages/dtx-web/src/lib/components/ChartListItem.svelte \
  packages/dtx-web/src/lib/components/ChartListItem.test.ts
git commit -m "refactor(web): make ImageAudio presentational"
```

---

### Task 3: Add the audio entry to the owner menu

**Files:**

- Modify: `packages/dtx-web/src/lib/i18n/locales/en.json`
- Modify: `packages/dtx-web/src/lib/i18n/locales/jp.json`
- Modify: `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- Test: `packages/dtx-web/src/lib/components/ChartListItem.test.ts`

**Interfaces:**

- Consumes: `audio` (an `AudioPreview`) from Task 2, and the `chart_actions.play_audio` / `chart_actions.pause_audio` keys added in this task.
- Produces: nothing new for later tasks beyond the two i18n keys, which Task 4 reuses.

The i18n mock (`packages/dtx-web/__mocks__/svelte-i18n.ts`) resolves every key to the key string itself, so tests assert on `'chart_actions.play_audio'`, not on `'Play audio'`.

- [ ] **Step 1: Write the failing test**

In `ChartListItem.test.ts`, inside the same `describe` block that holds `renders action menu trigger button in non-blog mode`, add:

```ts
it('offers the audio entry first in the owner menu', () => {
	render(ChartListItem, { props: renderProps });

	// PopoverStub always renders its content; no trigger click required.
	const items = screen.getAllByRole('menuitem');
	expect(items[0]).toHaveAccessibleName('chart_actions.play_audio');
});
```

`ButtonStub` must render its children with `role="menuitem"` for this to work. Read `packages/dtx-web/src/tests/stubs/ButtonStub.svelte` first. If it does not set that role, assert with `screen.getByRole('button', { name: 'chart_actions.play_audio' })` instead and drop the ordering assertion — report which form you used.

- [ ] **Step 2: Run and verify it fails**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartListItem.test.ts
```

Expected: FAIL — no audio entry exists in the menu.

- [ ] **Step 3: Add the i18n keys**

In `packages/dtx-web/src/lib/i18n/locales/en.json`, extend `chart_actions`:

```json
	"chart_actions": {
		"download": "Download",
		"downloading": "Downloading...",
		"play_audio": "Play audio",
		"pause_audio": "Pause audio"
	},
```

In `packages/dtx-web/src/lib/i18n/locales/jp.json`:

```json
	"chart_actions": {
		"download": "ダウンロード",
		"downloading": "ダウンロード中...",
		"play_audio": "音声を再生",
		"pause_audio": "音声を一時停止"
	},
```

- [ ] **Step 4: Add the shared label derivation and the owner menu entry**

In `ChartListItem.svelte`, add after the `audio` creation:

```ts
const audioLabel = $derived(
	audio.isPlaying ? $_('chart_actions.pause_audio') : $_('chart_actions.play_audio')
);
```

Inside the owner `{#snippet content()}`'s `<div class="py-2">`, insert this as the **first** child, above the `{#if hasUploadedChart}` block:

```svelte
{#if audio.available}
	<Button
		onclick={() => audio.toggle()}
		variant="menuItem"
		fullWidth
		justify="start"
		class="text-slate-300 hover:bg-purple-600/20 hover:text-purple-200"
	>
		{#snippet children()}
			<svg class="mr-3 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d={audio.isPlaying
						? 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z'
						: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}
				></path>
			</svg>
			{audioLabel}
		{/snippet}
	</Button>
{/if}
```

- [ ] **Step 5: Verify Task 3**

```bash
bun run --filter=dtx-web test -- src/lib/components/ChartListItem.test.ts
bun run --filter=dtx-web check
```

Expected: PASS. Owner cards now offer audio from the menu; the overlay is still visible when idle, so nothing is lost.

- [ ] **Step 6: Commit**

```bash
git add packages/dtx-web/src/lib/i18n/locales/en.json \
  packages/dtx-web/src/lib/i18n/locales/jp.json \
  packages/dtx-web/src/lib/components/ChartListItem.svelte \
  packages/dtx-web/src/lib/components/ChartListItem.test.ts
git commit -m "feat(web): add audio entry to the owner chart menu"
```

---

### Task 4: Give blog cards a menu and clean the cover

This is the atomic user-visible change: blog cards gain the `[⋮]`, the footer CTA is removed, and the overlay stops showing when idle — all in one commit, so no state exists where blog users cannot reach audio.

**Files:**

- Modify: `packages/dtx-web/src/lib/components/ChartListItem.svelte`
- Modify: `packages/dtx-web/src/lib/components/ImageAudio.svelte`
- Test: `packages/dtx-web/src/lib/components/ChartListItem.test.ts`
- Test: `packages/dtx-web/src/lib/components/ImageAudio.test.ts`

**Interfaces:**

- Consumes: `audio`, `audioLabel`, `previewable` from Tasks 2–3; `isPreviewable` from `$lib/components/ChartList.helpers`, already imported.
- Produces: final card behaviour. Nothing downstream.

- [ ] **Step 1: Invert the two contradicting tests and add coverage**

In `ChartListItem.test.ts`:

Replace the existing test at roughly line 260:

```ts
it('does not render action menu in blog mode', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true } });
	expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
});
```

with:

```ts
it('renders the action menu in blog mode when entries apply', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true } });
	expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
});
```

Replace the existing CTA test:

```ts
		it('shows an explicit blog Preview CTA for a previewable card', () => {
```

with a menu-entry assertion, and replace its `omits the blog Preview CTA` sibling. The full replacement pair:

```ts
it('offers Preview from the blog menu for a previewable card', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true } });
	expect(screen.getByRole('menuitem', { name: 'preview.open' })).toHaveAttribute(
		'href',
		'/preview/1'
	);
});

it('omits the Preview entry for a non-previewable blog card', () => {
	render(ChartListItem, {
		props: {
			...renderProps,
			isBlog: true,
			item: { ...mockItem, is_published: false }
		}
	});
	expect(screen.queryByRole('menuitem', { name: 'preview.open' })).not.toBeInTheDocument();
});

it('no longer renders a Preview call-to-action in the blog footer', () => {
	render(ChartListItem, { props: { ...renderProps, isBlog: true } });
	expect(screen.queryByRole('link', { name: 'preview.open' })).not.toBeInTheDocument();
});
```

Add one test for the empty-menu rule. `buildPreviewUrl` is mocked to always return a truthy string, so `audio.available` is true for any item with an `id`; suppressing the menu therefore requires an item with no `id`:

```ts
it('renders no action menu on a blog card with no id', () => {
	render(ChartListItem, {
		props: {
			...renderProps,
			isBlog: true,
			item: { ...mockItem, id: undefined }
		}
	});
	expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
});
```

In `ImageAudio.test.ts`, replace the `renders the control when audio is available` test with the new visibility rule, and add the loading case:

```ts
it('omits the control when idle', () => {
	render(ImageAudio, { props: { previewUrl, audio: makeAudio() } });
	expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('renders the control while playing', () => {
	render(ImageAudio, { props: { previewUrl, audio: makeAudio({ isPlaying: true }) } });
	expect(screen.getByRole('button', { name: 'chart_actions.pause_audio' })).toBeInTheDocument();
});

it('renders the control while loading', () => {
	render(ImageAudio, { props: { previewUrl, audio: makeAudio({ isLoading: true }) } });
	expect(screen.getByRole('button')).toBeInTheDocument();
});
```

The existing `delegates clicks to the audio unit` and `labels the control as pause while playing` tests must now build their audio with `{ isPlaying: true }` so the control is rendered at all. Update them accordingly.

- [ ] **Step 2: Run and verify the failures**

```bash
bun run --filter=dtx-web test -- \
  src/lib/components/ChartListItem.test.ts \
  src/lib/components/ImageAudio.test.ts
```

Expected: FAIL on the blog menu, the removed CTA, and the idle-overlay rule.

- [ ] **Step 3: Flip the overlay visibility rule**

In `ImageAudio.svelte`, change the single derivation:

```ts
const controlVisible = $derived(audio.isPlaying || audio.isLoading);
```

`audio.available` is no longer consulted here: an unavailable unit can never be playing or loading, so the condition is already implied.

- [ ] **Step 4: Add the blog menu**

In `ChartListItem.svelte`, add a derivation next to the others:

```ts
const blogMenuVisible = $derived(isBlog && (audio.available || previewable));
```

This step is **five one-line guard edits plus one guard on the Popover**. Do not retype any entry's body — every `<Button>` and `<a>` inside the menu keeps its current markup character-for-character. Only the `{#if ...}` lines change.

Make exactly these replacements in `ChartListItem.svelte`:

| #   | Find this line                                                                                | Replace with                                                                |
| --- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `{#if !isBlog}` (the Popover guard in the card header)                                        | `{#if !isBlog \|\| blogMenuVisible}`                                        |
| 2   | `{#if hasUploadedChart}` (guards _Open in Editor_)                                            | `{#if !isBlog && hasUploadedChart}`                                         |
| 3   | `{#if item.id !== undefined}` immediately above the `/app/chart/` anchor (_Edit details_)     | `{#if !isBlog && item.id !== undefined}`                                    |
| 4   | `{#if item.id !== undefined && item.is_published !== undefined}` (guards _Publish/Unpublish_) | `{#if !isBlog && item.id !== undefined && item.is_published !== undefined}` |
| 5   | `{#if item.id !== undefined}` immediately above the _Delete_ `<Button>`                       | `{#if !isBlog && item.id !== undefined}`                                    |

Edits 3 and 5 target textually identical lines, so match on the block that follows each one rather than on the guard alone.

Two guards are deliberately **not** changed:

- The audio entry's `{#if audio.available}` (added in Task 3) — it applies to both card types, which is what puts Play/Pause on blog cards.
- The Preview entry's `{#if previewable}` — likewise shared, which is what puts Open in Preview on blog cards.

Those two unchanged guards are the entire mechanism by which the blog menu gets its two entries and no others.

- [ ] **Step 5: Remove the footer Preview CTA**

In the blog footer block, delete only this:

```svelte
{#if previewable}
	<a
		href={`/preview/${item.id}`}
		class="music-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"
	>
		{$_('preview.open')}
	</a>
{/if}
```

Keep the surrounding `<div class="mt-4 flex flex-wrap items-center gap-3">` wrapper and the entire download branch untouched.

- [ ] **Step 6: Verify Task 4**

```bash
bun run --filter=dtx-web test
bun run --filter=dtx-web check
```

Expected: PASS across the whole web suite.

- [ ] **Step 7: Confirm the e2e suite is unaffected**

`packages/e2e-web/blog.spec.ts` asserts the card **title** link resolves to `/preview/[id]`, which this plan does not touch.

```bash
bun run --filter=dtx-e2e-web e2e -- blog.spec.ts
```

Expected: PASS. If it fails, report it — do not weaken the spec.

- [ ] **Step 8: Inspect final scope**

```bash
git diff main...HEAD -- packages/dtx-web/src/lib packages/e2e-web
```

Confirm no changes to `ChartListTableItem.svelte`, `ChartListTableItem.test.ts`, `ChartList.helpers.ts`, download logic, or anything under GraphQL/API/auth/desktop/Phaser.

- [ ] **Step 9: Commit**

```bash
git add packages/dtx-web/src/lib/components/ChartListItem.svelte \
  packages/dtx-web/src/lib/components/ChartListItem.test.ts \
  packages/dtx-web/src/lib/components/ImageAudio.svelte \
  packages/dtx-web/src/lib/components/ImageAudio.test.ts
git commit -m "feat(web): move card audio and preview into the action menu"
```

---

## Final Acceptance Checklist

- [ ] `createAudioPreview` is the only owner of preview-audio state; `ImageAudio` holds no audio state beyond `imageError`.
- [ ] Starting one card's audio still stops any other card's audio.
- [ ] A changed preview URL still stops playback and clears the error state.
- [ ] The cover overlay appears only while playing or loading, on both card types.
- [ ] The overlay button has an accessible name that flips with playback state.
- [ ] Blog cards render a `[⋮]` containing Play/Pause audio and Open in Preview, and nothing else.
- [ ] Blog cards with no `id` render no `[⋮]` at all.
- [ ] Owner cards lead with Play/Pause audio and retain Open in Editor, Open in Preview, Edit details, Publish/Unpublish and Delete unchanged.
- [ ] The blog footer no longer contains a Preview call-to-action; the download control is unchanged.
- [ ] `chart_actions.play_audio` and `chart_actions.pause_audio` exist in both `en.json` and `jp.json`.
- [ ] `ChartListTableItem.svelte` and its tests are untouched.
- [ ] `bun run --filter=dtx-web test` and `check` pass; `blog.spec.ts` still passes.
