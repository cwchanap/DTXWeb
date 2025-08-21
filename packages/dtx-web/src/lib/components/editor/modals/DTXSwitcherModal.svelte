<script lang="ts">
	import { Modal } from '@dtx/ui-components/components';
	import type { Workspace } from '$lib/services/workspaceService';

	interface Props {
		show: boolean;
		currentWorkspace: Workspace | null;
		onSwitchDTX: (dtxFileName: string) => void;
		onClose: () => void;
	}

	let { show = $bindable(), currentWorkspace, onSwitchDTX, onClose }: Props = $props();

	function handleSwitchDTX(dtxFileName: string) {
		onSwitchDTX(dtxFileName);
		show = false;
	}
</script>

<Modal bind:open={show} title="Switch DTX File">
	{#snippet children()}
		{#if currentWorkspace}
			<div class="space-y-4">
				<p class="text-gray-700">Select a DTX file from the current workspace:</p>
				<div class="max-h-64 space-y-2 overflow-y-auto">
					{#each currentWorkspace.dtxFiles as dtxFile}
						<button
							class="w-full rounded-lg border p-3 text-left transition-colors {currentWorkspace.currentDTX ===
							dtxFile.name
								? 'border-blue-500 bg-blue-50'
								: 'border-gray-200 hover:bg-gray-50'}"
							onclick={() => handleSwitchDTX(dtxFile.name)}
						>
							<div class="font-medium text-gray-900">{dtxFile.name}</div>
							<div class="text-sm text-gray-500">{dtxFile.path}</div>
							{#if currentWorkspace.currentDTX === dtxFile.name}
								<div class="mt-1 text-xs font-medium text-blue-600">
									Currently active
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	{/snippet}
</Modal>
