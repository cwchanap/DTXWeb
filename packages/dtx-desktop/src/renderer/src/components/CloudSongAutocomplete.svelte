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
		class="autocomplete-popup border-hairline bg-surface-1 fixed z-50 rounded-lg border shadow-xl"
		style="top: {position?.top || 50}px; left: {position?.left ||
			50}px; width: {position?.width || 400}px;"
	>
		<!-- Header -->
		<div class="border-hairline flex items-center gap-2 border-b p-4">
			<Link size={18} class="text-cyan" />
			<h3 class="font-display text-hi font-semibold">Link to Cloud Song</h3>
			<button
				class="text-faint hover:bg-surface-2 hover:text-base-text ml-auto rounded-lg p-1"
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
					<Search size={16} class="text-faint" />
				</div>
				<input
					bind:this={searchInputRef}
					type="text"
					bind:value={searchQuery}
					placeholder="Search by song title or artist..."
					class="border-hairline bg-surface-2 text-hi placeholder-faint focus:border-cyan w-full rounded-lg border py-2 pr-4 pl-10 focus:ring-1 focus:outline-none"
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
						class="text-faint hover:text-base-text absolute inset-y-0 right-0 flex items-center pr-3"
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
						class="border-cyan h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
					></div>
					<span class="text-dim ml-2 text-sm">Searching...</span>
				</div>
			{:else if searchQuery.trim().length >= 2}
				{#if suggestions.length > 0}
					<div class="border-hairline border-t">
						{#each suggestions as song, index}
							<button
								class="border-hairline hover:bg-surface-2 focus:bg-surface-2 flex w-full items-center gap-3 border-b p-4 text-left transition-colors focus:outline-none {selectedIndex ===
								index
									? 'bg-surface-2'
									: ''}"
								onclick={() => selectSong(song)}
								onmouseenter={() => (selectedIndex = index)}
							>
								<div
									class="bg-surface-2 flex h-10 w-10 items-center justify-center rounded-lg"
								>
									<Music size={16} class="text-cyan" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="text-hi truncate font-medium">
										{song.title}
									</div>
									<div class="text-dim flex items-center gap-2 text-sm">
										<User size={12} />
										<span class="truncate">{song.artist}</span>
										{#if song.bpm}
											<span class="text-faint">•</span>
											<span class="font-mono">{song.bpm} BPM</span>
										{/if}
										<span
											class="ml-auto rounded px-2 py-0.5 text-xs font-medium {song.is_published
												? 'border-green/40 bg-green/10 text-green'
												: 'bg-surface-2 text-dim'}"
										>
											{song.is_published ? 'Published' : 'Draft'}
										</span>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{:else}
					<div class="border-hairline border-t p-6 text-center">
						<Music size={24} class="text-faint mx-auto mb-2" />
						<p class="text-dim text-sm font-medium">No songs found</p>
						<p class="text-faint text-xs">Try a different search term</p>
					</div>
				{/if}
			{:else}
				<div class="border-hairline border-t p-6 text-center">
					<Search size={24} class="text-faint mx-auto mb-2" />
					<p class="text-dim text-sm font-medium">Start typing to search</p>
					<p class="text-faint text-xs">
						Enter at least 2 characters to search for cloud songs
					</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
