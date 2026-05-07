<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceStore } from '../stores/workspaceStore';
	import { bookmarkStore, basename, type WorkspaceBookmark } from '../stores/bookmarkStore';
	import { workspaceService } from '../services/workspaceService';
	import { ChevronDown, Star, CheckCircle2 } from '@lucide/svelte';

	let isOpen = $state(false);
	let currentPath = $state<string | null>(null);
	let bookmarks = $state<WorkspaceBookmark[]>([]);
	let addError = $state<string | null>(null);

	const isCurrentBookmarked = $derived(
		!!currentPath && bookmarks.some((b) => b.path === currentPath)
	);
	const currentBookmark = $derived(
		currentPath ? (bookmarks.find((b) => b.path === currentPath) ?? null) : null
	);

	const handleSwitchTo = (b: WorkspaceBookmark) => {
		if (b.path === currentPath) return;
		isOpen = false;
		void workspaceService.switchToBookmark(b);
	};

	const handleBookmarkCurrent = () => {
		if (!currentPath) return;
		const result = bookmarkStore.add(currentPath);
		if (result.ok) {
			addError = null;
			isOpen = false;
		} else if (result.reason === 'cap-exceeded') {
			addError = 'Maximum of 20 bookmarks reached';
		} else {
			addError = null;
		}
	};

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
			{#if currentPath && !isCurrentBookmarked}
				<button
					type="button"
					role="menuitem"
					class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
					onclick={handleBookmarkCurrent}
				>
					<Star size={16} />
					<span>Bookmark this folder</span>
				</button>
			{:else if currentBookmark}
				<div
					class="flex items-center gap-2 px-2 py-2 text-sm text-emerald-700 dark:text-emerald-300"
				>
					<CheckCircle2 size={16} />
					<span>Bookmarked as {currentBookmark.name}</span>
				</div>
			{/if}
			{#if addError}
				<div class="px-2 py-1 text-xs text-red-600 dark:text-red-300">{addError}</div>
			{/if}
			{#if bookmarks.length > 0}
				<div class="my-1 border-t border-slate-200 dark:border-slate-700"></div>
				<div class="px-2 pt-2 pb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
					Bookmarks
				</div>
				<ul class="max-h-72 overflow-auto">
					{#each bookmarks as bookmark (bookmark.path)}
						{@const isActive = bookmark.path === currentPath}
						<li
							role="menuitem"
							aria-label={isActive
								? `${bookmark.name} (current)`
								: `Switch to ${bookmark.name}`}
							aria-disabled={isActive}
							data-testid={`bookmark-row-${bookmark.path}`}
							data-active={isActive ? 'true' : 'false'}
							tabindex="0"
							class="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
							class:cursor-default={isActive}
							class:bg-slate-50={isActive}
							class:dark:bg-slate-700={isActive}
							onclick={() => handleSwitchTo(bookmark)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleSwitchTo(bookmark);
								}
							}}
						>
							<div class="min-w-0 flex-1">
								<div class="truncate text-slate-800 dark:text-slate-100">
									{bookmark.name}
								</div>
								<div
									class="truncate font-mono text-xs text-slate-500 dark:text-slate-400"
									title={bookmark.path}
								>
									{bookmark.path}
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
