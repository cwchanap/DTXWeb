<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceStore } from '../stores/workspaceStore';
	import { workspaceService } from '../services/workspaceService';
	import { Folder, FolderOpen, Loader, RefreshCw, X } from '@lucide/svelte';

	let isLoading = $state(false);
	let workspacePath = $state('');
	let folders = $state<string[]>([]);
	let error = $state('');

	// Subscribe to the workspace store
	const unsubscribe = workspaceStore.subscribe((state) => {
		workspacePath = state.path || '';
		folders = state.folders;
		isLoading = state.isLoading;
		error = state.error || '';
	});

	// Handle selecting a workspace
	const handleSelectWorkspace = async () => {
		await workspaceService.selectWorkspace();
	};

	// Handle refreshing the workspace folders
	const handleRefreshWorkspace = async () => {
		await workspaceService.loadWorkspaceFolders();
	};

	// Handle clearing the workspace
	const handleClearWorkspace = () => {
		workspaceService.clearWorkspace();
	};

	// Load workspace folders on mount if a path is already set
	onMount(() => {
		if (workspacePath) {
			void workspaceService.loadWorkspaceFolders();
		}

		return unsubscribe;
	});
</script>

<div class="rounded-xl bg-white p-6 shadow-md dark:bg-slate-800">
	<div
		class="mb-4 flex items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-700"
	>
		<div class="flex items-center gap-2">
			<Folder size={20} class="text-slate-500" />
			<h2 class="text-xl font-semibold">DTX Workspace</h2>
		</div>
		{#if workspacePath}
			<div class="flex gap-2">
				<button
					class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
					onclick={handleRefreshWorkspace}
					tabindex="0"
					aria-label="Refresh workspace"
				>
					<RefreshCw size={16} />
				</button>
				<button
					class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
					onclick={handleClearWorkspace}
					tabindex="0"
					aria-label="Clear workspace"
				>
					<X size={16} />
				</button>
			</div>
		{/if}
	</div>

	{#if isLoading}
		<div class="flex flex-col items-center py-8">
			<div class="relative flex h-16 w-16 items-center justify-center">
				<Loader size={40} class="animate-spin text-blue-500" />
			</div>
			<p class="mt-4 text-slate-600 dark:text-slate-400">Loading workspace...</p>
		</div>
	{:else if error}
		<div class="rounded-lg bg-red-50 p-4 text-red-800 dark:bg-red-900/20 dark:text-red-300">
			<p>{error}</p>
			<button
				class="mt-2 rounded bg-red-100 px-3 py-1 text-sm font-medium text-red-800 hover:bg-red-200 dark:bg-red-800/30 dark:text-red-200 dark:hover:bg-red-800/50"
				onclick={handleSelectWorkspace}
				tabindex="0"
				aria-label="Try again"
			>
				Try Again
			</button>
		</div>
	{:else if !workspacePath}
		<div class="flex flex-col items-center py-8">
			<div
				class="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
			>
				<FolderOpen size={40} class="text-blue-500 dark:text-blue-300" />
			</div>
			<p class="mb-6 text-center text-slate-600 dark:text-slate-400">
				Select a root folder for your DTX files workspace
			</p>
			<button
				class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-2.5 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-blue-600 hover:to-indigo-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
				onclick={handleSelectWorkspace}
				tabindex="0"
				aria-label="Select workspace folder"
			>
				<Folder size={20} />
				Select Folder
			</button>
		</div>
	{:else}
		<div class="mb-4">
			<div class="mb-2 flex items-center">
				<span class="mr-2 text-sm font-medium text-slate-500 dark:text-slate-400"
					>Current workspace:</span
				>
				<span class="rounded bg-slate-100 px-2 py-1 font-mono text-sm dark:bg-slate-700">
					{workspacePath}
				</span>
			</div>
			<button
				class="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
				onclick={handleSelectWorkspace}
				tabindex="0"
				aria-label="Change workspace folder"
			>
				Change folder
			</button>
		</div>

		{#if folders.length > 0}
			<div>
				<h3 class="mb-2 text-lg font-medium">Folders</h3>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
					{#each folders as folder}
						<button
							class="flex cursor-pointer flex-col items-center rounded-lg border border-slate-200 p-3 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50"
							tabindex="0"
							aria-label={`Open folder ${folder}`}
						>
							<Folder size={24} class="mb-2 text-blue-500 dark:text-blue-400" />
							<span class="w-full truncate text-center text-sm">{folder}</span>
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<div
				class="rounded-lg bg-slate-50 p-4 text-slate-700 dark:bg-slate-700/30 dark:text-slate-300"
			>
				<p>No folders found in the selected workspace.</p>
			</div>
		{/if}
	{/if}
</div>
