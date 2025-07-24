<script lang="ts">
	import { Music, ArrowLeft, Link, Search, Download } from '@lucide/svelte';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { settingsStore } from '../stores/settingsStore';
	import { UploadedAssetFiles, ChartDetail } from '@dtx/common/components';
	import { isValidDtxFile } from '@dtx/common';
	import { onMount } from 'svelte';
	import CloudSongAutocomplete from './CloudSongAutocomplete.svelte';

	interface Props {
		song: TreeNode;
	}

	let { song }: Props = $props();

	// State for local files
	let localFiles = $state<File[]>([]);
	let isLoadingFiles = $state(false);
	let fileLoadError = $state<string | null>(null);

	const handleClose = () => {
		workspaceStore.closeSongDetails();
	};

	// Handle opening the editor with a DTX file
	const handleOpenEditor = async () => {
		try {
			// Find the first DTX file in the song folder
			const result = await window.electron.ipcRenderer.invoke('list-files', song.path);

			if (result.error) {
				throw new Error(result.error);
			}

			// Find DTX files
			const dtxFiles = result.data.filter((file: any) =>
				file.fileName.toLowerCase().endsWith('.dtx')
			);

			if (dtxFiles.length === 0) {
				console.warn('No DTX files found in the selected folder');
				return;
			}

			// Read the first DTX file
			const dtxFile = dtxFiles[0];
			const fileContent = await window.electron.ipcRenderer.invoke('read-file', dtxFile.key);

			if (fileContent.error) {
				throw new Error(fileContent.error);
			}

			// Parse the DTX file using the common library
			const { DTXFile } = await import('@dtx/common');
			const parsedDtx = new DTXFile();
			await parsedDtx.parseFromText(fileContent.data);

			// Open the editor
			workspaceStore.showEditor(parsedDtx);
		} catch (error) {
			console.error('Failed to open editor:', error);
		}
	};

	// Helper function to create File object with custom properties
	const createFileObject = (content: any, fileInfo: any) => {
		const file = new File([content], fileInfo.fileName, {
			lastModified: new Date(fileInfo.lastModified).getTime()
		});
		// Add the file path as a custom property for desktop uploads
		(file as any).filePath = fileInfo.key;
		return file;
	};

	// Load local files from the song folder
	const loadLocalFiles = async () => {
		if (!song.path) return;

		isLoadingFiles = true;
		fileLoadError = null;

		try {
			const result = await window.electron.ipcRenderer.invoke('list-files', song.path);

			if (result.error) {
				throw new Error(result.error);
			}

			// Convert file info to File objects for compatibility with UploadedAssetFiles
			// Only include files with valid DTX-related extensions
			const files = await Promise.all(
				result.files
					.filter((fileInfo: any) => isValidDtxFile(fileInfo.fileName))
					.map(async (fileInfo: any) => {
						try {
							// Read file content as buffer
							const response = await window.electron.ipcRenderer.invoke(
								'read-file',
								fileInfo.key,
								song.path // Pass the song directory as workspace root
							);

							// Destructure the response to get error and content
							const { error, content } = response;

							// Check if there was an error reading the file
							if (error) {
								console.warn(`Could not read file ${fileInfo.fileName}:`, error);
								// Create empty File object as fallback
								return createFileObject('', fileInfo);
							}

							// Create File object using the content property
							return createFileObject(content, fileInfo);
						} catch (error) {
							console.warn(`Could not read file ${fileInfo.fileName}:`, error);
							// Create empty File object as fallback
							return createFileObject('', fileInfo);
						}
					})
			);

			localFiles = files;
		} catch (error) {
			console.error('Error loading local files:', error);
			fileLoadError = error instanceof Error ? error.message : 'Failed to load files';
		} finally {
			isLoadingFiles = false;
		}
	};

	// Load files when component mounts or song changes
	onMount(() => {
		loadLocalFiles();

		// Return cleanup function
		return () => {
			unsubscribeSettings();
		};
	});

	// Reload files when song changes
	$effect(() => {
		if (song.path) {
			loadLocalFiles();
		}
	});

	// Mock Supabase client for local-only functionality
	const mockSupabaseClient = {
		auth: {
			getSession: () => Promise.resolve({ data: { session: null }, error: null })
		}
	} as any;

	// State for parsed local DTX data
	let parsedLocalData = $state<{
		bpm?: number;
		artist?: string;
		levels?: { label: string; level: number }[];
	}>({});

	// State for upload process
	let isUploading = $state(false);
	let uploadError = $state<string | null>(null);
	let uploadSuccess = $state(false);

	// Reactive form values that mirror the ChartDetail component's state
	let displayId = $state(0);
	let publishDate = $state('');
	let downloadUrl = $state('');
	let videoPreviewUrl = $state('');
	let isPublished = $state(false);

	// Track which action is being performed
	let currentUploadAction: 'draft' | 'publish' | null = $state(null);

	// Autocomplete popup state
	let showAutocomplete = $state(false);
	let autocompletePosition = $state({ top: 0, left: 0, width: 0 });

	// Linking state
	let isLinking = $state(false);
	let linkingError = $state<string | null>(null);
	let linkingSuccess = $state(false);

	// Update state
	let isUpdating = $state(false);
	let updateError = $state<string | null>(null);
	let updateSuccess = $state(false);

	// Export state
	let isExporting = $state(false);
	let exportError = $state<string | null>(null);
	let exportSuccess = $state(false);
	let exportedFilePath = $state<string | null>(null);

	// Settings store subscription for export directory
	let currentSettings = $state({ exportDirectory: '~/Downloads' });
	const unsubscribeSettings = settingsStore.subscribe((settings) => {
		currentSettings = settings;
	});

	// Get all linked song IDs from workspace to exclude from search
	const getLinkedSongIds = $derived(() => {
		const workspaceState = $workspaceStore;
		const linkedIds: string[] = [];

		const collectLinkedIds = (nodes: typeof workspaceState.treeStructure) => {
			for (const node of nodes) {
				if (node.linkedSimFileId) {
					linkedIds.push(node.linkedSimFileId);
				}
				if (node.children.length > 0) {
					collectLinkedIds(node.children);
				}
			}
		};

		collectLinkedIds(workspaceState.treeStructure);
		return linkedIds;
	});

	// Custom asset file loader for desktop
	const loadAssetFilesForDesktop = async (simfileId: string) => {
		// For unlinked songs (no simfileId), return empty array - we only show local files
		if (!simfileId || simfileId === '') {
			return [];
		}

		// For linked songs, fetch actual cloud files via IPC
		try {
			const result = await window.electron.ipcRenderer.invoke('load-asset-files', simfileId);
			return result || [];
		} catch (error) {
			console.error('Error loading cloud asset files:', error);
			return [];
		}
	};

	// Handle upload for unlinked songs
	const handleUploadSong = async (event: CustomEvent) => {
		// Update reactive variables with current form values from ChartDetail
		if (event.detail) {
			displayId = event.detail.displayId !== undefined ? event.detail.displayId : displayId;
			publishDate =
				event.detail.publishDate !== undefined ? event.detail.publishDate : publishDate;
			downloadUrl =
				event.detail.downloadUrl !== undefined ? event.detail.downloadUrl : downloadUrl;
			videoPreviewUrl =
				event.detail.videoPreviewUrl !== undefined
					? event.detail.videoPreviewUrl
					: videoPreviewUrl;
		}

		// Override isPublished based on the current action
		if (currentUploadAction) {
			event.detail.isPublished = currentUploadAction === 'publish';
		}

		const isPublished = event.detail.isPublished || false;
		await uploadSong(event, isPublished);

		// Reset action after upload
		currentUploadAction = null;
	};

	// Function to trigger save with specific isPublished value
	const triggerSave = (isPublished: boolean) => {
		// Set the current action
		currentUploadAction = isPublished ? 'publish' : 'draft';

		// Use reactive variables directly (no DOM access needed)
		const currentFormValues = {
			displayId: displayId,
			publishDate: publishDate,
			downloadUrl: downloadUrl,
			videoPreviewUrl: videoPreviewUrl,
			isPublished: isPublished
		};

		// Create event with the current form values
		const event = new CustomEvent('onSave', {
			detail: currentFormValues
		});
		handleUploadSong(event);
	};

	// Common upload function
	const uploadSong = async (event: CustomEvent, isPublished: boolean) => {
		if (!song.containsDtxFiles || song.linkedSimFile) {
			return;
		}

		isUploading = true;
		uploadError = null;
		uploadSuccess = false;

		try {
			// Create plain object without any Svelte reactivity
			const simfileData = JSON.parse(
				JSON.stringify({
					title: String(song.songTitle || song.name || ''),
					artist: String(parsedLocalData.artist || ''),
					bpm: Number(parsedLocalData.bpm || 0),
					displayId: Number(displayId),
					isPublished: Boolean(
						event.detail.isPublished !== undefined
							? event.detail.isPublished
							: isPublished
					),
					publishDate: String(publishDate),
					downloadUrl: String(downloadUrl),
					videoPreviewUrl: String(videoPreviewUrl),
					levels: Array.isArray(parsedLocalData.levels)
						? parsedLocalData.levels.map((l) => ({
								label: String(l.label || ''),
								level: Number(l.level || 0)
							}))
						: [],
					// Pass the song path so main process can find and read preview files
					songPath: String(song.path || '')
				})
			);

			// Call IPC to create simfile record
			const result = await window.electron.ipcRenderer.invoke(
				'create-simfile-record',
				simfileData
			);

			if (result.success) {
				uploadSuccess = true;
				// Update the song with the new linked data
				song.linkedSimFileId = result.simfileId;
				song.linkedSimFile = result.data;

				// Update the workspace store
				workspaceStore.linkSimFileToFolder(song.path, result.data);

				// Hide success message after 3 seconds
				setTimeout(() => {
					uploadSuccess = false;
				}, 3000);
			} else {
				throw new Error(result.error || 'Failed to create simfile record');
			}
		} catch (error) {
			console.error('Error uploading song:', error);
			uploadError = error instanceof Error ? error.message : 'Failed to upload song';

			// Clear error message after 10 seconds
			setTimeout(() => {
				uploadError = null;
			}, 10000);
		} finally {
			isUploading = false;
		}
	};

	// Handle showing autocomplete popup
	const handleShowAutocomplete = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		// Center the popup on screen
		autocompletePosition = {
			top: window.innerHeight / 2 - 200, // Subtract half of estimated popup height
			left: window.innerWidth / 2 - 200, // Subtract half of popup width (400px)
			width: 400
		};

		showAutocomplete = true;
	};

	// Handle cloud song selection from autocomplete
	const handleCloudSongSelect = async (selectedSong: any) => {
		showAutocomplete = false;

		if (!selectedSong || !song.path) return;

		isLinking = true;
		linkingError = null;
		linkingSuccess = false;

		try {
			// Call IPC to get the cloud song data (no file caching in main process)
			const result = await window.electron.ipcRenderer.invoke('fetch-cloud-song', {
				cloudSongId: selectedSong.id
			});

			if (result.success) {
				linkingSuccess = true;
				// Update the song with the linked data
				song.linkedSimFileId = selectedSong.id;
				song.linkedSimFile = result.cloudSongData || selectedSong;

				// Update the workspace store (this will automatically cache to localStorage)
				workspaceStore.linkSimFileToFolder(song.path, song.linkedSimFile);

				// Hide success message after 3 seconds
				setTimeout(() => {
					linkingSuccess = false;
				}, 3000);
			} else {
				throw new Error(result.error || 'Failed to link song to cloud');
			}
		} catch (error) {
			console.error('Error linking song to cloud:', error);
			linkingError = error instanceof Error ? error.message : 'Failed to link song to cloud';

			// Clear error message after 10 seconds
			setTimeout(() => {
				linkingError = null;
			}, 10000);
		} finally {
			isLinking = false;
		}
	};

	// Handle updating linked simfile
	const handleUpdateSimfile = async (event: CustomEvent) => {
		if (!song.linkedSimFile || !song.linkedSimFileId) {
			console.error('No linked simfile to update');
			return;
		}

		isUpdating = true;
		updateError = null;
		updateSuccess = false;

		try {
			// Build update data object
			const updateData: any = {
				display_id: Number(event.detail.displayId),
				publish_date: String(event.detail.publishDate),
				is_published: Boolean(event.detail.isPublished),
				download_url: String(event.detail.downloadUrl),
				video_preview_url: String(event.detail.videoPreviewUrl)
			};

			// Add parsed local data if available (BPM, artist, title)
			if (parsedLocalData.bpm) {
				updateData.bpm = parsedLocalData.bpm;
			}
			if (parsedLocalData.artist) {
				updateData.artist = parsedLocalData.artist;
			}
			if (song.songTitle || song.name) {
				updateData.title = song.songTitle || song.name;
			}

			// Call IPC to update simfile record
			const result = await window.electron.ipcRenderer.invoke('update-simfile-record', {
				simfileId: song.linkedSimFileId,
				updateData
			});

			if (result.success) {
				updateSuccess = true;
				// Update the local song data with the new information
				song.linkedSimFile = { ...song.linkedSimFile, ...result.data };

				// Update the workspace store
				workspaceStore.linkSimFileToFolder(song.path, song.linkedSimFile);

				// Hide success message after 3 seconds
				setTimeout(() => {
					updateSuccess = false;
				}, 3000);
			} else {
				throw new Error(result.error || 'Failed to update simfile');
			}
		} catch (error) {
			console.error('Error updating simfile:', error);
			updateError = error instanceof Error ? error.message : 'Failed to update simfile';

			// Clear error message after 10 seconds
			setTimeout(() => {
				updateError = null;
			}, 10000);
		} finally {
			isUpdating = false;
		}
	};

	// Handle exporting song to zip
	const handleExportToZip = async () => {
		if (!song.path) {
			console.error('No song path available for export');
			return;
		}

		isExporting = true;
		exportError = null;
		exportSuccess = false;
		exportedFilePath = null;

		try {
			const zipFileName = song.name || 'song';
			const result = await window.electron.ipcRenderer.invoke('export-song-to-zip', {
				songPath: song.path,
				songTitle: zipFileName,
				exportDirectory: currentSettings.exportDirectory
			});

			if (result.success) {
				exportSuccess = true;
				exportedFilePath = result.zipPath;
				console.log(
					`Export successful: ${result.filesCount} files exported to ${result.zipPath}`
				);

				// Hide success message after 8 seconds
				setTimeout(() => {
					exportSuccess = false;
					exportedFilePath = null;
				}, 8000);
			} else {
				throw new Error(result.error || 'Failed to export song');
			}
		} catch (error) {
			console.error('Error exporting song:', error);
			exportError = error instanceof Error ? error.message : 'Failed to export song';

			// Clear error message after 10 seconds
			setTimeout(() => {
				exportError = null;
			}, 10000);
		} finally {
			isExporting = false;
		}
	};

	// Effect to parse local DTX files when needed
	$effect(() => {
		// Only parse local files if we have a folder path and linked simfile data is missing key information
		const shouldParse =
			song.path &&
			(!song.linkedSimFile ||
				song.linkedSimFile.bpm === undefined ||
				song.linkedSimFile.bpm === null ||
				song.linkedSimFile.artist === undefined ||
				song.linkedSimFile.artist === null ||
				song.linkedSimFile.artist === '');

		if (shouldParse) {
			// Use async function inside effect
			(async () => {
				try {
					// Use IPC to parse DTX files in the main process
					const result = await window.electron?.ipcRenderer?.invoke(
						'parse-dtx-files',
						song.path
					);

					if (result) {
						parsedLocalData = {
							bpm: result.bpm,
							artist: result.artist,
							levels: result.levels || []
						};
					} else {
						parsedLocalData = {};
					}
				} catch (error) {
					console.warn('Failed to parse local DTX files via IPC:', error);
					parsedLocalData = {};
				}
			})();
		} else {
			parsedLocalData = {};
		}
	});

	// Convert song data to simfile format for ChartDetail component
	// Use parsed local data as fallback when linked simfile data is missing
	const simfileData = $derived(() => {
		return {
			title: song.songTitle || song.name,
			artist: song.linkedSimFile?.artist || parsedLocalData.artist,
			bpm: song.linkedSimFile?.bpm || parsedLocalData.bpm,
			publish_date: song.linkedSimFile?.publish_date || publishDate,
			display_id: song.linkedSimFile?.display_id || displayId,
			is_published: song.linkedSimFile?.is_published || false,
			download_url: song.linkedSimFile?.download_url || downloadUrl,
			video_preview_url: song.linkedSimFile?.video_preview_url || videoPreviewUrl,
			dtx_files:
				song.linkedSimFile?.dtx_files ||
				(parsedLocalData.levels
					? parsedLocalData.levels.map((l, index) => ({
							id: index + 1,
							label: l.label || 'Unknown',
							level: l.level || 0,
							simfile_id: 0
						}))
					: [])
		};
	});

	// Initialize reactive form values from simfileData
	$effect(() => {
		const data = simfileData();
		// Always update form values to reflect current data
		displayId = data.display_id || 0;
		publishDate = data.publish_date || new Date().toISOString().split('T')[0];
		downloadUrl = data.download_url || '';
		videoPreviewUrl = data.video_preview_url || '';
		isPublished = data.is_published || false;
	});
