<script lang="ts">
	type Snippet = () => unknown;
	let { children } = $props<{
		children?: Snippet;
		value?: string[];
		rounded?: string;
		padding?: string;
		spaceY?: string;
		base?: string;
		collapsible?: boolean;
		onValueChange?: (e: { value: string[] }) => void;
	}>();
</script>

{@render children?.()}
