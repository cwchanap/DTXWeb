<script lang="ts">
	type Snippet = () => unknown;
	let { lead, control, panel, children } = $props<{
		lead?: Snippet;
		control?: Snippet;
		panel?: Snippet;
		children?: Snippet;
		value?: string;
		panelPadding?: string;
	}>();
</script>

{@render lead?.()}
{@render control?.()}
{@render panel?.()}
{@render children?.()}
