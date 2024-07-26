<script lang="ts">
	import { supabase } from '@/lib/supabase';
	import { onMount } from 'svelte';
	import type { Database } from '@/types/supabase.types';

	export let pageSize: number;
	let pageTitle = 'My Chart';

	let items: Database['public']['Tables']['simfiles']['Row'][] = [];
	let page = 0;
	let loading = false;
	let next = true;

	async function loadItems() {
		if (loading || !next) return;
		loading = true;

		try {
			// const response = await fetch(`/api/simfiles?page=${page}&page_size=${pageSize}`);
			const { data, error } = await supabase
				.from('simfiles')
				.select(`id, title, bpm, dtx_files(level)`)
				.range(page, pageSize);
			// const data = await response.json();
			if (error) {
				console.error('Failed to load items:', error);
				return;
			}
			if (!data || data.length === 0) {
				next = false;
				console.error('No data returned');
				return;
			}
			items = [...items, ...data];
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
	<div class="mb-4 flex items-center justify-between">
		<h1 class="text-2xl font-bold">{pageTitle}</h1>
		<a href="/app/chart/upload" class="rounded bg-blue-600 p-2 text-white hover:bg-blue-500">
			Upload Simfiles
		</a>
	</div>
	<div class="space-y-4">
		<!-- Changed from grid to space-y for vertical spacing -->
		{#each items as item}
			<div class="w-full rounded border p-4 shadow">
				<!-- Added w-full to make it occupy full width -->
				<h2 class="text-xl font-bold">{item.title}</h2>
				<p>{item.bpm}</p>
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
