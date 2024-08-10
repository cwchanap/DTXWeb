<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Tables } from '@/types/supabase.types';
	import { PREVIEW_BUCKET_NAME } from '@/constant';
	import { DotsVerticalOutline } from 'flowbite-svelte-icons';
	import { formatLevelDisplay } from '@/lib/utils';
	import { getToastStore, SlideToggle } from '@skeletonlabs/skeleton';
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
	let openDropdownId: number | null = null;
	let dropdownPosition: { x: number; y: number } | null = null;
	let hideUnpublished = false;

	const toastStore = getToastStore();

	$: if (pageSize && initialLoad) {
		loadItems();
		initialLoad = false;
	}

	$: if (hideUnpublished) {
		items = items.filter((item) => item.is_published);
	} 

	function toggleDropdown(id: number, event: MouseEvent) {
		event.stopPropagation();
		if (openDropdownId === id) {
			closeDropdown();
		} else {
			openDropdownId = id;
			dropdownPosition = {
				x: event.clientX,
				y: event.clientY
			};
		}
	}

	async function togglePublishChart(id: number, published: boolean) {
		const { error } = await supabase
			.from('simfiles')
			.update({ is_published: !published })
			.eq('id', id);

		if (error) {
			toastStore.trigger({
				message: `Failed to ${published ? 'unpublish' : 'publish'} chart`,
				background: 'variant-filled-error',
				timeout: 3000
			});
		} else {
			toastStore.trigger({
				message: `Chart ${published ? 'unpublished' : 'published'}`,
				background: 'variant-filled-success',
				timeout: 3000
			});
			items = items.map((item) => (item.id === id ? { ...item, is_published: true } : item));
		}
		openDropdownId = null;
		dropdownPosition = null;
	}

	async function loadItems() {
		if (loading || !next) return;
		loading = true;
		try {
			let query = supabase
				.from('simfiles')
				.select(
					`id, title, artist, bpm, preview_url, download_url, is_published, dtx_files(level)`
				)
				.order('publish_date', { ascending: false })
				.ilike('artist', `%${artistFilter}%`)
				.ilike('title', `%${songNameFilter}%`)
				.range(page * pageSize, (page + 1) * pageSize - 1);

			if (!isBlog) {
				const {
					data: { user }
				} = await supabase.auth.getUser();
				if (!user) return;
				query = query.eq('user_id', user.id);
			} else {
				query = query.eq('is_published', true);
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

	function closeDropdown() {
		openDropdownId = null;
		dropdownPosition = null;
	}

	function handleGlobalClick(event: MouseEvent) {
		if (openDropdownId !== null) {
			const dropdownElement = document.getElementById(`dropdown-${openDropdownId}`);
			if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
				closeDropdown();
			}
		}
	}

	onMount(() => {
		window.addEventListener('scroll', handleScroll);
		document.addEventListener('click', handleGlobalClick);
		return () => {
			window.removeEventListener('scroll', handleScroll);
			document.removeEventListener('click', handleGlobalClick);
		};
	});
</script>

<input
	type="text"
	placeholder="Search by artist"
	bind:value={artistFilter}
	class="mb-4 w-1/2 rounded border p-2"
	on:input={handleSearchInput}
/>
<input
	type="text"
	placeholder="Search by song name"
	bind:value={songNameFilter}
	class="mb-4 w-1/2 rounded border p-2"
	on:input={handleSearchInput}
/>
<div class="mb-4 flex items-center">
	<label for="is_published" class="mb-2 mr-2 block">Hide unpublished:</label>
	<SlideToggle name="slide-large" active="bg-primary-500" bind:checked={hideUnpublished} />
</div>
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
						<div class="relative">
							<button
								class="text-gray-500 hover:text-gray-700 focus:outline-none"
								on:click={(event) => toggleDropdown(item.id, event)}
							>
								<DotsVerticalOutline size="xl" />
							</button>
							{#if openDropdownId === item.id && dropdownPosition}
								<div
									id="dropdown-{item.id}"
									class="fixed z-10 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5"
									style="left: {dropdownPosition.x}px; top: {dropdownPosition.y}px;"
								>
									<div
										class="py-1"
										role="menu"
										aria-orientation="vertical"
										aria-labelledby="options-menu"
									>
										<a
											href={`/app/chart/${item.id}`}
											class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
											role="menuitem"
										>
											Edit
										</a>
										<button
											on:click={() =>
												togglePublishChart(item.id, item.is_published)}
											class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
											role="menuitem"
										>
											{item.is_published ? 'Unpublish' : 'Publish'}
										</button>
									</div>
								</div>
							{/if}
						</div>
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
