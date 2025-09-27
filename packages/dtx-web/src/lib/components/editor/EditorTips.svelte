<script lang="ts">
	import { ChevronDown } from '@lucide/svelte/icons';

	interface Props {
		showTips: boolean;
	}

	let { showTips = $bindable() }: Props = $props();
</script>

<!-- Fixed tips section at bottom of screen -->
{#if showTips}
	<div
		class="fixed right-0 bottom-0 left-0 z-10 border-t border-purple-500/30 bg-slate-900/95 shadow-lg backdrop-blur-md"
	>
		<!-- Tips header with hide button -->
		<div class="flex items-center justify-between border-b border-purple-500/20 p-4">
			<h3 class="text-sm font-semibold text-slate-200">📝 Editor Tips</h3>
			<button
				class="flex items-center space-x-1 rounded border border-purple-500/30 bg-slate-700/50 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-600/50"
				onclick={() => (showTips = false)}
				title="Hide tips"
			>
				<span>Hide</span>
				<ChevronDown class="h-3 w-3" />
			</button>
		</div>

		<!-- Tips content -->
		<div class="p-4">
			<div
				class="grid grid-cols-1 gap-2 text-xs text-slate-300 md:grid-cols-2 lg:grid-cols-3"
			>
				<div class="flex items-center space-x-2">
					<kbd
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Q</kbd
					>
					<span>Toggle editing mode</span>
				</div>
				<div class="flex items-center space-x-2">
					<span
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Drag</span
					>
					<span>Select multiple notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Del</kbd
					>
					<span>Delete selected notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Ctrl+X</kbd
					>
					<span>Cut selected notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Ctrl+C</kbd
					>
					<span>Copy selected notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Ctrl+V</kbd
					>
					<span>Paste notes</span>
				</div>
				<div class="flex items-center space-x-2">
					<kbd
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Ctrl+Z</kbd
					>
					<span>Undo last action</span>
				</div>
				<div class="flex items-center space-x-2">
					<span
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Right-click</span
					>
					<span>Delete note</span>
				</div>
				<div class="flex items-center space-x-2">
					<span
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
						>Left-click</span
					>
					<span>Add note (in edit mode)</span>
				</div>
				<div class="flex items-center space-x-2">
					<span
						class="rounded border border-purple-500/50 bg-purple-600/40 px-2 py-1 text-xs font-semibold text-purple-200"
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
		class="music-btn-primary fixed right-4 bottom-4 z-10 flex items-center space-x-2 rounded-full shadow-lg"
		onclick={() => (showTips = true)}
		title="Show editor tips"
	>
		<span>📝</span>
		<span>Show Tips</span>
	</button>
{/if}
