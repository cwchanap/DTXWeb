<script lang="ts">
	import { FolderTree, Check } from '@lucide/svelte';
	import { workspaceService } from '../services/workspaceService';

	interface Props {
		subWorkspace: string;
		isActive: boolean;
	}

	let { subWorkspace, isActive }: Props = $props();

	const handleSelectSubWorkspace = async () => {
		try {
			if (isActive) {
				// If already active, deselect it
				await workspaceService.setCurrentSubWorkspace(null);
			} else {
				// Select this sub-workspace
				await workspaceService.setCurrentSubWorkspace(subWorkspace);
			}
		} catch (error) {
			console.error('Error selecting sub-workspace:', error);
		}
	};

	// Remove the DTXFiles. prefix for display
	const displayName = subWorkspace.replace(/^DTXFiles\./, '');
</script>

<button
	class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 transition-all hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/50 {isActive
		? 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
		: ''}"
	onclick={handleSelectSubWorkspace}
	tabindex="0"
	aria-label={`${isActive ? 'Deselect' : 'Select'} sub-workspace ${displayName}`}
>
	<div class="flex items-center gap-2">
		<FolderTree size={20} class="text-green-500 dark:text-green-400" />
		{#if isActive}
			<Check size={16} class="text-blue-500 dark:text-blue-400" />
		{/if}
	</div>

	<div class="flex-1 text-left">
		<div class="font-medium text-slate-700 dark:text-slate-300">{displayName}</div>
		<div class="text-xs text-slate-500 dark:text-slate-400">Sub-workspace</div>
	</div>
</button>
