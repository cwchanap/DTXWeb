<script lang="ts">
	import { onMount } from 'svelte';

	export let pageSize: number;
	let pageTitle = 'My Chart';

	let items: any = [];
	let page = 1;
	let loading = false;
	let next = true;

	async function loadItems() {
		if (loading || !next) return;
		loading = true;

		try {
			const response = await fetch(`/api/simfiles?page=${page}&page_size=${pageSize}`);
			const data = await response.json();
            items = [...items, ...data.items];
            next = data.next;
            page++;
			
		} catch (error) {
			console.error('Failed to load items:', error);
		} finally {
			loading = false;
		}
	}

	function handleScroll() {
		if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500 && !loading) {
			loadItems();
		}
	}

	onMount(() => {
		const itemsOnScreen = Math.ceil(window.innerHeight / 100); // Adjust 100 to the estimated item height
		pageSize = itemsOnScreen * 2;
		loadItems();
		window.addEventListener('scroll', handleScroll);
		return () => {
			window.removeEventListener('scroll', handleScroll);
		};
	});
</script>

<div class="container mx-auto p-4">
    <h2 class="text-2xl font-bold mb-4">{pageTitle}</h2>    
	<div class="space-y-4">
		<!-- Changed from grid to space-y for vertical spacing -->
		{#each items as item}
			<div class="w-full rounded border p-4 shadow">
				<!-- Added w-full to make it occupy full width -->
				<h2 class="text-xl font-bold">{item.title}</h2>
				<p>{item.description}</p>
			</div>
		{/each}
	</div>
	{#if loading}
		<div class="mt-4 text-center">
			<p>Loading more items...</p>
		</div>
	{/if}
	{#if !loading && !next}
		<div class="mt-4 text-center">
			<p>No more items to load.</p>
		</div>
	{/if}
</div>
