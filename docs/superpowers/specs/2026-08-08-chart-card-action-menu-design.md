# Chart Card Action Menu Design

Status: approved
Date: 2026-08-08
Supersedes: the blog-card `Open in Preview` call-to-action introduced by the HPA-537 plan
(`docs/superpowers/plans/2026-08-07-hpa-537-preview-notation-navigation.md`, Task 4)

## Overview

Chart cards currently expose their two "consume this chart" affordances in two unrelated
places: the audio preview is a circular play button floating over the cover image, and the
notation preview is a text button in the card footer, next to Download.

This design consolidates both into the card's top-right kebab menu (`[⋮]`), which owner
cards already have and public blog cards currently lack. The cover image becomes clean in
its idle state; the play button reappears over the cover only while audio is loading or
playing, so pausing never requires reopening the menu.

## Goals

- Move the audio preview and the notation preview into the card's top-right `[⋮]` menu.
- Give public blog cards the same top-right menu that owner cards already have.
- Remove the footer `Open in Preview` call-to-action from the blog card.
- Keep the cover image free of overlay controls when nothing is playing.
- Keep pausing reachable in one click while audio plays.
- Preserve today's playback behaviour exactly, including the global rule that only one card
  plays at a time.

## Non-goals

- No change to the compact table row (`ChartListTableItem.svelte`). Its `Eye` preview icon
  and download control stay as they are; a dense row is better served by direct icons than
  by a menu.
- No change to download eligibility, download URLs, or download semantics.
- No change to the `/preview/[id]` page, the editor, or any navigation destination.
- No change to the owner menu's existing entries (`Open in Editor`, `Edit details`,
  `Publish`/`Unpublish`, `Delete`), including their hardcoded English labels. Localizing
  those pre-existing strings is a separate concern.
- No database, GraphQL, API, auth, codegen, desktop/Tauri, or Phaser changes.

## Current State

### Audio preview

`packages/dtx-web/src/lib/components/ImageAudio.svelte` owns all audio state internally:
`isPlaying`, `isLoading`, `audioError`, and the `HTMLAudioElement`. It renders the cover
image and, whenever `soundPreviewUrl` is non-null and no error has occurred, a circular
play/pause button centred over the image. It coordinates with other cards through the
`store.playingAudio` store so starting one preview stops any other. An `$effect` resets
state when `soundPreviewUrl` changes, and an `onMount` subscription clears `isPlaying`
when another card takes over.

`ImageAudio` has exactly one consumer, `ChartListItem.svelte`, which renders it for both
owner and blog cards with no `isBlog` distinction. It has a dedicated test file,
`ImageAudio.test.ts`, with 12 tests written against its internal state.

The overlay button is icon-only and currently carries no accessible name.

### Card menus

`ChartListItem.svelte` renders a top-right `Popover` with an `EllipsisVertical` trigger,
but only when `!isBlog`. That owner menu contains `Open in Editor`, `Open in Preview`,
`Edit details`, `Publish`/`Unpublish`, and `Delete`.

Public blog cards have no top-right menu. Their footer holds an `Open in Preview` link
(i18n key `preview.open`) followed by the download control.

## Design Decisions

- Audio state moves out of `ImageAudio` into a standalone reactive unit, because two
  separate surfaces (the menu item and the cover overlay) now need to read and drive it.
- The cover overlay is shown while `isPlaying || isLoading`, not only while playing, so a
  menu click produces immediate visible feedback rather than a dead interval.
- The blog menu is rendered only when it would contain at least one item; empty menus are
  never shown.
- Selecting a menu item closes the menu, consistent with the existing `handleOpenModal`
  behaviour. The cover overlay is what makes closing acceptable for playback.
- The blog menu reuses the owner Popover's placement and styling so the two card types
  behave identically.
- New action labels are localized under `chart_actions`, which already holds card action
  strings. The existing `preview.open` key is reused unchanged.

## Audio Preview Unit

### Module

`packages/dtx-web/src/lib/audioPreview.svelte.ts`

### Interface

```ts
export interface AudioPreview {
	readonly isPlaying: boolean;
	readonly isLoading: boolean;
	readonly available: boolean;
	toggle(): Promise<void>;
}

export const createAudioPreview: (getUrl: () => string | null) => AudioPreview;
```

`getUrl` is a getter rather than a plain value so the unit reacts to a changing preview
URL, matching today's `$effect` on `soundPreviewUrl`.

`available` is true when a preview URL exists and no load or playback error has occurred.
It folds together the two conditions that hide the control today, so callers have a single
flag to test.

`createAudioPreview` must be called during component initialization, because it registers
the `store.playingAudio` subscription. If standalone testing of the rune state proves
awkward under the repository's Vitest setup, the fallback is to add an explicit `dispose()`
to the interface and have `ChartListItem` own the lifecycle; the rest of the interface and
all behaviour stay the same.

### Behaviour

The unit absorbs the current logic without behavioural change:

- `toggle()` pauses if playing; otherwise stops any other card's audio via
  `store.playingAudio`, constructs a new `Audio`, plays it, and registers `ended` and
  `error` listeners.
- A rejected `play()` or an `error` event sets the error state, which makes `available`
  false, which hides both the overlay and the menu item.
- A change to the URL returned by `getUrl` stops playback and clears the error state.
- The `store.playingAudio` subscription clears `isPlaying` when another card takes over.

Browser autoplay policy is unaffected: a menu-item click is a user gesture exactly as the
overlay click was.

