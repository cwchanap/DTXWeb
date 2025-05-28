<script lang="ts">
	import { simFileStore } from '../stores/simFileStore';
	import { simFileService } from '../services/simFileService';
	import { RefreshCw, Music, Calendar, User } from '@lucide/svelte';

	// Subscribe to the simFile store
	$: simFileState = $simFileStore;

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
</script>

<div class="simfile-list p-4">
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-xl font-bold text-slate-800 dark:text-slate-100">
			My SimFiles ({simFileState.userSimFiles.length})
		</h2>
		<div class="flex items-center gap-2">
			{#if simFileState.fromCache}
				<span class="text-sm text-slate-500 dark:text-slate-400"> Cached data </span>
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
	{:else}
		<div class="grid gap-3">
			{#each simFileState.userSimFiles as simFile (simFile.id)}
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
	{/if}

	{#if simFileState.lastUpdated}
		<div class="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
			Last updated: {simFileState.lastUpdated.toLocaleString()}
		</div>
	{/if}
</div>

<style>
	.simfile-list {
		max-height: 400px;
		overflow-y: auto;
	}
</style>
