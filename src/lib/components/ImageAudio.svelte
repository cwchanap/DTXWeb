<script lang="ts">
	import { PlaySolid, PauseSolid, DotsHorizontalOutline } from 'flowbite-svelte-icons';
	import store from '../store';
	import { get } from 'svelte/store';

	interface Props {
		previewUrl: string;
		soundPreviewUrl: string | null;
		preview?: import('svelte').Snippet;
	}

	let { previewUrl, soundPreviewUrl, preview }: Props = $props();
	let isPlaying = $state(false);
	let isLoading = $state(false);

	let audio: HTMLAudioElement | null = $state(null);

	store.playingAudio.subscribe((audio) => {
		if (audio === null) {
			isPlaying = false;
		}
	});
</script>

<div class="relative">
	{#if preview}{@render preview()}{:else}
		<img src={previewUrl} alt="Preview" class="mb-4 h-60 w-full rounded-lg object-cover" />
	{/if}
	{#if soundPreviewUrl}
		<button
			class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform rounded-full bg-white p-2 shadow-lg"
			onclick={async () => {
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
			{#if isPlaying}
				<PauseSolid size="xl" />
			{:else if isLoading}
				<DotsHorizontalOutline size="xl" />
			{:else}
				<PlaySolid size="xl" />
			{/if}
		</button>
	{/if}
</div>
