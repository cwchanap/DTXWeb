<script lang="ts">
	import { type Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@/game/main.svelte';
	import { Editor } from '@/game/scenes/Editor';
	import { onMount } from 'svelte';
	import MainTab from '$lib/components/editor/MainTab.svelte';
	import { DTXFile, SimFile, decodeFileWithEncodingDetection } from '@dtx/common';
	import SoundTab from '$lib/components/editor/SoundTab.svelte';
	import { get } from 'svelte/store';
	import EventType from '@/game/EventType';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import store from '$lib/store';
	import { EventBus } from '@/game/EventBus';
	import { page } from '$app/state';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import { TempChartStorage } from '$lib/services/tempChartStorage';
	import { SoundLibrary } from '$lib/services/soundLibrary';

	let phaserRef: TPhaserRef = { game: null, scene: null };
	let currentTab: number = $state(0);
	let isPreviewing = $state(false);
	let isTabsCollapsed = $state(false);
	let simfileID = $state('');
	let showDifficultyModal = $state(false);
	let showDiscardModal = $state(false);
	let showTips = $state(true);
	let showSoundLibraryModal = $state(false);

	// Event emitted from the PhaserGame component
	const currentActiveScene = (scene: Scene) => {
		return scene;
	};

	function exportFile() {
		const dtxFile = get(store.currentDtxFile);
		const notes = get(store.editorNotes);
		dtxFile?.export(notes);
	}

	function importFile() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.dtx';
		input.onchange = handleFileImport;
		input.click();
	}

	async function handleFileImport(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		try {
			// DTX file validation callback
			const validateDtxContent = (content: string): boolean => {
				return (
					content.includes('#TITLE:') ||
					content.includes('#ARTIST:') ||
					content.includes('#BPM:') ||
					content.includes('#WAV') ||
					content.length > 0
				);
			};

			// Use encoding detection to handle different DTX file encodings
			const fileContent = await decodeFileWithEncodingDetection(
				file,
				validateDtxContent,
				['shift-jis', 'utf-8', 'utf-16le', 'utf-16be'], // DTX files typically use shift-jis first
				'shift-jis' // DTX fallback is shift-jis
			);

			const dtxFile = new DTXFile();
			await dtxFile.parseFromText(fileContent);

			// Parse notes and BPM changes from the imported DTX file
			const notes = dtxFile.parseNotes();
			const bpmNotes = dtxFile.parseBPMChanges();
			const soundChips = dtxFile.parseSoundChips();

			// Update stores with imported data
			store.currentDtxFile.set(dtxFile);
			store.currentSoundChip.set(soundChips);
			store.currentSimfile.set(null); // Clear simfile as we're working with imported file
			store.currentSimfileID.set(null);
			store.currentDifficulty.set('Imported');

			// Clear any existing temp data for the imported chart
			TempChartStorage.remove(null, 'Imported');

			// Wait a bit to ensure the scene is ready, then emit note import event
			setTimeout(() => {
				EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);
			}, 100);
		} catch (error) {
			console.error('Error importing DTX file:', error);
			alert('Failed to import DTX file. Please check the file format.');
		}
	}

	function newFile() {
		store.currentDtxFile.set(new DTXFile());
	}

	function discardLocalChanges() {
		// Show confirmation modal instead of native confirm dialog
		showDiscardModal = true;
	}

	function confirmDiscardChanges() {
		const currentSimfileID = get(store.currentSimfileID);
		const currentDifficulty = get(store.currentDifficulty);

		// Remove the temporary data for current simfile and difficulty
		TempChartStorage.remove(currentSimfileID, currentDifficulty);

		// Get the editor scene and clear its dirty state
		if (phaserRef.scene && phaserRef.scene.scene.key === Editor.key) {
			const editorScene = phaserRef.scene as Editor;
			editorScene.setDirty(false);
		}

		// Close modal and reload the page to restore the original state
		showDiscardModal = false;
		window.location.reload();
	}

	function cancelDiscardChanges() {
		showDiscardModal = false;
	}

	function handleDiscardModalKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			cancelDiscardChanges();
		}
	}

	function focusModal(element: HTMLElement) {
		element.focus();
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
			// Check if there's imported chart data available
			const importedData = TempChartStorage.load(null, 'Imported');
			if (importedData) {
				// Set difficulty to 'Imported' so the Editor can find the temp data
				store.currentDifficulty.set('Imported');
			} else {
				// No imported data, create a new file
				newFile();
			}
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

	// Sound Library Management
	let soundLibraryFiles = $state(SoundLibrary.getAll());
	let libraryStats = $state(SoundLibrary.getStats());

	function refreshSoundLibrary() {
		soundLibraryFiles = SoundLibrary.getAll();
		libraryStats = SoundLibrary.getStats();
	}

	function addSoundFiles() {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'audio/*';
		input.multiple = true;
		input.onchange = handleSoundFilesImport;
		input.click();
	}

	async function handleSoundFilesImport(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = Array.from(target.files || []);
		if (files.length === 0) return;

		try {
			const result = await SoundLibrary.addFiles(files);

			// Show result message
			let message = `Added ${result.added} files`;
			if (result.skipped > 0) {
				message += `, skipped ${result.skipped} duplicates`;
			}
			if (result.errors.length > 0) {
				message += `\n\nErrors:\n${result.errors.join('\n')}`;
			}
			alert(message);

			refreshSoundLibrary();
		} catch (error) {
			console.error('Error importing sound files:', error);
			alert('Failed to import sound files');
		}
	}

	function removeSoundFile(hash: string) {
		if (confirm('Are you sure you want to remove this sound file?')) {
			SoundLibrary.removeFile(hash);
			refreshSoundLibrary();
		}
	}

	function clearSoundLibrary() {
		if (
			confirm(
				'Are you sure you want to clear the entire sound library? This cannot be undone.'
			)
		) {
			SoundLibrary.clear();
			refreshSoundLibrary();
		}
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString();
	}

	function formatFileSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB'];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(1)} ${units[unitIndex]}`;
	}

	async function refreshSoundLibraryLinks() {
		const soundChips = get(store.currentSoundChip);
		if (!soundChips || soundChips.length === 0) {
			alert('No sound chips in current chart to refresh');
			return;
		}

		let matched = 0;
		let notFound = 0;

		try {
			// Update sound chips with files from library
			const updatedSoundChips = await Promise.all(
				soundChips.map(async (chip) => {
					// If already has a file, skip
					if (chip.file) {
						return chip;
					}

					// Try to find by filename in library
					const libraryFiles = SoundLibrary.findByFileName(chip.fileName);
					if (libraryFiles.length > 0) {
						// Use the first match (most recent if multiple)
						const libraryFile = libraryFiles[0];
						const file = SoundLibrary.toFile(libraryFile);
						chip.file = file;
						matched++;
					} else {
						notFound++;
					}

					return chip;
				})
			);

			// Update the store
			store.currentSoundChip.set(updatedSoundChips);

			// Show result
			let message = `Refresh complete:\n${matched} files matched`;
			if (notFound > 0) {
				message += `\n${notFound} files not found in library`;
			}
			alert(message);

			// Trigger auto-save to persist the links
			if (matched > 0) {
				// Get the editor scene and trigger auto-save
				if (phaserRef.scene && phaserRef.scene.scene.key === Editor.key) {
					const editorScene = phaserRef.scene as any;
					if (editorScene.autoSaveChart) {
						await editorScene.autoSaveChart();
					}
				}
			}
		} catch (error) {
			console.error('Error refreshing sound library links:', error);
			alert('Failed to refresh sound library links');
		}
	}
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
					<button class="px-4 py-2 text-left hover:bg-gray-100" onclick={importFile}
						>Import</button
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
						onclick={() => (showSoundLibraryModal = true)}
					>
						Manage Sound files library
					</button>
					<button
						class="px-4 py-2 text-left hover:bg-gray-100"
						onclick={refreshSoundLibraryLinks}
					>
						Refresh Sound Library Links
					</button>
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

