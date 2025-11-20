<script lang="ts">
	import { Trash2 } from '@lucide/svelte/icons';
	import { workspaceService, type Workspace } from '$lib/services/workspaceService';
	import { Modal } from '@dtx/ui-components/components';

	interface Props {
		show: boolean;
		onClose: () => void;
		onSwitchToWorkspace?: (workspace: Workspace) => void;
	}

	let { show, onClose, onSwitchToWorkspace }: Props = $props();

	// Internal state management
	let availableWorkspaces = $state<Workspace[]>(workspaceService.getWorkspaces());
	let currentWorkspace = $state<Workspace | null>(workspaceService.getCurrentWorkspace());
	let showDeleteConfirmModal = $state(false);
	let workspaceToDelete = $state<Workspace | null>(null);

	// Refresh workspaces when modal opens
	$effect(() => {
		if (show) {
			refreshWorkspaces();
		}
	});

	function refreshWorkspaces() {
		availableWorkspaces = workspaceService.getWorkspaces();
		currentWorkspace = workspaceService.getCurrentWorkspace();
	}

	async function switchToWorkspace(workspace: Workspace) {
		if (onSwitchToWorkspace) {
			await onSwitchToWorkspace(workspace);
		}
		currentWorkspace = workspace;
		workspaceService.setCurrentWorkspace(workspace);
		onClose();
	}

	function showDeleteWorkspaceConfirm(workspace: Workspace, event: Event) {
		event.stopPropagation();
		workspaceToDelete = workspace;
		showDeleteConfirmModal = true;
	}

	function confirmDeleteWorkspace() {
		if (!workspaceToDelete) return;

		try {
			const isCurrentWorkspace = currentWorkspace?.name === workspaceToDelete.name;

			// Delete the workspace
			workspaceService.deleteWorkspace(workspaceToDelete.name);

			// Refresh workspaces list
			refreshWorkspaces();

			// If we deleted the current workspace, clear it
			if (isCurrentWorkspace) {
				currentWorkspace = null;
				workspaceService.setCurrentWorkspace(null);

				// If there are other workspaces, switch to the first one
				if (availableWorkspaces.length > 0) {
					switchToWorkspace(availableWorkspaces[0]);
				}
			}

			// Close modals
			showDeleteConfirmModal = false;
			workspaceToDelete = null;

			// If we deleted the last workspace, close the manager modal
			if (availableWorkspaces.length === 0) {
				onClose();
			}
		} catch (error) {
			console.error('Error deleting workspace:', error);
		}
	}
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
							onclick={() => switchToWorkspace(workspace)}
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
							onclick={(event) => showDeleteWorkspaceConfirm(workspace, event)}
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

<!-- Delete Workspace Confirmation Modal -->
<Modal
	bind:open={showDeleteConfirmModal}
	title="Delete Workspace"
	onConfirm={confirmDeleteWorkspace}
	confirmText="Delete"
	confirmVariant="danger"
>
	{#snippet children()}
		{#if workspaceToDelete}
			<p class="text-gray-700">
				Are you sure you want to delete the workspace "{workspaceToDelete.name}"?
			</p>
			<p class="mt-2 text-sm text-gray-500">
				This will permanently remove {workspaceToDelete.dtxFiles.length} DTX files and
				{workspaceToDelete.audioFiles.length} audio files. This action cannot be undone.
			</p>
		{/if}
	{/snippet}
</Modal>
