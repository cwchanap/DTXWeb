<script lang="ts">
	import { onMount } from 'svelte';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import { _ } from 'svelte-i18n';
	import toastStore from '@/lib/toaster';
	import { Switch, Pagination } from '@skeletonlabs/skeleton-svelte';
	import ChartListItem from './ChartListItem.svelte';
	import ChartListTableItem from './ChartListTableItem.svelte';
	import IconX from '@lucide/svelte/icons/x';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconTable from '@lucide/svelte/icons/table';
	import IconGrid from '@lucide/svelte/icons/grid';
	import { supabase } from '../supabase';
	import { formatLevelDisplay } from '../utils';

	interface Props {
		pageSize?: number;
		isBlog?: boolean;
	}

	import type { SimfileWithDtx } from '@dtx/common';

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
		return `${PUBLIC_SIMFILE_BUCKET_URL}/${preview_url}`;
	}

	function getSoundPreviewUrl(sound_preview_url: string | null) {
		if (!sound_preview_url) return null;
		return `${PUBLIC_SIMFILE_BUCKET_URL}/${sound_preview_url}`;
	}

	function handleSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			currentPage = 1;
			loadItems();
		}, 500);
	}

	async function onFileDelete(id: number) {
		// Delete files from R2 bucket first
		let r2DeleteSuccess = false;
		try {
			const response = await fetch(`/api/simFile/delete/${id}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				const errorData = await response.json();
				console.error('Failed to delete R2 files:', errorData);
				toastStore.error({
					title: 'Failed to delete chart files',
					duration: 3000
				});
				return; // Abort if R2 deletion fails
			}
			r2DeleteSuccess = true;
		} catch (error) {
			console.error('Failed to delete R2 files:', error);
			toastStore.error({
				title: 'Failed to delete chart files',
				duration: 3000
			});
			return; // Abort if R2 deletion fails
		}

		// Only delete the database record if R2 deletion succeeded
		if (r2DeleteSuccess) {
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
	}

	onMount(() => {
		loadItems();
	});
</script>

<div class="mb-8">
	<div class="music-card p-6">
		<div class="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
			<div class="max-w-md flex-1">
				<input
					type="text"
					placeholder={$_('blog.search_song_or_artist')}
					bind:value={searchFilter}
					class="music-input w-full"
					oninput={handleSearchInput}
				/>
			</div>
			<div class="flex flex-wrap items-center gap-4">
				{#if !isBlog}
					<div class="flex items-center gap-3">
						<label for="is_published" class="text-sm font-medium text-slate-300"
							>Hide unpublished:</label
						>
						<Switch
							checked={hideUnpublished}
							onCheckedChange={(e) => (hideUnpublished = e.checked)}
							class="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-600 transition-colors focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none data-[checked]:bg-purple-600"
						>
							{#snippet inactiveChild()}<IconX
									size="14"
									class="text-slate-400"
								/>{/snippet}
							{#snippet activeChild()}<IconCheck
									size="14"
									class="text-purple-200"
								/>{/snippet}
						</Switch>
					</div>
				{/if}

				<!-- Page Size Selector -->
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium text-slate-300">Items:</span>
					<select
						bind:value={pageSize}
						onchange={() => handlePageSizeChange({ pageSize })}
						class="music-input min-w-0 px-3 py-2 text-sm"
					>
						<option value={6}>6</option>
						<option value={12}>12</option>
						<option value={24}>24</option>
						<option value={48}>48</option>
					</select>
				</div>

				<!-- View Mode Selector -->
				<div class="flex items-center gap-2">
					<span class="text-sm font-medium text-slate-300">View:</span>
					<div class="flex overflow-hidden rounded-lg border border-purple-500/30">
						<button
							class="inline-flex h-9 w-9 items-center justify-center transition-all duration-200 {viewMode ===
							'card'
								? 'bg-purple-600 text-white shadow-lg'
								: 'bg-slate-800/50 text-slate-400 hover:bg-purple-600/20 hover:text-purple-300'}"
							onclick={() => (viewMode = 'card')}
							aria-pressed={viewMode === 'card'}
							aria-label="Card view"
						>
							<IconGrid size="18" />
						</button>
						<button
							class="inline-flex h-9 w-9 items-center justify-center transition-all duration-200 {viewMode ===
							'table'
								? 'bg-purple-600 text-white shadow-lg'
								: 'bg-slate-800/50 text-slate-400 hover:bg-purple-600/20 hover:text-purple-300'}"
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
	</div>
</div>
{#if loading}
	<div class="flex items-center justify-center py-12">
		<div class="music-card p-8 text-center">
			<div class="mx-auto mb-4 flex scale-150 items-center justify-center">
				<div class="music-bars">
					<div class="music-bar" style="height: 12px;"></div>
					<div class="music-bar" style="height: 20px;"></div>
					<div class="music-bar" style="height: 16px;"></div>
					<div class="music-bar" style="height: 24px;"></div>
					<div class="music-bar" style="height: 8px;"></div>
				</div>
			</div>
			<p class="font-medium text-slate-300">Loading charts...</p>
		</div>
	</div>
{:else if viewMode === 'table'}
	<div class="space-y-4">
		{#each filteredItems as item (item.id)}
			<div class="music-card group p-6 transition-all duration-300 hover:scale-[1.02]">
				<div class="flex items-start justify-between">
					<div class="flex-1">
						<div class="mb-3 flex items-center gap-3">
							<div
								class="h-2 w-2 rounded-full bg-gradient-to-r from-purple-400 to-cyan-400"
							></div>
							<h3
								class="text-lg font-semibold text-slate-100 transition-colors group-hover:text-purple-300"
							>
								{item.display_id}. {item.title}
							</h3>
						</div>
						<div class="flex flex-wrap items-center gap-6 text-sm">
							<div class="flex items-center gap-2 text-slate-300">
								<svg
									class="h-4 w-4 text-purple-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
									></path>
								</svg>
								<span class="font-medium text-purple-300">{item.artist}</span>
							</div>
							<div class="flex items-center gap-2 text-slate-300">
								<svg
									class="h-4 w-4 text-cyan-400"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
									></path>
								</svg>
								<span class="font-medium text-cyan-300">{item.bpm} BPM</span>
							</div>
							{#if item.publish_date}
								<div class="flex items-center gap-2 text-slate-300">
									<svg
										class="h-4 w-4 text-amber-400"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
										></path>
									</svg>
									<span class="font-medium text-amber-300">
										{new Date(item.publish_date).toLocaleDateString()}
									</span>
								</div>
							{/if}
						</div>
						{#if item.dtx_files && item.dtx_files.length > 0}
							<div class="mt-3 flex items-center gap-2">
								<span class="text-xs font-medium text-slate-400">Levels:</span>
								<div class="flex flex-wrap gap-1">
									{#each formatLevelDisplay(item.dtx_files).split(', ') as level}
										<span
											class="rounded-full border border-purple-500/30 bg-gradient-to-r from-purple-600/30 to-cyan-600/30 px-2 py-1 text-xs text-purple-200"
										>
											{level}
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
					<div class="ml-4 flex items-center gap-2">
						<ChartListTableItem {item} {isBlog} {togglePublishChart} {onFileDelete} />
					</div>
				</div>
			</div>
		{/each}
	</div>
{:else if viewMode === 'card'}
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each filteredItems as item (item.id)}
			<div class="transform transition-all duration-300 hover:scale-105">
				<ChartListItem
					{item}
					{isBlog}
					{togglePublishChart}
					{onFileDelete}
					{getPreviewUrl}
					{getSoundPreviewUrl}
				/>
			</div>
		{/each}
	</div>
{/if}
<!-- Enhanced Pagination Component -->
{#if totalPages > 1}
	<div class="mt-8 flex justify-center">
		<div class="music-card p-4">
			<Pagination
				data={items}
				count={totalCount}
				page={currentPage}
				{pageSize}
				onPageChange={handlePageChange}
				onPageSizeChange={handlePageSizeChange}
				siblingCount={1}
				showFirstLastButtons={true}
				classes="flex items-center gap-1 flex-nowrap"
				buttonBase="px-2 py-1 text-xs font-medium rounded-lg transition-all duration-200 border border-purple-500/30 whitespace-nowrap"
				buttonActive="bg-gradient-to-r from-purple-600 to-cyan-600 text-white shadow-lg hover:shadow-xl"
				buttonInactive="bg-slate-800/50 text-slate-300 hover:bg-purple-600/20 hover:text-purple-300 hover:border-purple-400/50"
			>
				{#snippet labelFirst()}
					<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
						></path>
					</svg>
				{/snippet}
				{#snippet labelPrevious()}
					<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 19l-7-7 7-7"
						></path>
					</svg>
				{/snippet}
				{#snippet labelNext()}
					<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5l7 7-7 7"
						></path>
					</svg>
				{/snippet}
				{#snippet labelLast()}
					<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M13 5l7 7-7 7M5 5l7 7-7 7"
						></path>
					</svg>
				{/snippet}
			</Pagination>
		</div>
	</div>
{/if}
