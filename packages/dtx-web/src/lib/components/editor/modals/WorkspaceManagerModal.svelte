<script lang="ts">
	import { Trash2 } from '@lucide/svelte/icons';
	import type { Workspace } from '$lib/services/workspaceService';

	interface Props {
		show: boolean;
		availableWorkspaces: Workspace[];
		currentWorkspace: Workspace | null;
		onSwitchToWorkspace: (workspace: Workspace) => void;
		onShowDeleteWorkspaceConfirm: (workspace: Workspace, event: Event) => void;
		onClose: () => void;
	}

	let {
		show,
		availableWorkspaces,
		currentWorkspace,
		onSwitchToWorkspace,
		onShowDeleteWorkspaceConfirm,
		onClose
	}: Props = $props();
</script>

{#if show}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
			<h2 class="mb-4 text-xl font-bold text-gray-800">Manage Workspace</h2>

			{#if availableWorkspaces.length === 1}
				<p class="mb-4 text-sm text-gray-600">
					Click on a workspace to switch to it, or use the delete button to remove it.
				</p>
			{:else if availableWorkspaces.length > 1}
				<p class="mb-4 text-sm text-gray-600">
					Click on a workspace to switch to it, or use the delete button to remove
					workspaces you no longer need.
				</p>
			{/if}

			<div class="space-y-2">
				{#each availableWorkspaces as workspace}
					<div
						class="flex items-center rounded-md border transition-colors {currentWorkspace?.name ===
						workspace.name
							? 'border-blue-500 bg-blue-50'
							: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
					>
						<button
							class="flex-1 px-4 py-3 text-left"
							onclick={() => onSwitchToWorkspace(workspace)}
							disabled={currentWorkspace?.name === workspace.name}
						>
							<div class="flex items-center justify-between">
								<div>
									<div
										class="font-medium {currentWorkspace?.name ===
										workspace.name
											? 'text-blue-700'
											: 'text-gray-900'}"
									>
										{workspace.name}
									</div>
									<div class="text-sm text-gray-500">
										{workspace.dtxFiles.length} DTX files, {workspace.audioFiles
											.length} audio files
									</div>
									<div class="text-xs text-gray-400">
										Last modified: {new Date(
											workspace.lastModified
										).toLocaleDateString()}
									</div>
								</div>
								{#if currentWorkspace?.name === workspace.name}
									<span class="text-sm font-medium text-blue-600">Current</span>
								{/if}
							</div>
						</button>
						<button
							class="mr-3 rounded-md p-2 text-red-600 hover:bg-red-50 hover:text-red-800"
							onclick={(event) => onShowDeleteWorkspaceConfirm(workspace, event)}
							title="Delete workspace"
							aria-label="Delete workspace"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			</div>

			<div class="mt-6 flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
					onclick={onClose}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
