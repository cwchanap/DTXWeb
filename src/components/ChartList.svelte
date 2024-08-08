<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Database } from '@/types/supabase.types';
	import { PREVIEW_BUCKET_NAME } from '@/constant';
	import { goto } from '$app/navigation';

	export let pageSize: number;

	let items: Database['public']['Tables']['simfiles']['Row'][] = [];
	let page = 0;
	let loading = false;
	let next = true;
	let initialLoad = true;

	$: if (pageSize && initialLoad) {
		loadItems();
		initialLoad = false;
	}

	async function loadItems() {
		if (loading || !next) return;
		loading = true;
		const {
			data: { user }
		} = await supabase.auth.getUser();
		if (!user) return;
		try {
			const { data, error } = await supabase
				.from('simfiles')
				.select(`id, title, bpm, preview_url, dtx_files(level)`)
				.order('created_at', { ascending: false })
				.filter('user_id', 'eq', user.id)
				.range(page * pageSize, (page + 1) * pageSize - 1);

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

	onMount(() => {
		window.addEventListener('scroll', handleScroll);
		return () => {
			window.removeEventListener('scroll', handleScroll);
		};
	});
</script>

<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
	{#each items as item}
		<div
			class="relative flex min-h-[200px] flex-col justify-between rounded-lg border bg-white p-6 shadow-md"
		>
			<div class="absolute right-2 top-2">
				<button
					class="text-gray-500 hover:text-gray-700 focus:outline-none"
					on:click={() => goto(`/app/chart/${item.id}`)}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-6 w-6"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
						/>
					</svg>
				</button>
			</div>
			<div>
				<h2 class="mb-2 text-2xl font-bold">{item.title}</h2>
				<p class="text-lg">BPM: {item.bpm}</p>
			</div>
			{#if item.preview_url}
				<img
					src={getPreviewUrl(item.preview_url)}
					alt={`Preview for ${item.title}`}
					class="mb-4 h-40 w-full rounded-lg object-cover"
				/>
			{:else}
				<div
					class="mb-4 flex h-40 w-full items-center justify-center rounded-lg bg-gray-200"
				>
					<span class="text-gray-500">No preview available</span>
				</div>
			{/if}
			<div class="mt-4 text-sm text-gray-600">
				Level: {item.dtx_files?.map((file) => file.level).join(' / ') || 'N/A'}
			</div>
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
