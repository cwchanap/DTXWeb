<script lang="ts">
	type Snippet = () => unknown;
	let { trigger } = $props<{ trigger?: Snippet; content?: Snippet }>();
</script>

{@render trigger?.()}
