<script lang="ts">
	import { type Scene } from 'phaser';
	import Main, { type TPhaserRef } from '@dtx/common/game';
	import { Editor } from '@dtx/common/game';
	import { Preview } from '@dtx/common/game';
	import { onMount, onDestroy } from 'svelte';
	import {
		DTXFile,
		SimFile,
		decodeFileWithEncodingDetection,
		type LaneMeasureNote
	} from '@dtx/common';
	import { get } from 'svelte/store';
	import { EventType } from '@dtx/common/game';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import store from '$lib/store';
	import { EventBus } from '@dtx/common/game';
	import { goto } from '$app/navigation';
	import { Modal } from '@dtx/ui-components/components';
	import EditorTips from '$lib/components/editor/EditorTips.svelte';
	import EditorNavigation from '$lib/components/editor/EditorNavigation.svelte';
	import EditorTabs from '$lib/components/editor/EditorTabs.svelte';
	import DifficultyModal from '$lib/components/editor/modals/DifficultyModal.svelte';
	import DiscardModal from '$lib/components/editor/modals/DiscardModal.svelte';
	import SoundLibraryModal from '$lib/components/editor/modals/SoundLibraryModal.svelte';
	import WorkspaceManagerModal from '$lib/components/editor/modals/WorkspaceManagerModal.svelte';
	import ExportWorkspaceModal from '$lib/components/editor/modals/ExportWorkspaceModal.svelte';
	import DTXSwitcherModal from '$lib/components/editor/modals/DTXSwitcherModal.svelte';
	import NewFileModal from '$lib/components/editor/modals/NewFileModal.svelte';
	import { TempChartStorage } from '$lib/services/tempChartStorage';
	import { SoundLibrary } from '$lib/services/soundLibrary';
	import toastStore from '$lib/toaster';
	import { workspaceService, type Workspace } from '$lib/services/workspaceService';
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
	let isEditorReady = $state(false);
	let simfileID = $state('');
	let showDifficultyModal = $state(false);
	let showDiscardModal = $state(false);
	let showTips = $state(true);
	let showSoundLibraryModal = $state(false);
	let showImportResultModal = $state(false);
	let showRefreshResultModal = $state(false);
	let showImportErrorModal = $state(false);
	let showNewFileModal = $state(false);
	let showWorkspaceSwitchModal = $state(false);
	let showDTXSwitchModal = $state(false);
	let showExportWorkspaceModal = $state(false);
	let importResultMessage = $state('');
	let refreshResultMessage = $state('');
	let importErrorMessage = $state('');
	let currentWorkspace = $state<Workspace | null>(null);
	let availableWorkspaces = $state<Workspace[]>([]);

	// Event emitted from the PhaserGame component
	const currentActiveScene = (scene: Scene) => {
		// Check if the Editor scene is loaded when it becomes active
		if (scene.scene.key === Editor.key) {
			(scene as Editor).getIsLoaded();
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
		console.log('🔧 IMPORT DEBUG: importFolder called');
		const input = document.createElement('input');
		input.type = 'file';
		input.webkitdirectory = true;
		input.multiple = true;
		input.onchange = handleFolderImport;
		console.log('🔧 IMPORT DEBUG: About to trigger file dialog');
		input.click();
	}

	async function handleFolderImport(event: Event) {
		console.log('🔧 IMPORT DEBUG: handleFolderImport called', { event });
		const target = event.target as HTMLInputElement;
		const files = target.files;
		console.log('🔧 IMPORT DEBUG: Files selected', { fileCount: files?.length || 0 });
		if (!files || files.length === 0) {
			console.log('🔧 IMPORT DEBUG: No files selected, returning');
			return;
		}

		try {
			console.log('🔧 IMPORT DEBUG: Starting workspace import');
			const workspace = await workspaceService.importFolder(files);
			currentWorkspace = workspace;

			// Refresh available workspaces list
			availableWorkspaces = workspaceService.getWorkspaces();

			// Switch to the first DTX file in the workspace
			if (workspace.dtxFiles.length > 0) {
				// Note: The actual DTX switching logic is now in DTXSwitcherModal
				// This is a simplified version for folder import
				currentWorkspace = workspace;
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

	// DTX switching is now handled by DTXSwitcherModal component
	async function switchWorkspaceDTX(): Promise<void> {
		// This will be called by DTXSwitcherModal after successful switch
		// We need to handle the phaser-specific cleanup here
		if (phaserRef.scene && phaserRef.scene.scene.key === Editor.key) {
			return new Promise<void>((resolve) => {
				const editorScene = phaserRef.scene as Editor;

				// Set up a one-time listener for scene readiness
				const handleSceneReadyForCleanup = () => {
					if (
						editorScene.scene.isActive(Preview.key) ||
						editorScene.scene.isPaused(Preview.key)
					) {
						editorScene.scene.stop(Preview.key);
					}
					// Force editor to be dirty so Preview rebuilds completely
					editorScene.setDirty(true);

					// Clean up the listener
					EventBus.off(EventType.SCENE_READY, handleSceneReadyForCleanup);
					resolve();
				};

				// Listen for scene readiness
				EventBus.once(EventType.SCENE_READY, handleSceneReadyForCleanup);

				// Fallback timeout in case the event doesn't fire
				setTimeout(() => {
					EventBus.off(EventType.SCENE_READY, handleSceneReadyForCleanup);
					resolve();
				}, 1000);
			});
		}
	}

	function showWorkspaceManager() {
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
				// Note: The actual DTX switching logic is now in DTXSwitcherModal
				// For workspace switching, we'll keep the simplified version
				currentWorkspace = workspace;
			}

			showWorkspaceSwitchModal = false;
		} catch (error) {
			console.error('Error switching workspace:', error);
		}
	}

	function showWorkspaceExporter() {
		showExportWorkspaceModal = true;
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
			// Priority: UTF-8 (for exported files with BOM), then traditional encodings
			const result = await decodeFileWithEncodingDetection(
				file,
				validateDtxContent,
				['utf-8', 'shift-jis', 'utf-16le', 'utf-16be'], // Try UTF-8 first for exported files
				'utf-8' // UTF-8 fallback for safety
			);
			const fileContent = result.content;

			const dtxFile = new DTXFile();
			// Store the detected encoding for proper export
			dtxFile.detectedEncoding = result.encoding;
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

			// Emit note import event directly - no need to wait
			EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);
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

	function createNewFile(redirectOnRemote = true) {
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
		if (redirectOnRemote && simfileID) {
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
			.filter(([, level]) => level !== undefined)
			.map(([levelNum, level]) => ({
				level: parseInt(levelNum),
				label: level!.label,
				isActive: get(store.currentDtxFile) === level!.file
			}));
	}

	// Set up event listeners for editor readiness (for preview button state)
	const handleSceneReady = () => {
		isEditorReady = true;
	};
	const handleEditorLoaded = () => {
		isEditorReady = true;
	};
	const handleNoteImport = () => {
		isEditorReady = false;
	};
	const handleValidationError = (message: string) => {
		toastStore.error({ title: message });
	};

	onMount(async () => {
		store.activeScene.set(Editor.key);
		store.isPreviewing.subscribe((value) => {
			isPreviewing = value;
		});
		simfileID = data.simfileID || '';
		store.currentSimfileID.set(simfileID || null);

		EventBus.on(EventType.SCENE_READY, handleSceneReady);
		EventBus.on(EventType.EDITOR_LOADED, handleEditorLoaded);
		EventBus.on(EventType.NOTE_IMPORT, handleNoteImport);
		EventBus.on(EventType.VALIDATION_ERROR, handleValidationError);

		// Load current workspace and available workspaces
		currentWorkspace = workspaceService.getCurrentWorkspace();
		availableWorkspaces = workspaceService.getWorkspaces();

		if (!simfileID) {
			// Try to restore workspace from localStorage or URL

			if (currentWorkspace && currentWorkspace.currentDTX) {
				// Restore workspace state
				// Note: Detailed DTX switching is now handled by DTXSwitcherModal
				// For initialization, we'll keep a simplified version
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
				([, level]) => level?.file === highestDtx
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
			toastStore.error({ title: 'Failed to load chart', duration: 3000 });
			createNewFile(false); // Fallback to new file without redirecting away
			simfileID = ''; // Reset so UI components switch to local mode
		}
	});

	onDestroy(() => {
		EventBus.off(EventType.SCENE_READY, handleSceneReady);
		EventBus.off(EventType.EDITOR_LOADED, handleEditorLoaded);
		EventBus.off(EventType.NOTE_IMPORT, handleNoteImport);
		EventBus.off(EventType.VALIDATION_ERROR, handleValidationError);
	});

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
					const editorScene = phaserRef.scene as Editor;
					if (
						typeof (editorScene as unknown as { autoSaveChart?: () => Promise<void> })
							.autoSaveChart === 'function'
					) {
						await (
							editorScene as unknown as { autoSaveChart: () => Promise<void> }
						).autoSaveChart();
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

<div
	data-testid="editor-root"
	class="grid h-screen grid-cols-1 grid-rows-[auto_1fr]"
	style="background: var(--music-bg-primary);"
>
	<!-- Animated background elements -->
	<div class="pointer-events-none absolute inset-0 opacity-20">
		<div
			class="absolute top-20 left-10 h-32 w-32 animate-pulse rounded-full bg-gradient-to-br from-purple-500 to-pink-500 blur-xl"
		></div>
		<div
			class="absolute top-40 right-20 h-24 w-24 animate-pulse rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 blur-lg"
			style="animation-delay: 1s;"
		></div>
		<div
			class="absolute bottom-20 left-1/3 h-40 w-40 animate-pulse rounded-full bg-gradient-to-br from-amber-500 to-orange-500 blur-2xl"
			style="animation-delay: 2s;"
		></div>
	</div>

	<EditorNavigation
		{simfileID}
		{isPreviewing}
		{currentWorkspace}
		{availableWorkspaces}
		onNewFile={newFile}
		onImportFile={importFile}
		onImportFolder={importFolder}
		onExportFile={exportFile}
		onShowDifficultyModal={() => (showDifficultyModal = true)}
		onShowDTXSwitcher={showDTXSwitcher}
		onShowWorkspaceManager={showWorkspaceManager}
		onShowSoundLibraryModal={() => (showSoundLibraryModal = true)}
		onRefreshSoundLibraryLinks={refreshSoundLibraryLinks}
		onShowWorkspaceExporter={showWorkspaceExporter}
		onDiscardLocalChanges={discardLocalChanges}
	/>

	<!-- Main content area - change to flex column on small screens, row on larger screens -->
	<div class="row-span-1 flex flex-col 2xl:flex-row">
		<!-- Editor Tabs Component -->
		<EditorTabs
			bind:currentTab
			bind:isTabsCollapsed
			{isPreviewing}
			{isEditorReady}
			{simfileID}
			bucketUrl={PUBLIC_SIMFILE_BUCKET_URL}
			onTabChange={() => {}}
			onToggleCollapsed={() => (isTabsCollapsed = !isTabsCollapsed)}
		/>

		<!-- Center game component - expanded to fill remaining space -->
		<div class="flex w-full justify-center p-5 2xl:w-[75%]">
			<Main {phaserRef} {currentActiveScene} />
		</div>
	</div>
</div>

<!-- Editor Tips Component -->
<EditorTips bind:showTips />

<!-- Difficulty Selection Modal -->
<DifficultyModal
	show={showDifficultyModal}
	availableLevels={getAvailableLevels()}
	onSwitchLevel={switchToLevel}
	onClose={() => (showDifficultyModal = false)}
/>

<!-- Discard Changes Confirmation Modal -->
<DiscardModal
	show={showDiscardModal}
	chartName={get(store.currentSimfileID) || 'current chart'}
	difficultyText={get(store.currentDifficulty) ? ` (${get(store.currentDifficulty)})` : ''}
	onConfirm={confirmDiscardChanges}
	onCancel={cancelDiscardChanges}
/>

<!-- Sound Library Management Modal -->
<SoundLibraryModal
	show={showSoundLibraryModal}
	onClose={() => (showSoundLibraryModal = false)}
	onImportResult={(message) => {
		importResultMessage = message;
		showImportResultModal = true;
	}}
/>

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

<!-- Workspace DTX Switcher Modal -->
<DTXSwitcherModal bind:show={showDTXSwitchModal} onSwitchDTX={switchWorkspaceDTX} />

<!-- New File Confirmation Modal -->
<NewFileModal
	bind:show={showNewFileModal}
	onConfirm={createNewFile}
	onCancel={() => (showNewFileModal = false)}
/>

<!-- Workspace Manager Modal -->
<WorkspaceManagerModal
	show={showWorkspaceSwitchModal}
	onSwitchToWorkspace={switchToWorkspace}
	onClose={() => (showWorkspaceSwitchModal = false)}
/>

<!-- Export Workspace Modal -->
<ExportWorkspaceModal
	show={showExportWorkspaceModal}
	onClose={() => (showExportWorkspaceModal = false)}
/>
