<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		children
	}: {
		children?: Snippet;
		value?: string[];
		rounded?: string;
		padding?: string;
		spaceY?: string;
		base?: string;
		collapsible?: boolean;
		onValueChange?: (e: { value: string[] }) => void;
	} = $props();
</script>

{@render children?.()}
