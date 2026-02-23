<script lang="ts">
	type Snippet = () => unknown;
	let {
		open = $bindable(false),
		title = '',
		children,
		onConfirm,
		confirmText = 'Confirm'
	} = $props<{
		open?: boolean;
		title?: string;
		children?: Snippet;
		onConfirm?: () => void;
		confirmText?: string;
		confirmVariant?: string;
	}>();
</script>

{#if open}
	<div role="dialog" aria-label={title}>
		{@render children?.()}
		<button onclick={onConfirm}>{confirmText}</button>
		<button onclick={() => (open = false)}>Cancel</button>
	</div>
{/if}
