<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = {
		open?: boolean;
		title?: string;
		children?: Snippet;
		onConfirm?: () => void;
		confirmText?: string;
		confirmVariant?: string;
	};
	let {
		open = $bindable(false),
		title = '',
		children,
		onConfirm,
		confirmText = 'Confirm'
	}: Props = $props();

	function handleConfirm() {
		onConfirm?.();
		open = false;
	}
</script>

{#if open}
	<div role="dialog" aria-label={title}>
		{@render children?.()}
		<button onclick={handleConfirm}>{confirmText}</button>
		<button onclick={() => (open = false)}>Cancel</button>
	</div>
{/if}
