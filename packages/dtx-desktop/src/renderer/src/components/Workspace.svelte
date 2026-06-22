<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { workspaceService } from '../services/workspaceService';
	import { Folder, FolderOpen, Loader, RefreshCw, X, Plus, Search } from '@lucide/svelte';
	import WorkspaceTree from './WorkspaceTree.svelte';
	import SubWorkspaceItem from './SubWorkspaceItem.svelte';
	import WorkspaceBookmarksMenu from './WorkspaceBookmarksMenu.svelte';

	let isLoading = $state(false);
	let workspacePath = $state('');
	let currentSubWorkspace = $state<string | null>(null);
	let subWorkspaces = $state<string[]>([]);
	let treeStructure = $state<TreeNode[]>([]);
	let error = $state('');
	let searchQuery = $state('');

	// Subscribe to the workspace store
	const unsubscribe = workspaceStore.subscribe((state) => {
		workspacePath = state.path || '';
		currentSubWorkspace = state.currentSubWorkspace;
		subWorkspaces = state.subWorkspaces;
		treeStructure = state.treeStructure;
		isLoading = state.isLoading;
		error = state.error || '';
	});

	const handleSelectWorkspace = async () => {
		await workspaceService.selectWorkspace();
	};

	// Handle refreshing the workspace
	const handleRefreshWorkspace = async () => {
		await workspaceService.loadSubWorkspaces();
		await workspaceService.loadTreeStructure();
	};

	// Handle clearing the workspace
	const handleClearWorkspace = () => {
		workspaceService.clearWorkspace();
	};

	// Handle creating a new song
	const handleNewSong = () => {
		workspaceStore.showNewSongForm();
	};

	// Filter tree nodes based on search query
	const filterTreeNodes = (nodes: TreeNode[], query: string): TreeNode[] => {
		if (!query.trim()) return nodes;

		const searchTerm = query.toLowerCase();

		const filterNode = (node: TreeNode): TreeNode | null => {
			// Check if node matches search criteria
			const nameMatches = node.name.toLowerCase().includes(searchTerm);
			const songTitleMatches = node.songTitle?.toLowerCase().includes(searchTerm) || false;
			const matches = nameMatches || songTitleMatches;

			// Filter children recursively
			const filteredChildren = node.children
				.map((child) => filterNode(child))
				.filter((child) => child !== null);

			// Include node if it matches or has matching children
			if (matches || filteredChildren.length > 0) {
				return {
					...node,
					children: filteredChildren,
					// Auto-expand nodes that have matching children
					isExpanded: filteredChildren.length > 0 || node.isExpanded
				};
			}

			return null;
		};

		return nodes.map((node) => filterNode(node)).filter((node) => node !== null);
	};

	// Get filtered tree structure
	const filteredTreeStructure = $derived(filterTreeNodes(treeStructure, searchQuery));

	// Load workspace data on mount if a path is already set
	onMount(() => {
		if (workspacePath) {
			void workspaceService.loadSubWorkspaces();
			void workspaceService.loadTreeStructure();
		}

		return () => {
			unsubscribe();
		};
	});
</script>

