<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import dayjs from 'dayjs';
	import { DownloadCloud } from '@lucide/svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { isValidDtxFile } from '../index.js';

	let {
		simfileId = '',
		userFiles = [],
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		supabaseClient: _supabaseClient,
		simfileBucketUrl,
		loadAssetFiles,
		isDesktop = false,
		songFolderPath = ''
	} = $props<{
		simfileId?: string;
		userFiles?: Array<File>;
		supabaseClient: SupabaseClient;
		simfileBucketUrl: string;
		loadAssetFiles: (
			simfileId: string
		) => Promise<{ fileName: string; size: number; lastModified: string; key: string }[]>;
		isDesktop?: boolean;
		songFolderPath?: string; // Song folder path for desktop uploads
	}>();

	// Ensure userFiles is always an array of File objects with valid extensions
	const safeUserFiles = $derived<File[]>(
		Array.isArray(userFiles)
			? userFiles
					.filter((f: File) => isValidDtxFile(f.name))
					.map((f: File) => new File([f], f.name.toLowerCase(), f))
			: []
	);

	let assetFiles = $state<
		{ fileName: string; size: number; lastModified: string; key: string }[]
	>([]);
	let isLoadingFiles = $state(false);
	let fileLoadError = $state<string | null>(null);
	let mergedFiles = $derived(getMergedFiles());
	let value: string[] = $state([]);

	// For bulk upload feature
	let selectedFiles = $state<Set<string>>(new Set());
	let isUploading = $state(false);
	let uploadProgress = $state<Record<string, 'pending' | 'uploading' | 'success' | 'error'>>({});

	// Track previous user files count to detect new uploads
	let previousUserFilesCount = $state(0);

	// Computed property to check if all uploadable files are selected
	let allFilesSelected = $derived(calculateAllFilesSelected());

	// Function to calculate if all files are selected
	function calculateAllFilesSelected() {
		// Get count of files that have userFile property (can be uploaded)
		const uploadableFilesCount = mergedFiles.filter((file) => file.userFile).length;

		// Check if all uploadable files are selected
		return uploadableFilesCount > 0 && selectedFiles.size === uploadableFilesCount;
	}

	// Auto-select newly added user files only when the count changes
	$effect(() => {
		// Only run this when the number of files increases (new files added)
		if (safeUserFiles.length > previousUserFilesCount) {
			// Create a new Set to trigger reactivity
			selectedFiles = new Set(selectedFiles);

			// Only select files that weren't previously selected
			for (let i = previousUserFilesCount; i < safeUserFiles.length; i++) {
				selectedFiles.add(safeUserFiles[i].name);
			}
		}

		// Update the previous count
		previousUserFilesCount = safeUserFiles.length;
	});

	$effect(() => {
		if (simfileId) {
			loadAssetFilesInternal();
		}
	});

	async function loadAssetFilesInternal() {
		if (!simfileId) return;

		isLoadingFiles = true;
		fileLoadError = null;

		try {
			assetFiles = await loadAssetFiles(simfileId);
		} catch (err) {
			console.error('Error loading asset files:', err);
			fileLoadError = err instanceof Error ? err.message : 'Error loading files';
		} finally {
			isLoadingFiles = false;
		}
	}

	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';

		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));

		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	function formatDate(dateString: string): string {
		return dayjs(dateString).format('YYYY-MM-DD HH:mm');
	}

	function getDownloadUrl(key: string): string {
		return `${simfileBucketUrl}/${key}`;
	}

	// Toggle selection of a file
	function toggleFileSelection(fileName: string) {
		// Create a new Set to trigger reactivity
		selectedFiles = new Set(selectedFiles);

		if (selectedFiles.has(fileName)) {
			selectedFiles.delete(fileName);
		} else {
			selectedFiles.add(fileName);
		}
	}

	// Toggle selection of all files
	function toggleSelectAll(event: Event) {
		const checked = (event.target as HTMLInputElement).checked;

		// Create a new Set to trigger reactivity
		selectedFiles = new Set(selectedFiles);

		if (checked) {
			// Select all files that have a userFile property (new or replacing)
			for (const file of mergedFiles) {
				if (file.userFile) {
					selectedFiles.add(file.name);
				}
			}
		} else {
			// Deselect all files
			selectedFiles.clear();
		}
	}

	// Upload a single file without refresh (for bulk operations)
	async function uploadFileBulk(fileName: string): Promise<boolean> {
		if (!isDesktop) {
			console.error('Upload functionality is only available in desktop mode');
			return false;
		}

		try {
			// Update status to uploading
			uploadProgress[fileName] = 'uploading';

			// Validate required parameters
			if (!songFolderPath) {
				throw new Error('Song folder path is required for desktop uploads');
			}
			if (!simfileId) {
				throw new Error('Simfile ID is required for uploads');
			}

			// Use IPC to upload the file - main process will construct full path
			const result = await invokeIpc('upload-file', fileName, songFolderPath, simfileId);

			if (!result || !result.success) {
				throw new Error(result?.error || 'Upload failed');
			}

			// Update status to success (no refresh in bulk mode)
			uploadProgress[fileName] = 'success';
			return true;
		} catch (error) {
			console.error(`Error uploading ${fileName}:`, error);
			uploadProgress[fileName] = 'error';
			return false;
		}
	}

	// Upload selected files (desktop only)
	export async function uploadSelectedFiles() {
		if (!isDesktop) {
			console.error('Bulk upload functionality is only available in desktop mode');
			return;
		}

		if (selectedFiles.size === 0 || !simfileId) return;

		isUploading = true;

		// Initialize progress for selected files
		selectedFiles.forEach((fileName) => {
			uploadProgress[fileName] = 'pending';
		});

		const uploadPromises = [...selectedFiles].map(async (fileName) => {
			const fileToUpload = mergedFiles.find((f) => f.name === fileName)?.userFile;
			if (!fileToUpload) return;

			// Upload without triggering individual refresh (bulk mode)
			return await uploadFileBulk(fileName);
		});

		// Wait for all uploads to complete
		await Promise.all(uploadPromises);

		// Refresh the file list after uploads
		await loadAssetFilesInternal();

		// Reset upload state
		isUploading = false;
		selectedFiles.clear();
		uploadProgress = {};
	}

	function getMergedFiles() {
		// Define the file type
		type MergedFile = {
			name: string;
			size: number;
			lastModified: string;
			key: string;
			source: 'cloud' | 'local';
			status: 'new' | 'replacing' | 'existing';
			userFile?: File;
		};

		// Filter valid cloud files once and reuse
		const validCloudFiles = assetFiles.filter((file) => isValidDtxFile(file.fileName));

		// Create a map of cloud files by filename
		const cloudFileMap = new Map<string, (typeof assetFiles)[0]>();
		validCloudFiles.forEach((file) => {
			cloudFileMap.set(file.fileName, file);
		});

		// Create a map to track which user files we've already processed
		// This prevents duplicates when the same folder is uploaded multiple times
		const processedUserFiles = new Map<string, File>();

		// Process user files, keeping only the last one for each filename
		safeUserFiles.forEach((userFile) => {
			processedUserFiles.set(userFile.name, userFile);
		});

		// Create merged file objects
		const merged: MergedFile[] = [];

		// Add all valid cloud files first (using the already filtered array)
		validCloudFiles.forEach((cloudFile) => {
			const userFile = processedUserFiles.get(cloudFile.fileName);
			merged.push({
				name: cloudFile.fileName,
				size: cloudFile.size,
				lastModified: cloudFile.lastModified,
				key: cloudFile.key,
				source: 'cloud',
				status: userFile ? 'replacing' : 'existing',
				userFile
			});

			// Remove from the map so we don't process it again
			if (userFile) {
				processedUserFiles.delete(cloudFile.fileName);
			}
		});

		// Add remaining user files that don't exist in the cloud
		if (processedUserFiles.size > 0) {
			processedUserFiles.forEach((userFile, fileName) => {
				merged.push({
					name: fileName,
					size: userFile.size,
					lastModified: new Date(userFile.lastModified).toISOString(),
					key: '',
					source: 'local' as const,
					status: 'new' as const,
					userFile
				});
			});
		}

		return merged;
	}

	// Helper function to safely invoke IPC channels
	function invokeIpc(
		channel: string,
		...args: unknown[]
	): Promise<{ success: boolean; error?: string }> {
		const ipcRenderer = (
			window as { electron?: { ipcRenderer?: { invoke: typeof invokeIpc } } }
		).electron?.ipcRenderer;
		if (!ipcRenderer) {
			throw new Error('IPC Renderer is not available');
		}
		return ipcRenderer.invoke(channel, ...args);
	}
