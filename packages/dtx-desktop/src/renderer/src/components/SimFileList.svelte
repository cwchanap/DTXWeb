<script lang="ts">
	import { simFileStore } from '../stores/simFileStore';
	import { simFileService } from '../services/simFileService';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { RefreshCw, Music, Calendar, User, Link, Search, X } from '@lucide/svelte';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';

	// Subscribe to the simFile store
	let simFileState = $derived($simFileStore);
	let workspaceState = $derived($workspaceStore);

	// Pagination state
	let currentPage = $state(1);
	let pageSize = $state(10);

	// Search state
	let searchQuery = $state('');

	// Filter simFiles based on search query
	const filteredSimFiles = $derived.by(() => {
		if (!searchQuery.trim()) return simFileState.userSimFiles;

		const searchTerm = searchQuery.toLowerCase();
		return simFileState.userSimFiles.filter(
			(simFile) =>
				simFile.title.toLowerCase().includes(searchTerm) ||
				simFile.artist.toLowerCase().includes(searchTerm)
		);
	});

	// Calculate paginated data using filtered results
	let paginatedSimFiles = $derived(sliceData(filteredSimFiles, currentPage, pageSize));
	let totalPages = $derived(Math.ceil(filteredSimFiles.length / pageSize));

	// Function to slice data for current page
	function sliceData<T>(data: T[], page: number, size: number): T[] {
		const start = (page - 1) * size;
		const end = start + size;
		return data.slice(start, end);
	}

	// Handle page changes
	function handlePageChange(event: { page: number }) {
		currentPage = event.page;
	}

	// Handle page size changes
	function handlePageSizeChange(event: { pageSize: number }) {
		pageSize = event.pageSize;
		currentPage = 1; // Reset to first page when page size changes
	}

	// Reset to first page when search query changes
	$effect(() => {
		if (searchQuery) {
			currentPage = 1;
		}
	});

	// Function to refresh simFile data
	async function refreshSimFiles() {
		try {
			simFileStore.setLoading(true);
			const result = await simFileService.refreshUserSimFiles();

			if (result.error) {
				simFileStore.setError(result.error);
			} else {
				simFileStore.setUserSimFiles(result.data, result.fromCache);
			}
		} catch (error) {
			console.error('Failed to refresh simFiles:', error);
			simFileStore.setError(
				error instanceof Error ? error.message : 'Failed to refresh simFiles'
			);
		}
	}

	// Format date for display
	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString();
	}

	// Check if a simFile is linked to any local folder
	function isSimFileLinked(simFileId: number): boolean {
		if (!workspaceState.treeStructure) return false;

		const checkNodes = (nodes: TreeNode[]): boolean => {
			for (const node of nodes) {
				if (
					node.linkedSimFileId !== undefined &&
					String(node.linkedSimFileId) === String(simFileId)
				) {
					return true;
				}
				if (node.children && node.children.length > 0) {
					if (checkNodes(node.children)) {
						return true;
					}
				}
			}
			return false;
		};

		return checkNodes(workspaceState.treeStructure);
	}
</script>

