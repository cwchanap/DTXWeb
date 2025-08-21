<script lang="ts">
	interface Props {
		show: boolean;
		chartName: string;
		difficultyText: string;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { show, chartName, difficultyText, onConfirm, onCancel }: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onCancel();
		}
	}

	function focusModal(element: HTMLElement) {
		element.focus();
	}
</script>

{#if show}
	<div
		class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black"
		role="dialog"
		aria-modal="true"
		aria-labelledby="discard-modal-title"
		aria-describedby="discard-modal-description"
		onkeydown={handleKeydown}
		tabindex="-1"
		use:focusModal
	>
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
				<h2 id="discard-modal-title" class="text-xl font-bold text-gray-900">
					Discard Local Changes?
				</h2>
			</div>

			<div id="discard-modal-description" class="mb-6">
				<p class="mb-3 text-gray-700">
					Are you sure you want to discard all local changes for <strong
						>{chartName}{difficultyText}</strong
					>?
				</p>
				<p class="text-sm font-medium text-red-600">
					⚠️ This action cannot be undone. All unsaved edits will be permanently lost.
				</p>
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
					Discard Changes
				</button>
			</div>
		</div>
	</div>
{/if}
