<script lang="ts">
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Tables } from '@/types/supabase.types';
	import { PREVIEW_BUCKET_NAME } from '@/constant';
	import { DotsVerticalOutline } from 'flowbite-svelte-icons';
	import { formatLevelDisplay } from '@/lib/utils';
	import { popup } from '@skeletonlabs/skeleton';
	import { getModalStore, getToastStore, SlideToggle } from '@skeletonlabs/skeleton';
	import { _ } from 'svelte-i18n';
	export let pageSize: number = 12;
	export let isBlog = false;

	let items: Tables<'simfiles'>[] = [];
	let currentPage = 1;
	let totalPages = 1;
	let loading = false;
	let artistFilter: string = '';
	let songNameFilter: string = '';
	let searchTimeout: NodeJS.Timeout;
	let hideUnpublished = false;

	const toastStore = getToastStore();
	const modalStore = getModalStore();

	$: filteredItems = hideUnpublished ? items.filter((item) => item.is_published) : items;

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
		}
		openDropdownId = null;
		dropdownPosition = null;
	}

	async function loadItems() {
		loading = true;
		try {
			let query = supabase
				.from('simfiles')
				.select(
					`id, title, artist, bpm, preview_url, download_url, is_published, display_id, dtx_files(level)`,
					{ count: 'exact' }
				)
				.order('publish_date', { ascending: false })
				.ilike('artist', `%${artistFilter}%`)
				.ilike('title', `%${songNameFilter}%`)
				.range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

			if (!isBlog) {
				const {
					data: { user }
				} = await supabase.auth.getUser();
				if (!user) return;
				query = query.eq('user_id', user.id);
			} else {
				query = query.eq('is_published', true);
			}

			const { data, error, count } = await query;

			if (error) {
				console.error('Failed to load items:', error);
				return;
			}
			items = data || [];
			totalPages = Math.ceil((count || 0) / pageSize);
		} catch (error) {
			console.error('Failed to load items:', error);
		} finally {
			loading = false;
		}
	}

	function changePage(newPage: number) {
		if (newPage >= 1 && newPage <= totalPages) {
			currentPage = newPage;
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
			currentPage = 1;
			loadItems();
		}, 500);
	}

	function openDeleteModal(id: number, preview_url?: string) {
		modalStore.trigger({
			type: 'confirm',
			title: 'Please Confirm',
			body: 'Are you sure you want to proceed with deletion? This action is irreversible.',
			response: async (confirmed: boolean) => {
				if (confirmed) {
					if (preview_url) {
						const { error: deletePreviewError } = await supabase.storage
							.from(PREVIEW_BUCKET_NAME)
							.remove([preview_url]);
						if (deletePreviewError) {
							toastStore.trigger({
								message: 'Failed to delete preview',
								background: 'variant-filled-error',
								timeout: 3000
							});
						}
					}
					const { error } = await supabase.from('simfiles').delete().eq('id', id);
					if (error) {
						toastStore.trigger({
							message: 'Failed to delete chart',
							background: 'variant-filled-error',
							timeout: 3000
						});
					} else {
						toastStore.trigger({
							message: 'Chart deleted',
							background: 'variant-filled-success',
							timeout: 3000
						});
						// items = items.filter((item) => item.id !== id);
					}
				}
			}
		});
	}

	onMount(() => {
		loadItems();
	});
</script>

<input
	type="text"
	placeholder={$_('blog.search_artist')}
	bind:value={artistFilter}
	class="mb-4 w-1/2 rounded border p-2"
	on:input={handleSearchInput}
/>
<input
	type="text"
	placeholder={$_('blog.search_song_name')}
	bind:value={songNameFilter}
	class="mb-4 w-1/2 rounded border p-2"
	on:input={handleSearchInput}
/>
{#if !isBlog}
	<div class="mb-4 flex items-center">
		<label for="is_published" class="mb-2 mr-2 block">Hide unpublished:</label>
		<SlideToggle name="slide-large" active="bg-primary-500" bind:checked={hideUnpublished} />
	</div>
{/if}
{#if loading}
	<div class="mt-4 text-center">
		<p>Loading more items...</p>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each filteredItems as item (item.id)}
			<div
				class="relative flex min-h-[200px] flex-col justify-between rounded-lg border bg-white p-6 shadow-md"
			>
				<div class="mb-2 flex items-center justify-between">
					<h2 class="text-2xl font-bold">{item.display_id}. {item.title}</h2>
					{#if !isBlog}
						<div class="relative">
							<button
								class="text-gray-500 hover:text-gray-700 focus:outline-none"
								use:popup={{
									event: 'click',
									target: 'popupFeatured-' + item.id,
									placement: 'bottom'
								}}
							>
								<DotsVerticalOutline size="xl" />
							</button>

							<div
								class="fixed z-10 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5"
								data-popup="popupFeatured-{item.id}"
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

									<button
										on:click={() => openDeleteModal(item.id, item.preview_url)}
										class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
										role="menuitem"
									>
										Delete
									</button>
								</div>
							</div>
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
					{$_('blog.level')}: {formatLevelDisplay(item.dtx_files)}
				</div>
				{#if isBlog}
					{#if item.download_url}
						<a
							href={item.download_url}
							target="_blank"
							rel="noopener noreferrer"
							class="mt-4 text-blue-500 hover:underline"
						>
							{$_('blog.download')}
						</a>
					{:else}
						<div class="mt-4 text-sm text-gray-600">Download not available</div>
					{/if}
				{/if}
			</div>
		{/each}
	</div>
	<!-- Pagination controls -->
	<div class="mt-6 flex justify-center">
		<button
			class="mr-2 rounded bg-blue-500 px-4 py-2 text-white"
			on:click={() => changePage(currentPage - 1)}
			disabled={currentPage === 1}>{$_('blog.pagination.previous')}</button
		>
		<span class="mx-4 self-center">
			{$_('blog.pagination.page', { values: { currentPage, totalPages } })}
		</span>
		<button
			class="ml-2 rounded bg-blue-500 px-4 py-2 text-white"
			on:click={() => changePage(currentPage + 1)}
			disabled={currentPage === totalPages}>{$_('blog.pagination.next')}</button
		>
	</div>
{/if}
