<script lang="ts">
	import { onMount } from 'svelte';
	import { PREVIEW_BUCKET_NAME, SOUND_PREVIEW_BUCKET_NAME } from '@/constant';
	import { _ } from 'svelte-i18n';
	import toastStore from '@/lib/toaster';
	import { Switch, Pagination } from '@skeletonlabs/skeleton-svelte';
	import ChartListItem from './ChartListItem.svelte';
	import ChartListTableItem from './ChartListTableItem.svelte';
	import IconX from '@lucide/svelte/icons/x';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconTable from '@lucide/svelte/icons/table';
	import IconGrid from '@lucide/svelte/icons/grid';
	import { Button } from '@dtx/ui-components/components';
	import { supabase } from '../supabase';
	import { formatLevelDisplay } from '../utils';

	interface Props {
		pageSize?: number;
		isBlog?: boolean;
	}

	import type { SimfileWithDtx, Tables } from '@dtx/common';

	let { pageSize = 12, isBlog = false }: Props = $props();

	let items: SimfileWithDtx[] = $state([]);
	let currentPage = $state(1);
	let totalPages = $state(1);
	let totalCount = $state(0);
	let loading = $state(false);
	let searchFilter: string = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;
	let hideUnpublished = $state(false);
	let filteredItems = $state<SimfileWithDtx[]>([]);
	let viewMode = $state<'card' | 'table'>('card');

	// Replace the run() function with a reactive effect using $effect
	$effect(() => {
		filteredItems = hideUnpublished ? items.filter((item) => item.is_published) : items;
	});

	async function togglePublishChart(id: number, published: boolean) {
		const { error } = await supabase
			.from('simfiles')
			.update({ is_published: !published })
			.eq('id', id);

		if (error) {
			toastStore.error({
				title: `Failed to ${published ? 'unpublish' : 'publish'} chart`,
				duration: 3000
			});
		} else {
			toastStore.success({
				title: `Chart ${published ? 'unpublished' : 'published'}`,
				duration: 3000
			});
		}
	}

	async function loadItems() {
		loading = true;
		try {
			let query = supabase
				.from('simfiles')
				.select(
					`id, title, artist, bpm, preview_url, sound_preview_url, download_url, is_published, display_id, publish_date, dtx_files(level)`,
					{ count: 'exact' }
				)
				.order('publish_date', { ascending: false })
				.range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

			// Apply search filter to both artist and title if search term is provided
			if (searchFilter.trim()) {
				query = query.or(`artist.ilike.%${searchFilter}%,title.ilike.%${searchFilter}%`);
			}

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
			totalCount = count || 0;
			totalPages = Math.ceil(totalCount / pageSize);
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

	// Handle page changes from Skeleton UI Pagination
	function handlePageChange(event: { page: number }) {
		changePage(event.page);
	}

	// Handle page size changes from Skeleton UI Pagination
	function handlePageSizeChange(event: { pageSize: number }) {
		pageSize = event.pageSize;
		currentPage = 1; // Reset to first page when page size changes
		loadItems();
	}

	function getPreviewUrl(preview_url: string) {
		return supabase.storage.from(PREVIEW_BUCKET_NAME).getPublicUrl(`${preview_url}`).data
			.publicUrl;
	}

	function getSoundPreviewUrl(sound_preview_url: string | null) {
		if (!sound_preview_url) return null;
		return supabase.storage.from(SOUND_PREVIEW_BUCKET_NAME).getPublicUrl(`${sound_preview_url}`)
			.data.publicUrl;
	}

	function handleSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			currentPage = 1;
			loadItems();
		}, 500);
	}

	async function onFileDelete(id: number, preview_url?: string, sound_preview_url?: string) {
		if (preview_url) {
			const { error: deletePreviewError } = await supabase.storage
				.from(PREVIEW_BUCKET_NAME)
				.remove([preview_url]);
			if (deletePreviewError) {
				toastStore.error({
					title: 'Failed to delete preview',
					duration: 3000
				});
			}
		}
		if (sound_preview_url) {
			const { error: deleteSoundPreviewError } = await supabase.storage
				.from(SOUND_PREVIEW_BUCKET_NAME)
				.remove([sound_preview_url]);
			if (deleteSoundPreviewError) {
				toastStore.error({
					title: 'Failed to delete sound preview',
					duration: 3000
				});
			}
		}
		const { error } = await supabase.from('simfiles').delete().eq('id', id);
		if (error) {
			toastStore.error({
				title: 'Failed to delete chart',
				duration: 3000
			});
		} else {
			toastStore.success({
				title: 'Chart deleted',
				duration: 3000
			});
			filteredItems = filteredItems.filter((item) => item.id !== id);
		}
		loadItems();
	}

	onMount(() => {
		loadItems();
	});
</script>

