<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = {
		trigger?: Snippet;
		content?: Snippet;
		triggerAriaLabel?: string;
		triggerClasses?: string;
		open?: boolean;
		onOpenChange?: (details: { open: boolean }) => void;
	};
	let {
		trigger,
		content,
		triggerAriaLabel,
		triggerClasses,
		open = false,
		onOpenChange
	}: Props = $props();
</script>

<button
	type="button"
	class={triggerClasses}
	aria-label={triggerAriaLabel}
	onclick={() => onOpenChange?.({ open: !open })}
>
	{@render trigger?.()}
</button>
{@render content?.()}
