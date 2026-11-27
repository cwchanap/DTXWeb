<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = { trigger?: Snippet; content?: Snippet };
	let { trigger, content }: Props = $props();
</script>

{@render trigger?.()}
{@render content?.()}
