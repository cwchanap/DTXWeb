<script lang="ts">
	import { PlaySolid, PauseSolid } from 'flowbite-svelte-icons';
	import store from '../store';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';

	export let previewUrl: string;
	export let soundPreviewUrl: string | null;
	let isPlaying = false;

	let audio: HTMLAudioElement | null = null;

	store.playingAudio.subscribe((audio) => {
		if (audio === null) {
			isPlaying = false;
		}
	});

	onMount(() => {
		if (soundPreviewUrl) {
			audio = new Audio(soundPreviewUrl);
		}
	});
</script>

<div class="relative">
	<slot name="preview">
		<img src={previewUrl} alt="Preview" class="mb-4 h-60 w-full rounded-lg object-cover" />
	</slot>
	{#if soundPreviewUrl}
		<button
			class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transform rounded-full bg-white p-2 shadow-lg"
			on:click={() => {
				if (isPlaying) {
					audio?.pause();
					isPlaying = false;
					store.playingAudio.set(null);
				} else {
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
					audio.play();
					isPlaying = true;
					store.playingAudio.set(audio);
					audio.addEventListener('ended', () => {
						store.playingAudio.set(null);
						isPlaying = false;
					});
				}
			}}
		>
			{#if isPlaying}
				<PauseSolid size="xl" />
			{:else}
				<PlaySolid size="xl" />
			{/if}
		</button>
	{/if}
</div>