## Component Changes

### `ImageAudio.svelte`

Becomes presentational. Its props change from:

```ts
{ previewUrl: string; soundPreviewUrl: string | null; preview?: Snippet }
```

to:

```ts
{ previewUrl: string; audio: AudioPreview; preview?: Snippet }
```

It renders the cover image (with the existing `imageError` fallback) and renders the
circular overlay button only when `audio.isPlaying || audio.isLoading`. The button calls
`audio.toggle()` and gains an accessible name that tracks state (see Localization). Its
existing icon behaviour is preserved: pause glyph while playing, loading glyph while
loading.

All audio state, the `HTMLAudioElement`, the `store.playingAudio` subscription, and the
URL-change effect are removed from this component.

### `ChartListItem.svelte`

Creates one preview per card during initialization:

```ts
const audio = createAudioPreview(() =>
	item.id === undefined ? null : buildPreviewUrl(simfileBucketUrl, item.id, 'mp3')
);
```

and passes it to `ImageAudio`.

**Owner card (`!isBlog`).** The existing Popover gains a Play/Pause audio entry as its
first item, rendered only when `audio.available`. All existing entries are unchanged in
label, order, and destination.

**Blog card (`isBlog`).** A new Popover is added in the same header position, with the same
`EllipsisVertical` trigger, `triggerAriaLabel="Actions"`, `bottom-start` placement,
`zIndex="120"`, and content styling as the owner one. It contains:

1. Play/Pause audio, when `audio.available`
2. Open in Preview (`preview.open`), an `<a href="/preview/{id}" role="menuitem">`, when
   `isPreviewable(item)`

The Popover is rendered only when at least one of those conditions holds.

The footer `Open in Preview` call-to-action is removed. The download control and the
`flex flex-wrap items-center gap-3` footer wrapper that was added alongside it stay, since
the wrapper still governs the download control's layout.

### Menu matrix

| Entry               | Blog card                  | Owner card                         |
| ------------------- | -------------------------- | ---------------------------------- |
| Play / Pause audio  | when `audio.available`     | when `audio.available`, first item |
| Open in Preview     | when `isPreviewable(item)` | unchanged                          |
| Open in Editor      | never                      | unchanged                          |
| Edit details        | never                      | unchanged                          |
| Publish / Unpublish | never                      | unchanged                          |
| Delete              | never                      | unchanged                          |

## Localization

Two keys are added to `chart_actions` in both
`packages/dtx-web/src/lib/i18n/locales/en.json` and `jp.json`:

| Key                         | en            | jp               |
| --------------------------- | ------------- | ---------------- |
| `chart_actions.play_audio`  | `Play audio`  | `音声を再生`     |
| `chart_actions.pause_audio` | `Pause audio` | `音声を一時停止` |

The Japanese strings follow the existing `preview` section's vocabulary: `音声` for audio
(as in `preview.audio_loading`) and `一時停止` for pause (as in `preview.pause`).

`preview.open` is reused unchanged for the Preview entry.

Both the menu entry and the cover overlay's accessible name resolve the same way:
`chart_actions.pause_audio` when `audio.isPlaying`, otherwise `chart_actions.play_audio`.

## Edge Cases

- **Blog card with no audio and not previewable**, including `item.id === undefined`: no
  `[⋮]` is rendered.
- **Owner card with no audio**: the menu renders without the audio entry; its other entries
  guarantee it is never empty.
- **Audio errors mid-playback**: `available` becomes false, so the overlay and the menu
  entry both disappear. This matches today's behaviour of hiding the button on error.
- **Another card starts playing**: this card's `isPlaying` becomes false through the store
  subscription and the overlay disappears without user action.
- **Preview URL changes** while a card is reused for a different chart: playback stops and
  error state clears.

## Testing

- **`audioPreview.svelte.ts`** gains direct unit tests: play/pause toggling, a second
  instance stopping the first through `store.playingAudio`, URL change resetting state, and
  the error path flipping `available` to false. This logic is reachable only through
  component rendering today, so this is new coverage.
- **`ImageAudio.test.ts`** is reworked from internal-state assertions to presentational
  ones: overlay absent when idle, present when playing, present when loading, and clicking
  it delegates to `toggle()`.
- **`ChartListItem.test.ts`** covers the blog menu containing both entries for a previewable
  card with audio, the blog menu being absent when neither entry applies, and the owner menu
  leading with the audio entry while retaining its existing entries. The Task 4 assertion for
  the footer `Open in Preview` call-to-action is updated, since that call-to-action is
  removed.
- **e2e** requires no change. `packages/e2e-web/blog.spec.ts` asserts the card _title_ link
  resolves to `/preview/[id]`, which this design does not touch. The suite is re-run to
  confirm.

Tests must not click the Popover trigger before asserting menu contents: the repository's
`PopoverStub.svelte` always renders its content snippet.

## Risks

- **Rune context.** `createAudioPreview` uses runes in a `.svelte.ts` module and must be
  called during component initialization. Standalone tests need `$effect.root`. The
  documented fallback is an explicit `dispose()` owned by `ChartListItem`.
- **Discoverability.** Audio preview moves from a large always-visible button to a menu
  entry, which is a deliberate reduction in prominence. This is the accepted cost of a clean
  cover image.
- **Test rework.** `ImageAudio.test.ts`'s 12 tests are written against internal state and
  will not survive the split unchanged; they are rewritten rather than deleted.
