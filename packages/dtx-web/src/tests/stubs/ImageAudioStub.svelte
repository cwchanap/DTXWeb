<script lang="ts">
	let {
		previewUrl,
		audio
	}: {
		previewUrl: string;
		audio: {
			available: boolean;
			toggle: () => void;
			isPlaying: boolean;
			isLoading: boolean;
		};
		[key: string]: unknown;
	} = $props();
</script>

{#if previewUrl}
	<img data-testid="image-cover" src={previewUrl} alt="Preview" />
{/if}
{#if audio?.available}
	<button
		type="button"
		class="audio-toggle"
		aria-label={audio.isPlaying ? 'chart_actions.pause_audio' : 'chart_actions.play_audio'}
		onclick={() => audio.toggle()}
	></button>
{/if}
