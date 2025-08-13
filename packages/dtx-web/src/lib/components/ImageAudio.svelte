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
	{:else}
		<img src={previewUrl} alt="Preview" class="mb-4 h-60 w-full rounded-lg object-cover" />
	{/if}
	{#if soundPreviewUrl}
		<Button
			variant="floating"
			position="absolute"
			centered
			padding="2"
			on:click={async () => {
				if (isPlaying) {
					audio?.pause();
					isPlaying = false;
					store.playingAudio.set(null);
				} else {
					isLoading = true;
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
					await audio.play();
					isPlaying = true;
					isLoading = false;
					store.playingAudio.set(audio);
					audio.addEventListener('ended', () => {
						store.playingAudio.set(null);
						isPlaying = false;
					});
				}
			}}
			disabled={isLoading}
		>
			{#snippet children()}
				{#if isPlaying}
					<CirclePause />
				{:else if isLoading}
					<Ellipsis />
				{:else}
					<Play />
				{/if}
			{/snippet}
		</Button>
	{/if}
</div>
