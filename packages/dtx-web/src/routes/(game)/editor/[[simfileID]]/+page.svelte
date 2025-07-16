<script lang="ts">
	import { type Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { Editor } from '@/game/scenes/Editor';
	import { onMount } from 'svelte';
	import MainTab from '$lib/components/editor/MainTab.svelte';
	import { DTXFile, SimFile } from '@dtx/common';
	import SoundTab from '$lib/components/editor/SoundTab.svelte';
	import { get } from 'svelte/store';
	import EventType from '@/game/EventType';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import store from '$lib/store';
	import { EventBus } from '@/game/EventBus';
	import { page } from '$app/state';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import { TempChartStorage } from '$lib/services/tempChartStorage';

	let phaserRef: TPhaserRef = { game: null, scene: null };
	let currentTab: number = $state(0);
	let isPreviewing = $state(false);
	let isTabsCollapsed = $state(false);
	let simfileID = $state('');
	let showDifficultyModal = $state(false);
	let showTips = $state(true);

	// Event emitted from the PhaserGame component
	const currentActiveScene = (scene: Scene) => {
		return scene;
	};

	function exportFile() {
		const dtxFile = get(store.currentDtxFile);
		const notes = get(store.editorNotes);
		dtxFile?.export(notes);
	}

	function newFile() {
		store.currentDtxFile.set(new DTXFile());
	}

	function discardLocalChanges() {
		const currentSimfileID = get(store.currentSimfileID);
		const currentDifficulty = get(store.currentDifficulty);

		// Show confirmation dialog
		const chartName = currentSimfileID || 'current chart';
		const difficultyText = currentDifficulty ? ` (${currentDifficulty})` : '';
		const message = `Are you sure you want to discard all local changes for ${chartName}${difficultyText}?\n\nThis action cannot be undone. All unsaved edits will be permanently lost.`;

		if (!confirm(message)) {
			return; // User cancelled
		}

		// Remove the temporary data for current simfile and difficulty
		TempChartStorage.remove(currentSimfileID, currentDifficulty);

		// Get the editor scene and clear its dirty state
		if (phaserRef.scene && phaserRef.scene.scene.key === Editor.key) {
			const editorScene = phaserRef.scene as Editor;
			editorScene.setDirty(false);
		}

		// Reload the page to restore the original state
		window.location.reload();
	}

	async function switchToLevel(level: number) {
		const simfile = get(store.currentSimfile);
		if (!simfile || !simfile.levels[level]) {
			console.error(`Level ${level} not found in simfile`);
			return;
		}

		const dtxFile = simfile.levels[level].file;

		// Parse notes and BPM changes for the selected difficulty
		const notes = dtxFile.parseNotes();
		const bpmNotes = dtxFile.parseBPMChanges();
		const soundChips = dtxFile.parseSoundChips();

		// Update stores
		store.currentDtxFile.set(dtxFile);
		store.currentSoundChip.set(soundChips);

		// Set the current difficulty
		const levelData = simfile.levels[level];
		if (levelData) {
			store.currentDifficulty.set(levelData.label);
		}

		// Fetch sound files
		await Promise.all(
			soundChips.map(async (soundChip) => {
				await soundChip.fetchRemote(simfileID, PUBLIC_SIMFILE_BUCKET_URL);
			})
		);

		// Emit note import event to update the editor
		EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);

		// Close modal
		showDifficultyModal = false;
	}

	function getAvailableLevels() {
		const simfile = get(store.currentSimfile);
		if (!simfile) return [];

		return Object.entries(simfile.levels)
			.filter(([_, level]) => level !== undefined)
			.map(([levelNum, level]) => ({
				level: parseInt(levelNum),
				label: level!.label,
				isActive: get(store.currentDtxFile) === level!.file
			}));
	}

	onMount(async () => {
		store.activeScene.set(Editor.key);
		store.isPreviewing.subscribe((value) => {
			isPreviewing = value;
		});
		simfileID = page.params.simfileID;
		store.currentSimfileID.set(simfileID || null);
		if (!simfileID) {
			newFile();
			return;
		}

		try {
			// Load simfile from remote URL
			const simfile = await SimFile.parseFromRemoteURL(simfileID, PUBLIC_SIMFILE_BUCKET_URL);

			// Get the highest level DTX file from the simfile
			const highestDtx = simfile.getHighestLevel();

			// Parse notes and BPM changes
			const notes = highestDtx.parseNotes();
			const bpmNotes = highestDtx.parseBPMChanges();
			const soundChips = highestDtx.parseSoundChips();

			// Set the current DTX file and simfile in the store
			store.currentDtxFile.set(highestDtx);
			store.currentSimfile.set(simfile);
			store.currentSoundChip.set(soundChips);

			// Find and set the current difficulty
			const currentLevel = Object.entries(simfile.levels).find(
				([_, level]) => level?.file === highestDtx
			);
			if (currentLevel && currentLevel[1]) {
				store.currentDifficulty.set(currentLevel[1].label);
			}

			await Promise.all(
				soundChips.map(async (soundChip) => {
					await soundChip.fetchRemote(simfileID, PUBLIC_SIMFILE_BUCKET_URL);
				})
			);

			// Emit note import event
			EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);
		} catch (error) {
			console.error('Error loading simfile:', error);
			newFile(); // Fallback to new file if loading fails
		}
	});
