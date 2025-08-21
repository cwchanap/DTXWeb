<script lang="ts">
	import { ChevronDown } from '@lucide/svelte/icons';

	interface Props {
		showTips: boolean;
	}

	let { showTips = $bindable() }: Props = $props();
</script>

<!-- Fixed tips section at bottom of screen -->
{#if showTips}
	<div class="fixed right-0 bottom-0 left-0 z-10 border-t border-gray-200 bg-gray-50 shadow-lg">
		<!-- Tips header with hide button -->
		<div class="flex items-center justify-between border-b border-gray-200 p-4">
			<h3 class="text-sm font-semibold text-gray-700">📝 Editor Tips</h3>
			<button
				class="flex items-center space-x-1 rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-300"
				onclick={() => (showTips = false)}
				title="Hide tips"
			>
				<span>Hide</span>
				<ChevronDown class="h-3 w-3" />
			</button>
		</div>

		<!-- Tips content -->
		<div class="p-4">
			<div class="grid grid-cols-1 gap-2 text-xs text-gray-600 md:grid-cols-2 lg:grid-cols-3">
				<div class="flex items-center space-x-2">
					<kbd class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Q</kbd
					>
					<span>Toggle editing mode</span>
				</div>
				<div class="flex items-center space-x-2">
					<span class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Drag</span
					>
					<span>Select multiple notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Del</kbd
					>
					<span>Delete selected notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Ctrl+X</kbd
					>
					<span>Cut selected notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Ctrl+C</kbd
					>
					<span>Copy selected notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Ctrl+V</kbd
					>
					<span>Paste notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Ctrl+Z</kbd
					>
					<span>Undo last action</span>
				</div>
				<div class="flex items-center space-x-2">
					<span class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Right-click</span
					>
					<span>Delete note</span>
				</div>
				<div class="flex items-center space-x-2">
					<span class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Left-click</span
					>
					<span>Add note (in edit mode)</span>
				</div>
				<div class="flex items-center space-x-2">
					<span class="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-800"
						>Key Bindings</span
					>
					<span>Press bound keys to switch active note</span>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Floating "Show Tips" button when tips are hidden -->
{#if !showTips}
	<button
		class="fixed right-4 bottom-4 z-10 flex items-center space-x-2 rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-lg transition-colors hover:bg-blue-600"
		onclick={() => (showTips = true)}
		title="Show editor tips"
	>
		<span>📝</span>
		<span>Show Tips</span>
	</button>
{/if}
