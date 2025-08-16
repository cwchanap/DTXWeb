<script lang="ts">
	import { type Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@dtx/common/game';
	import { Editor } from '@dtx/common/game';
	import { Preview } from '@dtx/common/game';
	import { onMount } from 'svelte';
	import { MainTab, PreviewTab } from '@dtx/common/components';
	import {
		DTXFile,
		SimFile,
		decodeFileWithEncodingDetection,
		type LaneMeasureNote
	} from '@dtx/common';
	import { SoundTab } from '@dtx/common/components';
	import { get } from 'svelte/store';
	import { EventType } from '@dtx/common/game';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import store from '$lib/store';
	import { EventBus } from '@dtx/common/game';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import { Modal } from '@dtx/ui-components/components';
	import { Trash2, X, Music, ChevronDown } from '@lucide/svelte/icons';
	import { TempChartStorage } from '$lib/services/tempChartStorage';
	import { SoundLibrary } from '$lib/services/soundLibrary';
	import {
		workspaceService,
		WorkspaceService,
		type Workspace
	} from '$lib/services/workspaceService';
	import * as FileManager from '@dtx/common/services/fileManager';
	// Use the data prop directly since SvelteKit handles the typing
	interface SimFileMetadata {
		title: string;
		levels: {
			[key: number]:
				| {
						label: string;
						fileName: string;
				  }
				| undefined;
		};
	}

	interface Props {
		data: {
			simfileID: string | null;
			metadata: SimFileMetadata | null; // null only for local files (no simfileID)
		};
	}

	let { data }: Props = $props();

	let phaserRef: TPhaserRef = { game: null, scene: null };
	let currentTab: number = $state(0);
	let isPreviewing = $state(false);
	let isTabsCollapsed = $state(false);
	let isEditorLoaded = $state(false);
	let simfileID = $state('');
	let showDifficultyModal = $state(false);
	let showDiscardModal = $state(false);
	let showTips = $state(true);
	let showSoundLibraryModal = $state(false);
	let showImportResultModal = $state(false);
	let showRefreshResultModal = $state(false);
	let showImportErrorModal = $state(false);
	let showRemoveConfirmModal = $state(false);
	let showClearConfirmModal = $state(false);
	let showNewFileModal = $state(false);
	let showWorkspaceSwitchModal = $state(false);
	let showDTXSwitchModal = $state(false);
	let showDeleteWorkspaceModal = $state(false);
	let importResultMessage = $state('');
	let refreshResultMessage = $state('');
	let importErrorMessage = $state('');
	let removeFileHash = $state('');
	let workspaceToDelete = $state<Workspace | null>(null);
	let currentWorkspace = $state<Workspace | null>(null);
	let availableWorkspaces = $state<Workspace[]>([]);

	// Event emitted from the PhaserGame component
	const currentActiveScene = (scene: Scene) => {
		// Check if the Editor scene is loaded when it becomes active
		if (scene.scene.key === Editor.key) {
			const editorScene = scene as Editor;
			isEditorLoaded = editorScene.getIsLoaded();
		}
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

	function importFolder() {
		const input = document.createElement('input');
		input.type = 'file';
		input.webkitdirectory = true;
		input.multiple = true;
		input.onchange = handleFolderImport;
		input.click();
	}

	async function handleFolderImport(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = target.files;
		if (!files || files.length === 0) return;

		try {
			const workspace = await workspaceService.importFolder(files);
			currentWorkspace = workspace;

			// Refresh available workspaces list
			availableWorkspaces = workspaceService.getWorkspaces();

			// Switch to the first DTX file in the workspace
			if (workspace.dtxFiles.length > 0) {
				const firstDTX = workspace.dtxFiles[0].name;
				await switchWorkspaceDTX(firstDTX);
			}

			// Set current workspace
			workspaceService.setCurrentWorkspace(workspace);

			importResultMessage = `Imported workspace "${workspace.name}"\n- ${workspace.dtxFiles.length} DTX files\n- ${workspace.audioFiles.length} audio files added to sound library`;
			showImportResultModal = true;
		} catch (error) {
			console.error('Error importing folder:', error);
			importErrorMessage = 'Failed to import folder. Please check the folder contents.';
			showImportErrorModal = true;
		}
	}

	async function switchWorkspaceDTX(dtxFileName: string) {
		if (!currentWorkspace) return;

		try {
			// Stop any existing preview to ensure clean re-draw when switching DTX files
			EventBus.emit(EventType.STOP_PREVIEW);

			const result = await workspaceService.parseDTXFile(currentWorkspace, dtxFileName);
			if (!result) {
				console.error('Failed to parse DTX file:', dtxFileName);
				return;
			}

			const { dtxFile, simFile } = result;

			// Parse notes and BPM changes
			const notes = dtxFile.parseNotes();
			const bpmNotes = dtxFile.parseBPMChanges();
			const soundChips = dtxFile.parseSoundChips();

			// Map sound chips to files from the SimFile
			const mappedSoundChips = soundChips.map((chip) => {
				if (chip.fileName) {
					const matchingFile = simFile.files.find(
						(f) => f.name.toLowerCase() === chip.fileName.toLowerCase()
					);
					if (matchingFile) {
						// Store file only in FileManager to avoid store corruption
						const currentSimfileID = get(store.currentSimfileID);
						const fileKey = FileManager.generateKey(currentSimfileID, chip.fileName);
						FileManager.setFile(fileKey, matchingFile);

						// Don't store File object in chip to avoid store corruption
						chip.file = undefined;
					} else {
						// Try exact match without case conversion
						const exactMatch = simFile.files.find((f) => f.name === chip.fileName);
						if (exactMatch) {
							const currentSimfileID = get(store.currentSimfileID);
							const fileKey = FileManager.generateKey(
								currentSimfileID,
								chip.fileName
							);
							FileManager.setFile(fileKey, exactMatch);
							chip.file = undefined;
						}
					}
				}
				return chip;
			});

			// Update stores
			store.currentDtxFile.set(dtxFile);
			store.currentSoundChip.set(mappedSoundChips);
			store.currentSimfile.set(simFile);
			store.currentSimfileID.set(null); // Local workspace
			store.currentDifficulty.set(dtxFileName.replace('.dtx', ''));

			// Switch workspace current DTX
			workspaceService.switchDTXFile(currentWorkspace, dtxFileName);

			// Clear any existing temp data
			TempChartStorage.remove(null, get(store.currentDifficulty));

			// Emit note import event
			setTimeout(() => {
				EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);

				// After notes are imported and Editor scene is ready, clean up Preview scene
				setTimeout(() => {
					if (phaserRef.scene && phaserRef.scene.scene.key === Editor.key) {
						const editorScene = phaserRef.scene as Editor;

						if (
							editorScene.scene.isActive(Preview.key) ||
							editorScene.scene.isPaused(Preview.key)
						) {
							editorScene.scene.stop(Preview.key);
						}

						// Force editor to be dirty so Preview rebuilds completely
						editorScene.setDirty(true);
					}
				}, 200);
			}, 100);
		} catch (error) {
			console.error('Error switching DTX file:', error);
		}
	}

	function showWorkspaceManager() {
		availableWorkspaces = workspaceService.getWorkspaces();
		showWorkspaceSwitchModal = true;
	}

	function showDTXSwitcher() {
		showDTXSwitchModal = true;
	}

	async function switchToWorkspace(workspace: Workspace) {
		try {
			// Stop any existing preview
			EventBus.emit(EventType.STOP_PREVIEW);

			// Set the workspace as current
			currentWorkspace = workspace;
			workspaceService.setCurrentWorkspace(workspace);

			// Switch to the first or current DTX file in the workspace
			const targetDTX = workspace.currentDTX || workspace.dtxFiles[0]?.name;
			if (targetDTX) {
				await switchWorkspaceDTX(targetDTX);
			}

			showWorkspaceSwitchModal = false;
		} catch (error) {
			console.error('Error switching workspace:', error);
		}
	}

	function showDeleteWorkspaceConfirm(workspace: Workspace, event: Event) {
		event.stopPropagation(); // Prevent workspace switch
		workspaceToDelete = workspace;
		showDeleteWorkspaceModal = true;
	}

	async function confirmDeleteWorkspace() {
		if (!workspaceToDelete) return;

		try {
			const isCurrentWorkspace = currentWorkspace?.name === workspaceToDelete.name;

			// Delete the workspace
			workspaceService.deleteWorkspace(workspaceToDelete.name);

			// Clear large files from session storage for this workspace only
			WorkspaceService.clearSessionFiles(workspaceToDelete.name);

			// Refresh available workspaces
			availableWorkspaces = workspaceService.getWorkspaces();

			// If we deleted the current workspace, handle cleanup
			if (isCurrentWorkspace) {
				currentWorkspace = null;

				// Try to switch to another workspace if available
				if (availableWorkspaces.length > 0) {
					await switchToWorkspace(availableWorkspaces[0]);
				} else {
					// No workspaces left, create a new file
					newFile();
				}
			}

			// Close modals
			showDeleteWorkspaceModal = false;
			showWorkspaceSwitchModal = false;
			workspaceToDelete = null;
		} catch (error) {
			console.error('Error deleting workspace:', error);
		}
	}

	function cancelDeleteWorkspace() {
		showDeleteWorkspaceModal = false;
		workspaceToDelete = null;
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
			importErrorMessage = 'Failed to import DTX file. Please check the file format.';
			showImportErrorModal = true;
		}
	}

	function newFile() {
		// Check if there's temp data that would be lost
		const currentSimfileID = get(store.currentSimfileID);
		const currentDifficulty = get(store.currentDifficulty);
		const hasUnsavedChanges = TempChartStorage.exists(currentSimfileID, currentDifficulty);

		if (hasUnsavedChanges) {
			// Show confirmation modal
			showNewFileModal = true;
		} else {
			// No unsaved changes, proceed directly
			createNewFile();
		}
	}

	function createNewFile() {
		const currentSimfileID = get(store.currentSimfileID);
		const currentDifficulty = get(store.currentDifficulty);

		// Clear temp data for current chart
		TempChartStorage.remove(currentSimfileID, currentDifficulty);

		// Create new DTX file
		const newDtxFile = new DTXFile();

		// Create properly structured empty data
		const emptyNotes: LaneMeasureNote[] = []; // Empty array, not object
		const emptyBpmNotes: Record<string, number> = {};

		// Clear stores and set new DTX file
		store.currentDtxFile.set(newDtxFile);
		store.currentSimfile.set(null);
		store.currentSimfileID.set(null);
		store.currentDifficulty.set('New Chart');
		store.currentSoundChip.set([]);

		// Get the editor scene and clear its state
		if (phaserRef.scene && phaserRef.scene.scene.key === Editor.key) {
			const editorScene = phaserRef.scene as Editor;
			editorScene.setDirty(false);
			// Clear the editor notes and reset the scene with proper empty data
			EventBus.emit(EventType.NOTE_IMPORT, emptyNotes, emptyBpmNotes);
		}

		// If we're currently in a remote chart, redirect to local workspace after cleanup
		if (simfileID) {
			goto('/editor');
		}
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

		// Fetch remote files for sound chips
		await Promise.all(
			soundChips.map(async (soundChip) => {
				if (soundChip.fileName) {
					try {
						await soundChip.fetchRemote(simfileID, PUBLIC_SIMFILE_BUCKET_URL);

						// Store file in FileManager to avoid Svelte store serialization issues
						if (soundChip.file) {
							const fileKey = FileManager.generateKey(simfileID, soundChip.fileName);
							FileManager.setFile(fileKey, soundChip.file);

							// Clear file from chip to avoid store issues
							soundChip.file = undefined;
						}
					} catch (error) {
						console.error(
							'Failed to fetch remote file (switchToLevel):',
							soundChip.fileName,
							error
						);
					}
				}
			})
		);

		// Update store with fetched sound chips
		store.currentSoundChip.set(soundChips);

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
		simfileID = data.simfileID || '';
		store.currentSimfileID.set(simfileID || null);

		// Load available workspaces for the workspace switcher
		availableWorkspaces = workspaceService.getWorkspaces();

		if (!simfileID) {
			// Try to restore workspace from localStorage or URL
			currentWorkspace = workspaceService.getCurrentWorkspace();

			if (currentWorkspace && currentWorkspace.currentDTX) {
				// Restore workspace state
				await switchWorkspaceDTX(currentWorkspace.currentDTX);
				return;
			}

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
			// In production, we should always have server-side metadata
			// In development, fall back to client-side fetching if needed
			const simfile = data.metadata
				? await SimFile.parseFromRemoteURLWithMetadata(
						simfileID,
						PUBLIC_SIMFILE_BUCKET_URL,
						data.metadata
					)
				: await SimFile.parseFromRemoteURL(simfileID, PUBLIC_SIMFILE_BUCKET_URL);

			if (!data.metadata) {
				console.warn(
					'Using client-side SET.def fetching in development - this should not happen in production'
				);
			}

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

			// Fetch remote files for sound chips
			await Promise.all(
				soundChips.map(async (soundChip) => {
					if (soundChip.fileName) {
						try {
							await soundChip.fetchRemote(simfileID, PUBLIC_SIMFILE_BUCKET_URL);

							// Store file in FileManager to avoid Svelte store serialization issues
							if (soundChip.file) {
								const fileKey = FileManager.generateKey(
									simfileID,
									soundChip.fileName
								);
								FileManager.setFile(fileKey, soundChip.file);

								// Clear file from chip to avoid store issues
								soundChip.file = undefined;
							}
						} catch (error) {
							console.error(
								'Failed to fetch remote file:',
								soundChip.fileName,
								error
							);
						}
					}
				})
			);

			// Update store with fetched sound chips
			store.currentSoundChip.set(soundChips);

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
		input.accept = 'audio/*,.xa';
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
			importResultMessage = message;
			showImportResultModal = true;

			refreshSoundLibrary();
		} catch (error) {
			console.error('Error importing sound files:', error);
			importResultMessage = 'Failed to import sound files';
			showImportResultModal = true;
		}
	}

	function removeSoundFile(hash: string) {
		removeFileHash = hash;
		showRemoveConfirmModal = true;
	}

	function confirmRemoveSoundFile() {
		SoundLibrary.removeFile(removeFileHash);
		refreshSoundLibrary();
		removeFileHash = '';
	}

	function clearSoundLibrary() {
		showClearConfirmModal = true;
	}

	function confirmClearSoundLibrary() {
		SoundLibrary.clear();
		refreshSoundLibrary();
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
			refreshResultMessage = 'No sound chips in current chart to refresh';
			showRefreshResultModal = true;
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
			refreshResultMessage = message;
			showRefreshResultModal = true;

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
			refreshResultMessage = 'Failed to refresh sound library links';
			showRefreshResultModal = true;
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
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={newFile}
						disabled={isPreviewing}>New</button
					>
					{#if !simfileID}
						<button
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={importFile}
							disabled={isPreviewing}>Import File</button
						>
						<button
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={importFolder}
							disabled={isPreviewing}>Import Folder</button
						>
					{/if}
					{#if simfileID}
						<button
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={() => (showDifficultyModal = true)}
							disabled={isPreviewing}>Switch file</button
						>
					{:else if currentWorkspace && currentWorkspace.dtxFiles.length > 1}
						<button
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={showDTXSwitcher}
							disabled={isPreviewing}>Switch DTX</button
						>
					{/if}
					<button
						class="px-4 py-2 text-left {isPreviewing
							? 'cursor-not-allowed text-gray-400'
							: 'hover:bg-gray-100'}"
						onclick={exportFile}
						disabled={isPreviewing}>Export</button
					>
				</div>
			{/snippet}
		</Popover>

		{#if !simfileID}
			<!-- Only show Workspace menu for local files (no simfileID) -->
			<Popover
				positioning={{ placement: 'bottom-start' }}
				contentBase="p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
				classes="w-1/12 rounded-sm bg-gray-200 py-2 hover:bg-gray-300"
				triggerClasses="w-full"
			>
				{#snippet trigger()}
					<span>Workspace</span>
				{/snippet}
				{#snippet content()}
					<div class="flex flex-col">
						{#if availableWorkspaces.length > 0}
							<button
								class="px-4 py-2 text-left {isPreviewing
									? 'cursor-not-allowed text-gray-400'
									: 'hover:bg-gray-100'}"
								onclick={showWorkspaceManager}
								disabled={isPreviewing}
							>
								Manage Workspace
							</button>
						{/if}
						<button
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={() => (showSoundLibraryModal = true)}
							disabled={isPreviewing}
						>
							Manage Sound files library
						</button>
						<button
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={refreshSoundLibraryLinks}
							disabled={isPreviewing}
						>
							Refresh Sound Library Links
						</button>
					</div>
				{/snippet}
			</Popover>
		{:else}
			<!-- Show Edit menu with only discard changes for remote files -->
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
							class="px-4 py-2 text-left {isPreviewing
								? 'cursor-not-allowed text-gray-400'
								: 'hover:bg-gray-100'}"
							onclick={discardLocalChanges}
							title="Discard all local changes and reload from server"
							disabled={isPreviewing}
						>
							Discard current Local changes
						</button>
					</div>
				{/snippet}
			</Popover>
		{/if}

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
						<ChevronDown
							class="h-5 w-5 transform transition-transform duration-200 {isTabsCollapsed
								? 'rotate-0'
								: 'rotate-180'}"
						/>
					</button>
				</div>

				<!-- Collapsible content -->
				{#if !isTabsCollapsed}
					<div class="h-[600px] overflow-y-auto border border-gray-200 bg-white">
						<!-- Tab controls -->
						<div class="tab-list flex border-b border-gray-200">
							<button
								class="w-[15%] px-4 py-2 2xl:w-1/4 {currentTab === 0
									? 'bg-primary-500 text-white'
									: 'bg-gray-50 text-gray-700 hover:bg-gray-200 hover:text-gray-800'}"
								onclick={() => (currentTab = 0)}
							>
								Main
							</button>
							{#if !isPreviewing}
								<button
									class="w-[15%] px-4 py-2 2xl:w-1/4 {currentTab === 1
										? 'bg-primary-500 text-white'
										: 'bg-gray-50 text-gray-700 hover:bg-gray-200 hover:text-gray-800'}"
									onclick={() => (currentTab = 1)}
								>
									Sound
								</button>
							{/if}
							<button
								class="w-[15%] px-4 py-2 2xl:w-1/4 {currentTab === 2
									? 'bg-primary-500 text-white'
									: 'bg-gray-50 text-gray-700 hover:bg-gray-200 hover:text-gray-800'}"
								onclick={() => (currentTab = 2)}
							>
								Preview
							</button>
						</div>

						<!-- Tab panels -->
						<div class="tab-content p-4">
							{#if currentTab === 0}
								<MainTab />
							{:else if currentTab === 1}
								<SoundTab
									{simfileID}
									theme="light"
									bucketUrl={PUBLIC_SIMFILE_BUCKET_URL}
								/>
							{:else if currentTab === 2}
								<PreviewTab />
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
					<X class="h-6 w-6" />
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
						<Music class="mx-auto mb-4 h-12 w-12 text-gray-400" />
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
										<Music class="h-5 w-5 flex-shrink-0 text-blue-500" />
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
									aria-label="Remove file"
								>
									<Trash2 class="h-4 w-4" />
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

<!-- Import Result Modal -->
<Modal bind:open={showImportResultModal} title="Import Result">
	{#snippet children()}
		<p class="whitespace-pre-line text-gray-700">{importResultMessage}</p>
	{/snippet}
</Modal>

<!-- Refresh Result Modal -->
<Modal bind:open={showRefreshResultModal} title="Refresh Result">
	{#snippet children()}
		<p class="whitespace-pre-line text-gray-700">{refreshResultMessage}</p>
	{/snippet}
</Modal>

<!-- Import Error Modal -->
<Modal bind:open={showImportErrorModal} title="Import Error">
	{#snippet children()}
		<p class="text-gray-700">{importErrorMessage}</p>
	{/snippet}
</Modal>

<!-- Remove File Confirmation Modal -->
<Modal
	bind:open={showRemoveConfirmModal}
	title="Remove File"
	onConfirm={confirmRemoveSoundFile}
	confirmText="Remove"
	confirmVariant="danger"
>
	{#snippet children()}
		<p class="text-gray-700">Are you sure you want to remove this sound file?</p>
	{/snippet}
</Modal>

<!-- Clear Library Confirmation Modal -->
<Modal
	bind:open={showClearConfirmModal}
	title="Clear Library"
	onConfirm={confirmClearSoundLibrary}
	confirmText="Clear All"
	confirmVariant="danger"
>
	{#snippet children()}
		<p class="text-gray-700">
			Are you sure you want to clear the entire sound library? This cannot be undone.
		</p>
	{/snippet}
</Modal>

<!-- Workspace DTX Switcher Modal -->
<Modal bind:open={showDTXSwitchModal} title="Switch DTX File">
	{#snippet children()}
		{#if currentWorkspace}
			<div class="space-y-4">
				<p class="text-gray-700">Select a DTX file from the current workspace:</p>
				<div class="max-h-64 space-y-2 overflow-y-auto">
					{#each currentWorkspace.dtxFiles as dtxFile}
						<button
							class="w-full rounded-lg border p-3 text-left transition-colors {currentWorkspace.currentDTX ===
							dtxFile.name
								? 'border-blue-500 bg-blue-50'
								: 'border-gray-200 hover:bg-gray-50'}"
							onclick={() => {
								switchWorkspaceDTX(dtxFile.name);
								showDTXSwitchModal = false;
							}}
						>
							<div class="font-medium text-gray-900">{dtxFile.name}</div>
							<div class="text-sm text-gray-500">{dtxFile.path}</div>
							{#if currentWorkspace.currentDTX === dtxFile.name}
								<div class="mt-1 text-xs font-medium text-blue-600">
									Currently active
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	{/snippet}
</Modal>

<!-- New File Confirmation Modal -->
<Modal
	bind:open={showNewFileModal}
	title="Create New File"
	onConfirm={createNewFile}
	confirmText="Create New"
	confirmVariant="danger"
>
	{#snippet children()}
		<div class="space-y-3">
			<p class="text-gray-700">
				Creating a new file will clear all unsaved changes to the current chart.
			</p>
			<p class="text-sm font-medium text-red-600">
				⚠️ This action cannot be undone. All temporary edits will be permanently lost.
			</p>
		</div>
	{/snippet}
</Modal>

<!-- Workspace Manager Modal -->
{#if showWorkspaceSwitchModal}
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
		<div class="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
			<h2 class="mb-4 text-xl font-bold text-gray-800">Manage Workspace</h2>

			{#if availableWorkspaces.length === 1}
				<p class="mb-4 text-sm text-gray-600">
					Click on a workspace to switch to it, or use the delete button to remove it.
				</p>
			{:else if availableWorkspaces.length > 1}
				<p class="mb-4 text-sm text-gray-600">
					Click on a workspace to switch to it, or use the delete button to remove
					workspaces you no longer need.
				</p>
			{/if}

			<div class="space-y-2">
				{#each availableWorkspaces as workspace}
					<div
						class="flex items-center rounded-md border transition-colors {currentWorkspace?.name ===
						workspace.name
							? 'border-blue-500 bg-blue-50'
							: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'}"
					>
						<button
							class="flex-1 px-4 py-3 text-left"
							onclick={() => switchToWorkspace(workspace)}
							disabled={currentWorkspace?.name === workspace.name}
						>
							<div class="flex items-center justify-between">
								<div>
									<div
										class="font-medium {currentWorkspace?.name ===
										workspace.name
											? 'text-blue-700'
											: 'text-gray-900'}"
									>
										{workspace.name}
									</div>
									<div class="text-sm text-gray-500">
										{workspace.dtxFiles.length} DTX files, {workspace.audioFiles
											.length} audio files
									</div>
									<div class="text-xs text-gray-400">
										Last modified: {new Date(
											workspace.lastModified
										).toLocaleDateString()}
									</div>
								</div>
								{#if currentWorkspace?.name === workspace.name}
									<span class="text-sm font-medium text-blue-600">Current</span>
								{/if}
							</div>
						</button>
						<button
							class="mr-3 rounded-md p-2 text-red-600 hover:bg-red-50 hover:text-red-800"
							onclick={(event) => showDeleteWorkspaceConfirm(workspace, event)}
							title="Delete workspace"
							aria-label="Delete workspace"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			</div>

			<div class="mt-6 flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
					onclick={() => (showWorkspaceSwitchModal = false)}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Delete Workspace Confirmation Modal -->
{#if showDeleteWorkspaceModal && workspaceToDelete}
	<div class="bg-opacity-50 fixed inset-0 z-60 flex items-center justify-center bg-black">
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
				<h2 class="text-xl font-bold text-gray-900">Delete Workspace?</h2>
			</div>

			<div class="mb-6">
				<p class="mb-3 text-gray-700">
					Are you sure you want to delete the workspace <strong
						>"{workspaceToDelete.name}"</strong
					>?
				</p>
				<div class="mb-3 rounded-lg bg-gray-50 p-3">
					<div class="text-sm text-gray-600">
						<div>• {workspaceToDelete.dtxFiles.length} DTX files</div>
						<div>• {workspaceToDelete.audioFiles.length} audio files</div>
						<div>
							• Last modified: {new Date(
								workspaceToDelete.lastModified
							).toLocaleDateString()}
						</div>
					</div>
				</div>
				<p class="text-sm font-medium text-red-600">
					⚠️ This action cannot be undone. All workspace data will be permanently lost.
				</p>
				{#if currentWorkspace?.name === workspaceToDelete.name}
					<p class="mt-2 text-sm font-medium text-orange-600">
						🔄 This is your current workspace. You will be switched to another workspace
						or a new file.
					</p>
				{/if}
			</div>

			<div class="flex justify-end space-x-3">
				<button
					class="rounded-md border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
					onclick={cancelDeleteWorkspace}
				>
					Cancel
				</button>
				<button
					class="rounded-md bg-red-600 px-4 py-2 text-white transition-colors hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
					onclick={confirmDeleteWorkspace}
				>
					Delete Workspace
				</button>
			</div>
		</div>
	</div>
{/if}
