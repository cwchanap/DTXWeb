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

{#snippet playButton()}
	<button
		class="group absolute top-1/2 left-1/2 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 via-cyan-600 to-amber-600 p-3 shadow-xl backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:shadow-2xl hover:shadow-purple-500/25 focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-slate-900 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
		onclick={() => audio.toggle()}
		disabled={audio.isLoading}
		aria-label={controlLabel}
		title={controlLabel}
	>
		<div
			class="relative z-10 text-white drop-shadow-sm transition-transform duration-200 group-hover:scale-110"
		>
			{#if audio.isPlaying}
				<CirclePause size={20} />
			{:else if audio.isLoading}
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
		{#if controlVisible}
			{@render playButton()}
		{/if}
	{:else}
		<div class="relative mb-4">
			{#if imageError}
				<div
					class="flex h-60 w-full items-center justify-center rounded-lg border border-purple-500/20 bg-gradient-to-br from-slate-800 to-slate-700"
				>
					<div class="text-center">
						<svg
							class="mx-auto mb-2 h-12 w-12 text-slate-500"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
							></path>
						</svg>
						<span class="text-sm text-slate-500">Preview unavailable</span>
					</div>
				</div>
			{:else}
				<img
					src={previewUrl}
					alt="Preview"
					class="h-60 w-full rounded-lg object-cover"
					onerror={() => (imageError = true)}
				/>
			{/if}
			{#if controlVisible}
				{@render playButton()}
			{/if}
		</div>
	{/if}
</div>