<!-- Discard Changes Confirmation Modal -->
{#if showDiscardModal}
	<div
		class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black"
		role="dialog"
		aria-modal="true"
		aria-labelledby="discard-modal-title"
		aria-describedby="discard-modal-description"
		onkeydown={handleDiscardModalKeydown}
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
				{#if true}
					{@const currentSimfileID = get(store.currentSimfileID)}
					{@const currentDifficulty = get(store.currentDifficulty)}
					{@const chartName = currentSimfileID || 'current chart'}
					{@const difficultyText = currentDifficulty ? ` (${currentDifficulty})` : ''}
					<p class="mb-3 text-gray-700">
						Are you sure you want to discard all local changes for <strong
							>{chartName}{difficultyText}</strong
						>?
					</p>
				{/if}
				<p class="text-sm font-medium text-red-600">
					⚠️ This action cannot be undone. All unsaved edits will be permanently lost.
				</p>
			</div>

			<div class="flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
					onclick={cancelDiscardChanges}
				>
					Cancel
				</button>
				<button
					class="rounded-md bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
					onclick={confirmDiscardChanges}
				>
					Discard Changes
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Sound Library Management Modal -->
{#if showSoundLibraryModal}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div
			class="mx-4 flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white p-6 shadow-xl"
		>
			<div class="mb-4 flex items-center justify-between border-b border-gray-200 pb-4">
				<h2 class="text-xl font-bold text-gray-800">Sound Files Library</h2>
				<button
					class="rounded-md text-gray-400 hover:text-gray-600"
					onclick={() => (showSoundLibraryModal = false)}
				>
					<svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>

			<!-- Library Stats -->
			<div class="mb-4 rounded-lg bg-gray-50 p-4">
				<div class="flex items-center justify-between">
					<div>
						<span class="text-sm text-gray-600">
							{libraryStats.fileCount} files, {libraryStats.sizeFormatted} total
						</span>
					</div>
					<div class="space-x-2">
						<button
							class="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
							onclick={addSoundFiles}
						>
							Add Files
						</button>
						{#if libraryStats.fileCount > 0}
							<button
								class="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
								onclick={clearSoundLibrary}
							>
								Clear All
							</button>
						{/if}
					</div>
				</div>
			</div>

			<!-- File List -->
			<div class="flex-1 overflow-y-auto">
				{#if soundLibraryFiles.length === 0}
					<div class="py-8 text-center text-gray-500">
						<svg
							class="mx-auto mb-4 h-12 w-12 text-gray-400"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
							/>
						</svg>
						<p class="text-lg font-medium">No sound files in library</p>
						<p class="text-sm">Click "Add Files" to import audio files</p>
					</div>
				{:else}
					<div class="space-y-2">
						{#each soundLibraryFiles as file}
							<div
								class="flex items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
							>
								<div class="min-w-0 flex-1">
									<div class="flex items-center space-x-3">
										<svg
											class="h-5 w-5 flex-shrink-0 text-blue-500"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
											/>
										</svg>
										<div class="min-w-0 flex-1">
											<p class="truncate text-sm font-medium text-gray-900">
												{file.fileName}
											</p>
											<p class="text-xs text-gray-500">
												{formatFileSize(file.size)} • {file.fileType} • Added
												{formatDate(file.dateAdded)}
											</p>
										</div>
									</div>
								</div>
								<button
									class="ml-3 rounded-md text-red-600 hover:text-red-800"
									onclick={() => removeSoundFile(file.hash)}
									title="Remove file"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
										/>
									</svg>
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="mt-4 border-t border-gray-200 pt-4">
				<div class="flex justify-end">
					<button
						class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
						onclick={() => (showSoundLibraryModal = false)}
					>
						Close
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
