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

	interface Props {
		simfileID?: string;
	}

	let { simfileID }: Props = $props();

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

			// Load simfile data if we have a simfileID
			if (simfileID) {
				await loadSimfileData(simfileID);
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

	const loadSimfileData = async (simfileId: string) => {
		try {
			console.log('Loading simfile for editing:', simfileId);

			// Check if this is a numeric ID (likely linked to remote simfile)
			const isNumericId = /^\d+$/.test(simfileId);
			console.log('Is numeric ID:', isNumericId);

			if (isNumericId) {
				// For numeric IDs, we need to find the actual local folder that's linked to this simfile
				console.log('Looking for local folder linked to simfile ID:', simfileId);
				await loadLinkedSimfileData(simfileId);
			} else {
				// For string names, load purely local
				console.log('Loading purely local for folder:', simfileId);
				await loadLocalSimfileData(simfileId);
			}
		} catch (error) {
			console.error('Failed to load simfile data:', error);
			// Set default metadata on error
			chartMetadata = {
				title: simfileId || 'New Song',
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

			store.currentSimfileID.set(simfileId);
			store.currentDtxFile.set(dtxFile);
			store.currentSoundChip.set([]);
			store.editorNotes.set({});
			store.measureCount.set(10);

			// Desktop app is always local editing
			isLocalEditingMode = true;
		}
	};

	const loadLinkedSimfileData = async (simfileId: string) => {
		console.log('Loading data for simfile ID:', simfileId);

		// For the editor, we don't need cloud metadata - load from local directory directly
		// First, find a local folder that matches this song (by title or linked ID)
		const workspacePath = localStorage.getItem('workspace_path')?.replace(/^"|"$/g, '') || '';
		console.log('Searching workspace for song folder:', workspacePath);

		let songFolderPath: string | null = null;
		let folderName: string | null = null;

		try {
			// Load the tree structure to find the song folder
			const treeStructure = await window.electron.ipcRenderer.invoke(
				'load-tree-structure',
				workspacePath
			);

			// First, try to find a folder with matching linkedSimFileId
			const findByLinkedId = (nodes: any[]): any => {
				for (const node of nodes) {
					if (node.linkedSimFileId === simfileId) {
						return node;
					}
					if (node.children && node.children.length > 0) {
						const found = findByLinkedId(node.children);
						if (found) return found;
					}
				}
				return null;
			};

			let songFolder = findByLinkedId(treeStructure);

			// If no linked folder found, try to find by matching song title
			if (!songFolder) {
				// Get remote metadata to find the song title
				let remoteTitle: string | null = null;
				try {
					const currentSession =
						await window.electron.ipcRenderer.invoke('get-current-session');
					if (currentSession) {
						const userSimfiles =
							await window.electron.ipcRenderer.invoke('fetch-user-simfiles');
						const remoteMetadata = userSimfiles.data?.find(
							(sf: any) => sf.id.toString() === simfileId
						);
						remoteTitle = remoteMetadata?.title;
					}
				} catch (error) {
					console.warn('Failed to fetch remote metadata:', error);
				}

				// Try to find folder by title match (case-insensitive, partial match)
				const findByTitle = (nodes: any[]): any => {
					for (const node of nodes) {
						if (remoteTitle) {
							// Try exact match first
							if (node.name.toLowerCase() === remoteTitle.toLowerCase()) {
								return node;
							}
							// Try partial match (folder name contains song title or vice versa)
							if (
								node.name.toLowerCase().includes(remoteTitle.toLowerCase()) ||
								remoteTitle.toLowerCase().includes(node.name.toLowerCase())
							) {
								return node;
							}
						}
						if (node.children && node.children.length > 0) {
							const found = findByTitle(node.children);
							if (found) return found;
						}
					}
					return null;
				};

				songFolder = findByTitle(treeStructure);
			}

			// If still no folder found, just pick the first folder with DTX files
			if (!songFolder) {
				const findWithDtxFiles = (nodes: any[]): any => {
					for (const node of nodes) {
						if (node.containsDtxFiles) {
							return node;
						}
						if (node.children && node.children.length > 0) {
							const found = findWithDtxFiles(node.children);
							if (found) return found;
						}
					}
					return null;
				};

				songFolder = findWithDtxFiles(treeStructure);
			}

			if (songFolder) {
				songFolderPath = songFolder.path;
				folderName = songFolder.name;
			} else {
				throw new Error(
					`No suitable folder found in workspace for simfile ID ${simfileId}. Please ensure there's a folder with DTX files in the workspace.`
				);
			}
		} catch (error) {
			console.error('Error finding song folder:', error);
			throw error;
		}

		// Load the files from the found folder
		if (songFolderPath && folderName) {
			await loadLocalFilesFromPath(songFolderPath, folderName);
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

	const loadLocalSimfileData = async (simfileId: string) => {
		// For pure local loading, construct the path from workspace + simfileId
		const workspacePath = localStorage.getItem('workspace_path')?.replace(/^"|"$/g, '') || '';
		const folderPath = `${workspacePath}/${simfileId}`;

		await loadLocalFilesFromPath(folderPath, simfileId);
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
				DTX Editor {simfileID ? `- Song ID: ${simfileID}` : '- New Chart'}
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
					'simfileID:',
					simfileID,
					'will pass:',
					isLocalEditingMode ? null : simfileID
				)}
				<SoundTab simfileID={isLocalEditingMode ? null : simfileID} />
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
