<script lang="ts">
	import type { Workspace } from '$lib/services/workspaceService';

	interface Props {
		show: boolean;
		workspaceToDelete: Workspace | null;
		currentWorkspace: Workspace | null;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { show, workspaceToDelete, currentWorkspace, onConfirm, onCancel }: Props = $props();
</script>

{#if show && workspaceToDelete}
	<div class="bg-opacity-50 fixed inset-0 z-60 flex items-center justify-center bg-black">
		<div class="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
			<div class="mb-4 flex items-center space-x-3">
				<div class="flex-shrink-0">
					<svg
						class="h-6 w-6 text-red-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.866-.833-2.636 0L3.178 16.5c-.77.833.192 2.5 1.732 2.5z"
						/>
					</svg>
				</div>
				<h2 class="text-xl font-bold text-gray-900">Delete Workspace?</h2>
			</div>

			<div class="mb-6">
				<p class="mb-3 text-gray-700">
					Are you sure you want to delete the workspace <strong
						>"{workspaceToDelete.name}"</strong
					>?
				</p>
				<div class="mb-3 rounded-lg bg-gray-50 p-3">
					<div class="text-sm text-gray-600">
						<div>• {workspaceToDelete.dtxFiles.length} DTX files</div>
						<div>• {workspaceToDelete.audioFiles.length} audio files</div>
						<div>
							• Last modified: {new Date(
								workspaceToDelete.lastModified
							).toLocaleDateString()}
						</div>
					</div>
				</div>
				<p class="text-sm font-medium text-red-600">
					⚠️ This action cannot be undone. All workspace data will be permanently lost.
				</p>
				{#if currentWorkspace?.name === workspaceToDelete.name}
					<p class="mt-2 text-sm font-medium text-orange-600">
						🔄 This is your current workspace. You will be switched to another workspace
						or a new file.
					</p>
				{/if}
			</div>

			<div class="flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
					onclick={onCancel}
				>
					Cancel
				</button>
				<button
					class="rounded-md bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
					onclick={onConfirm}
				>
					Delete Workspace
				</button>
			</div>
		</div>
	</div>
{/if}
