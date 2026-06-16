<script lang="ts">
	import { Music, ArrowLeft, Link, Search, Download } from '@lucide/svelte';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { settingsStore } from '../stores/settingsStore';
	import { editorMappingStore } from '../stores/editorMappingStore';
	import { authStore } from '../stores/authStore';
	import { UploadedAssetFiles, ChartDetail } from '@dtx/common/components';
	import { isValidDtxFile } from '@dtx/common';
	import type { SimfileWithDtx, DtxFileRow } from '@dtx/common';
	import { onMount } from 'svelte';
	import CloudSongAutocomplete from './CloudSongAutocomplete.svelte';
	import { simFileService } from '../services/simFileService';
	import { desktopHost } from '../services/desktopHost';

	interface Props {
		song: TreeNode;
	}

	type ListedFile = {
		fileName: string;
		key: string;
		lastModified: number;
	};

	type ListFilesResponse = {
		files: ListedFile[];
		error?: string;
	};

	type CloudSong = {
		id: string;
		title: string;
		artist: string;
		bpm?: number;
		is_published: boolean;
	};

	type FetchCloudSongResult = {
		success: boolean;
		cloudSongData?: SimfileWithDtx;
		error?: string;
	};

	type CreateSimfileResult = {
		success: boolean;
		simfileId?: string;
		data?: SimfileWithDtx;
		error?: string;
		warnings?: string[];
	};

	type UpdateSimfileResult = {
		success: boolean;
		data?: Partial<SimfileWithDtx>;
		error?: string;
	};

	type ExportSongResult = {
		success: boolean;
		zipPath?: string;
		filesCount?: number;
		error?: string;
	};

	type AssetFile = {
		fileName: string;
		size: number;
		lastModified: string;
		key: string;
	};

	type LoadAssetFilesResult =
		| {
				success: boolean;
				data?: AssetFile[];
				error?: string;
		  }
		| AssetFile[];

	let { song }: Props = $props();

	// State for local files
	let localFiles = $state<File[]>([]);
	let isLoadingFiles = $state(false);
	let fileLoadError = $state<string | null>(null);

	const handleClose = () => {
		workspaceStore.closeSongDetails();
	};

	const handleOpenEditor = () => {
		// Navigate to editor page for this song
		let simFileId: string;

		if (song.linkedSimFileId) {
			// Use the linked simFileId if available
			simFileId = song.linkedSimFileId;
		} else {
			// For unlinked songs, use the folder name as simFileId
			simFileId = song.name || 'new-song';
		}

		// Store the mapping of simFileId to song folder path and song name
		if (song.path) {
			const songName = song.songTitle || song.name || 'Unknown Song';
			editorMappingStore.setMappingWithMetadata(simFileId, song.path, songName);
		}

		const editorPath = `editor/${simFileId}`;

		// Close the song details first
		workspaceStore.closeSongDetails();

		// Use the router to navigate to the editor
		window.location.hash = `#${editorPath}`;

		// Manually trigger hashchange event to ensure route handler picks it up
		window.dispatchEvent(new HashChangeEvent('hashchange'));
	};

	import { toBlobPart, type FileContent } from '../utils/fileUtils';

	// Helper function to create File object with custom properties

	const createFileObject = (content: FileContent, fileInfo: ListedFile) => {
		const file = new File([toBlobPart(content)], fileInfo.fileName, {
			lastModified: new Date(fileInfo.lastModified).getTime()
		});
		// Add the file path as a custom property for desktop uploads
		(file as unknown as { filePath: string }).filePath = fileInfo.key;
		return file;
	};

	// Load local files from the song folder
	const loadLocalFiles = async () => {
		if (!song.path) return;

		isLoadingFiles = true;
		fileLoadError = null;

		try {
			const result = await desktopHost.listFiles<ListFilesResponse>(song.path, song.path);

			if (result.error) {
				throw new Error(result.error);
			}

			// Convert file info to File objects for compatibility with UploadedAssetFiles
			// Only include files with valid DTX-related extensions
			const files = await Promise.all(
				result.files
					.filter((fileInfo: ListedFile) => isValidDtxFile(fileInfo.fileName))
					.map(async (fileInfo: ListedFile) => {
						try {
							// Read file content as buffer
							const response = await desktopHost.readFile(
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
	let uploadWarnings = $state<string[]>([]);
	let displayIdAutoPopulateError = $state<string | null>(null);
	let autoPopulatedDisplayId = $state<{ path: string; value: number } | null>(null);
	const autoPopulatedForPaths = new Map<string, number>();
	const autoPopulateInFlightPaths = new Set<string>();

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

	const isSimfileWithDtx = (data: unknown): data is SimfileWithDtx => {
		if (!data || typeof data !== 'object') return false;
		const candidate = data as Partial<SimfileWithDtx>;
		return (
			typeof candidate.id === 'number' &&
			typeof candidate.title === 'string' &&
			typeof candidate.artist === 'string' &&
			typeof candidate.bpm === 'number'
		);
	};

	const normalizeSimfile = (data: SimfileWithDtx): SimfileWithDtx => ({
		...data,
		dtx_files: data.dtx_files?.map((file, index) => ({
			...file,
			level: file?.level !== undefined ? Number(file.level) : undefined,
			id: (file as { id?: number })?.id ?? index + 1,
			simfile_id: (file as { simfile_id?: number })?.simfile_id
		}))
	});

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
	const loadAssetFilesForDesktop = async (simfileId: string): Promise<AssetFile[]> => {
		// For unlinked songs (no simfileId), return empty array - we only show local files
		if (!simfileId || simfileId === '' || simfileId === '0') {
			return [];
		}

		// For linked songs, fetch actual cloud files via IPC
		try {
			const result = await desktopHost.loadAssetFiles<LoadAssetFilesResult>(simfileId);
			if (result && typeof result === 'object' && 'success' in result) {
				if (!result.success) {
					console.error('Error loading cloud asset files:', result.error);
					return [];
				}
				return result.data ?? [];
			}
			// Fallback for unexpected shapes
			return Array.isArray(result) ? result : [];
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
		uploadWarnings = [];

		try {
			const submittedDisplayId = Number(displayId);
			const displayIdForCreate =
				submittedDisplayId === 0 ||
				(autoPopulatedDisplayId?.path === song.path &&
					autoPopulatedDisplayId.value === submittedDisplayId)
					? null
					: submittedDisplayId;
			// Create plain object without any Svelte reactivity
			const simfileData = JSON.parse(
				JSON.stringify({
					title: String(song.songTitle || song.name || ''),
					artist: String(parsedLocalData.artist || ''),
					bpm: Number(parsedLocalData.bpm || 0),
					displayId: displayIdForCreate,
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
					// Pass the song path so the Rust backend can find and read preview files
					songPath: String(song.path || ''),
					// Pass the workspace root so the Rust backend can confine preview
					// reads to the workspace (prevents path-traversal exfiltration)
					workspaceRoot: String($workspaceStore?.path ?? '')
				})
			);

			// Create the cloud simfile record through the desktop host.
			const result = await desktopHost.createSimfileRecord<CreateSimfileResult>(simfileData);

			if (result.success && result.data && isSimfileWithDtx(result.data)) {
				uploadSuccess = true;
				const linkedSimfile = normalizeSimfile(result.data);
				// Update the song with the new linked data
				song.linkedSimFileId = result.simfileId || String(result.data.id);
				song.linkedSimFile = linkedSimfile;

				// Update the workspace store
				workspaceStore.linkSimFileToFolder(song.path, linkedSimfile);

				// Surface any preview upload warnings (e.g. image/audio failed to upload)
				if (result.warnings && result.warnings.length > 0) {
					console.warn('Preview upload warnings:', result.warnings);
					uploadWarnings = result.warnings;
				}

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

	const populateNextDisplayId = async (currentPath: string) => {
		if (autoPopulateInFlightPaths.has(currentPath)) {
			return;
		}

		// Restore cached value on revisit without re-fetching
		const cachedId = autoPopulatedForPaths.get(currentPath);
		if (cachedId !== undefined) {
			if (displayId === 0) {
				displayId = cachedId;
				autoPopulatedDisplayId = { path: currentPath, value: cachedId };
			}
			return;
		}

		// Mark path synchronously before async call to prevent duplicate IPC invocations
		autoPopulateInFlightPaths.add(currentPath);

		try {
			const next = await simFileService.getNextDisplayId();
			if (!Number.isSafeInteger(next)) {
				throw new Error('Invalid next display_id response');
			}
			// Record that we fetched for this path even if user navigated away,
			// to prevent duplicate calls if they navigate back
			autoPopulatedForPaths.set(currentPath, next);
			// Guard against stale responses: skip mutation if user switched songs
			if (song.path !== currentPath) return;
			if (displayId === 0) {
				displayId = next;
				autoPopulatedDisplayId = { path: currentPath, value: next };
			}
			displayIdAutoPopulateError = null;
		} catch (error) {
			console.warn('Failed to fetch next display_id:', error);
			// Guard against stale rejections: skip error mutation if user switched songs
			if (song.path !== currentPath) return;
			displayIdAutoPopulateError =
				'Could not fetch the next display ID. You can enter it manually or retry.';
		} finally {
			autoPopulateInFlightPaths.delete(currentPath);
		}
	};

	const handleRetryDisplayIdAutoPopulate = () => {
		if (!song.path || song.linkedSimFile || !$authStore.isAuthenticated) return;
		displayIdAutoPopulateError = null;
		void populateNextDisplayId(song.path);
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
	const handleCloudSongSelect = (selectedSong: CloudSong) => {
		void (async () => {
			showAutocomplete = false;

			if (!selectedSong || !song.path) return;

			isLinking = true;
			linkingError = null;
			linkingSuccess = false;

			try {
				const result = await desktopHost.fetchCloudSong<FetchCloudSongResult>({
					cloudSongId: selectedSong.id
				});

				if (
					result.success &&
					result.cloudSongData &&
					isSimfileWithDtx(result.cloudSongData)
				) {
					const linkedSimfile = normalizeSimfile(result.cloudSongData);
					linkingSuccess = true;
					song.linkedSimFileId = String(selectedSong.id);
					song.linkedSimFile = linkedSimfile;

					// Update the workspace store (this will automatically cache to localStorage)
					workspaceStore.linkSimFileToFolder(song.path, linkedSimfile);

					// Hide success message after 3 seconds
					setTimeout(() => {
						linkingSuccess = false;
					}, 3000);
				} else {
					throw new Error(result.error || 'Failed to link song to cloud');
				}
			} catch (error) {
				console.error('Error linking song to cloud:', error);
				linkingError =
					error instanceof Error ? error.message : 'Failed to link song to cloud';

				// Clear error message after 10 seconds
				setTimeout(() => {
					linkingError = null;
				}, 10000);
			} finally {
				isLinking = false;
			}
		})();
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
			const updateData: Record<string, unknown> = {
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

			// Update the linked simfile record through the desktop host.
			const result = await desktopHost.updateSimfileRecord<UpdateSimfileResult>({
				simfileId: song.linkedSimFileId,
				updateData
			});

			if (result.success && song.linkedSimFile) {
				updateSuccess = true;
				// Update the local song data with the new information
				const updatedSimfile = normalizeSimfile({
					...song.linkedSimFile,
					...(result.data || {})
				} as SimfileWithDtx);
				song.linkedSimFile = updatedSimfile;

				// Update the workspace store
				workspaceStore.linkSimFileToFolder(song.path, updatedSimfile);

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
			const result = await desktopHost.exportSongToZip<ExportSongResult>({
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
					const result = await desktopHost.parseDtxFiles<{
						bpm?: number;
						artist?: string;
						levels?: { label: string; level: number }[];
					} | null>(song.path);

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
		const linkedSimfile = song.linkedSimFile ? normalizeSimfile(song.linkedSimFile) : null;
		const fallbackDtxFiles: Partial<DtxFileRow>[] = parsedLocalData.levels
			? parsedLocalData.levels.map((l, index) => ({
					id: index + 1,
					label: l.label || 'Unknown',
					level: Number(l.level || 0),
					simfile_id: 0
				}))
			: [];
		const dtxFiles: Partial<DtxFileRow>[] =
			linkedSimfile?.dtx_files?.map((file, index) => ({
				...file,
				level: file?.level !== undefined ? Number(file.level) : undefined,
				id: (file as { id?: number })?.id ?? index + 1,
				simfile_id: (file as { simfile_id?: number })?.simfile_id
			})) || fallbackDtxFiles;

		return {
			title: linkedSimfile?.title || song.songTitle || song.name,
			artist: linkedSimfile?.artist || parsedLocalData.artist,
			bpm: linkedSimfile?.bpm ?? parsedLocalData.bpm,
			publish_date: linkedSimfile?.publish_date || publishDate,
			display_id: linkedSimfile?.display_id ?? displayId,
			is_published: linkedSimfile?.is_published ?? false,
			download_url: linkedSimfile?.download_url || downloadUrl,
			video_preview_url: linkedSimfile?.video_preview_url || videoPreviewUrl,
			dtx_files: dtxFiles
		} satisfies Partial<SimfileWithDtx>;
	});

	// Reset auto-populate state when switching songs to prevent stale IDs
	$effect(() => {
		const currentPath = song.path;
		// Access song.path to track changes, then reset auto-populate state
		if (currentPath) {
			displayId = 0;
			autoPopulatedDisplayId = null;
			displayIdAutoPopulateError = null;
		}
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

	$effect(() => {
		const currentPath = song.path;
		if (!currentPath || song.linkedSimFile || !$authStore.isAuthenticated) return;
		void populateNextDisplayId(currentPath);
	});
</script>

{#if song.linkedSimFile}
	<!-- For linked songs, use the built-in Update button -->
	<div class="flex h-full flex-col">
		<ChartDetail
			simfile={simfileData()}
			showEditor={false}
			showPublishingControls={$authStore.isAuthenticated}
			showPublishedToggle={$authStore.isAuthenticated}
			saveButtonText={$authStore.isAuthenticated ? 'Update' : ''}
			bind:displayId
			bind:publishDate
			bind:downloadUrl
			bind:videoPreviewUrl
			bind:isPublished
			on:onSave={$authStore.isAuthenticated ? handleUpdateSimfile : () => {}}
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
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-blue-600 hover:to-blue-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
							onclick={handleOpenEditor}
							tabindex="0"
							aria-label="Open Editor"
						>
							<Music size={16} />
							Open Editor
						</button>
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
				{#if isUpdating && $authStore.isAuthenticated}
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

				{#if updateError && $authStore.isAuthenticated}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Update failed: {updateError}
							</span>
						</div>
					</div>
				{/if}

				{#if updateSuccess && $authStore.isAuthenticated}
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
							simfileBucketUrl=""
							loadAssetFiles={loadAssetFilesForDesktop}
							uploadFile={desktopHost.uploadFile}
							isDesktop={true}
							songFolderPath={song.path || ''}
							disableUploads={!$authStore.isAuthenticated}
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
			showEditor={false}
			showPublishingControls={true}
			showPublishedToggle={false}
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
							class="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 font-medium text-white shadow-md transition duration-150 ease-in-out hover:from-blue-600 hover:to-blue-700 hover:shadow-lg focus:shadow-lg focus:outline-none active:shadow-lg"
							onclick={handleOpenEditor}
							tabindex="0"
							aria-label="Open Editor"
						>
							<Music size={16} />
							Open Editor
						</button>
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
				{#if song.containsDtxFiles && $authStore.isAuthenticated}
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

				{#if displayIdAutoPopulateError && $authStore.isAuthenticated}
					<div class="rounded-lg bg-yellow-50 p-3 dark:bg-yellow-900/20">
						<div class="flex items-center justify-between gap-2">
							<span class="text-sm text-yellow-800 dark:text-yellow-200">
								{displayIdAutoPopulateError}
							</span>
							<button
								class="rounded bg-yellow-200 px-3 py-1 text-sm font-medium text-yellow-900 hover:bg-yellow-300 focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:outline-none dark:bg-yellow-800 dark:text-yellow-100 dark:hover:bg-yellow-700"
								onclick={handleRetryDisplayIdAutoPopulate}
							>
								Retry
							</button>
						</div>
					</div>
				{/if}

				<!-- Linking Status Messages -->
				{#if isLinking && $authStore.isAuthenticated}
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

				{#if linkingError && $authStore.isAuthenticated}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Linking failed: {linkingError}
							</span>
						</div>
					</div>
				{/if}

				{#if linkingSuccess && $authStore.isAuthenticated}
					<div class="rounded-lg bg-green-50 p-3 dark:bg-green-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-green-800 dark:text-green-200">
								Song linked successfully! It is now linked to the cloud.
							</span>
						</div>
					</div>
				{/if}

				<!-- Upload Status Messages -->
				{#if isUploading && $authStore.isAuthenticated}
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

				{#if uploadError && $authStore.isAuthenticated}
					<div class="rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
						<div class="flex items-center gap-2">
							<span class="text-sm text-red-800 dark:text-red-200">
								Upload failed: {uploadError}
							</span>
						</div>
					</div>
				{/if}

				{#if uploadWarnings.length > 0 && $authStore.isAuthenticated}
					<div class="rounded-lg bg-yellow-50 p-3 dark:bg-yellow-900/20">
						<div class="flex flex-col gap-1">
							<span class="text-sm font-medium text-yellow-800 dark:text-yellow-200">
								Song uploaded, but some preview files could not be uploaded:
							</span>
							{#each uploadWarnings as warning}
								<span class="text-xs text-yellow-700 dark:text-yellow-300"
									>{warning}</span
								>
							{/each}
						</div>
					</div>
				{/if}

				{#if uploadSuccess && $authStore.isAuthenticated}
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
							simfileBucketUrl=""
							loadAssetFiles={loadAssetFilesForDesktop}
							uploadFile={desktopHost.uploadFile}
							isDesktop={true}
							songFolderPath={song.path || ''}
							disableUploads={!$authStore.isAuthenticated}
						/>
					{/if}
				</div>
			{/snippet}

			{#snippet save()}
				{#if song.containsDtxFiles && $authStore.isAuthenticated}
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
{#if $authStore.isAuthenticated}
	<CloudSongAutocomplete
		isOpen={showAutocomplete}
		position={autocompletePosition}
		excludeLinkedSongIds={getLinkedSongIds()}
		onclose={() => (showAutocomplete = false)}
		onselect={handleCloudSongSelect}
	/>
{/if}
