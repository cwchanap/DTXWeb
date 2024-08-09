<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Tables } from '@/types/supabase.types';
	import { PREVIEW_BUCKET_NAME } from '@/constant';
	import { goto } from '$app/navigation';
	import { DotsVerticalOutline } from 'flowbite-svelte-icons';
	import { formatLevelDisplay } from '@/lib/utils';

	export let pageSize: number;
	export let isBlog = false;

	let items: Tables<'simfiles'>[] = [];
	let page = 0;
	let loading = false;
	let next = true;
	let initialLoad = true;
	let artistFilter: string = '';
	let songNameFilter: string = '';
	let searchTimeout: NodeJS.Timeout;

	$: if (pageSize && initialLoad) {
		loadItems();
		initialLoad = false;
	}

	async function loadItems() {
		if (loading || !next) return;
		loading = true;
		try {
			let query = supabase
				.from('simfiles')
				.select(`id, title, artist, bpm, preview_url, download_url, dtx_files(level)`)
				.order('created_at', { ascending: false })
				.ilike('artist', `%${artistFilter}%`)
				.ilike('title', `%${songNameFilter}%`)
				.range(page * pageSize, (page + 1) * pageSize - 1);

			if (!isBlog) {
				const {
					data: { user }
				} = await supabase.auth.getUser();
				if (!user) return;
				query = query.eq('user_id', user.id);
			}

			const { data, error } = await query;

			if (error) {
				console.error('Failed to load items:', error);
				return;
			}
			if (!data || data.length === 0) {
				next = false;
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

	function getPreviewUrl(preview_url: string) {
		return supabase.storage.from(PREVIEW_BUCKET_NAME).getPublicUrl(`${preview_url}`).data
			.publicUrl;
	}

	function handleSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			next = true;
			page = 0;
			items = [];
			loadItems();
		}, 500);
	}

	onMount(() => {
		window.addEventListener('scroll', handleScroll);
		return () => {
			window.removeEventListener('scroll', handleScroll);
		};
	});
</script>

<input
	type="text"
	placeholder="Search by artist"
	bind:value={artistFilter}
	class="mb-4 rounded border p-2"
	on:input={handleSearchInput}
/>
<input
	type="text"
	placeholder="Search by song name"
	bind:value={songNameFilter}
	class="mb-4 rounded border p-2"
	on:input={handleSearchInput}
/>
{#if loading}
	<div class="mt-4 text-center">
		<p>Loading more items...</p>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each items as item}
			<div
				class="relative flex min-h-[200px] flex-col justify-between rounded-lg border bg-white p-6 shadow-md"
			>
				<div class="mb-2 flex items-center justify-between">
					<h2 class="text-2xl font-bold">{item.title}</h2>
					{#if !isBlog}
						<button
							class="text-gray-500 hover:text-gray-700 focus:outline-none"
							on:click={() => goto(`/app/chart/${item.id}`)}
						>
							<DotsVerticalOutline size="xl" />
						</button>
					{/if}
				</div>
				<div>
					<p class="mb-2 text-lg text-gray-600">{item.artist}</p>
					<p class="mb-2 text-lg">BPM: {item.bpm}</p>
				</div>
				{#if item.preview_url}
					<img
						src={getPreviewUrl(item.preview_url)}
						alt={`Preview for ${item.title}`}
						class="mb-4 h-60 w-full rounded-lg object-cover"
					/>
				{:else}
					<div
						class="mb-4 flex h-60 w-full items-center justify-center rounded-lg bg-gray-200"
					>
						<span class="text-gray-500">No preview available</span>
					</div>
				{/if}
				<div class="mt-4 text-sm text-gray-600">
					Level: {formatLevelDisplay(item.dtx_files)}
				</div>
				{#if isBlog}
					{#if item.download_url}
						<a
							href={item.download_url}
							target="_blank"
							rel="noopener noreferrer"
							class="mt-4 text-blue-500 hover:underline"
						>
							Download
						</a>
					{:else}
						<div class="mt-4 text-sm text-gray-600">Download not available</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
	{#if !next}
		<div class="mt-4 text-center">
			<p>No more items to load.</p>
		</div>
	{/if}
{/if}
