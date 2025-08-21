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
		onShowDifficultyModal: () => void;
		onShowDTXSwitcher: () => void;
		onShowWorkspaceManager: () => void;
		onShowSoundLibraryModal: () => void;
		onRefreshSoundLibraryLinks: () => void;
		onShowWorkspaceExporter: () => void;
		onDiscardLocalChanges: () => void;
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
		onShowDifficultyModal,
		onShowDTXSwitcher,
		onShowWorkspaceManager,
		onShowSoundLibraryModal,
		onRefreshSoundLibraryLinks,
		onShowWorkspaceExporter,
		onDiscardLocalChanges
	}: Props = $props();
</script>

<div class="relative row-span-1 flex flex-row items-center border-b-2 border-gray-400">
	<Popover
		positioning={{ placement: 'bottom-start' }}
		contentBase="p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
		classes="w-1/12 rounded-sm bg-gray-200 py-2 hover:bg-gray-300"
		triggerClasses="w-full"
	>
		{#snippet trigger()}
			<span>File</span>
		{/snippet}
		{#snippet content()}
			<div class="flex flex-col">
				<button
					class="px-4 py-2 text-left {isPreviewing
						? 'cursor-not-allowed text-gray-400'
						: 'hover:bg-gray-100'}"
					onclick={onNewFile}
					disabled={isPreviewing}>New</button
				>
				{#if !simfileID}
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onImportFile}
						disabled={isPreviewing}>Import File</button
					>
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onImportFolder}
						disabled={isPreviewing}>Import Folder</button
					>
				{/if}
				{#if simfileID}
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onShowDifficultyModal}
						disabled={isPreviewing}>Switch file</button
					>
				{:else if currentWorkspace && currentWorkspace.dtxFiles.length > 1}
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onShowDTXSwitcher}
						disabled={isPreviewing}>Switch DTX</button
					>
				{/if}
				<button
					class="px-4 py-2 text-left {isPreviewing
						? 'cursor-not-allowed text-gray-400'
						: 'hover:bg-gray-100'}"
					onclick={onExportFile}
					disabled={isPreviewing}>Export File</button
				>
				{#if !simfileID && availableWorkspaces.length > 0}
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onShowWorkspaceExporter}
						disabled={isPreviewing}>Export Workspace</button
					>
				{/if}
			</div>
		{/snippet}
	</Popover>

	{#if !simfileID}
		<!-- Only show Workspace menu for local files (no simfileID) -->
		<Popover
			positioning={{ placement: 'bottom-start' }}
			contentBase="p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
			classes="w-1/12 rounded-sm bg-gray-200 py-2 hover:bg-gray-300"
			triggerClasses="w-full"
		>
			{#snippet trigger()}
				<span>Workspace</span>
			{/snippet}
			{#snippet content()}
				<div class="flex flex-col">
					{#if availableWorkspaces.length > 0}
						<button
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={onShowWorkspaceManager}
							disabled={isPreviewing}
						>
							Manage Workspace
						</button>
					{/if}
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onShowSoundLibraryModal}
						disabled={isPreviewing}
					>
						Manage Sound files library
					</button>
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onRefreshSoundLibraryLinks}
						disabled={isPreviewing}
					>
						Refresh Sound Library Links
					</button>
				</div>
			{/snippet}
		</Popover>
	{:else}
		<!-- Show Edit menu with only discard changes for remote files -->
		<Popover
			positioning={{ placement: 'bottom-start' }}
			contentBase="p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
			classes="w-1/12 rounded-sm bg-gray-200 py-2 hover:bg-gray-300"
			triggerClasses="w-full"
		>
			{#snippet trigger()}
				<span>Edit</span>
			{/snippet}
			{#snippet content()}
				<div class="flex flex-col">
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={onDiscardLocalChanges}
						title="Discard all local changes and reload from server"
						disabled={isPreviewing}
					>
						Discard current Local changes
					</button>
				</div>
			{/snippet}
		</Popover>
	{/if}

	<div class="h-8 border-l border-gray-300"></div>
</div>
