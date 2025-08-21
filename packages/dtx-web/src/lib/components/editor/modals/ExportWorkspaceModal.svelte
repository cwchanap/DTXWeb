<script lang="ts">
	import type { Workspace } from '$lib/services/workspaceService';

	interface Props {
		show: boolean;
		availableWorkspaces: Workspace[];
		includeAudioInExport: boolean;
		isExportingWorkspace: boolean;
		workspaceToExport: Workspace | null;
		onExportWorkspace: (workspace: Workspace) => void;
		onClose: () => void;
	}

	let {
		show,
		availableWorkspaces,
		includeAudioInExport = $bindable(),
		isExportingWorkspace,
		workspaceToExport,
		onExportWorkspace,
		onClose
	}: Props = $props();
</script>

{#if show}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
			<h2 class="mb-4 text-xl font-bold text-gray-800">Export Workspace</h2>

			<p class="mb-4 text-sm text-gray-600">Select a workspace to export as a ZIP file.</p>

			<!-- Audio inclusion option -->
			<div class="mb-4 rounded-lg border border-gray-200 p-3">
				<label class="flex cursor-pointer items-center space-x-2">
					<input
						type="checkbox"
						bind:checked={includeAudioInExport}
						class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
						disabled={isExportingWorkspace}
					/>
					<span class="text-sm font-medium text-gray-700"> Include audio files </span>
				</label>
				<p class="mt-1 text-xs text-gray-500">
					Uncheck to export only DTX files (smaller file size)
				</p>
			</div>

			<div class="space-y-2">
				{#each availableWorkspaces as workspace}
					<button
						class="w-full rounded-md border p-3 text-left transition-colors {isExportingWorkspace &&
						workspaceToExport?.name === workspace.name
							? 'cursor-not-allowed border-blue-500 bg-blue-50'
							: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
						onclick={() => onExportWorkspace(workspace)}
						disabled={isExportingWorkspace}
					>
						<div class="flex items-center justify-between">
							<div>
								<div class="font-medium text-gray-900">{workspace.name}</div>
								<div class="text-sm text-gray-500">
									{workspace.dtxFiles.length} DTX files{includeAudioInExport
										? `, ${workspace.audioFiles.length} audio files`
										: ''}
								</div>
								<div class="text-xs text-gray-400">
									Last modified: {new Date(
										workspace.lastModified
									).toLocaleDateString()}
								</div>
							</div>
							{#if isExportingWorkspace && workspaceToExport?.name === workspace.name}
								<div class="flex items-center gap-2">
									<div
										class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
									></div>
									<span class="text-sm text-blue-600">Exporting...</span>
								</div>
							{/if}
						</div>
					</button>
				{/each}
			</div>

			<div class="mt-6 flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
					onclick={onClose}
					disabled={isExportingWorkspace}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
