import { get } from 'svelte/store';
import { untrack } from 'svelte';
import store from '$lib/store';

export interface AudioPreview {
	readonly isPlaying: boolean;
	readonly isLoading: boolean;
	readonly available: boolean;
	toggle(): Promise<void>;
}

// Monotonic counter shared across every audio-preview unit. Each play request
// captures the current value before awaiting `play()`; after the await, if a
// newer request has incremented it, the stale request abandons its element so
// the latest user selection always wins — even when an older click's slower
// `play()` resolves after a newer click's faster one.
let playbackRequestToken = 0;

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

	// Another card taking over clears the shared store; follow it. A
	// successful takeover sets the store to the new element (not null), so
	// treat any value that is not this unit's own element as loss of
	// ownership — otherwise a stale Pause button here would clear the real
	// owner's state.
	$effect(() =>
		store.playingAudio.subscribe((playing) => {
			if (playing !== element) isPlaying = false;
		})
	);

	const toggle = async (): Promise<void> => {
		if (isLoading) return;

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

			// Stop this unit's previous element before constructing a fresh one.
			if (element) {
				element.pause();
				element.remove();
			}

			// Stamp this request so a stale (older) `play()` that resolves after
			// a newer click can be detected and discarded below.
			const requestToken = ++playbackRequestToken;

			const created = new Audio(url);
			await created.play();

			// A newer toggle incremented the token while this `play()` was
			// pending. Abandon this element — the newer request is the one the
			// user actually wants to own the store — and leave the current owner
			// untouched.
			if (requestToken !== playbackRequestToken) {
				created.pause();
				created.remove();
				isLoading = false;
				return;
			}

			// After the async play() resolves, another card may have claimed the
			// shared store during the await. Stop whatever is now active (unless
			// it is already our new element) so the latest playback owns the
			// store exclusively, then claim it for `created`.
			const activeNow = get(store.playingAudio);
			if (activeNow && activeNow !== created) {
				activeNow.pause();
				activeNow.remove();
			}

			element = created;
			isPlaying = true;
			isLoading = false;
			store.playingAudio.set(created);

			// Capture `created` so a stale ended/error completion from a
			// superseded element cannot clear a newer card's playback: only
			// touch the store / isPlaying when this element still owns them.
			created.addEventListener('ended', () => {
				if (element === created) isPlaying = false;
				if (get(store.playingAudio) === created) store.playingAudio.set(null);
			});
			created.addEventListener('error', () => {
				// A stale error from a superseded element must not flip this card's
				// hasError/isLoading — that would make `available` false and remove
				// the Pause control while the newer element is still playing. Guard
				// first, then mutate state only for the current element.
				if (element !== created) return;
				hasError = true;
				isLoading = false;
				isPlaying = false;
				if (get(store.playingAudio) === created) store.playingAudio.set(null);
			});
		} catch (error) {
			console.error('Error playing audio:', error);
			hasError = true;
			isLoading = false;
			isPlaying = false;
			// A rejected play() never claimed the shared store, so do not clear
			// it here — doing so would wipe another card's ownership while its
			// audio keeps playing.
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

/** Resolves the i18n key for the audio toggle control, shared by every surface that renders it. */
export const audioToggleLabelKey = (audio: AudioPreview): string =>
	audio.isPlaying ? 'chart_actions.pause_audio' : 'chart_actions.play_audio';
