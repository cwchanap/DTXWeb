<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		children,
		onclick
	}: { children?: Snippet; onclick?: () => void; [key: string]: unknown } = $props();
</script>

<button {onclick}>
	{@render children?.()}
</button>