<div class="bg-surface-1 flex h-full flex-col p-6">
	<!-- Header row: title + (when workspacePath) New Song / Refresh / Clear buttons -->
	<div class="mb-4 flex items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<Folder size={20} class="text-magenta" />
			<h2 class="font-display text-hi text-lg font-semibold tracking-wide">Library</h2>
		</div>
		{#if workspacePath}
			<div class="flex gap-2">
				<button
					class="bg-magenta font-display flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-semibold text-[#16001a]"
					style="box-shadow:0 0 22px -6px var(--color-magenta)"
					onclick={handleNewSong}
					tabindex="0"
					aria-label="Create new song"
				>
					<Plus size={14} />
					New Song
				</button>
				<button
					class="border-hairline bg-surface-2 text-dim hover:text-hi flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
					onclick={handleRefreshWorkspace}
					tabindex="0"
					aria-label="Refresh workspace"
				>
					<RefreshCw size={14} />
				</button>
				<button
					class="border-hairline bg-surface-2 text-dim hover:text-hi flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
					onclick={handleClearWorkspace}
					tabindex="0"
					aria-label="Clear workspace"
				>
					<X size={14} />
				</button>
			</div>
		{/if}
	</div>

	<!-- Content states -->
	{#if isLoading}
		<div class="flex flex-col items-center py-8">
			<div class="relative flex h-16 w-16 items-center justify-center">
				<Loader size={40} class="text-magenta animate-spin" />
			</div>
			<p class="text-dim mt-4">Loading workspace...</p>
		</div>
	{:else if error}
		<div class="border-hairline bg-surface-2 text-red rounded-lg border p-4">
			<p>{error}</p>
			<div class="mt-2 flex flex-wrap gap-2">
				<button
					class="border-hairline bg-surface-2 text-dim hover:text-hi rounded px-3 py-1 text-sm font-medium transition-colors"
					onclick={handleSelectWorkspace}
					tabindex="0"
					aria-label="Try again"
				>
					Try Again
				</button>
			</div>
		</div>
	{:else if !workspacePath}
		<div class="flex flex-col items-center py-8">
			<div
				class="bg-surface-2 border-hairline mb-4 flex h-20 w-20 items-center justify-center rounded-full border"
			>
				<FolderOpen size={40} class="text-magenta" />
			</div>
			<p class="text-dim mb-6 text-center">
				Select a root folder for your DTX files workspace
			</p>
			<div class="flex items-center gap-3">
				<button
					class="bg-magenta font-display flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-[#16001a]"
					style="box-shadow:0 0 22px -6px var(--color-magenta)"
					onclick={handleSelectWorkspace}
					tabindex="0"
					aria-label="Select workspace folder"
				>
					<Folder size={18} />
					Select Folder
				</button>
				<WorkspaceBookmarksMenu />
			</div>
		</div>
	{:else}
		<!-- Workspace Content -->
		<div class="mb-4">
			<WorkspaceBookmarksMenu />
		</div>

		<!-- Search Filter -->
		<div class="mb-4">
			<div class="relative">
				<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
					<Search size={16} class="text-dim" />
				</div>
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Search songs and folders..."
					class="border-hairline bg-surface-2 text-hi placeholder-dim focus:border-magenta w-full rounded-lg border py-2 pr-4 pl-10 text-sm focus:outline-none"
				/>
				{#if searchQuery}
					<button
						onclick={() => (searchQuery = '')}
						class="text-dim hover:text-hi absolute inset-y-0 right-0 flex items-center pr-3 transition-colors"
						aria-label="Clear search"
					>
						<X size={16} />
					</button>
				{/if}
			</div>
		</div>

		<!-- Sub-workspaces Section -->
		{#if subWorkspaces.length > 0}
			<div class="mb-4">
				<div class="space-y-1">
					{#each subWorkspaces as subWorkspace}
						<SubWorkspaceItem
							{subWorkspace}
							isActive={currentSubWorkspace === subWorkspace}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tree Structure Section -->
		<div class="mb-6">
			<h3 class="text-hi mb-3 text-base font-medium">
				{currentSubWorkspace
					? `Tree: ${currentSubWorkspace.replace(/^DTXFiles\./, '')}`
					: 'Workspace Tree'}
			</h3>
			<div class="text-dim mb-2 text-sm">
				{currentSubWorkspace
					? 'Showing contents of selected sub-workspace'
					: 'Showing all folders in workspace'}
			</div>
			{#if filteredTreeStructure.length > 0}
				<div class="border-hairline bg-surface-2 rounded-lg border p-3">
					<WorkspaceTree nodes={filteredTreeStructure} />
				</div>
			{:else if searchQuery.trim()}
				<div
					class="border-hairline bg-surface-2 text-dim rounded-lg border p-3 text-center text-sm"
				>
					No results found for "{searchQuery}"
				</div>
			{:else}
				<div
					class="border-hairline bg-surface-2 text-dim rounded-lg border p-3 text-center text-sm"
				>
					No folders found
				</div>
			{/if}
		</div>
	{/if}
</div>
