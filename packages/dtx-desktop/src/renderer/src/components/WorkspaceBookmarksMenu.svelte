<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceStore } from '../stores/workspaceStore';
	import { bookmarkStore, basename, type WorkspaceBookmark } from '../stores/bookmarkStore';
	import { workspaceService } from '../services/workspaceService';
	import { ChevronDown, Star, CheckCircle2, Pencil, Trash2, FolderOpen } from '@lucide/svelte';

	let isOpen = $state(false);
	let currentPath = $state<string | null>(null);
	let bookmarks = $state<WorkspaceBookmark[]>([]);
	let addError = $state<string | null>(null);
	let bookmarkSwitchError = $state<{ message: string; path: string } | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);
	let rootEl = $state<HTMLDivElement | null>(null);

	const isCurrentBookmarked = $derived(
		!!currentPath && bookmarks.some((b) => b.path === currentPath)
	);
	const currentBookmark = $derived(
		currentPath ? (bookmarks.find((b) => b.path === currentPath) ?? null) : null
	);

	const closeDropdown = (options?: { refocus?: boolean }) => {
		if (editingPath !== null) {
			commitEditing();
		}
		isOpen = false;
		addError = null;
		bookmarkSwitchError = null;
		if (options?.refocus !== false) {
			queueMicrotask(() => triggerEl?.focus());
		}
	};

	const handleSwitchTo = async (b: WorkspaceBookmark) => {
		if (b.path === currentPath) return;
		const result = await workspaceService.switchToBookmark(b);
		if (result.ok === false) {
			bookmarkSwitchError = { message: result.error, path: result.path };
			// Keep the menu open to show the error
			return;
		}
		closeDropdown();
	};

	const handleBookmarkCurrent = () => {
		if (!currentPath) return;
		const result = bookmarkStore.add(currentPath);
		if (result.ok) {
			addError = null;
			closeDropdown();
			return;
		}
		const failure = result as { ok: false; reason: 'duplicate' | 'cap-exceeded' };
		if (failure.reason === 'cap-exceeded') {
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
		if (isOpen) {
			closeDropdown();
		} else {
			isOpen = true;
		}
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape' && isOpen) {
			closeDropdown();
			return;
		}

		if (!isOpen || !menuEl) return;

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const items = Array.from(
				menuEl.querySelectorAll<HTMLElement>(
					'[role="menuitem"]:not([aria-disabled="true"])'
				)
			);
			if (items.length === 0) return;

			const currentIndex = items.indexOf(document.activeElement as HTMLElement);
			let nextIndex: number;
			if (event.key === 'ArrowDown') {
				nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
			} else {
				nextIndex =
					currentIndex === -1 || currentIndex === 0
						? items.length - 1
						: (currentIndex - 1 + items.length) % items.length;
			}
			items[nextIndex].focus();
		}
	};

	const handleOutsideMousedown = (event: MouseEvent) => {
		if (isOpen && rootEl && !rootEl.contains(event.target as Node)) {
			closeDropdown({ refocus: false });
		}
	};

	onMount(() => {
		window.addEventListener('keydown', handleKeydown);
		document.addEventListener('mousedown', handleOutsideMousedown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('mousedown', handleOutsideMousedown);
			unsubWs();
			unsubBm();
		};
	});

	const triggerLabel = $derived(currentPath ? basename(currentPath) : 'No workspace');

	let editingPath = $state<string | null>(null);
	let editingValue = $state('');

	const startEditing = (b: WorkspaceBookmark) => {
		editingPath = b.path;
		editingValue = b.name;
	};

	const commitEditing = () => {
		if (editingPath === null) return;
		const path = editingPath;
		const value = editingValue;
		editingPath = null;
		bookmarkStore.rename(path, value);
	};

	const cancelEditing = () => {
		editingPath = null;
	};

	const handleRemove = (b: WorkspaceBookmark) => {
		bookmarkStore.remove(b.path);
	};

	const handleBrowse = () => {
		closeDropdown();
		void workspaceService.selectWorkspace();
	};

	const handleEditKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			commitEditing();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancelEditing();
		}
	};
</script>

<div class="relative inline-block" bind:this={rootEl}>
	<button
		type="button"
		class="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
		aria-label="Workspace menu"
		aria-haspopup="menu"
		aria-expanded={isOpen}
		bind:this={triggerEl}
		onclick={handleTriggerClick}
	>
		<span>{triggerLabel}</span>
		<ChevronDown size={14} />
	</button>

	{#if isOpen}
		<div
			role="menu"
			bind:this={menuEl}
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
			{#if bookmarkSwitchError}
				<div
					class="mx-2 my-1 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300"
				>
					<p>{bookmarkSwitchError.message}</p>
					<button
						type="button"
						class="mt-1 font-medium text-red-800 underline hover:text-red-900 dark:text-red-200 dark:hover:text-red-100"
						onclick={() => {
							bookmarkStore.remove(bookmarkSwitchError!.path);
							bookmarkSwitchError = null;
						}}
					>
						Remove bookmark
					</button>
				</div>
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
							class="group flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
							class:cursor-default={isActive}
							class:bg-slate-50={isActive}
							class:dark:bg-slate-700={isActive}
							onclick={() => handleSwitchTo(bookmark)}
							onkeydown={(e) => {
								if (e.target !== e.currentTarget) return;
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleSwitchTo(bookmark);
								}
							}}
						>
							<div class="min-w-0 flex-1">
								{#if editingPath === bookmark.path}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										type="text"
										class="w-full rounded border border-slate-300 bg-white px-1 py-0.5 text-sm text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
										aria-label={`Rename ${bookmark.name}`}
										bind:value={editingValue}
										onkeydown={handleEditKeydown}
										onblur={commitEditing}
										onclick={(e) => e.stopPropagation()}
										autofocus
									/>
								{:else}
									<div class="truncate text-slate-800 dark:text-slate-100">
										{bookmark.name}
									</div>
								{/if}
								<div
									class="truncate font-mono text-xs text-slate-500 dark:text-slate-400"
									title={bookmark.path}
								>
									{bookmark.path}
								</div>
							</div>
							<button
								type="button"
								class="rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 focus-visible:opacity-100 dark:hover:bg-slate-600 dark:hover:text-slate-200"
								aria-label={`Rename ${bookmark.name}`}
								onclick={(e) => {
									e.stopPropagation();
									startEditing(bookmark);
								}}
							>
								<Pencil size={14} />
							</button>
							<button
								type="button"
								class="rounded p-1 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-red-600 focus-visible:opacity-100 dark:hover:bg-slate-600 dark:hover:text-red-400"
								aria-label={`Remove ${bookmark.name}`}
								onclick={(e) => {
									e.stopPropagation();
									handleRemove(bookmark);
								}}
							>
								<Trash2 size={14} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="my-1 border-t border-slate-200 dark:border-slate-700"></div>
			<button
				type="button"
				role="menuitem"
				class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700"
				onclick={handleBrowse}
			>
				<FolderOpen size={16} />
				<span>Browse for folder…</span>
			</button>
		</div>
	{/if}
</div>
