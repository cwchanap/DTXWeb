<script module lang="ts">
	let pendingPhaserTeardown: Promise<void> = Promise.resolve();

	// Test-only hook: resets the module-scoped teardown promise so test suites
	// are not order-coupled by leftover chain state. Guarded by DEV so the
	// body is a no-op in production. The export itself is only imported by
	// DesktopEditor.test.ts; in production builds tree-shaking drops it since
	// no production code references it. Co-located with the state it resets
	// rather than split into a separate module to keep the teardown chain
	// logic in one place.
	export const __resetPendingTeardownForTests = (): void => {
		if (import.meta.env.DEV) {
			pendingPhaserTeardown = Promise.resolve();
		}
	};
</script>

<script lang="ts">
	// Desktop Editor component that uses common package components directly
	import { onMount, tick } from 'svelte';
	import Phaser from 'phaser';
	import EditorContextBar from './editor/EditorContextBar.svelte';
	import EditorDock from './editor/EditorDock.svelte';
	import TransportBar from './editor/TransportBar.svelte';
	import { Editor, Preloader, MainMenu, EventBus, EventType } from '@dtx/common/game';
	import { DesktopPreview } from '../scenes/DesktopPreview';
	import { store } from '@dtx/common';
	import { DTXFile, LaneMeasureNote, SimFile, SoundChip, setFileProvider } from '@dtx/common';
	import { DesktopFileProvider } from '../services/desktopFileProvider';
	import { desktopHost } from '../services/desktopHost';
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

	type DesktopFileContent = string | ArrayBuffer | Uint8Array;

	interface Props {
		simFileId?: string;
	}

	let { simFileId }: Props = $props();

	// Editor state
	let isEditorReady = $state(false);
	let gameContainer: HTMLDivElement;
	let isGameInitialized = $state(false);
	let chartMetadata = $state<ChartMetadata | null>(null);
	let fileProvider: DesktopFileProvider | null = null;
	let game: Phaser.Game | null = null;
	let isLocalEditingMode = $state(false); // Track if we should treat this as local editing
	let isSidebarCollapsed = $state(false); // Track sidebar collapse state
	let currentSongName = $state<string | null>(null); // Track current song name
	let currentChart = $state<ChartState | null>(null); // Track current chart with DTX files
	const SIDEBAR_WIDTH_STORAGE_KEY = 'desktop_editor_sidebar_width';
	const SIDEBAR_WIDTH_DEFAULT = 320;
	const storedSidebarWidth = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
	let sidebarWidth = $state(Number(storedSidebarWidth) || SIDEBAR_WIDTH_DEFAULT);
	let isDragging = $state(false);
	let minSidebarWidth = 120;
	let maxSidebarWidth = 600;
	let collapseThreshold = 50; // Width below which sidebar collapses
	const keyboardResizeStep = 20;
	let validationError = $state<string | null>(null); // Track validation errors
	let chartLoadError = $state<string | null>(null); // Track chart-folder load errors
	let validationErrorTimeout: ReturnType<typeof setTimeout> | null = null;

	// Persist sidebar width to localStorage so it survives remounts/reloads.
	// Skip writing during drag (handleMouseMove fires every pointermove) to
	// avoid a synchronous localStorage write per frame; the final width is
	// persisted when isDragging flips back to false on mouseup. The
	// last-persisted guard is seeded from the same localStorage read that
	// initializes sidebarWidth, so a mount with an unchanged value writes
	// nothing; a missing or invalid stored value persists the resolved default.
	let lastPersistedSidebarWidth: string | null = storedSidebarWidth;
	$effect(() => {
		if (isDragging) return;
		const serialized = String(sidebarWidth);
		if (serialized === lastPersistedSidebarWidth) return;
		try {
			localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, serialized);
			lastPersistedSidebarWidth = serialized;
		} catch {
			// localStorage can throw (quota exceeded, disabled in private mode);
			// sidebar width persistence is non-critical, ignore.
		}
	});

	const toArrayBuffer = (content: ArrayBuffer | Uint8Array): ArrayBuffer => {
		if (content instanceof ArrayBuffer) {
			return content;
		}

		const copy = new Uint8Array(content.byteLength);
		copy.set(content);
		return copy.buffer;
	};

	const utf8Decoder = new TextDecoder();

	const toBlobPart = (content: DesktopFileContent): string | ArrayBuffer => {
		if (typeof content === 'string') {
			return content;
		}

		return toArrayBuffer(content);
	};

	const toUtf8String = (content: DesktopFileContent): string => {
		if (typeof content === 'string') {
			return content;
		}

		// TextDecoder is the browser-native API; Buffer is a Node.js global and is
		// not available in the Tauri webview renderer.
		return utf8Decoder.decode(toArrayBuffer(content));
	};

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
		if (validationErrorTimeout !== null) {
			clearTimeout(validationErrorTimeout);
		}
		validationErrorTimeout = setTimeout(() => {
			validationError = null;
			validationErrorTimeout = null;
		}, 5000);
	};

	onMount(() => {
		let mounted = true;
		// Set up validation error event listener
		EventBus.on(EventType.VALIDATION_ERROR, handleValidationError);

		const initializeEditor = async () => {
			try {
				await pendingPhaserTeardown;
				await tick();
				if (!mounted) return;

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
				// Re-check mounted here because loadFromSimFileId / loadChartFromPath
				// above may still have been in flight when teardown began.
				if (!mounted) return;
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
						isEditorReady = true;
						EventBus.emit(EventType.NOTE_IMPORT, [], {});
					});

					isGameInitialized = true;
				} else {
					throw new Error('Desktop editor game container was not available');
				}
			} catch (error) {
				console.error('Failed to initialize desktop editor:', error);
				// Set initialized to true even on error so we don't show loading forever
				if (mounted) {
					isGameInitialized = true;
				}
			}
		};

		// Start initialization
		initializeEditor();

		// Return cleanup function
		return () => {
			mounted = false;
			EventBus.off(EventType.VALIDATION_ERROR, handleValidationError);
			if (validationErrorTimeout !== null) {
				clearTimeout(validationErrorTimeout);
				validationErrorTimeout = null;
			}
			if (game) {
				const gameToDestroy = game;
				game = null;
				// Register the destroy listener before calling destroy so we
				// never miss the event, then resolve pendingPhaserTeardown only
				// when Phaser signals full teardown completion. Race with a
				// timeout so a missing 'destroy' event (scene throw during
				// shutdown, WebGL context loss) cannot hang every later mount.
				const teardownPromise = new Promise<void>((resolve) => {
					const timeout = setTimeout(() => {
						console.warn(
							'[DesktopEditor] Phaser destroy event did not fire within 5s; ' +
								'resolving teardown to avoid hanging subsequent mounts.'
						);
						resolve();
					}, 5000);
					gameToDestroy.events.once('destroy', () => {
						clearTimeout(timeout);
						resolve();
					});
					gameToDestroy.destroy(true);
				});
				pendingPhaserTeardown = pendingPhaserTeardown.then(
					() => teardownPromise,
					() => teardownPromise
				);
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
			const setDefResult = await desktopHost.readFile(`${folderPath}/SET.def`, folderPath);
			if (!setDefResult.error) {
				const blob = new Blob([toBlobPart(setDefResult.content)], {
					type: 'text/plain'
				});
				setDefFile = new File([blob], 'SET.def');
			} else {
				// Try lowercase
				const setDefLowerResult = await desktopHost.readFile(
					`${folderPath}/set.def`,
					folderPath
				);
				if (!setDefLowerResult.error) {
					const blob = new Blob([toBlobPart(setDefLowerResult.content)], {
						type: 'text/plain'
					});
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
				const dtxResult = await desktopHost.readFile(
					`${folderPath}/${dtxFileName}`,
					folderPath
				);
				if (!dtxResult.error) {
					// Use the pre-decoded content directly since the Rust backend already handled encoding
					if (dtxResult.kind === 'text') {
						dtxFile = new DTXFile(toUtf8String(dtxResult.content));
					} else {
						// Convert Buffer to string for DTX files
						dtxFile = new DTXFile(toUtf8String(dtxResult.content));
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
		chartLoadError = null;
		try {
			// List all DTX files in the folder using the list-files Tauri command
			const dtxExtensions = ['.dtx'];
			const folderContents = await desktopHost.listFiles<{
				files: Array<{ fileName: string }>;
				error?: string;
			}>(folderPath, folderPath);

			if (folderContents.error) {
				// Surface the failure (containment/permission/missing-dir) instead
				// of silently leaving the editor blank.
				chartLoadError = `Could not load chart files: ${folderContents.error}`;
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

			const dtxResult = await desktopHost.readFile(
				`${folderPath}/${dtxFileName}`,
				folderPath
			);

			if (!dtxResult.error) {
				dtxFile = new DTXFile(toUtf8String(dtxResult.content));
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

<div class="bg-base text-base-text flex h-screen flex-col">
	<EditorContextBar
		songName={currentSongName}
		{simFileId}
		difficulties={currentChart?.dtxFiles ?? []}
		currentDtx={currentChart?.currentDTX ?? ''}
		onBack={handleBackToWorkspace}
		onSwitchDifficulty={switchChartDifficulty}
	/>
	<div class="flex min-h-0 flex-1">
		{#if !isSidebarCollapsed}
			<div
				class="border-hairline relative border-r"
				style="width:{sidebarWidth}px;max-width:{maxSidebarWidth}px"
			>
				<EditorDock
					simfileId={isLocalEditingMode ? null : simFileId}
					{chartLoadError}
					{validationError}
					{isEditorReady}
				/>
				<button
					type="button"
					class="hover:bg-cyan/40 absolute top-0 right-0 h-full w-1 cursor-col-resize"
					class:bg-cyan={isDragging}
					onmousedown={handleMouseDown}
					onkeydown={handleKeyResize}
					aria-label="Resize sidebar"
				></button>
			</div>
		{:else}
			<div
				class="border-hairline hover:bg-surface-2 relative w-3 cursor-col-resize border-r"
				onclick={expandSidebar}
				onmousedown={handleMouseDown}
				onkeydown={(e) => {
					// role="button" should activate on both Enter and Space (WAI-ARIA pattern).
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						expandSidebar();
					}
				}}
				role="button"
				tabindex="0"
				title="Expand dock"
				aria-label="Expand dock"
			></div>
		{/if}
		<div class="bg-base min-w-0 flex-1">
			<div bind:this={gameContainer} class="h-full w-full">
				{#if !isGameInitialized}
					<div class="text-dim flex h-full items-center justify-center">
						Initializing editor…
					</div>
				{/if}
			</div>
		</div>
	</div>
	<TransportBar {isEditorReady} />
</div>
