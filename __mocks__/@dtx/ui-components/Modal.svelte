<script lang="ts">
	import type { Snippet } from 'svelte';

	type ModalSize = 'sm' | 'md' | 'lg';
	type ConfirmVariant = 'primary' | 'danger';

	let {
		open = $bindable(false),
		title,
		children,
		onConfirm,
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		confirmVariant = 'primary' as ConfirmVariant,
		size = 'md' as ModalSize
	} = $props<{
		open: boolean;
		title: string;
		children: Snippet;
		onConfirm?: () => void;
		confirmText?: string;
		cancelText?: string;
		confirmVariant?: ConfirmVariant;
		size?: ModalSize;
	}>();
</script>

{#if open}
	<div data-testid="modal">
		<h2>{title}</h2>
		{@render children()}
	</div>
{/if}
