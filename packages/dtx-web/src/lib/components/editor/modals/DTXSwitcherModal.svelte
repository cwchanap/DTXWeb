<script lang="ts">
	import { Modal } from '@dtx/ui-components/components';
	import { workspaceService, type Workspace } from '$lib/services/workspaceService';
	import { TempChartStorage } from '$lib/services/tempChartStorage';
	import { EventBus } from '@dtx/common/game';
	import { EventType } from '@dtx/common/game';
	import store from '$lib/store';
	import { get } from 'svelte/store';
	import * as FileManager from '@dtx/common/services/fileManager';

	interface Props {
		show: boolean;
		onSwitchDTX?: (dtxFileName: string) => void;
		onClose: () => void;
	}

	let { show = $bindable(), onSwitchDTX, onClose }: Props = $props();

	// Internal state management
	let currentWorkspace = $state<Workspace | null>(workspaceService.getCurrentWorkspace());

	// Refresh workspace when modal opens
	$effect(() => {
		if (show) {
			currentWorkspace = workspaceService.getCurrentWorkspace();
		}
	});

	async function switchWorkspaceDTX(dtxFileName: string) {
		if (!currentWorkspace) return;

		try {
			// Stop any existing preview to ensure clean re-draw when switching DTX files
			EventBus.emit(EventType.STOP_PREVIEW);

			const result = await workspaceService.parseDTXFile(currentWorkspace, dtxFileName);
			if (!result) {
				console.error('Failed to parse DTX file:', dtxFileName);
				return;
			}

			const { dtxFile, simFile } = result;

			// Parse notes and BPM changes
			const notes = dtxFile.parseNotes();
			const bpmNotes = dtxFile.parseBPMChanges();
			const soundChips = dtxFile.parseSoundChips();

			// Map sound chips to files from the SimFile
			const mappedSoundChips = soundChips.map((chip) => {
				if (chip.fileName) {
					const matchingFile = simFile.files.find(
						(f) => f.name.toLowerCase() === chip.fileName.toLowerCase()
					);
					if (matchingFile) {
						// Store file only in FileManager to avoid store corruption
						const currentSimfileID = get(store.currentSimfileID);
						const fileKey = FileManager.generateKey(currentSimfileID, chip.fileName);
						FileManager.setFile(fileKey, matchingFile);

						// Don't store File object in chip to avoid store corruption
						chip.file = undefined;
					} else {
						// Try exact match without case conversion
						const exactMatch = simFile.files.find((f) => f.name === chip.fileName);
						if (exactMatch) {
							const currentSimfileID = get(store.currentSimfileID);
							const fileKey = FileManager.generateKey(
								currentSimfileID,
								chip.fileName
							);
							FileManager.setFile(fileKey, exactMatch);
							chip.file = undefined;
						}
					}
				}
				return chip;
			});

			// Update stores
			store.currentDtxFile.set(dtxFile);
			store.currentSoundChip.set(mappedSoundChips);
			store.currentSimfile.set(simFile);
			store.currentSimfileID.set(null); // Local workspace
			store.currentDifficulty.set(dtxFileName.replace('.dtx', ''));

			// Switch workspace current DTX
			workspaceService.switchDTXFile(currentWorkspace, dtxFileName);

			// Clear any existing temp data
			TempChartStorage.remove(null, get(store.currentDifficulty));

			// Emit note import event
			setTimeout(() => {
				EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);

				// After notes are imported and Editor scene is ready, clean up Preview scene
				setTimeout(() => {
					// Force editor to be dirty so Preview rebuilds completely
					// This will be handled by the parent component if needed
				}, 200);
			}, 100);

			// Call parent callback if provided
			if (onSwitchDTX) {
				onSwitchDTX(dtxFileName);
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
							dtxFile.name
								? 'border-blue-500 bg-blue-50'
								: 'border-gray-200 hover:bg-gray-50'}"
							onclick={() => switchWorkspaceDTX(dtxFile.name)}
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
