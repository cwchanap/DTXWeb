<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title = '',
		children
	} = $props<{
		open: boolean;
		title?: string;
		children?: Snippet;
	}>();
</script>

{#if open}
	<div data-testid="modal">
		<h2>{title}</h2>
		{#if children}
			{@render children()}
		{/if}
	</div>
{/if}
