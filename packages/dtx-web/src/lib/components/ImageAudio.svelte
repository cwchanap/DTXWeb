<script lang="ts">
	import store from '../store';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';

	import { Play, CirclePause, Ellipsis } from '@lucide/svelte/icons';
	import { Button } from '@dtx/ui-components/components';

	interface Props {
		previewUrl: string;
		soundPreviewUrl: string | null;
		preview?: import('svelte').Snippet;
	}

	let { previewUrl, soundPreviewUrl, preview }: Props = $props();

	let isPlaying = $state(false);
	let isLoading = $state(false);
	let audio: HTMLAudioElement | null = $state(null);

	// Use onMount to properly handle store subscription
	onMount(() => {
		const unsubscribe = store.playingAudio.subscribe((playingAudio) => {
			if (playingAudio === null) {
				isPlaying = false;
			}
		});

		return unsubscribe;
	});
</script>

<div class="relative">
	<!-- Add a comment or space to prevent empty text expression -->
	{#if preview}
		{@render preview()}
		{#if soundPreviewUrl}
			<button
				class="absolute top-1/2 left-1/2 inline-flex h-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded rounded-full bg-white p-2 px-4 shadow-lg transition-colors hover:shadow-xl focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
				onclick={async () => {
					if (isPlaying) {
						audio?.pause();
						isPlaying = false;
						store.playingAudio.set(null);
					} else {
						try {
							isLoading = true;
							console.log('Playing audio from URL:', soundPreviewUrl);
							const playingAudio = get(store.playingAudio);
							if (playingAudio) {
								playingAudio.pause();
								playingAudio.remove();
								store.playingAudio.set(null);
							}
							if (audio) {
								audio.pause();
								audio.remove();
							}
							audio = new Audio(soundPreviewUrl);
							console.log('Audio element created:', audio);
							await audio.play();
							console.log('Audio started playing');
							isPlaying = true;
							isLoading = false;
							store.playingAudio.set(audio);
							audio.addEventListener('ended', () => {
								store.playingAudio.set(null);
								isPlaying = false;
							});
						} catch (error) {
							console.error('Error playing audio:', error);
							isLoading = false;
						}
					}
				}}
				disabled={isLoading}
			>
				{#if isPlaying}
					<CirclePause />
				{:else if isLoading}
					<Ellipsis />
				{:else}
					<Play />
				{/if}
			</button>
		{/if}
	{:else}
		<div class="relative mb-4">
			<img src={previewUrl} alt="Preview" class="h-60 w-full rounded-lg object-cover" />
			{#if soundPreviewUrl}
				<button
					class="absolute top-1/2 left-1/2 inline-flex h-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded rounded-full bg-white p-2 px-4 shadow-lg transition-colors hover:shadow-xl focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
					onclick={async () => {
						if (isPlaying) {
							audio?.pause();
							isPlaying = false;
							store.playingAudio.set(null);
						} else {
							try {
								isLoading = true;
								console.log('Playing audio from URL:', soundPreviewUrl);
								const playingAudio = get(store.playingAudio);
								if (playingAudio) {
									playingAudio.pause();
									playingAudio.remove();
									store.playingAudio.set(null);
								}
								if (audio) {
									audio.pause();
									audio.remove();
								}
								audio = new Audio(soundPreviewUrl);
								console.log('Audio element created:', audio);
								await audio.play();
								console.log('Audio started playing');
								isPlaying = true;
								isLoading = false;
								store.playingAudio.set(audio);
								audio.addEventListener('ended', () => {
									store.playingAudio.set(null);
									isPlaying = false;
								});
							} catch (error) {
								console.error('Error playing audio:', error);
								isLoading = false;
							}
						}
					}}
					disabled={isLoading}
				>
					{#if isPlaying}
						<CirclePause />
					{:else if isLoading}
						<Ellipsis />
					{:else}
						<Play />
					{/if}
				</button>
			{/if}
		</div>
	{/if}
</div>
