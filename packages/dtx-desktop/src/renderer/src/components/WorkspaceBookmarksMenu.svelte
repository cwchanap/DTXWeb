<script lang="ts">
	import { onMount } from 'svelte';
	import { workspaceStore } from '../stores/workspaceStore';
	import { bookmarkStore, basename, type WorkspaceBookmark } from '../stores/bookmarkStore';
	import { workspaceService } from '../services/workspaceService';
	import { ChevronDown, Star, CheckCircle2, Pencil, Trash2, FolderOpen } from '@lucide/svelte';

	let isOpen = $state(false);
	let currentPath = $state<string | null>(null);
	let rootId = $state<string | null>(null);
	let bookmarks = $state<WorkspaceBookmark[]>([]);
	let addError = $state<string | null>(null);
	let bookmarkSwitchError = $state<{ message: string; id?: string } | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);
	let rootEl = $state<HTMLDivElement | null>(null);

	const isCurrentBookmarked = $derived(!!rootId);
	const currentBookmark = $derived(
		rootId ? (bookmarks.find((b) => b.id === rootId) ?? null) : null
	);

	const closeDropdown = (options?: { refocus?: boolean }) => {
		if (editingId !== null) {
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
		if (b.id === rootId) return;
		const result = await workspaceService.switchToBookmark(b);
		if (result.ok === false) {
			bookmarkSwitchError = {
				message: result.error,
				...('path' in result && { id: b.id })
			};
			// Keep the menu open to show the error
			return;
		}
		closeDropdown();
	};

	const handleBookmarkCurrent = async () => {
		if (!currentPath) return;
		try {
			await bookmarkStore.addCurrent();
			addError = null;
			closeDropdown();
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			if (message.includes('Maximum of 20 bookmarks')) {
				addError = 'Maximum of 20 bookmarks reached';
			} else {
				addError = message || 'Could not bookmark this folder';
			}
		}
	};

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
		const unsubWorkspace = workspaceStore.subscribe((s) => {
			currentPath = s.path;
			rootId = s.rootId;
		});
		const unsubBookmarks = bookmarkStore.subscribe((v) => {
			bookmarks = v;
		});
		window.addEventListener('keydown', handleKeydown);
		document.addEventListener('mousedown', handleOutsideMousedown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			document.removeEventListener('mousedown', handleOutsideMousedown);
			unsubWorkspace();
			unsubBookmarks();
		};
	});

	const triggerLabel = $derived(currentPath ? basename(currentPath) : 'No workspace');

	let editingId = $state<string | null>(null);
	let editingValue = $state('');

	const startEditing = (b: WorkspaceBookmark) => {
		editingId = b.id;
		editingValue = b.name;
	};

	const commitEditing = () => {
		if (editingId === null) return;
		const id = editingId;
		const value = editingValue;
		editingId = null;
		void bookmarkStore.rename(id, value);
	};

	const cancelEditing = () => {
		editingId = null;
	};

	const handleRemove = (b: WorkspaceBookmark) => {
		void bookmarkStore.remove(b.id);
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
		class="bg-surface-2 text-base-text hover:border-cyan border-hairline flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium"
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
			class="border-hairline bg-surface-1 absolute left-0 z-20 mt-2 w-80 rounded-lg border p-2 shadow-lg"
		>
			{#if currentPath}
				<div class="px-2 py-1">
					<div class="text-faint text-xs font-medium">Current</div>
					<div class="text-base-text mt-1 truncate font-mono text-xs" title={currentPath}>
						{currentPath}
					</div>
				</div>
			{/if}
			{#if currentPath && !isCurrentBookmarked}
				<button
					type="button"
					role="menuitem"
					class="text-base-text hover:bg-surface-2 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm"
					onclick={handleBookmarkCurrent}
				>
					<Star size={16} />
					<span>Bookmark this folder</span>
				</button>
			{:else if currentBookmark}
				<div class="text-green flex items-center gap-2 px-2 py-2 text-sm">
					<CheckCircle2 size={16} />
					<span>Bookmarked as {currentBookmark.name}</span>
				</div>
			{/if}
			{#if addError}
				<div class="text-red px-2 py-1 text-xs">{addError}</div>
			{/if}
			{#if bookmarkSwitchError}
				<div class="border-red/40 bg-red/10 mx-2 my-1 rounded p-2 text-xs">
					<p class="text-red">{bookmarkSwitchError.message}</p>
					{#if bookmarkSwitchError.id}
						<button
							type="button"
							class="text-red mt-1 font-medium underline hover:opacity-80"
							onclick={() => {
								void bookmarkStore.remove(bookmarkSwitchError.id!);
								bookmarkSwitchError = null;
							}}
						>
							Remove bookmark
						</button>
					{/if}
				</div>
			{/if}
			{#if bookmarks.length > 0}
				<div class="border-hairline my-1 border-t"></div>
				<div class="text-faint px-2 pt-2 pb-1 text-xs font-medium">Bookmarks</div>
				<p class="text-faint px-2 pb-2 text-xs">
					Click a bookmark to switch to that workspace folder.
				</p>
				<ul class="max-h-72 overflow-auto">
					{#each bookmarks as bookmark (bookmark.id)}
						{@const isActive = bookmark.id === rootId}
						<li
							role="menuitem"
							aria-label={isActive
								? `${bookmark.name} (current)`
								: `Switch to ${bookmark.name}`}
							aria-disabled={isActive}
							data-testid={`bookmark-row-${bookmark.id}`}
							data-active={isActive ? 'true' : 'false'}
							tabindex="0"
							class="group hover:bg-surface-2 flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-2 text-sm"
							class:cursor-default={isActive}
							class:bg-surface-2={isActive}
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
								{#if editingId === bookmark.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										type="text"
										class="border-hairline bg-surface-2 text-hi focus:border-cyan w-full rounded border px-1 py-0.5 text-sm focus:ring-2 focus:outline-none"
										aria-label={`Rename ${bookmark.name}`}
										bind:value={editingValue}
										onkeydown={handleEditKeydown}
										onblur={commitEditing}
										onclick={(e) => e.stopPropagation()}
										autofocus
									/>
								{:else}
									<div class="text-hi truncate">
										{bookmark.name}
									</div>
								{/if}
								<div
									class="text-faint truncate font-mono text-xs"
									title={bookmark.path}
								>
									{bookmark.path}
								</div>
							</div>
							<button
								type="button"
								class="text-faint hover:bg-surface-2 hover:text-base-text rounded p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
								class="text-faint hover:bg-surface-2 hover:text-red rounded p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
			<div class="border-hairline my-1 border-t"></div>
			<button
				type="button"
				role="menuitem"
				class="text-base-text hover:bg-surface-2 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm"
				onclick={handleBrowse}
			>
				<FolderOpen size={16} />
				<span>Browse for folder…</span>
			</button>
		</div>
	{/if}
</div>
