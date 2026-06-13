<script lang="ts">
	import { Search, X, Music, User, Link } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { desktopHost } from '../services/desktopHost';

	interface Props {
		isOpen: boolean;
		position?: { top: number; left: number; width: number };
		excludeLinkedSongIds?: string[];
		onclose?: () => void;
		onselect?: (song: CloudSong) => void;
	}

	interface CloudSong {
		id: string;
		title: string;
		artist: string;
		bpm?: number;
		is_published: boolean;
	}

	let {
		isOpen = false,
		position,
		excludeLinkedSongIds = [],
		onclose,
		onselect
	}: Props = $props();

	let searchQuery = $state('');
	let suggestions = $state<CloudSong[]>([]);
	let selectedIndex = $state(-1);
	let isLoading = $state(false);
	let searchTimeout: ReturnType<typeof setTimeout>;
	let searchInputRef = $state<HTMLInputElement>();

	const handleClose = () => {
		onclose?.();
		searchQuery = '';
		suggestions = [];
		selectedIndex = -1;
	};

	const handleSearchInput = () => {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(async () => {
			if (searchQuery.trim().length >= 2) {
				await searchCloudSongs();
			} else {
				suggestions = [];
				selectedIndex = -1;
			}
		}, 300);
	};

	const searchCloudSongs = async () => {
		if (!searchQuery.trim()) return;

		isLoading = true;
		try {
			const result = await desktopHost.searchCloudSongs<{
				success: boolean;
				data?: CloudSong[];
				error?: string;
			}>({
				query: searchQuery.trim(),
				limit: 20, // Increase limit to account for filtering
				excludeLinkedSongIds
			});

			if (result.success) {
				// Filter out already linked songs on the client side as well (double protection)
				const filteredSuggestions = (result.data || []).filter(
					(song: CloudSong) => !excludeLinkedSongIds.includes(song.id)
				);
				suggestions = filteredSuggestions.slice(0, 8); // Limit to 8 results after filtering
				selectedIndex = -1;
			} else {
				console.error('Search failed:', result.error);
				suggestions = [];
			}
		} catch (error) {
			console.error('Error searching cloud songs:', error);
			suggestions = [];
		} finally {
			isLoading = false;
		}
	};

	const handleKeydown = (event: KeyboardEvent) => {
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				break;
			case 'Enter':
				event.preventDefault();
				if (selectedIndex >= 0 && suggestions[selectedIndex]) {
					selectSong(suggestions[selectedIndex]);
				}
				break;
			case 'Escape':
				event.preventDefault();
				handleClose();
				break;
		}
	};

	const selectSong = (song: CloudSong) => {
		onselect?.(song);
		handleClose();
	};

	const handleClickOutside = (event: MouseEvent) => {
		const target = event.target as Element;
		if (!target.closest('.autocomplete-popup')) {
			handleClose();
		}
	};

	onMount(() => {
		if (isOpen && searchInputRef) {
			searchInputRef.focus();
		}

		// Add click outside listener with a small delay to prevent immediate closure
		const timeoutId = setTimeout(() => {
			document.addEventListener('click', handleClickOutside);
		}, 100);

		return () => {
			clearTimeout(timeoutId);
			document.removeEventListener('click', handleClickOutside);
			clearTimeout(searchTimeout);
		};
	});

	$effect(() => {
		if (isOpen && searchInputRef) {
			searchInputRef.focus();
		}
	});
</script>

{#if isOpen}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-40 bg-black/20"
		onclick={handleClose}
		onkeydown={(e) => e.key === 'Escape' && handleClose()}
		role="button"
		tabindex="-1"
		aria-label="Close popup"
	></div>

	<!-- Popup -->
	<div
		class="autocomplete-popup fixed z-50 rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800"
		style="top: {position?.top || 50}px; left: {position?.left ||
			50}px; width: {position?.width || 400}px;"
	>
		<!-- Header -->
		<div class="flex items-center gap-2 border-b border-slate-200 p-4 dark:border-slate-700">
			<Link size={18} class="text-purple-500 dark:text-purple-400" />
			<h3 class="font-semibold text-slate-900 dark:text-slate-100">Link to Cloud Song</h3>
			<button
				class="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
				onclick={handleClose}
				aria-label="Close"
			>
				<X size={16} />
			</button>
		</div>

		<!-- Search Input -->
		<div class="p-4">
			<div class="relative">
				<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
					<Search size={16} class="text-slate-400" />
				</div>
				<input
					bind:this={searchInputRef}
					type="text"
					bind:value={searchQuery}
					placeholder="Search by song title or artist..."
					class="w-full rounded-lg border border-slate-200 bg-white py-2 pr-4 pl-10 text-slate-900 placeholder-slate-400 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-purple-400 dark:focus:ring-purple-400"
					oninput={handleSearchInput}
					onkeydown={handleKeydown}
				/>
				{#if searchQuery}
					<button
						onclick={() => {
							searchQuery = '';
							suggestions = [];
							selectedIndex = -1;
						}}
						class="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
						aria-label="Clear search"
					>
						<X size={16} />
					</button>
				{/if}
			</div>
		</div>

		<!-- Results -->
		<div class="max-h-80 overflow-y-auto">
			{#if isLoading}
				<div class="flex items-center justify-center p-6">
					<div
						class="h-5 w-5 animate-spin rounded-full border-2 border-purple-500 border-t-transparent"
					></div>
					<span class="ml-2 text-sm text-slate-600 dark:text-slate-400">Searching...</span
					>
				</div>
			{:else if searchQuery.trim().length >= 2}
				{#if suggestions.length > 0}
					<div class="border-t border-slate-200 dark:border-slate-700">
						{#each suggestions as song, index}
							<button
								class="flex w-full items-center gap-3 border-b border-slate-100 p-4 text-left transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:border-slate-700 dark:hover:bg-slate-700/50 dark:focus:bg-slate-700/50 {selectedIndex ===
								index
									? 'bg-slate-50 dark:bg-slate-700/50'
									: ''}"
								onclick={() => selectSong(song)}
								onmouseenter={() => (selectedIndex = index)}
							>
								<div
									class="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30"
								>
									<Music size={16} class="text-purple-600 dark:text-purple-400" />
								</div>
								<div class="min-w-0 flex-1">
									<div
										class="truncate font-medium text-slate-900 dark:text-slate-100"
									>
										{song.title}
									</div>
									<div
										class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400"
									>
										<User size={12} />
										<span class="truncate">{song.artist}</span>
										{#if song.bpm}
											<span class="text-slate-400">•</span>
											<span>{song.bpm} BPM</span>
										{/if}
										<span
											class="ml-auto rounded px-2 py-0.5 text-xs font-medium {song.is_published
												? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
												: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'}"
										>
											{song.is_published ? 'Published' : 'Draft'}
										</span>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{:else}
					<div class="border-t border-slate-200 p-6 text-center dark:border-slate-700">
						<Music size={24} class="mx-auto mb-2 text-slate-400" />
						<p class="text-sm font-medium text-slate-600 dark:text-slate-400">
							No songs found
						</p>
						<p class="text-xs text-slate-500 dark:text-slate-500">
							Try a different search term
						</p>
					</div>
				{/if}
			{:else}
				<div class="border-t border-slate-200 p-6 text-center dark:border-slate-700">
					<Search size={24} class="mx-auto mb-2 text-slate-400" />
					<p class="text-sm font-medium text-slate-600 dark:text-slate-400">
						Start typing to search
					</p>
					<p class="text-xs text-slate-500 dark:text-slate-500">
						Enter at least 2 characters to search for cloud songs
					</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