</script>

<div class="grid h-screen grid-cols-1 grid-rows-[auto_1fr]">
	<div class="relative row-span-1 flex flex-row items-center border-b-2 border-gray-400">
		<Popover
			positioning={{ placement: 'bottom-start' }}
			contentBase="p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
			classes="w-1/12 rounded-sm bg-gray-200 py-2 hover:bg-gray-300"
			triggerClasses="w-full"
		>
			{#snippet trigger()}
				<span>File</span>
			{/snippet}
			{#snippet content()}
				<div class="flex flex-col">
					<button class="px-4 py-2 text-left hover:bg-gray-100" onclick={newFile}
						>New</button
					>
					{#if simfileID}
						<button
							class="px-4 py-2 text-left hover:bg-gray-100"
							onclick={() => (showDifficultyModal = true)}>Switch file</button
						>
					{/if}
					<button class="px-4 py-2 text-left hover:bg-gray-100" onclick={exportFile}
						>Export</button
					>
				</div>
			{/snippet}
		</Popover>

		<Popover
			positioning={{ placement: 'bottom-start' }}
			contentBase="p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
			classes="w-1/12 rounded-sm bg-gray-200 py-2 hover:bg-gray-300"
			triggerClasses="w-full"
		>
			{#snippet trigger()}
				<span>Edit</span>
			{/snippet}
			{#snippet content()}
				<div class="flex flex-col">
					<button
						class="px-4 py-2 text-left hover:bg-gray-100"
						onclick={discardLocalChanges}
						title="Discard all local changes and reload from server"
					>
						Discard current Local changes
					</button>
				</div>
			{/snippet}
		</Popover>

		<div class="h-8 border-l border-gray-300"></div>
	</div>

	<!-- Main content area - change to flex column on small screens, row on larger screens -->
	<div class="row-span-1 flex flex-col 2xl:flex-row">
		<!-- Left tab panel - full width on small screens, 25% on large screens -->
		<div class="w-full pt-4 2xl:w-[25%]">
			<div class="tab-container">
				<!-- Collapsible header -->
				<div class="border-b border-gray-200 bg-gray-50">
					<button
						class="focus:ring-primary-500 flex w-full items-center justify-between px-4 py-3 text-left font-medium text-gray-700 hover:bg-gray-100 focus:ring-2 focus:outline-none"
						onclick={() => (isTabsCollapsed = !isTabsCollapsed)}
						aria-expanded={!isTabsCollapsed}
					>
						<span>Editor Tabs</span>
						<svg
							class="h-5 w-5 transform transition-transform duration-200 {isTabsCollapsed
								? 'rotate-0'
								: 'rotate-180'}"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 9l-7 7-7-7"
							/>
						</svg>
					</button>
				</div>

				<!-- Collapsible content -->
				{#if !isTabsCollapsed}
					<div class="h-[600px] overflow-y-auto border border-gray-200 bg-white">
						<!-- Tab controls -->
						<div class="tab-list flex border-b border-gray-200">
							<button
								class="w-[15%] px-4 py-2 hover:bg-gray-100 hover:text-gray-800 2xl:w-1/4 {currentTab ===
								0
									? 'bg-primary-500 text-white'
									: 'bg-gray-100 text-gray-700'}"
								onclick={() => (currentTab = 0)}
							>
								Main
							</button>
							{#if !isPreviewing}
								<button
									class="w-[15%] px-4 py-2 hover:bg-gray-100 hover:text-gray-800 2xl:w-1/4 {currentTab ===
									1
										? 'bg-primary-500 text-white'
										: 'bg-gray-100 text-gray-700'}"
									onclick={() => (currentTab = 1)}
								>
									Sound
								</button>
							{/if}
						</div>

						<!-- Tab panels -->
						<div class="tab-content p-4">
							{#if currentTab === 0}
								<MainTab />
							{:else if currentTab === 1}
								<SoundTab />
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Center game component - expanded to fill remaining space -->
		<div class="flex w-full justify-center p-5 2xl:w-[75%]">
			<Main {phaserRef} {currentActiveScene} />
		</div>
	</div>
</div>

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
				<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
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

<!-- Difficulty Selection Modal -->
{#if showDifficultyModal}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
			<h2 class="mb-4 text-xl font-bold text-gray-800">Switch Difficulty</h2>

			<div class="space-y-2">
				{#each getAvailableLevels() as { level, label, isActive }}
					<button
						class="w-full rounded-md border px-4 py-3 text-left transition-colors {isActive
							? 'border-blue-500 bg-blue-50 text-blue-700'
							: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
						onclick={() => switchToLevel(level)}
						disabled={isActive}
					>
						<div class="flex items-center justify-between">
							<div>
								<div class="font-medium">{label}</div>
								<div class="text-sm text-gray-500">Level {level}</div>
							</div>
							{#if isActive}
								<span class="text-sm font-medium text-blue-600">Current</span>
							{/if}
						</div>
					</button>
				{/each}
			</div>

			<div class="mt-6 flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
					onclick={() => (showDifficultyModal = false)}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}
