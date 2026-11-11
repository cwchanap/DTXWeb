<script lang="ts">
	import { Modal } from '@dtx/ui-components/components';
	import { workspaceService, type Workspace } from '$lib/services/workspaceService';
	import { TempChartStorage } from '$lib/services/tempChartStorage';
	import { EventBus } from '@dtx/common/game';
	import { EventType } from '@dtx/common/game';
	import store from '$lib/store';
	import { get } from 'svelte/store';

	interface Props {
		show: boolean;
		onSwitchDTX?: () => Promise<void>;
	}

	let { show = $bindable(), onSwitchDTX }: Props = $props();

	// Internal state management
	let currentWorkspace = $state<Workspace | null>(workspaceService.getCurrentWorkspace());

	// Refresh workspace when modal opens
	$effect(() => {
		if (show) {
			currentWorkspace = workspaceService.getCurrentWorkspace();
		}
	});

	async function switchWorkspaceDTX(dtxPath: string) {
		if (!currentWorkspace) return;

		try {
			// Stop any existing preview to ensure clean re-draw when switching DTX files
			EventBus.emit(EventType.STOP_PREVIEW);

			const result = await workspaceService.parseDTXFile(currentWorkspace, dtxPath);
			if (!result) {
				console.error('Failed to parse DTX file:', dtxPath);
				return;
			}

			const { dtxFile, simFile } = result;

			// Parse notes and BPM changes
			const notes = dtxFile.parseNotes();
			const bpmNotes = dtxFile.parseBPMChanges();
			const soundChips = dtxFile.parseSoundChips();

			// Update stores. Clear the remote id before publishing the new chips so
			// Preview does not resolve them against the previous remote simfile.
			store.currentDtxFile.set(dtxFile);
			store.currentSimfile.set(simFile);
			store.currentSimfileID.set(null); // Local workspace
			store.currentSoundChip.set(soundChips);
			const dtxName =
				currentWorkspace.dtxFiles.find((file) => file.path === dtxPath)?.name ?? dtxPath;
			store.currentDifficulty.set(dtxName.replace(/\.dtx$/i, ''));

			// Switch workspace current DTX
			workspaceService.switchDTXFile(currentWorkspace, dtxPath);

			// Clear any existing temp data
			TempChartStorage.remove(null, get(store.currentDifficulty));

			// Emit note import event
			EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);

			// Call parent callback if provided and wait for completion
			if (onSwitchDTX) {
				await onSwitchDTX();
			}

			// Close modal
			show = false;
		} catch (error) {
			console.error('Error switching DTX file:', error);
		}
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
							dtxFile.path
								? 'border-blue-500 bg-blue-50'
								: 'border-gray-200 hover:bg-gray-50'}"
							onclick={() => switchWorkspaceDTX(dtxFile.path)}
						>
							<div class="font-medium text-gray-900">{dtxFile.name}</div>
							<div class="text-sm text-gray-500">{dtxFile.path}</div>
							{#if currentWorkspace.currentDTX === dtxFile.path}
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
