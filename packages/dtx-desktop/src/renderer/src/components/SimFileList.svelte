<script lang="ts">
	import { simFileStore } from '../stores/simFileStore';
	import { simFileService } from '../services/simFileService';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { RefreshCw, Music, Calendar, User, Link, Search, X } from '@lucide/svelte';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import { formatLevel } from '@dtx/common';

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
		<h2 class="font-display text-hi text-xl font-bold">
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
				<span class="text-dim text-sm"> Cached data </span>
			{/if}

			<!-- Page Size Selector -->
			{#if filteredSimFiles.length > 5}
				<select
					bind:value={pageSize}
					onchange={() => handlePageSizeChange({ pageSize })}
					class="border-hairline bg-surface-2 text-base-text rounded border px-2 py-1 text-sm"
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
				class="bg-magenta flex items-center gap-1 rounded px-3 py-1 text-sm text-[#16001a] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
				style="box-shadow:0 0 22px -6px var(--color-magenta)"
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
				<Search size={16} class="text-faint" />
			</div>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Search by song title or artist..."
				class="border-hairline bg-surface-1 text-base-text placeholder-faint focus:border-cyan focus:ring-cyan/20 w-full rounded-lg border py-2 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
			/>
			{#if searchQuery}
				<button
					onclick={() => (searchQuery = '')}
					class="text-faint hover:text-dim absolute inset-y-0 right-0 flex items-center pr-3"
					aria-label="Clear search"
				>
					<X size={16} />
				</button>
			{/if}
		</div>
	</div>

	{#if simFileState.isLoading}
		<div class="flex items-center justify-center py-8">
			<div class="text-dim flex items-center gap-2">
				<RefreshCw size="16" class="animate-spin" />
				Loading simFiles...
			</div>
		</div>
	{:else if simFileState.error}
		<div class="border-red/40 bg-red/10 rounded-lg border p-4">
			<div class="text-red flex items-center gap-2">
				<span class="font-medium">Error:</span>
				{simFileState.error}
			</div>
		</div>
	{:else if simFileState.userSimFiles.length === 0}
		<div class="text-dim py-8 text-center">
			<Music size="48" class="mx-auto mb-2 opacity-50" />
			<p>No simFiles found</p>
			<p class="text-sm">Upload some simFiles to get started</p>
		</div>
	{:else if filteredSimFiles.length === 0 && searchQuery.trim()}
		<div class="text-dim py-8 text-center">
			<Search size="48" class="mx-auto mb-2 opacity-50" />
			<p>No simFiles found for "{searchQuery}"</p>
			<p class="text-sm">Try a different search term</p>
		</div>
	{:else}
		<div class="grid gap-3">
			{#each paginatedSimFiles as simFile (simFile.id)}
				<div
					class="border-hairline bg-surface-1 focus-visible:ring-cyan/40 cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2"
					role="button"
					tabindex="0"
					aria-label="View details for {simFile.title} by {simFile.artist}"
					onclick={() => workspaceStore.selectCloudSimFile(simFile)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							workspaceStore.selectCloudSimFile(simFile);
						}
					}}
				>
					<div class="flex items-start justify-between">
						<div class="flex-1">
							<h3 class="text-hi mb-1 font-semibold">
								{simFile.title}
							</h3>
							<div class="text-base-text flex items-center gap-4 text-sm">
								<div class="flex items-center gap-1">
									<User size="14" />
									{simFile.artist}
								</div>
								<div class="flex items-center gap-1 font-mono">
									<Music size="14" />
									{simFile.bpm} BPM
								</div>
								{#if simFile.publishDate}
									<div class="flex items-center gap-1">
										<Calendar size="14" />
										{formatDate(simFile.publishDate)}
									</div>
								{/if}
							</div>
							{#if simFile.dtxFiles && simFile.dtxFiles.length > 0}
								<div class="mt-2">
									<span class="text-dim text-xs">
										Levels: {simFile.dtxFiles
											.map((f) => formatLevel(f.level))
											.join(', ')}
									</span>
								</div>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							{#if isSimFileLinked(simFile.id)}
								<span
									class="border-cyan/40 bg-cyan/10 text-cyan flex items-center gap-1 rounded px-2 py-1 text-xs"
								>
									<Link size="12" />
									Linked
								</span>
							{/if}
							{#if simFile.isPublished}
								<span
									class="border-green/40 bg-green/10 text-green rounded px-2 py-1 text-xs"
								>
									Published
								</span>
							{:else}
								<span class="bg-surface-2 text-dim rounded px-2 py-1 text-xs">
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
		<div class="text-faint mt-4 text-center text-xs">
			Last updated: {simFileState.lastUpdated.toLocaleString()}
		</div>
	{/if}
</div>