</script>

{#if song.linkedSimFile}
	<!-- For linked songs, use the built-in Update button -->
	<div class="flex h-full flex-col">
		<ChartDetail
			simfile={simfileData()}
			showEditor={true}
			showPublishingControls={true}
			showPublishedToggle={true}
			saveButtonText="Update"
			onOpenEditor={handleOpenEditor}
			bind:displayId
			bind:publishDate
			bind:downloadUrl
			bind:videoPreviewUrl
			bind:isPublished
			on:onSave={handleUpdateSimfile}
		>
			{#snippet header()}
				<!-- Header -->
				<div
					class="flex items-center justify-between gap-2 border-b border-slate-200 p-6 pb-4 dark:border-slate-700"
				>
					<div class="flex items-center gap-2">
						<Music size={20} class="text-purple-500 dark:text-purple-400" />
						<h2 class="text-xl font-semibold">Song Details</h2>
					</div>
					<div class="flex items-center gap-2">
						<button
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-green-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-green-600 hover:to-green-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
							onclick={handleExportToZip}
							disabled={isExporting}
							tabindex="0"
							aria-label="Export to ZIP"
						>
							{#if isExporting}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Exporting...
							{:else}
								<Download size={16} />
								Export to ZIP
							{/if}
						</button>
						<button
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-slate-500 to-slate-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
							onclick={handleClose}
							tabindex="0"
							aria-label="Back to workspace"
						>
							<ArrowLeft size={16} />
							Back to Workspace
						</button>
					</div>
				</div>
			{/snippet}

			{#snippet desktop_info()}
				<!-- Status Section - This will be rendered outside the grid -->
				<div class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
					<div class="flex items-center gap-2">
						<Link size={16} class="text-green-500 dark:text-green-400" />
						<span class="font-semibold text-green-800 dark:text-green-200">
							{song.linkedSimFile.title}
						</span>
						<span
							class="rounded bg-green-200 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-800 dark:text-green-200"
						>
							Linked
						</span>
					</div>
				</div>

				<!-- Update Status Messages -->
				{#if isUpdating}
					<div class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
						<div class="flex items-center gap-2">
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<span class="text-sm text-blue-800 dark:text-blue-200">
								Updating cloud song...
							</span>
						</div>
					</div>
				{/if}

				{#if updateError}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Update failed: {updateError}
							</span>
						</div>
					</div>
				{/if}

				{#if updateSuccess}
					<div class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-green-800 dark:text-green-200">
								Cloud song updated successfully!
							</span>
						</div>
					</div>
				{/if}

				<!-- Export Status Messages -->
				{#if isExporting}
					<div class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
						<div class="flex items-center gap-2">
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<span class="text-sm text-blue-800 dark:text-blue-200">
								Exporting song to ZIP...
							</span>
						</div>
					</div>
				{/if}

				{#if exportError}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Export failed: {exportError}
							</span>
						</div>
					</div>
				{/if}

				{#if exportSuccess}
					<div class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-green-800 dark:text-green-200">
								Song exported to ZIP successfully!
							</span>
							{#if exportedFilePath}
								<span
									class="font-mono text-xs break-all text-green-700 dark:text-green-300"
								>
									Saved to: {exportedFilePath}
								</span>
							{/if}
						</div>
					</div>
				{/if}
			{/snippet}

			{#snippet folder_upload()}
				<!-- Folder Name -->
				<div class="col-span-1 flex items-center">
					<span class="mr-2 block text-slate-700 dark:text-slate-300">Folder:</span>
				</div>
				<div class="col-span-7">
					<span class="font-mono text-sm text-slate-900 dark:text-slate-100"
						>{song.name}</span
					>
				</div>

				<!-- Song Path -->
				<div class="col-span-1 flex items-center">
					<span class="mr-2 block text-slate-700 dark:text-slate-300">Path:</span>
				</div>
				<div class="col-span-7">
					<span class="truncate font-mono text-sm text-slate-900 dark:text-slate-100"
						>{song.path}</span
					>
				</div>
			{/snippet}

			{#snippet local_files()}
				<!-- Local Asset Files Section -->
				<div class="rounded-lg bg-slate-50 dark:bg-slate-800/50">
					{#if isLoadingFiles}
						<div class="flex justify-center p-4">
							<p class="text-slate-600 dark:text-slate-400">Loading files...</p>
						</div>
					{:else if fileLoadError}
						<div class="p-4 text-red-500">
							<p>{fileLoadError}</p>
							<button
								class="mt-2 rounded-sm bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
								onclick={loadLocalFiles}
							>
								Retry
							</button>
						</div>
					{:else}
						<!-- Use UploadedAssetFiles component for local files display -->
						<UploadedAssetFiles
							simfileId={song.linkedSimFileId?.toString() || ''}
							userFiles={localFiles}
							supabaseClient={mockSupabaseClient}
							simfileBucketUrl=""
							loadAssetFiles={loadAssetFilesForDesktop}
							isDesktop={true}
							songFolderPath={song.path || ''}
						/>
					{/if}
				</div>
			{/snippet}
		</ChartDetail>
	</div>
{:else}
	<!-- For unlinked songs, use custom upload buttons -->
	<div class="flex h-full flex-col">
		<ChartDetail
			simfile={simfileData()}
			showEditor={true}
			showPublishingControls={true}
			showPublishedToggle={false}
			onOpenEditor={handleOpenEditor}
			bind:displayId
			bind:publishDate
			bind:downloadUrl
			bind:videoPreviewUrl
			bind:isPublished
			on:onSave={handleUploadSong}
		>
			{#snippet header()}
				<!-- Header -->
				<div
					class="flex items-center justify-between gap-2 border-b border-slate-200 p-6 pb-4 dark:border-slate-700"
				>
					<div class="flex items-center gap-2">
						<Music size={20} class="text-purple-500 dark:text-purple-400" />
						<h2 class="text-xl font-semibold">Song Details</h2>
					</div>
					<div class="flex items-center gap-2">
						<button
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-500 to-green-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-green-600 hover:to-green-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
							onclick={handleExportToZip}
							disabled={isExporting}
							tabindex="0"
							aria-label="Export to ZIP"
						>
							{#if isExporting}
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Exporting...
							{:else}
								<Download size={16} />
								Export to ZIP
							{/if}
						</button>
						<button
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-slate-500 to-slate-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-slate-600 hover:to-slate-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
							onclick={handleClose}
							tabindex="0"
							aria-label="Back to workspace"
						>
							<ArrowLeft size={16} />
							Back to Workspace
						</button>
					</div>
				</div>
			{/snippet}

			{#snippet desktop_info()}
				<!-- Status Section - This will be rendered outside the grid -->
				{#if song.containsDtxFiles}
					<div class="rounded-lg bg-yellow-50 p-3 dark:bg-yellow-900/20">
						<div class="flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								<Music size={16} class="text-yellow-600 dark:text-yellow-400" />
								<span class="text-sm text-yellow-800 dark:text-yellow-200">
									Not linked - Local song not yet uploaded to cloud
								</span>
							</div>
							<button
								class="flex items-center gap-2 rounded-lg bg-purple-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-600 focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none dark:bg-purple-600 dark:hover:bg-purple-700"
								onclick={handleShowAutocomplete}
								disabled={isLinking}
							>
								{#if isLinking}
									<div
										class="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent"
									></div>
									Linking...
								{:else}
									<Search size={14} />
									Link to Cloud
								{/if}
							</button>
						</div>
					</div>
				{/if}

				<!-- Linking Status Messages -->
				{#if isLinking}
					<div class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
						<div class="flex items-center gap-2">
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<span class="text-sm text-blue-800 dark:text-blue-200">
								Linking song to cloud...
							</span>
						</div>
					</div>
				{/if}

				{#if linkingError}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Linking failed: {linkingError}
							</span>
						</div>
					</div>
				{/if}

				{#if linkingSuccess}
					<div class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-green-800 dark:text-green-200">
								Song linked successfully! It is now linked to the cloud.
							</span>
						</div>
					</div>
				{/if}

				<!-- Upload Status Messages -->
				{#if isUploading}
					<div class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
						<div class="flex items-center gap-2">
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<span class="text-sm text-blue-800 dark:text-blue-200">
								Uploading song to cloud...
							</span>
						</div>
					</div>
				{/if}

				{#if uploadError}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Upload failed: {uploadError}
							</span>
						</div>
					</div>
				{/if}

				{#if uploadSuccess}
					<div class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-green-800 dark:text-green-200">
								Song uploaded successfully! It is now linked to the cloud.
							</span>
						</div>
					</div>
				{/if}

				<!-- Export Status Messages -->
				{#if isExporting}
					<div class="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
						<div class="flex items-center gap-2">
							<div
								class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
							></div>
							<span class="text-sm text-blue-800 dark:text-blue-200">
								Exporting song to ZIP...
							</span>
						</div>
					</div>
				{/if}

				{#if exportError}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Export failed: {exportError}
							</span>
						</div>
					</div>
				{/if}

				{#if exportSuccess}
					<div class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-green-800 dark:text-green-200">
								Song exported to ZIP successfully!
							</span>
							{#if exportedFilePath}
								<span
									class="font-mono text-xs break-all text-green-700 dark:text-green-300"
								>
									Saved to: {exportedFilePath}
								</span>
							{/if}
						</div>
					</div>
				{/if}
			{/snippet}

			{#snippet folder_upload()}
				<!-- Folder Name -->
				<div class="col-span-1 flex items-center">
					<span class="mr-2 block text-slate-700 dark:text-slate-300">Folder:</span>
				</div>
				<div class="col-span-7">
					<span class="font-mono text-sm text-slate-900 dark:text-slate-100"
						>{song.name}</span
					>
				</div>

				<!-- Song Path -->
				<div class="col-span-1 flex items-center">
					<span class="mr-2 block text-slate-700 dark:text-slate-300">Path:</span>
				</div>
				<div class="col-span-7">
					<span class="truncate font-mono text-sm text-slate-900 dark:text-slate-100"
						>{song.path}</span
					>
				</div>
			{/snippet}

			{#snippet local_files()}
				<!-- Local Asset Files Section -->
				<div class="rounded-lg bg-slate-50 dark:bg-slate-800/50">
					{#if isLoadingFiles}
						<div class="flex justify-center p-4">
							<p class="text-slate-600 dark:text-slate-400">Loading files...</p>
						</div>
					{:else if fileLoadError}
						<div class="p-4 text-red-500">
							<p>{fileLoadError}</p>
							<button
								class="mt-2 rounded-sm bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
								onclick={loadLocalFiles}
							>
								Retry
							</button>
						</div>
					{:else}
						<!-- Use UploadedAssetFiles component for local files display -->
						<UploadedAssetFiles
							simfileId={song.linkedSimFileId?.toString() || ''}
							userFiles={localFiles}
							supabaseClient={mockSupabaseClient}
							simfileBucketUrl=""
							loadAssetFiles={loadAssetFilesForDesktop}
							isDesktop={true}
							songFolderPath={song.path || ''}
						/>
					{/if}
				</div>
			{/snippet}

			{#snippet save()}
				{#if song.containsDtxFiles}
					<div class="flex gap-2">
						{#if isUploading}
							<div class="flex items-center gap-2">
								<div
									class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
								></div>
								Uploading...
							</div>
						{:else}
							<button
								class="rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-800"
								onclick={() => triggerSave(false)}
							>
								Upload as Draft
							</button>
							<button
								class="rounded-sm bg-green-500 px-4 py-2 font-bold text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-800"
								onclick={() => triggerSave(true)}
							>
								Upload and Publish
							</button>
						{/if}
					</div>
				{/if}
			{/snippet}
		</ChartDetail>
	</div>
{/if}

<!-- Autocomplete Popup -->
<CloudSongAutocomplete
	isOpen={showAutocomplete}
	position={autocompletePosition}
	excludeLinkedSongIds={getLinkedSongIds()}
	onclose={() => (showAutocomplete = false)}
	onselect={handleCloudSongSelect}
/>
