<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import { _ } from 'svelte-i18n';
	import toastStore from '$lib/toaster';
	import { Switch, Pagination } from '@skeletonlabs/skeleton-svelte';
	import {
		BULK_DOWNLOAD_UNSUPPORTED_MESSAGE,
		MAX_BULK_DOWNLOAD_CHARTS,
		canBulkSelect,
		changePage as getChangedPage,
		handlePageSizeChange as getChangedPageSize,
		isAbortError,
		resetBulkSelection as createEmptySelection,
		startBulkDownload,
		supportsBulkDownloadStreaming as checkBulkDownloadStreaming
	} from '$lib/components/ChartList.helpers';
	import type { SaveFilePickerWindow } from '$lib/components/ChartList.helpers';
	import ChartListItem from './ChartListItem.svelte';
	import ChartListTableItem from './ChartListTableItem.svelte';
	import IconX from '@lucide/svelte/icons/x';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconTable from '@lucide/svelte/icons/table';
	import IconGrid from '@lucide/svelte/icons/grid';
	import { formatLevelDisplay } from '../utils';

	interface Props {
		pageSize?: number;
		isBlog?: boolean;
		enableDownload?: boolean;
	}

	import type { SimfileWithDtx } from '@dtx/common';

	type ListedChart = SimfileWithDtx & { has_uploaded_files?: boolean };

	let { pageSize = 12, isBlog = false, enableDownload = false }: Props = $props();

	let items: ListedChart[] = $state([]);
	let currentPage = $state(1);
	let totalPages = $state(1);
	let totalCount = $state(0);
	let loading = $state(false);
	let searchFilter: string = $state('');
	let searchTimeout: ReturnType<typeof setTimeout>;
	let hideUnpublished = $state(false);
	let filteredItems = $state<ListedChart[]>([]);
	let viewMode = $state<'card' | 'table'>('card');
	let selectMode = $state(false);
	let selectedIds = $state(new Set<number>());
	let bulkDownloading = $state(false);
	let supportsBulkDownloadStreaming = $state(false);

	// Replace the run() function with a reactive effect using $effect
	$effect(() => {
		filteredItems = hideUnpublished ? items.filter((item) => item.is_published) : items;
	});

	const togglePublishChart = async (id: number, published: boolean) => {
		try {
			const response = await fetch(`/api/chart/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ is_published: !published })
			});

			if (!response.ok) {
				throw new Error('Failed to update');
			}

			// Update local state
			items = items.map((item) =>
				item.id === id ? { ...item, is_published: !published } : item
			);

			toastStore.success({
				title: `Chart ${published ? 'unpublished' : 'published'}`,
				duration: 3000
			});
		} catch {
			toastStore.error({
				title: `Failed to ${published ? 'unpublish' : 'publish'} chart`,
				duration: 3000
			});
		}
	};

	const loadItems = async () => {
		loading = true;
		try {
			const params = new URLSearchParams({
				page: String(currentPage),
				pageSize: String(pageSize),
				scope: isBlog ? 'published' : 'mine'
			});

			if (searchFilter.trim()) {
				params.set('search', searchFilter);
			}

			params.set('check_uploaded', 'true');

			const response = await fetch(`/api/chart?${params}`);
			if (!response.ok) {
				console.error('Failed to load items:', await response.text());
				return;
			}

			const result = await response.json();
			items = result.data || [];
			totalCount = result.count || 0;
			totalPages = Math.ceil(totalCount / pageSize);
		} catch (error) {
			console.error('Failed to load items:', error);
		} finally {
			loading = false;
		}
	};

	const changePage = (newPage: number) => {
		const nextPage = getChangedPage(newPage, totalPages);
		if (!nextPage) return;

		selectedIds = nextPage.selectedIds;
		currentPage = nextPage.currentPage;
		loadItems();
	};

	// Handle page changes from Skeleton UI Pagination
	function handlePageChange(event: { page: number }) {
		changePage(event.page);
	}

	// Handle page size changes from Skeleton UI Pagination
	function handlePageSizeChange(event: { pageSize: number }) {
		const nextPageSize = getChangedPageSize(event.pageSize);
		selectedIds = nextPageSize.selectedIds;
		pageSize = nextPageSize.pageSize;
		currentPage = nextPageSize.currentPage;
		loadItems();
	}

	function handleSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			selectedIds = createEmptySelection();
			currentPage = 1;
			loadItems();
		}, 500);
	}

	const handleFileDelete = async (id: number) => {
		// API call handles complete deletion (R2 bucket files + database records)
		try {
			const response = await fetch(`/api/simFile/delete/${id}`, {
				method: 'DELETE'
			});
			if (!response.ok) {
				// Safely parse error response, handling non-JSON responses
				let errorData: unknown;
				try {
					errorData = await response.json();
				} catch {
					errorData = await response.text();
				}
				console.error('Failed to delete R2 files:', errorData);
				toastStore.error({
					title: 'Failed to delete chart files',
					duration: 3000
				});
				return; // Abort if R2 deletion fails
			}

			// Check if some R2 files failed to delete (partial deletion)
			const deleteResult = await response.json();
			if (deleteResult.partialDeletion) {
				console.warn('Partial deletion: some R2 files could not be removed', deleteResult);
				await loadItems();
				toastStore.error({
					title: 'Chart deleted from library, but some files may remain in storage. Please contact support.',
					duration: 6000
				});
				return;
			}
		} catch (error) {
			console.error('Failed to delete R2 files:', error);
			toastStore.error({
				title: 'Failed to delete chart files',
				duration: 3000
			});
			return; // Abort if R2 deletion fails
		}

		// filteredItems is derived reactively from items via $effect, so no manual update needed
		await loadItems();
		toastStore.success({
			title: 'Chart deleted',
			duration: 3000
		});
	};

	const handleToggleSelect = (id: number) => {
		const next = new Set(selectedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			if (next.size >= MAX_BULK_DOWNLOAD_CHARTS) {
				toastStore.error({
					title: `You can download up to ${MAX_BULK_DOWNLOAD_CHARTS} charts at once`,
					duration: 3000
				});
				return;
			}
			next.add(id);
		}
		selectedIds = next;
	};

	const clearBulkSelection = () => {
		selectMode = false;
		selectedIds = createEmptySelection();
	};

	const handleBulkDownload = async () => {
		if (selectedIds.size === 0) return;
		if (!supportsBulkDownloadStreaming) {
			toastStore.error({
				title: BULK_DOWNLOAD_UNSUPPORTED_MESSAGE,
				duration: 4000
			});
			clearBulkSelection();
			return;
		}
		if (selectedIds.size > MAX_BULK_DOWNLOAD_CHARTS) {
			toastStore.error({
				title: `You can download up to ${MAX_BULK_DOWNLOAD_CHARTS} charts at once`,
				duration: 3000
			});
			return;
		}
		bulkDownloading = true;
		try {
			await startBulkDownload({
				ids: [...selectedIds],
				fetchFn: fetch,
				saveFilePickerWindow: window as SaveFilePickerWindow
			});
		} catch (error) {
			if (isAbortError(error)) {
				return;
			}

			console.error('Failed to start bulk download:', error);
			toastStore.error({
				title: error instanceof Error ? error.message : 'Bulk download failed',
				duration: 3000
			});
			clearBulkSelection();
		} finally {
			bulkDownloading = false;
		}
	};

	onDestroy(() => {
		clearTimeout(searchTimeout);
	});

	onMount(() => {
		supportsBulkDownloadStreaming = checkBulkDownloadStreaming(window as SaveFilePickerWindow);
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
					<div
						class="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-300"
					>
						<span>Hide unpublished:</span>
						<Switch
							checked={hideUnpublished}
							onCheckedChange={(e) => (hideUnpublished = e.checked)}
							classes="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-600 transition-colors focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none data-[checked]:bg-purple-600"
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

				{#if isBlog && enableDownload && supportsBulkDownloadStreaming}
					<!-- Multi-select controls -->
					<button
						class="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-200 {selectMode
							? 'border-purple-500 bg-purple-600/20 text-purple-300'
							: 'border-purple-500/30 bg-slate-800/50 text-slate-300 hover:bg-purple-600/20 hover:text-purple-300'}"
						onclick={() => {
							selectMode = !selectMode;
							selectedIds = createEmptySelection();
						}}
						aria-pressed={selectMode}
					>
						{selectMode ? 'Cancel' : 'Select'}
					</button>
					{#if selectMode && selectedIds.size > 0}
						<button
							class="inline-flex items-center gap-2 rounded-lg bg-linear-to-r from-purple-600 to-cyan-600 px-3 py-2 text-sm font-medium text-white shadow-lg transition-all duration-200 hover:shadow-xl disabled:opacity-50"
							onclick={handleBulkDownload}
							disabled={bulkDownloading ||
								selectedIds.size > MAX_BULK_DOWNLOAD_CHARTS}
						>
							{bulkDownloading ? 'Downloading…' : `Download (${selectedIds.size})`}
						</button>
					{/if}
				{/if}

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
			<div
				class="music-card group relative z-0 p-6 transition-all duration-300 focus-within:z-30 hover:z-30 hover:scale-[1.02]"
			>
				<div class="flex items-start justify-between">
					<div class="flex-1">
						<div class="mb-3 flex items-center gap-3">
							<div
								class="h-2 w-2 rounded-full bg-linear-to-r from-purple-400 to-cyan-400"
							></div>
							<h3
								class="text-lg font-semibold text-slate-100 transition-colors group-hover:text-purple-300"
							>
								{#if item.has_uploaded_files === true}
									<a
										href={`/editor/${item.id}`}
										class="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-400"
									>
										{item.display_id}. {item.title}
									</a>
								{:else}
									{item.display_id}. {item.title}
								{/if}
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
											class="rounded-full border border-purple-500/30 bg-linear-to-r from-purple-600/30 to-cyan-600/30 px-2 py-1 text-xs text-purple-200"
										>
											{level}
										</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
					<div class="ml-4 flex items-center gap-2">
						{#if selectMode && isBlog && enableDownload && canBulkSelect(item)}
							<label>
								<input
									type="checkbox"
									checked={selectedIds.has(item.id)}
									onchange={() => handleToggleSelect(item.id)}
									aria-label="Select {item.title}"
									class="h-4 w-4 cursor-pointer rounded border-slate-500 bg-slate-700 text-purple-600 focus:ring-purple-500"
								/>
							</label>
						{/if}
						<ChartListTableItem
							{item}
							{isBlog}
							{enableDownload}
							{togglePublishChart}
							onFileDelete={handleFileDelete}
						/>
					</div>
				</div>
			</div>
		{/each}
	</div>
{:else if viewMode === 'card'}
	<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each filteredItems as item (item.id)}
			<div
				class="relative z-0 transition-all duration-300 focus-within:z-30 hover:z-30 hover:scale-105"
			>
				{#if selectMode && isBlog && enableDownload && canBulkSelect(item)}
					<label class="absolute top-3 left-3 z-10 cursor-pointer">
						<input
							type="checkbox"
							checked={selectedIds.has(item.id)}
							onchange={() => handleToggleSelect(item.id)}
							aria-label="Select {item.title}"
							class="h-4 w-4 rounded border-slate-500 bg-slate-700 text-purple-600 focus:ring-purple-500"
						/>
					</label>
				{/if}
				<ChartListItem
					{item}
					{isBlog}
					{enableDownload}
					{togglePublishChart}
					onFileDelete={handleFileDelete}
					simfileBucketUrl={PUBLIC_SIMFILE_BUCKET_URL}
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
				buttonActive="bg-linear-to-r from-purple-600 to-cyan-600 text-white shadow-lg hover:shadow-xl"
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
