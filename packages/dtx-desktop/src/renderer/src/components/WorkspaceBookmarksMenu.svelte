<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceStore } from '../stores/workspaceStore';
	import { bookmarkStore, basename, type WorkspaceBookmark } from '../stores/bookmarkStore';
	import { ChevronDown } from '@lucide/svelte';

	let isOpen = $state(false);
	let currentPath = $state<string | null>(null);
	// bookmarks will be used in Tasks 7+
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let bookmarks = $state<WorkspaceBookmark[]>([]);

	const unsubWs = workspaceStore.subscribe((s) => {
		currentPath = s.path;
	});
	const unsubBm = bookmarkStore.subscribe((v) => {
		bookmarks = v;
	});

	const handleTriggerClick = () => {
		isOpen = !isOpen;
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && isOpen) {
			isOpen = false;
		}
	};

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			unsubWs();
			unsubBm();
		};
	});

	const triggerLabel = $derived(currentPath ? basename(currentPath) : 'No workspace');
</script>

<div class="relative inline-block">
	<button
		type="button"
		class="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
		aria-label="Workspace menu"
		aria-haspopup="menu"
		aria-expanded={isOpen}
		onclick={handleTriggerClick}
	>
		<span>{triggerLabel}</span>
		<ChevronDown size={14} />
	</button>

	{#if isOpen}
		<div
			role="menu"
			class="absolute left-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
		>
			{#if currentPath}
				<div class="px-2 py-1">
					<div class="text-xs font-medium text-slate-500 dark:text-slate-400">
						Current
					</div>
					<div
						class="mt-1 truncate font-mono text-xs text-slate-700 dark:text-slate-200"
						title={currentPath}
					>
						{currentPath}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
