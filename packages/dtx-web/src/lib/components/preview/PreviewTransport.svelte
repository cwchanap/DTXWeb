<script lang="ts">
	import { _ } from 'svelte-i18n';

	interface Props {
		playing: boolean;
		audioReady: boolean;
		onToggle: () => void;
		currentTime?: number;
		duration?: number;
	}
	let { playing, audioReady, onToggle, currentTime = 0, duration = 0 }: Props = $props();

	const formatTime = (seconds: number): string => {
		const total = Math.max(0, Math.floor(seconds));
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	};
</script>

<div class="flex items-center gap-3">
	<button
		class="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
		disabled={!audioReady}
		onclick={onToggle}
		aria-label={playing ? $_('preview.pause') : $_('preview.play')}
	>
		{#if !audioReady}
			{$_('preview.audio_loading')}
		{:else if playing}
			{$_('preview.pause')}
		{:else}
			{$_('preview.play')}
		{/if}
	</button>
	<span class="text-sm tabular-nums opacity-70" data-testid="transport-time">
		{formatTime(currentTime)} / {formatTime(duration)}
	</span>
</div>
