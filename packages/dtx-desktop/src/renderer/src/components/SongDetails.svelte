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
						const content = await window.electron.ipcRenderer.invoke(
							'read-file',
							fileInfo.key
						);
						// Create File object
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
		publish_date: song.linkedSimFile?.publish_date,
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
	<ChartDetail simfile={simfileData} showEditor={false} showPublishingControls={false}>
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
		{/snippet}

		{#snippet folder_upload()}
			<!-- Folder Name -->
			<div class="col-span-1 flex items-center">
				<label class="mr-2 block text-slate-700 dark:text-slate-300">Folder:</label>
			</div>
			<div class="col-span-7">
				<span class="font-mono text-sm text-slate-900 dark:text-slate-100">{song.name}</span
				>
			</div>

			<!-- Song Path -->
			<div class="col-span-1 flex items-center">
				<label class="mr-2 block text-slate-700 dark:text-slate-300">Path:</label>
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
	</ChartDetail>
</div>
