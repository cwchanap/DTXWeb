<script lang="ts">
	// Desktop Editor component that uses common package components directly
	import { onMount } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { MainTab, SoundTab, PreviewTab } from '@dtx/common/components';
	import Phaser from 'phaser';
	import { Editor, Preloader, MainMenu, EventBus, EventType } from '@dtx/common/game';
	import { DesktopPreview } from '../scenes/DesktopPreview';
	import { store } from '@dtx/common';
	import { DTXFile, LaneMeasureNote, SimFile, SoundChip, setFileProvider } from '@dtx/common';
	import { DesktopFileProvider } from '../services/desktopFileProvider';
	import { editorMappingStore } from '../stores/editorMappingStore';

	// Local type definitions
	interface SoundChipData {
		label: string;
		id: number;
		volume: number;
		position: number;
		fileName: string;
		filePath?: string;
		fileHash?: string;
	}

	interface ChartMetadata {
		title: string;
		artist: string;
		comment: string;
		bpm: number;
		level: number;
		soundChips: SoundChipData[];
	}

	interface ChartFile {
		name: string;
		path: string;
	}

	interface ChartState {
		name: string;
		dtxFiles: ChartFile[];
		currentDTX: string;
		folderPath: string;
	}

	interface Props {
		simFileId?: string;
	}

	let { simFileId }: Props = $props();

	// Editor state
	let currentTab = $state('main');
	let gameContainer: HTMLDivElement;
	let isGameInitialized = $state(false);
	let isLoading = $state(true);
	let chartMetadata = $state<ChartMetadata | null>(null);
	let fileProvider: DesktopFileProvider | null = null;
	let game: Phaser.Game | null = null;
	let isLocalEditingMode = $state(false); // Track if we should treat this as local editing
	let isSidebarCollapsed = $state(false); // Track sidebar collapse state
	let currentSongName = $state<string | null>(null); // Track current song name
	let currentChart = $state<ChartState | null>(null); // Track current chart with DTX files
	let sidebarWidth = $state(320); // Sidebar width in pixels (default 80 * 0.25rem = 320px)
	let isDragging = $state(false);
	let minSidebarWidth = 200;
	let maxSidebarWidth = 600;
	let collapseThreshold = 50; // Width below which sidebar collapses
	const keyboardResizeStep = 20;
	let validationError = $state<string | null>(null); // Track validation errors

	// Helper function to create DTXFile from ChartMetadata
	const createDTXFileFromMetadata = (metadata: ChartMetadata): DTXFile => {
		const dtxFile = new DTXFile();
		dtxFile.title = metadata.title;
		dtxFile.artist = metadata.artist;
		dtxFile.comment = metadata.comment;
		dtxFile.bpm = metadata.bpm;
		dtxFile.level = metadata.level;
		return dtxFile;
	};

	const handleBackToWorkspace = () => {
		// Navigate back to workspace
		window.location.hash = '';
	};

	const switchTab = (tab: string) => {
		currentTab = tab;
	};

	const handleMouseDown = (e: MouseEvent) => {
		e.preventDefault();
		isDragging = true;
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	};

	const clampSidebarWidth = (width: number) =>
		Math.min(Math.max(width, minSidebarWidth), maxSidebarWidth);

	const applySidebarWidth = (newWidth: number) => {
		// Only collapse/expand, don't resize when collapsed
		if (isSidebarCollapsed) {
			if (newWidth > collapseThreshold) {
				isSidebarCollapsed = false;
				sidebarWidth = clampSidebarWidth(newWidth);
			}
			return;
		}

		if (newWidth < collapseThreshold) {
			isSidebarCollapsed = true;
			return;
		}

		sidebarWidth = clampSidebarWidth(newWidth);
	};

	const handleMouseMove = (e: MouseEvent) => {
		if (!isDragging) return;
		applySidebarWidth(e.clientX);
	};

	const handleMouseUp = () => {
		isDragging = false;
		document.removeEventListener('mousemove', handleMouseMove);
		document.removeEventListener('mouseup', handleMouseUp);
		document.body.style.cursor = '';
		document.body.style.userSelect = '';

		// Ensure minimum width when drag ends (but don't collapse)
		if (!isSidebarCollapsed && sidebarWidth < minSidebarWidth) {
			sidebarWidth = minSidebarWidth;
		}
	};

	const handleKeyResize = (e: KeyboardEvent) => {
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			const delta = e.key === 'ArrowLeft' ? -keyboardResizeStep : keyboardResizeStep;
			const targetWidth = (isSidebarCollapsed ? minSidebarWidth : sidebarWidth) + delta;
			applySidebarWidth(targetWidth);
		} else if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			if (isSidebarCollapsed) {
				isSidebarCollapsed = false;
				sidebarWidth = clampSidebarWidth(sidebarWidth || minSidebarWidth);
			} else {
				isSidebarCollapsed = true;
			}
		}
	};

	const expandSidebar = () => {
		isSidebarCollapsed = false;
	};

	// Validation error handler
	const handleValidationError = (message: string) => {
		validationError = message;
		// Auto-hide error after 5 seconds
		setTimeout(() => {
			validationError = null;
		}, 5000);
	};

	onMount(() => {
		// Set up validation error event listener
		EventBus.on(EventType.VALIDATION_ERROR, handleValidationError);

		const initializeEditor = async () => {
			try {
				// Initialize file provider
				let workspacePath = localStorage.getItem('workspace_path') || '';
				// Remove extra quotes if present
				if (workspacePath.startsWith('"') && workspacePath.endsWith('"')) {
					workspacePath = workspacePath.slice(1, -1);
				}
				fileProvider = new DesktopFileProvider(workspacePath);
				setFileProvider(fileProvider);

				// Load simfile data if we have a simFileId
				if (simFileId) {
					await loadFromSimFileId(simFileId);
				} else {
					// Initialize with default metadata for new chart
					chartMetadata = {
						title: 'New Song',
						artist: 'Unknown Artist',
						comment: '',
						bpm: 120,
						level: 1,
						soundChips: []
					};

					// Create default DTXFile
					const dtxFile = createDTXFileFromMetadata(chartMetadata);

					// Initialize store with default values
					store.currentSimfileID.set(null);
					store.currentDifficulty.set(null);
					store.currentDtxFile.set(dtxFile);
					store.editorNotes.set({});
					store.currentSoundChip.set([]);
					store.measureCount.set(10);

					// Desktop app is always local editing
					isLocalEditingMode = true;

					// Try to load chart from the workspace path if available
					if (workspacePath && workspacePath !== '""' && workspacePath !== '') {
						await loadChartFromPath(workspacePath, 'Current Workspace');
					}

					// NOTE_IMPORT will be emitted after Phaser game is ready
				}

				// Initialize the Phaser game for the editor
				if (gameContainer) {
					// Set the active scene to Editor for desktop
					store.activeScene.set(Editor.key);

					// Set up the game configuration for desktop
					const gameConfig = {
						type: Phaser.AUTO,
						width: gameContainer.clientWidth,
						height: gameContainer.clientHeight,
						parent: gameContainer,
						scene: [Preloader, MainMenu, Editor, DesktopPreview],
						backgroundColor: '#1e293b',
						physics: {
							default: 'arcade',
							arcade: {
								gravity: { y: 0, x: 0 },
								debug: false
							}
						}
					};

					// Initialize Phaser game
					game = new Phaser.Game(gameConfig);

					// Wait for the game to be ready before emitting NOTE_IMPORT
					game.events.once('ready', () => {
						EventBus.emit(EventType.NOTE_IMPORT, [], {});
					});

					isGameInitialized = true;
				}
			} catch (error) {
				console.error('Failed to initialize desktop editor:', error);
				// Set initialized to true even on error so we don't show loading forever
				isGameInitialized = true;
			} finally {
				isLoading = false;
			}
		};

		// Start initialization
		initializeEditor();

		// Return cleanup function
		return () => {
			EventBus.off(EventType.VALIDATION_ERROR, handleValidationError);
			if (game) {
				game.destroy(true);
			}
		};
	});

	const loadFromSimFileId = async (simFileIdParam: string) => {
		// Decode the simFileId in case it's URL-encoded
		const decodedSimFileId = decodeURIComponent(simFileIdParam);

		try {
			// Get the song metadata from the mapping store
			const songMetadata = editorMappingStore.getSongMetadata(decodedSimFileId);
			const folderPath =
				songMetadata?.folderPath || editorMappingStore.getFolderPath(decodedSimFileId);

			if (!folderPath) {
				throw new Error(
					`No folder path found for simFileId: ${decodedSimFileId} (original: ${simFileIdParam})`
				);
			}

			// Update file provider to use the specific song folder as workspace root
			if (fileProvider) {
				fileProvider.setWorkspaceRoot(folderPath);
			}

			// Get song name from metadata or fall back to folder name
			const songName = songMetadata?.songName || folderPath.split('/').pop() || 'Unknown';
			currentSongName = songName;

			// Create chart structure for difficulty switching
			await loadChartFromPath(folderPath, songName);

			await loadLocalFilesFromPath(folderPath, songName);
		} catch (error) {
			console.error('Failed to load from simFileId:', error);
			// Set default metadata on error
			chartMetadata = {
				title: decodedSimFileId || 'New Song',
				artist: 'Unknown Artist',
				comment: '',
				bpm: 120,
				level: 1,
				soundChips: []
			};

			// Create default DTXFile
			const dtxFile = createDTXFileFromMetadata(chartMetadata);

			store.currentSimfileID.set(null); // For local editing, simfileID should be null
			store.currentDtxFile.set(dtxFile);
			store.currentSoundChip.set([]);
			store.editorNotes.set({});
			store.measureCount.set(10);

			// Desktop app is always local editing
			isLocalEditingMode = true;

			// Emit empty notes for error case
			setTimeout(() => {
				EventBus.emit(EventType.NOTE_IMPORT, [], {});
			}, 100);
		}
	};

	const loadLocalFilesFromPath = async (
		folderPath: string,
		songName: string,
		remoteMetadata: Partial<ChartMetadata> | null = null
	) => {
		// Try to load SET.def file first directly from the folder path
		let setDefFile: File | undefined;
		let localSimFile: SimFile | null = null;

		try {
			// Read SET.def directly from folder path
			const setDefResult = await window.electron.ipcRenderer.invoke(
				'read-file',
				`${folderPath}/SET.def`,
				folderPath
			);
			if (!setDefResult.error) {
				const blob = new Blob([setDefResult.content], { type: 'text/plain' });
				setDefFile = new File([blob], 'SET.def');
			} else {
				// Try lowercase
				const setDefLowerResult = await window.electron.ipcRenderer.invoke(
					'read-file',
					`${folderPath}/set.def`,
					folderPath
				);
				if (!setDefLowerResult.error) {
					const blob = new Blob([setDefLowerResult.content], { type: 'text/plain' });
					setDefFile = new File([blob], 'set.def');
				}
			}
		} catch (error) {
			console.warn('Error reading SET.def file:', error);
		}

		if (setDefFile) {
			// Parse the SET.def file to get metadata
			localSimFile = new SimFile([setDefFile]);
			await localSimFile.parseHeader(setDefFile);
		}

		// Try to load DTX files for sound chips and notes
		let soundChips: SoundChip[] = [];
		let dtxFile: DTXFile | null = null;
		let notes: LaneMeasureNote[] = [];
		let bpmNotes: Record<string, number> = {};

		try {
			const dtxFiles = ['ext.dtx', 'mas.dtx', 'bas.dtx', 'adv.dtx', 'nov.dtx'];
			for (const dtxFileName of dtxFiles) {
				const dtxResult = await window.electron.ipcRenderer.invoke(
					'read-file',
					`${folderPath}/${dtxFileName}`,
					folderPath
				);
				if (!dtxResult.error) {
					// Use the pre-decoded content directly since main process already handled encoding
					if (dtxResult.isText) {
						dtxFile = new DTXFile(dtxResult.content);
					} else {
						// Convert Buffer to string for DTX files
						dtxFile = new DTXFile(Buffer.from(dtxResult.content).toString('utf8'));
					}
					await dtxFile.parse();
					soundChips = dtxFile.parseSoundChips();
					notes = dtxFile.parseNotes();
					bpmNotes = dtxFile.parseBPMChanges();
					break;
				}
			}
		} catch (error) {
			console.warn('Failed to load DTX files:', error);
		}

		// Combine remote metadata with local file data
		chartMetadata = {
			title: remoteMetadata?.title || localSimFile?.title || songName,
			artist: remoteMetadata?.artist || dtxFile?.artist || 'Unknown Artist',
			comment: dtxFile?.comment || '',
			bpm: remoteMetadata?.bpm || dtxFile?.bpm || 120,
			level: dtxFile?.level || 1,
			soundChips: soundChips.map((chip) => {
				const chipPath =
					'filePath' in chip ? (chip as { filePath?: string }).filePath : undefined;
				return {
					label: chip.label,
					id: chip.id,
					volume: chip.volume,
					position: chip.position,
					fileName: chip.fileName,
					filePath: chipPath
				};
			})
		};

		// Create DTXFile for MainTab
		const mainTabDtxFile = dtxFile || createDTXFileFromMetadata(chartMetadata);

		// Update store - for local files, use null as simfileID since files are directly in workspace root
		store.currentSimfileID.set(null); // Files are directly in the song folder (workspace root)
		store.currentSimfile.set(localSimFile);
		store.currentDtxFile.set(mainTabDtxFile);
		store.currentSoundChip.set(soundChips);
		store.editorNotes.set({});
		store.measureCount.set(10);

		// Desktop app is always local editing
		isLocalEditingMode = true;

		// Wait a bit to ensure the Phaser scene is ready, then emit note import event
		setTimeout(() => {
			EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);
		}, 100);
	};

	const loadChartFromPath = async (folderPath: string, songName: string) => {
		try {
			// List all DTX files in the folder using existing list-files IPC channel
			const dtxExtensions = ['.dtx'];
			const folderContents = await window.electron.ipcRenderer.invoke(
				'list-files',
				folderPath
			);

			if (folderContents.error) {
				console.warn('Could not list directory contents:', folderContents.error);
				return;
			}

			// Filter DTX files (list-files returns files with different structure)
			const dtxFiles: ChartFile[] = folderContents.files
				.filter((file: { fileName: string }) =>
					dtxExtensions.some((ext) => file.fileName.toLowerCase().endsWith(ext))
				)
				.map((file: { fileName: string }) => ({
					name: file.fileName,
					path: `${folderPath}/${file.fileName}`
				}));

			if (dtxFiles.length > 0) {
				// Create chart structure with difficulty files
				// Priority order: hardest to easiest (following SimFile.getHighestLevel() logic)
				const difficultyPriority = ['real.dtx', 'mas.dtx', 'ext.dtx', 'adv.dtx', 'bas.dtx'];
				const defaultDTX =
					difficultyPriority.find((difficulty) =>
						dtxFiles.some((file) => file.name.toLowerCase() === difficulty)
					) || dtxFiles[0].name;

				currentChart = {
					name: songName,
					dtxFiles: dtxFiles,
					currentDTX: defaultDTX,
					folderPath: folderPath
				};
			}
		} catch (error) {
			console.error('Error loading chart from path:', error);
		}
	};

	const switchChartDifficulty = async (dtxFileName: string) => {
		if (!currentChart || !fileProvider) return;

		try {
			// Stop any existing preview to ensure clean re-draw when switching DTX files
			EventBus.emit(EventType.STOP_PREVIEW);

			// Update current chart
			currentChart.currentDTX = dtxFileName;

			// Get the folder path from file provider
			const folderPath = fileProvider.getWorkspaceRoot();

			// Load the selected DTX file
			let dtxFile: DTXFile | null = null;
			let notes: LaneMeasureNote[] = [];
			let bpmNotes: Record<string, number> = {};
			let soundChips: SoundChip[] = [];

			const dtxResult = await window.electron.ipcRenderer.invoke(
				'read-file',
				`${folderPath}/${dtxFileName}`,
				folderPath
			);

			if (!dtxResult.error) {
				dtxFile = new DTXFile(dtxResult.content as string);
				await dtxFile.parse();
				soundChips = dtxFile.parseSoundChips();
				notes = dtxFile.parseNotes();
				bpmNotes = dtxFile.parseBPMChanges();

				// Update chart metadata with DTX file data
				if (chartMetadata) {
					chartMetadata.artist = dtxFile.artist || chartMetadata.artist;
					chartMetadata.comment = dtxFile.comment || '';
					chartMetadata.bpm = dtxFile.bpm || chartMetadata.bpm;
					chartMetadata.level = dtxFile.level || 1;
					chartMetadata.soundChips = soundChips.map((chip) => {
						const chipPath =
							'filePath' in chip
								? (chip as { filePath?: string }).filePath
								: undefined;
						return {
							label: chip.label,
							id: chip.id,
							volume: chip.volume,
							position: chip.position,
							fileName: chip.fileName,
							filePath: chipPath
						};
					});
				}
			} else {
				console.error('Failed to load DTX file:', dtxFileName);
				return;
			}

			// Update stores
			store.currentDtxFile.set(dtxFile);
			store.currentSoundChip.set(soundChips);
			store.currentDifficulty.set(dtxFileName.replace('.dtx', ''));

			// Emit note import event
			setTimeout(() => {
				EventBus.emit(EventType.NOTE_IMPORT, notes, bpmNotes);

				// Clean up any preview scenes after switching
				setTimeout(() => {
					if (game?.scene) {
						const editorScene = game.scene.getScene('Editor');
						if (editorScene) {
							const previewScene = game.scene.getScene('Preview');
							if (
								previewScene &&
								(previewScene.scene.isActive() || previewScene.scene.isPaused())
							) {
								previewScene.scene.stop();
							}
							// Force editor to be dirty so Preview rebuilds completely
							const dirtyScene = editorScene as Phaser.Scene & {
								setDirty?: (flag?: boolean) => void;
							};
							if (typeof dirtyScene.setDirty === 'function') {
								dirtyScene.setDirty(true);
							}
						}
					}
				}, 200);
			}, 100);
		} catch (error) {
			console.error('Error switching DTX file:', error);
		}
	};
