<script lang="ts">
	import { Music, ArrowLeft, Link } from '@lucide/svelte';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { UploadedAssetFiles, ChartDetail } from '@dtx/common/components';
	import { onMount } from 'svelte';
	import { loadAssetFiles } from '../services/assetFileService';

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
			const files = await Promise.all(
				result.files.map(async (fileInfo: any) => {
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
							return new File([''], fileInfo.fileName, {
								lastModified: new Date(fileInfo.lastModified).getTime()
							});
						}

						// Create File object using the content property
						return new File([content], fileInfo.fileName, {
							lastModified: new Date(fileInfo.lastModified).getTime()
						});
					} catch (error) {
						console.warn(`Could not read file ${fileInfo.fileName}:`, error);
						// Create empty File object as fallback
						return new File([''], fileInfo.fileName, {
							lastModified: new Date(fileInfo.lastModified).getTime()
						});
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

	// Track which action is being performed
	let currentUploadAction: 'draft' | 'publish' | null = $state(null);

	// Handle upload for unlinked songs
	const handleUploadSong = async (event: CustomEvent) => {
		// Override isPublished based on the current action
		if (currentUploadAction) {
			event.detail.isPublished = currentUploadAction === 'publish';
		}

		const isPublished = event.detail.isPublished || false;
		await uploadSong(event, isPublished);

		// Reset action after upload
		currentUploadAction = null;
	};

	// Function to get current form values from the DOM
	const getCurrentFormValues = () => {
		// Query the form inputs directly from the DOM
		const displayIdInput = document.getElementById('display_id') as HTMLInputElement;
		const publishDateInput = document.getElementById('publish_date') as HTMLInputElement;
		const downloadLinkInput = document.getElementById('download_link') as HTMLInputElement;
		const videoPreviewLinkInput = document.getElementById(
			'video_preview_link'
		) as HTMLInputElement;

		return {
			displayId: displayIdInput ? parseInt(displayIdInput.value) || 0 : 0,
			publishDate: publishDateInput
				? publishDateInput.value
				: new Date().toISOString().split('T')[0],
			downloadUrl: downloadLinkInput ? downloadLinkInput.value : '',
			videoPreviewUrl: videoPreviewLinkInput ? videoPreviewLinkInput.value : ''
		};
	};

	// Function to trigger save with specific isPublished value
	const triggerSave = (isPublished: boolean) => {
		// Set the current action
		currentUploadAction = isPublished ? 'publish' : 'draft';

		// Get current form values from the DOM
		const formValues = getCurrentFormValues();

		// Create event with the current form values
		const event = new CustomEvent('onSave', {
			detail: {
				...formValues,
				isPublished: isPublished
			}
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
			const { displayId, publishDate, downloadUrl, videoPreviewUrl } = event.detail;

			// Create plain object without any Svelte reactivity
			const simfileData = JSON.parse(
				JSON.stringify({
					title: String(song.songTitle || song.name || ''),
					artist: String(parsedLocalData.artist || ''),
					bpm: Number(parsedLocalData.bpm || 0),
					displayId: Number(displayId || 0),
					isPublished: Boolean(
						event.detail.isPublished !== undefined
							? event.detail.isPublished
							: isPublished
					),
					publishDate: String(publishDate || ''),
					downloadUrl: String(downloadUrl || ''),
					videoPreviewUrl: String(videoPreviewUrl || ''),
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

	// Effect to parse local DTX files when needed
	$effect(() => {
		console.log('SongDetails effect triggered:', {
			songPath: song.path,
			hasLinkedSimfile: !!song.linkedSimFile,
			linkedSimfileBpm: song.linkedSimFile?.bpm,
			linkedSimfileArtist: song.linkedSimFile?.artist
		});

		// Only parse local files if we have a folder path and linked simfile data is missing key information
		const shouldParse =
			song.path &&
			(!song.linkedSimFile ||
				song.linkedSimFile.bpm === undefined ||
				song.linkedSimFile.bpm === null ||
				song.linkedSimFile.artist === undefined ||
				song.linkedSimFile.artist === null ||
				song.linkedSimFile.artist === '');

		console.log('Should parse local DTX files:', shouldParse);

		if (shouldParse) {
			console.log('Parsing local DTX files via IPC...');
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

						console.log('Parsed local data via IPC:', parsedLocalData);
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
	const simfileData = $derived({
		title: song.songTitle || song.name,
		artist: song.linkedSimFile?.artist || parsedLocalData.artist,
		bpm: song.linkedSimFile?.bpm || parsedLocalData.bpm,
		publish_date: song.linkedSimFile?.publish_date || new Date().toISOString().split('T')[0],
		display_id: song.linkedSimFile?.display_id || 0,
		is_published: song.linkedSimFile?.is_published || false,
		download_url: song.linkedSimFile?.download_url || '',
		video_preview_url: song.linkedSimFile?.video_preview_url || '',
		dtx_files:
			song.linkedSimFile?.dtx_files ||
			(parsedLocalData.levels
				? parsedLocalData.levels.map((l) => ({
						label: l.label,
						level: l.level
					}))
				: []),
		...song.linkedSimFile
	});
</script>

<div class="flex h-full flex-col">
	<ChartDetail
		simfile={simfileData}
		showEditor={false}
		showPublishingControls={true}
		showPublishedToggle={false}
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
		{/snippet}

		{#snippet desktop_info()}
			<!-- Status Section - This will be rendered outside the grid -->
			{#if song.linkedSimFile}
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
			{:else if song.containsDtxFiles}
				<div class="rounded-lg bg-yellow-50 p-3 dark:bg-yellow-900/20">
					<div class="flex items-center gap-2">
						<Music size={16} class="text-yellow-600 dark:text-yellow-400" />
						<span class="text-sm text-yellow-800 dark:text-yellow-200">
							Not linked - Local song not yet uploaded to cloud
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
		{/snippet}

		{#snippet folder_upload()}
			<!-- Folder Name -->
			<div class="col-span-1 flex items-center">
				<span class="mr-2 block text-slate-700 dark:text-slate-300">Folder:</span>
			</div>
			<div class="col-span-7">
				<span class="font-mono text-sm text-slate-900 dark:text-slate-100">{song.name}</span
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
						cloudflareWorkerUrl=""
						{loadAssetFiles}
					/>
				{/if}
			</div>
		{/snippet}

		{#snippet save()}
			{#if !song.linkedSimFile && song.containsDtxFiles}
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
