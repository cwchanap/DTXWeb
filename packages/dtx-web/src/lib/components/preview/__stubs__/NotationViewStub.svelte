<script lang="ts">
	interface Props {
		onSeek?: (pos: { measure: number; fraction: number }) => void;
	}
	let { onSeek }: Props = $props();
</script>

<div data-testid="notation-stub"></div>
{#if onSeek}
	<button data-testid="stub-seek" onclick={() => onSeek({ measure: 0, fraction: 0.5 })}
		>seek</button
	>
{/if}
