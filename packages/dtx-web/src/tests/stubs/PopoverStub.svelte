<script lang="ts">
	type Snippet = () => unknown;
	let { trigger, content } = $props<{ trigger?: Snippet; content?: Snippet }>();
</script>

{@render trigger?.()}
{@render content?.()}
