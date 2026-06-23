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
	let displayName = $derived(subWorkspace.replace(/^DTXFiles\./, ''));
</script>

<button
	class="border-hairline hover:bg-surface-2 flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all {isActive
		? 'border-cyan/40 bg-cyan/10'
		: ''}"
	onclick={handleSelectSubWorkspace}
	aria-label={`${isActive ? 'Deselect' : 'Select'} sub-workspace ${displayName}`}
>
	<div class="flex items-center gap-2">
		<FolderTree size={20} class="text-green" />
		{#if isActive}
			<Check size={16} class="text-cyan" />
		{/if}
	</div>

	<div class="flex-1 text-left">
		<div class="text-base-text font-medium">{displayName}</div>
	</div>
</button>
