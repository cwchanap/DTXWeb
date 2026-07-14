<script lang="ts">
	// Minimal Pagination stub for tests that exercise page-change interaction
	// without depending on @skeletonlabs/skeleton-svelte's real rendering
	// (which is fragile across upgrades). Renders one button per page and
	// fires onPageChange with { page } on click.
	let {
		count = 0,
		pageSize = 10,
		onPageChange
	} = $props<{
		data?: unknown[];
		count?: number;
		pageSize?: number;
		page?: number;
		onPageChange?: (event: { page: number }) => void;
		siblingCount?: number;
		showFirstLastButtons?: boolean;
	}>();

	const totalPages = $derived(Math.max(1, Math.ceil(count / pageSize)));
	const go = (p: number): void => {
		onPageChange?.({ page: p });
	};
</script>

<nav aria-label="pagination">
	{#each Array(totalPages).keys() as p}
		<button onclick={() => go(p + 1)}>{p + 1}</button>
	{/each}
</nav>