<input
	type="text"
	placeholder={$_('blog.search_song_or_artist')}
	bind:value={searchFilter}
	class="mb-4 w-full rounded-sm border p-2"
	oninput={handleSearchInput}
/>
<div class="mb-4 flex items-center justify-between">
	<div class="flex items-center">
		{#if !isBlog}
			<div class="mr-6 flex items-center">
				<label for="is_published" class="mr-2 mb-2 block">Hide unpublished:</label>
				<Switch
					checked={hideUnpublished}
					onCheckedChange={(e) => (hideUnpublished = e.checked)}
				>
					{#snippet inactiveChild()}<IconX size="14" />{/snippet}
					{#snippet activeChild()}<IconCheck size="14" />{/snippet}
				</Switch>
			</div>
		{/if}
	</div>
	<div class="flex items-center gap-4">
		<!-- Page Size Selector -->
		<div class="flex items-center">
			<span class="mr-2 text-sm">Items per page:</span>
			<select
				bind:value={pageSize}
				onchange={() => handlePageSizeChange({ pageSize })}
				class="rounded border border-gray-300 px-2 py-1 text-sm"
			>
				<option value={6}>6</option>
				<option value={12}>12</option>
				<option value={24}>24</option>
				<option value={48}>48</option>
			</select>
		</div>

		<!-- View Mode Selector using regular buttons -->
		<div class="flex items-center">
			<span class="mr-2">View:</span>
			<div class="flex rounded border">
				<button
					class="inline-flex h-9 w-9 items-center justify-center rounded transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50 {viewMode ===
					'card'
						? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
						: 'hover:bg-gray-100'}"
					onclick={() => (viewMode = 'card')}
					aria-pressed={viewMode === 'card'}
					aria-label="Card view"
				>
					<IconGrid size="18" />
				</button>
				<button
					class="inline-flex h-9 w-9 items-center justify-center rounded transition-colors focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50 {viewMode ===
					'table'
						? 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
						: 'hover:bg-gray-100'}"
					onclick={() => (viewMode = 'table')}
					aria-pressed={viewMode === 'table'}
					aria-label="Table view"
				>
					<IconTable size="18" />
				</button>
			</div>
		</div>
	</div>
</div>
{#if loading}
	<div class="mt-4 text-center">
		<p>Loading more items...</p>
	</div>
{:else if viewMode === 'table'}
	<div class="grid gap-3">
		{#each filteredItems as item (item.id)}
			<div
				class="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
			>
				<div class="flex items-start justify-between">
					<div class="flex-1">
						<h3 class="mb-1 font-semibold text-gray-800">
							{item.display_id}. {item.title}
						</h3>
						<div class="flex items-center gap-4 text-sm text-gray-600">
							<div class="flex items-center gap-1">
								<span>Artist:</span>
								{item.artist}
							</div>
							<div class="flex items-center gap-1">
								<span>BPM:</span>
								{item.bpm}
							</div>
							{#if item.publish_date}
								<div class="flex items-center gap-1">
									<span>Published:</span>
									{new Date(item.publish_date).toLocaleDateString()}
								</div>
							{/if}
						</div>
						{#if item.dtx_files && item.dtx_files.length > 0}
							<div class="mt-2">
								<span class="text-xs text-gray-500">
									Levels: {formatLevelDisplay(
										item.dtx_files as Tables<'dtx_files'>[]
									)}
								</span>
							</div>
						{/if}
					</div>
					<div class="flex items-center gap-2">
						<ChartListTableItem {item} {isBlog} {togglePublishChart} {onFileDelete} />
					</div>
				</div>
			</div>
		{/each}
	</div>
{:else if viewMode === 'card'}
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each filteredItems as item (item.id)}
			<ChartListItem
				{item}
				{isBlog}
				{togglePublishChart}
				{onFileDelete}
				{getPreviewUrl}
				{getSoundPreviewUrl}
			/>
		{/each}
	</div>
{/if}
<!-- Skeleton UI Pagination Component -->
{#if totalPages > 1}
	<div class="mt-6 flex justify-center">
		<Pagination
			data={items}
			count={totalCount}
			page={currentPage}
			{pageSize}
			onPageChange={handlePageChange}
			onPageSizeChange={handlePageSizeChange}
			siblingCount={2}
			showFirstLastButtons={true}
			classes="flex items-center gap-2"
			buttonBase="btn btn-sm"
			buttonActive="preset-filled-primary-500"
			buttonInactive="preset-tonal-surface"
		>
			{#snippet labelFirst()}
				{$_('blog.pagination.first')}
			{/snippet}
			{#snippet labelPrevious()}
				{$_('blog.pagination.previous')}
			{/snippet}
			{#snippet labelNext()}
				{$_('blog.pagination.next')}
			{/snippet}
			{#snippet labelLast()}
				{$_('blog.pagination.last')}
			{/snippet}
		</Pagination>
	</div>
{/if}
