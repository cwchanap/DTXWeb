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

/** Resolves the i18n key for the audio toggle control, shared by every surface that renders it. */
export const audioToggleLabelKey = (audio: AudioPreview): string =>
	audio.isPlaying ? 'chart_actions.pause_audio' : 'chart_actions.play_audio';
