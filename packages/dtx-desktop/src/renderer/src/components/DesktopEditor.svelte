<script lang="ts">
	// Desktop Editor component that uses common package components directly
	import { onMount } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { MainTab, SoundTab } from '@dtx/common/components';
	import Phaser from 'phaser';
	import { Editor } from '@dtx/common/game';
	import { store } from '@dtx/common';
	import { DTXFile, SimFile, setFileProvider } from '@dtx/common';
	import { DesktopFileProvider } from '../services/desktopFileProvider';
	import type { ChartMetadata } from '@dtx/common/services/tempChartStorage';
	import { editorMappingStore } from '../stores/editorMappingStore';

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
	let isLocalEditingMode = $state(false); // Track if we should treat this as local editing

	const handleBackToWorkspace = () => {
		// Navigate back to workspace
		window.location.hash = '';
	};

	const switchTab = (tab: string) => {
		currentTab = tab;
	};

	onMount(async () => {
		try {
			// Initialize file provider
			let workspacePath = localStorage.getItem('workspace_path') || '';
			// Remove extra quotes if present
			if (workspacePath.startsWith('"') && workspacePath.endsWith('"')) {
				workspacePath = workspacePath.slice(1, -1);
			}
			console.log('Cleaned workspace path:', workspacePath);
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
				const dtxFile = new DTXFile();
				dtxFile.title = chartMetadata.title;
				dtxFile.artist = chartMetadata.artist;
				dtxFile.comment = chartMetadata.comment;
				dtxFile.bpm = chartMetadata.bpm;
				dtxFile.level = chartMetadata.level;

				// Initialize store with default values
				store.currentSimfileID.set(null);
				store.currentDifficulty.set(null);
				store.currentDtxFile.set(dtxFile);
				store.editorNotes.set({});
				store.currentSoundChip.set([]);
				store.measureCount.set(10);

				// Desktop app is always local editing
				isLocalEditingMode = true;
			}

			// Initialize the Phaser game for the editor
			if (gameContainer) {
				// Set up the game configuration for desktop
				const gameConfig = {
					type: Phaser.AUTO,
					width: gameContainer.clientWidth,
					height: gameContainer.clientHeight,
					parent: gameContainer,
					scene: [Editor],
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
				const game = new Phaser.Game(gameConfig);

				isGameInitialized = true;

				// Cleanup function
				return () => {
					if (game) {
						game.destroy(true);
					}
				};
			}
		} catch (error) {
			console.error('Failed to initialize desktop editor:', error);
			// Set initialized to true even on error so we don't show loading forever
			isGameInitialized = true;
		} finally {
			isLoading = false;
		}
	});

	const loadFromSimFileId = async (simFileIdParam: string) => {
		try {
			console.log('Loading from simFileId:', simFileIdParam);

			// Get the folder path from the mapping store
			let folderPath: string | undefined;
			editorMappingStore.subscribe((state) => {
				folderPath = state.simFileIdToFolderPath[simFileIdParam];
			})();

			if (!folderPath) {
				throw new Error(`No folder path found for simFileId: ${simFileIdParam}`);
			}

			console.log('Resolved folder path:', folderPath);

			// Get folder name for display
			const folderName = folderPath.split('/').pop() || 'Unknown';

			await loadLocalFilesFromPath(folderPath, folderName);
		} catch (error) {
			console.error('Failed to load from simFileId:', error);
			// Set default metadata on error
			chartMetadata = {
				title: simFileIdParam || 'New Song',
				artist: 'Unknown Artist',
				comment: '',
				bpm: 120,
				level: 1,
				soundChips: []
			};

			// Create default DTXFile
			const dtxFile = new DTXFile();
			dtxFile.title = chartMetadata.title;
			dtxFile.artist = chartMetadata.artist;
			dtxFile.comment = chartMetadata.comment;
			dtxFile.bpm = chartMetadata.bpm;
			dtxFile.level = chartMetadata.level;

			store.currentSimfileID.set(simFileIdParam);
			store.currentDtxFile.set(dtxFile);
			store.currentSoundChip.set([]);
			store.editorNotes.set({});
			store.measureCount.set(10);

			// Desktop app is always local editing
			isLocalEditingMode = true;
		}
	};

	const loadLocalFilesFromPath = async (
		folderPath: string,
		folderName: string,
		remoteMetadata: any = null
	) => {
		// Try to load SET.def file first directly from the folder path
		let setDefFile: File | undefined;
		let localSimFile: any = null;

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

		// Try to load DTX files for sound chips
		let soundChips: any[] = [];
		let dtxFile: DTXFile | null = null;

		try {
			const dtxFiles = ['ext.dtx', 'mas.dtx', 'bas.dtx', 'adv.dtx', 'nov.dtx'];
			for (const dtxFileName of dtxFiles) {
				const dtxResult = await window.electron.ipcRenderer.invoke(
					'read-file',
					`${folderPath}/${dtxFileName}`,
					folderPath
				);
				if (!dtxResult.error) {
					const blob = new Blob([dtxResult.content], { type: 'text/plain' });
					const dtxFileContent = new File([blob], dtxFileName);

					dtxFile = new DTXFile(dtxFileContent);
					await dtxFile.parse();
					soundChips = dtxFile.parseSoundChips();
					break;
				}
			}
		} catch (error) {
			console.warn('Failed to load DTX files:', error);
		}

		// Combine remote metadata with local file data
		chartMetadata = {
			title: remoteMetadata?.title || localSimFile?.title || folderName,
			artist: remoteMetadata?.artist || dtxFile?.artist || 'Unknown Artist',
			comment: dtxFile?.comment || '',
			bpm: remoteMetadata?.bpm || dtxFile?.bpm || 120,
			level: dtxFile?.level || 1,
			soundChips: soundChips.map((chip) => ({
				label: chip.label,
				id: chip.id,
				volume: chip.volume,
				position: chip.position,
				fileName: chip.fileName,
				filePath: chip.filePath
			}))
		};

		// Create DTXFile for MainTab
		const mainTabDtxFile = dtxFile || new DTXFile();
		mainTabDtxFile.title = chartMetadata.title;
		mainTabDtxFile.artist = chartMetadata.artist;
		mainTabDtxFile.comment = chartMetadata.comment;
		mainTabDtxFile.bpm = chartMetadata.bpm;
		mainTabDtxFile.level = chartMetadata.level;

		// Update store
		store.currentSimfileID.set(folderName); // Use folder name instead of remote ID
		store.currentSimfile.set(localSimFile);
		store.currentDtxFile.set(mainTabDtxFile);
		store.currentSoundChip.set(soundChips);
		store.editorNotes.set({});
		store.measureCount.set(10);

		// Desktop app is always local editing
		isLocalEditingMode = true;
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
				DTX Editor {simFileId ? `- ${simFileId}` : '- New Chart'}
			</h1>
		</div>

		<!-- Tab Navigation -->
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
		</div>
	</div>

	<!-- Editor Content -->
	<div class="flex h-full">
		<!-- Sidebar for tabs -->
		<div class="w-80 border-r border-slate-700 bg-slate-800 p-4">
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
				<MainTab />
			{:else if currentTab === 'sound'}
				{console.log(
					'SoundTab render - isLocalEditingMode:',
					isLocalEditingMode,
					'simFileId:',
					simFileId,
					'will pass:',
					isLocalEditingMode ? null : simFileId
				)}
				<SoundTab simfileID={isLocalEditingMode ? null : simFileId} />
			{/if}
		</div>

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
