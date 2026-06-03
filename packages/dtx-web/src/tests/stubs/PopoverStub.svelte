<script lang="ts">
	type Snippet = () => unknown;
	let {
		trigger,
		content,
		triggerAriaLabel,
		triggerClasses,
		open = false,
		onOpenChange
	} = $props<{
		trigger?: Snippet;
		content?: Snippet;
		triggerAriaLabel?: string;
		triggerClasses?: string;
		open?: boolean;
		onOpenChange?: (details: { open: boolean }) => void;
	}>();
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
