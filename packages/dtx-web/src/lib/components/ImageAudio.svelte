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

	const handlePlayPause = async () => {
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
				audio = new Audio(soundPreviewUrl!);
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
	};

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

{#snippet playButton()}
	<button
		class="group absolute top-1/2 left-1/2 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 via-cyan-600 to-amber-600 p-3 shadow-xl backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:shadow-2xl hover:shadow-purple-500/25 focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-slate-900 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
		onclick={handlePlayPause}
		disabled={isLoading}
	>
		<div
			class="relative z-10 text-white drop-shadow-sm transition-transform duration-200 group-hover:scale-110"
		>
			{#if isPlaying}
				<CirclePause size={20} />
			{:else if isLoading}
				<Ellipsis size={20} class="animate-pulse" />
			{:else}
				<Play size={20} />
			{/if}
		</div>
		<!-- Animated background overlay -->
		<div
			class="absolute inset-0 rounded-full bg-gradient-to-br from-purple-400/30 to-cyan-400/30 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
		></div>
	</button>
{/snippet}

<div class="relative">
	{#if preview}
		{@render preview()}
		{#if soundPreviewUrl}
			{@render playButton()}
		{/if}
	{:else}
		<div class="relative mb-4">
			<img src={previewUrl} alt="Preview" class="h-60 w-full rounded-lg object-cover" />
			{#if soundPreviewUrl}
				{@render playButton()}
			{/if}
		</div>
	{/if}
</div>
