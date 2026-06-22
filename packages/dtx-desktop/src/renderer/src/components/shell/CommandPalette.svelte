<script lang="ts">
	// Placeholder command palette. The full implementation lands in a later task (T18).
	interface Props {
		open: boolean;
		onClose: () => void;
	}
	let { open, onClose }: Props = $props();
</script>

{#if open}
	<div
		class="bg-base/70 fixed inset-0 z-50 backdrop-blur-sm"
		role="button"
		tabindex="0"
		aria-label="Close command palette"
		onclick={onClose}
		onkeydown={(event) => {
			if (event.key === 'Escape' || event.key === 'Enter') onClose();
		}}
	></div>
{/if}
