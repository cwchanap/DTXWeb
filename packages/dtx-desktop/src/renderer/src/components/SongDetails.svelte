<script lang="ts">
	import { Music, ArrowLeft, Link } from '@lucide/svelte';
	import { workspaceStore, type TreeNode } from '../stores/workspaceStore';
	import { UploadedAssetFiles } from '@dtx/common';
	import { onMount } from 'svelte';

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
</script>

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

<!-- Content Area -->
<div class="flex-1 overflow-auto p-6">
	<div class="space-y-3">
		<!-- Song Title from SET.def -->
		{#if song.songTitle}
			<div
				class="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50"
			>
				<span class="text-sm font-medium text-slate-600 dark:text-slate-400"
					>Song Title:</span
				>
				<span class="text-lg font-semibold text-slate-800 dark:text-slate-200"
					>{song.songTitle}</span
				>
			</div>
		{/if}

		<!-- Folder Name -->
		<div
			class="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50"
		>
			<span class="text-sm font-medium text-slate-600 dark:text-slate-400">Folder Name:</span>
			<span class="font-mono text-sm text-slate-800 dark:text-slate-200">{song.name}</span>
		</div>

		<!-- Song Path -->
		<div
			class="flex items-center justify-between rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50"
		>
			<span class="text-sm font-medium text-slate-600 dark:text-slate-400">Path:</span>
			<span class="ml-2 truncate font-mono text-sm text-slate-800 dark:text-slate-200"
				>{song.path}</span
			>
		</div>

		<!-- Linked SimFile Information -->
		{#if song.linkedSimFile}
			<div class="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
				<div class="mb-3 flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Link size={16} class="text-green-500 dark:text-green-400" />
						<span class="font-semibold text-green-800 dark:text-green-200">
							{song.linkedSimFile.title}
						</span>
					</div>
					<span
						class="rounded bg-green-200 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-800 dark:text-green-200"
					>
						Linked
					</span>
				</div>
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<span class="text-sm text-green-700 dark:text-green-300">Artist:</span>
						<span class="text-sm font-medium text-green-800 dark:text-green-200"
							>{song.linkedSimFile.artist}</span
						>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-sm text-green-700 dark:text-green-300">BPM:</span>
						<span class="text-sm font-medium text-green-800 dark:text-green-200"
							>{song.linkedSimFile.bpm}</span
						>
					</div>
					{#if song.linkedSimFile.publish_date}
						<div class="flex items-center justify-between">
							<span class="text-sm text-green-700 dark:text-green-300"
								>Published:</span
							>
							<span class="text-sm font-medium text-green-800 dark:text-green-200">
								{new Date(song.linkedSimFile.publish_date).toLocaleDateString()}
							</span>
						</div>
					{/if}
				</div>
			</div>
		{:else if song.containsDtxFiles}
			<div class="rounded-lg bg-yellow-50 p-3 dark:bg-yellow-900/20">
				<div class="flex items-center gap-2">
					<Music size={16} class="text-yellow-600 dark:text-yellow-400" />
					<span class="text-sm text-yellow-800 dark:text-yellow-200">
						No linked remote simFile found. This local song is not yet uploaded to the
						cloud.
					</span>
				</div>
			</div>
		{/if}

		<!-- Local Asset Files Section -->
		<div class="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
			<h3 class="mb-4 text-lg font-semibold text-slate-800 dark:text-slate-200">
				Local Asset Files
			</h3>

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
				/>
			{/if}
		</div>

		<!-- Additional song information -->
		<div
			class="rounded-lg border-2 border-dashed border-slate-200 p-4 text-center dark:border-slate-700"
		>
			<Music size={32} class="mx-auto mb-2 text-slate-400" />
			<p class="text-sm text-slate-400 dark:text-slate-500">
				Additional DTX file parsing and metadata coming soon...
			</p>
		</div>
	</div>
</div>
