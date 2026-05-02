<script lang="ts">
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import type { Workspace } from '$lib/services/workspaceService';

	interface Props {
		simfileID: string;
		isPreviewing: boolean;
		currentWorkspace: Workspace | null;
		availableWorkspaces: Workspace[];
		onNewFile: () => void;
		onImportFile: () => void;
		onImportFolder: () => void;
		onExportFile: () => void;
		onShowDTXSwitcher: () => void;
		onShowWorkspaceManager: () => void;
		onShowSoundLibraryModal: () => void;
		onRefreshSoundLibraryLinks: () => void;
		onShowWorkspaceExporter: () => void;
	}

	let {
		simfileID,
		isPreviewing,
		currentWorkspace,
		availableWorkspaces,
		onNewFile,
		onImportFile,
		onImportFolder,
		onExportFile,
		onShowDTXSwitcher,
		onShowWorkspaceManager,
		onShowSoundLibraryModal,
		onRefreshSoundLibraryLinks,
		onShowWorkspaceExporter
	}: Props = $props();
</script>

<div
	class="relative row-span-1 flex flex-row items-center border-b-2 border-purple-500/30 bg-slate-800/50 backdrop-blur-sm"
>
	{#if !simfileID}
		<Popover
			positioning={{ placement: 'bottom-start' }}
			contentBase="p-0 z-50 rounded-sm border border-purple-500/30 bg-slate-800/95 backdrop-blur-md shadow-lg"
			classes="w-1/12 rounded-sm bg-slate-700/50 py-2 hover:bg-slate-600/50 text-slate-200"
			triggerClasses="w-full"
		>
			{#snippet trigger()}
				<span>File</span>
			{/snippet}
			{#snippet content()}
				<div class="flex flex-col">
					<button
						class="px-4 py-2 text-left text-slate-200 {isPreviewing
							? 'cursor-not-allowed text-slate-500'
							: 'hover:bg-slate-700/50'}"
						onclick={onNewFile}
						disabled={isPreviewing}>New</button
					>
					<button
						class="px-4 py-2 text-left text-slate-200 {isPreviewing
							? 'cursor-not-allowed text-slate-500'
							: 'hover:bg-slate-700/50'}"
						onclick={onImportFile}
						disabled={isPreviewing}>Import File</button
					>
					<button
						class="px-4 py-2 text-left text-slate-200 {isPreviewing
							? 'cursor-not-allowed text-slate-500'
							: 'hover:bg-slate-700/50'}"
						onclick={onImportFolder}
						disabled={isPreviewing}>Import Folder</button
					>
					{#if currentWorkspace && currentWorkspace.dtxFiles.length > 1}
						<button
							class="px-4 py-2 text-left text-slate-200 {isPreviewing
								? 'cursor-not-allowed text-slate-500'
								: 'hover:bg-slate-700/50'}"
							onclick={onShowDTXSwitcher}
							disabled={isPreviewing}>Switch DTX</button
						>
					{/if}
					<button
						class="px-4 py-2 text-left text-slate-200 {isPreviewing
							? 'cursor-not-allowed text-slate-500'
							: 'hover:bg-slate-700/50'}"
						onclick={onExportFile}
						disabled={isPreviewing}>Export File</button
					>
					{#if availableWorkspaces.length > 0}
						<button
							class="px-4 py-2 text-left text-slate-200 {isPreviewing
								? 'cursor-not-allowed text-slate-500'
								: 'hover:bg-slate-700/50'}"
							onclick={onShowWorkspaceExporter}
							disabled={isPreviewing}>Export Workspace</button
						>
					{/if}
				</div>
			{/snippet}
		</Popover>

		<!-- Only show Workspace menu for local files (no simfileID) -->
		<Popover
			positioning={{ placement: 'bottom-start' }}
			contentBase="p-0 z-50 rounded-sm border border-purple-500/30 bg-slate-800/95 backdrop-blur-md shadow-lg"
			classes="w-1/12 rounded-sm bg-slate-700/50 py-2 hover:bg-slate-600/50 text-slate-200"
			triggerClasses="w-full"
		>
			{#snippet trigger()}
				<span>Workspace</span>
			{/snippet}
			{#snippet content()}
				<div class="flex flex-col">
					{#if availableWorkspaces.length > 0}
						<button
							class="px-4 py-2 text-left text-slate-200 {isPreviewing
								? 'cursor-not-allowed text-slate-500'
								: 'hover:bg-slate-700/50'}"
							onclick={onShowWorkspaceManager}
							disabled={isPreviewing}
						>
							Manage Workspace
						</button>
					{/if}
					<button
						class="px-4 py-2 text-left text-slate-200 {isPreviewing
							? 'cursor-not-allowed text-slate-500'
							: 'hover:bg-slate-700/50'}"
						onclick={onShowSoundLibraryModal}
						disabled={isPreviewing}
					>
						Manage Sound files library
					</button>
					<button
						class="px-4 py-2 text-left text-slate-200 {isPreviewing
							? 'cursor-not-allowed text-slate-500'
							: 'hover:bg-slate-700/50'}"
						onclick={onRefreshSoundLibraryLinks}
						disabled={isPreviewing}
					>
						Refresh Sound Library Links
					</button>
				</div>
			{/snippet}
		</Popover>
	{/if}

	<div class="h-8 border-l border-purple-500/30"></div>
</div>