</script>

<div class="h-screen w-full bg-slate-900 text-white">
	<!-- Header with navigation and tabs -->
	<div
		class="flex items-center justify-between border-b border-slate-700 bg-slate-800 p-4 shadow-sm"
	>
		<div class="flex items-center gap-4">
			<button
				class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-slate-500 to-slate-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
				onclick={handleBackToWorkspace}
				title="Back to Workspace"
			>
				<ArrowLeft size={16} />
				Back to Workspace
			</button>

			<h1 class="text-xl font-semibold">
				DTX Editor {currentSongName
					? `- ${currentSongName}`
					: simFileId
						? `- ${simFileId}`
						: '- New Chart'}
			</h1>
		</div>

		<!-- Tab Navigation and Difficulty Switcher -->
		<div class="flex items-center gap-4">
			{#if currentChart && currentChart.dtxFiles.length > 1}
				<!-- Difficulty/DTX File Selector -->
				<div class="relative">
					<select
						class="rounded border border-slate-500 bg-slate-600 px-3 py-2 text-sm text-white hover:bg-slate-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
						value={currentChart.currentDTX || ''}
						onchange={(e) =>
							switchChartDifficulty((e.target as HTMLSelectElement).value)}
					>
						{#each currentChart.dtxFiles as dtxFile}
							<option value={dtxFile.name} class="bg-slate-700 text-white">
								{dtxFile.name.replace('.dtx', '').toUpperCase()}
							</option>
						{/each}
					</select>
				</div>
			{/if}

			{#if !isSidebarCollapsed}
				<div class="flex rounded-lg bg-slate-700 p-1">
					<button
						class="rounded-md px-4 py-2 text-sm font-medium transition-colors {currentTab ===
						'main'
							? 'bg-slate-600 text-white'
							: 'text-slate-300 hover:text-white'}"
						onclick={() => switchTab('main')}
					>
						Main
					</button>
					<button
						class="rounded-md px-4 py-2 text-sm font-medium transition-colors {currentTab ===
						'sound'
							? 'bg-slate-600 text-white'
							: 'text-slate-300 hover:text-white'}"
						onclick={() => switchTab('sound')}
					>
						Sound
					</button>
					<button
						class="rounded-md px-4 py-2 text-sm font-medium transition-colors {currentTab ===
						'preview'
							? 'bg-slate-600 text-white'
							: 'text-slate-300 hover:text-white'}"
						onclick={() => switchTab('preview')}
					>
						Preview
					</button>
				</div>
			{/if}
		</div>
	</div>

	<!-- Editor Content -->
	<div class="flex h-full">
		<!-- Sidebar for tabs -->
		{#if !isSidebarCollapsed}
			<div
				class="relative border-r border-slate-700 bg-slate-800 p-4"
				style="width: {sidebarWidth}px; max-width: {maxSidebarWidth}px;"
			>
				{#if isLoading}
					<div class="flex h-full items-center justify-center">
						<div class="text-center">
							<div
								class="mx-auto mb-4 h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<p class="text-sm text-slate-400">Loading chart data...</p>
						</div>
					</div>
				{:else if currentTab === 'main'}
					{#if validationError}
						<div class="mb-3 rounded-md border border-red-300 bg-red-50 p-3">
							<div class="flex items-start justify-between">
								<p class="text-sm text-red-700">{validationError}</p>
								<button
									class="text-red-500 hover:text-red-700"
									onclick={() => (validationError = null)}>×</button
								>
							</div>
						</div>
					{/if}
					<MainTab />
				{:else if currentTab === 'sound'}
					<SoundTab simfileID={isLocalEditingMode ? null : simFileId} bucketUrl="" />
				{:else if currentTab === 'preview'}
					<PreviewTab />
				{/if}

				<!-- Drag handle -->
				<button
					type="button"
					class="absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-blue-500/50 {isDragging
						? 'bg-blue-500'
						: ''}"
					onmousedown={handleMouseDown}
					onkeydown={handleKeyResize}
					tabindex="0"
					aria-label="Resize sidebar"
				></button>
			</div>
		{:else}
			<!-- Collapsed sidebar - expand area -->
			<div
				class="relative cursor-col-resize border-r border-slate-700 bg-slate-800 transition-colors hover:bg-slate-700"
				onclick={expandSidebar}
				onmousedown={handleMouseDown}
				onkeydown={(e) => e.key === 'Enter' && expandSidebar()}
				role="button"
				tabindex="0"
				title="Drag to expand sidebar"
			>
				<div class="flex h-full w-2 items-center justify-center">
					<div class="h-8 w-0.5 rounded bg-slate-600"></div>
				</div>
			</div>
		{/if}

		<!-- Game Canvas Area -->
		<div class="flex-1 bg-slate-900">
			<div bind:this={gameContainer} class="h-full w-full">
				{#if !isGameInitialized}
					<div class="flex h-full items-center justify-center">
						<div class="text-center">
							<div
								class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<p class="text-slate-400">Initializing editor...</p>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
