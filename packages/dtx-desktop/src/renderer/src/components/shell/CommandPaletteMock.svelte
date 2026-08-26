<script lang="ts">
	// Minimal stand-in for CommandPalette used only by AppShell.test.ts so the
	// shell test can observe whether the palette was opened without pulling in
	// the real palette's service dependencies. A real compiled component (not a
	// vi.fn()) is required so Svelte re-renders it when the `open` prop changes.
	let { open }: { open: boolean; onClose: () => void } = $props();
</script>

{#if open}
	<div data-testid="command-palette" role="dialog" aria-label="Command palette"></div>
{/if}