</script>

<div class="mt-8">
	<Accordion
		{value}
		rounded="rounded-lg"
		padding="p-0"
		spaceY="space-y-0"
		base="overflow-hidden border-2 border-gray-300 dark:border-slate-600"
		collapsible
		onValueChange={(e) => (value = e.value)}
	>
		<Accordion.Item value="asset-files" panelPadding="p-0">
			{#snippet lead()}
				<i class="fa-solid fa-file-lines"></i>
			{/snippet}
			{#snippet control()}
				<h3 class="my-2 text-lg font-semibold text-slate-800 dark:text-slate-200">
					Asset Files Section
				</h3>
			{/snippet}
			{#snippet panel()}
				{#if isLoadingFiles && simfileId}
					<div class="flex justify-center p-4">
						<p class="text-slate-600 dark:text-slate-400">Loading files...</p>
					</div>
				{:else if fileLoadError}
					<div class="p-4 text-red-500 dark:text-red-400">
						<p>{fileLoadError}</p>
						<button
							class="mt-2 rounded-sm bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
							onclick={loadAssetFilesInternal}
						>
							Retry
						</button>
					</div>
				{:else if mergedFiles.length === 0}
					<div class="p-4">
						<p class="text-slate-600 dark:text-slate-400">
							No asset files found for this simfile.
						</p>
					</div>
				{:else}
					<div class="relative">
						<table class="w-full table-auto border-collapse">
							<thead>
								<tr
									class="border-b border-gray-300 bg-gray-50 dark:border-slate-600 dark:bg-slate-700"
								>
									{#if simfileId && isDesktop}
										<th class="w-10 px-4 py-2 text-center">
											<input
												type="checkbox"
												checked={allFilesSelected}
												onchange={toggleSelectAll}
												class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-500 dark:bg-slate-600"
												disabled={isUploading}
											/>
										</th>
									{/if}
									<th
										class="px-4 py-2 text-left text-slate-700 dark:text-slate-300"
										>File Name</th
									>
									<th
										class="px-4 py-2 text-left text-slate-700 dark:text-slate-300"
										>Size</th
									>
									<th
										class="px-4 py-2 text-left text-slate-700 dark:text-slate-300"
										>Last Modified</th
									>
									{#if simfileId && isDesktop}
										<th
											class="px-4 py-2 text-left text-slate-700 dark:text-slate-300"
											>Status</th
										>
									{/if}
									<th
										class="px-4 py-2 text-center text-slate-700 dark:text-slate-300"
										>Actions</th
									>
								</tr>
							</thead>
							<tbody>
								{#each mergedFiles as file}
									<tr
										class="border-b border-gray-300 hover:bg-gray-50 dark:border-slate-600 dark:hover:bg-slate-700 {simfileId &&
										file.status === 'new'
											? 'bg-green-50 dark:bg-green-900/20'
											: ''} {simfileId && file.status === 'replacing'
											? 'bg-yellow-50 dark:bg-yellow-900/20'
											: ''}"
									>
										{#if simfileId && isDesktop}
											<td class="px-4 py-2 text-center">
												{#if file.userFile}
													<input
														type="checkbox"
														checked={selectedFiles.has(file.name)}
														onclick={() =>
															toggleFileSelection(file.name)}
														class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-500 dark:bg-slate-600"
														disabled={isUploading}
													/>
												{/if}
											</td>
										{/if}
										<td class="px-4 py-2 text-slate-800 dark:text-slate-200"
											>{file.name}</td
										>
										<td class="px-4 py-2 text-slate-600 dark:text-slate-400"
											>{formatFileSize(file.size)}</td
										>
										<td class="px-4 py-2 text-slate-600 dark:text-slate-400"
											>{formatDate(file.lastModified)}</td
										>
										{#if simfileId && isDesktop}
											<td class="px-4 py-2">
												{#if uploadProgress[file.name] === 'pending'}
													<span
														class="rounded-sm bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800 dark:bg-slate-600 dark:text-slate-200"
														>Pending</span
													>
												{:else if uploadProgress[file.name] === 'uploading'}
													<span
														class="rounded-sm bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
														>Uploading...</span
													>
												{:else if uploadProgress[file.name] === 'success'}
													<span
														class="rounded-sm bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300"
														>Uploaded</span
													>
												{:else if uploadProgress[file.name] === 'error'}
													<span
														class="rounded-sm bg-red-100 px-2 py-1 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300"
														>Failed</span
													>
												{:else if file.status === 'new'}
													<span
														class="rounded-sm bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300"
														>New</span
													>
												{:else if file.status === 'replacing'}
													<span
														class="rounded-sm bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
														>Replacing</span
													>
												{:else}
													<span class="text-gray-500 dark:text-slate-400"
														>-</span
													>
												{/if}
											</td>
										{/if}
										<td class="px-4 py-2 text-center">
											{#if file.source === 'cloud' && file.key}
												<a
													href={getDownloadUrl(file.key)}
													target="_blank"
													download={file.name}
													class="inline-flex items-center rounded-full bg-blue-100 p-2 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-800/60"
													title="Download file"
												>
													<DownloadCloud />
												</a>
											{:else}
												<span class="text-gray-400 dark:text-slate-500"
													>-</span
												>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>

						<!-- Bulk upload button - only show if simfileId exists and in desktop mode -->
						{#if simfileId && isDesktop && selectedFiles.size > 0}
							<div class="absolute right-4 bottom-4">
								<button
									class="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50 dark:bg-blue-700 dark:hover:bg-blue-800 dark:focus:ring-blue-400"
									onclick={uploadSelectedFiles}
									disabled={isUploading}
								>
									{#if isUploading}
										<span class="animate-spin">↻</span>
										Uploading...
									{:else}
										<span>⬆️</span>
										Bulk Upload ({selectedFiles.size})
									{/if}
								</button>
							</div>
						{/if}
					</div>
				{/if}
			{/snippet}
		</Accordion.Item>
	</Accordion>
</div>