<div class="simfile-list p-4">
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-xl font-bold text-slate-800 dark:text-slate-100">
			My SimFiles
			{#if searchQuery.trim()}
				({filteredSimFiles.length} of {simFileState.userSimFiles.length} found, showing {paginatedSimFiles.length}
				on page {currentPage} of {totalPages})
			{:else}
				({simFileState.userSimFiles.length} total, showing {paginatedSimFiles.length} on page
				{currentPage} of {totalPages})
			{/if}
		</h2>
		<div class="flex items-center gap-2">
			{#if simFileState.fromCache}
				<span class="text-sm text-slate-500 dark:text-slate-400"> Cached data </span>
			{/if}

			<!-- Page Size Selector -->
			{#if filteredSimFiles.length > 5}
				<select
					bind:value={pageSize}
					onchange={() => handlePageSizeChange({ pageSize })}
					class="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-700"
				>
					<option value={5}>5 per page</option>
					<option value={10}>10 per page</option>
					<option value={20}>20 per page</option>
					<option value={50}>50 per page</option>
				</select>
			{/if}

			<button
				onclick={refreshSimFiles}
				disabled={simFileState.isLoading}
				class="flex items-center gap-1 rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				<RefreshCw size="14" class={simFileState.isLoading ? 'animate-spin' : ''} />
				Refresh
			</button>
		</div>
	</div>

	<!-- Search Filter -->
	<div class="mb-4">
		<div class="relative">
			<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
				<Search size={16} class="text-slate-400" />
			</div>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search by song title or artist..."
				class="w-full rounded-lg border border-slate-200 bg-white py-2 pr-4 pl-10 text-sm placeholder-slate-400 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white"
			/>
			{#if searchQuery}
				<button
					onclick={() => (searchQuery = '')}
					class="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
					aria-label="Clear search"
				>
					<X size={16} />
				</button>
			{/if}
		</div>
	</div>

	{#if simFileState.isLoading}
		<div class="flex items-center justify-center py-8">
			<div class="flex items-center gap-2 text-slate-600 dark:text-slate-300">
				<RefreshCw size="16" class="animate-spin" />
				Loading simFiles...
			</div>
		</div>
	{:else if simFileState.error}
		<div
			class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
		>
			<div class="flex items-center gap-2 text-red-700 dark:text-red-300">
				<span class="font-medium">Error:</span>
				{simFileState.error}
			</div>
		</div>
	{:else if simFileState.userSimFiles.length === 0}
		<div class="py-8 text-center text-slate-500 dark:text-slate-400">
			<Music size="48" class="mx-auto mb-2 opacity-50" />
			<p>No simFiles found</p>
			<p class="text-sm">Upload some simFiles to get started</p>
		</div>
	{:else if filteredSimFiles.length === 0 && searchQuery.trim()}
		<div class="py-8 text-center text-slate-500 dark:text-slate-400">
			<Search size="48" class="mx-auto mb-2 opacity-50" />
			<p>No simFiles found for "{searchQuery}"</p>
			<p class="text-sm">Try a different search term</p>
		</div>
	{:else}
		<div class="grid gap-3">
			{#each paginatedSimFiles as simFile (simFile.id)}
				<div
					class="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
				>
					<div class="flex items-start justify-between">
						<div class="flex-1">
							<h3 class="mb-1 font-semibold text-slate-800 dark:text-slate-100">
								{simFile.title}
							</h3>
							<div
								class="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-300"
							>
								<div class="flex items-center gap-1">
									<User size="14" />
									{simFile.artist}
								</div>
								<div class="flex items-center gap-1">
									<Music size="14" />
									{simFile.bpm} BPM
								</div>
								{#if simFile.publish_date}
									<div class="flex items-center gap-1">
										<Calendar size="14" />
										{formatDate(simFile.publish_date)}
									</div>
								{/if}
							</div>
							{#if simFile.dtx_files && simFile.dtx_files.length > 0}
								<div class="mt-2">
									<span class="text-xs text-slate-500 dark:text-slate-400">
										Levels: {simFile.dtx_files.map((f) => f.level).join(', ')}
									</span>
								</div>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							{#if isSimFileLinked(simFile.id)}
								<span
									class="flex items-center gap-1 rounded bg-blue-100 px-2 py-1 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
								>
									<Link size="12" />
									Linked
								</span>
							{/if}
							{#if simFile.is_published}
								<span
									class="rounded bg-green-100 px-2 py-1 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300"
								>
									Published
								</span>
							{:else}
								<span
									class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
								>
									Draft
								</span>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination Component -->
		{#if filteredSimFiles.length > pageSize}
			<div class="mt-6 flex justify-center">
				<Pagination
					data={filteredSimFiles}
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
				/>
			</div>
		{/if}
	{/if}

	{#if simFileState.lastUpdated}
		<div class="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
			Last updated: {simFileState.lastUpdated.toLocaleString()}
		</div>
	{/if}
</div>
