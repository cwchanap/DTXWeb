<script lang="ts">
	// Minimal Pagination stub for tests that exercise page-change interaction
	// without depending on @skeletonlabs/skeleton-svelte's real rendering
	// (which is fragile across upgrades). Renders one button per page and
	// fires onPageChange with { page } on click. The active page (from the
	// `page` prop) is marked with `aria-current="page"` so tests can assert
	// which page the pagination presents as active.
	let {
		count = 0,
		pageSize = 10,
		page = 1,
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
		<button onclick={() => go(p + 1)} aria-current={page === p + 1 ? 'page' : undefined}>
			{p + 1}
		</button>
	{/each}
</nav>
