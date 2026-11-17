<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		lead,
		control,
		panel,
		children
	}: {
		lead?: Snippet;
		control?: Snippet;
		panel?: Snippet;
		children?: Snippet;
		[key: string]: unknown;
	} = $props();
</script>

{@render lead?.()}
{@render control?.()}
{@render panel?.()}
{@render children?.()}
