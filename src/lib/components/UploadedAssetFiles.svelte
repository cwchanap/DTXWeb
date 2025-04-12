<script lang="ts">
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import dayjs from 'dayjs';
	import { DownloadCloud } from '@lucide/svelte';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';

	let {
		simfileId = '',
		supabase = null,
		userFiles = []
	} = $props<{
		simfileId?: string;
		supabase?: any;
		userFiles?: Array<File>;
	}>();

	// Ensure userFiles is always an array of File objects
	const safeUserFiles = $derived<File[]>(Array.isArray(userFiles) ? userFiles : []);

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
		if (simfileId && supabase) {
			loadAssetFiles();
		}
	});

	async function loadAssetFiles() {
		if (!simfileId || !supabase) return;

		isLoadingFiles = true;
		fileLoadError = null;

		try {
			const response = await fetch(`/api/simFile/listFiles/${simfileId}`);

			if (!response.ok) {
				throw new Error(`Error fetching files: ${response.statusText}`);
			}

			const data = await response.json();
			assetFiles = data.files;
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
		return `${PUBLIC_SIMFILE_BUCKET_URL}/${key}`;
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

	// Upload selected files
	async function uploadSelectedFiles() {
		if (selectedFiles.size === 0 || !simfileId) return;

		isUploading = true;

		// Initialize progress for selected files
		selectedFiles.forEach((fileName) => {
			uploadProgress[fileName] = 'pending';
		});

		// Process each selected file one by one
		for (const fileName of selectedFiles) {
			const fileToUpload = mergedFiles.find((f) => f.name === fileName)?.userFile;
			if (!fileToUpload) continue;

			try {
				// Update status to uploading
				uploadProgress[fileName] = 'uploading';

				// Create a new file without the first level directory name
				let fileNameWithoutDir = fileName;
				// Check if the file name has a directory structure
				if (fileName.includes('/')) {
					// Remove the first directory level
					fileNameWithoutDir = fileName.split('/').slice(1).join('/');
				}

				// Create a new File object with the modified name
				const modifiedFile = new File([fileToUpload], fileNameWithoutDir, {
					type: fileToUpload.type
				});

				// Create form data for the API
				const formData = new FormData();
				formData.append('file', modifiedFile);
				formData.append('simFileId', simfileId);

				// Send the request
				const response = await fetch('/api/simFile/upload', {
					method: 'POST',
					body: formData
				});

				if (!response.ok) {
					throw new Error(`Upload failed: ${response.statusText}`);
				}

				// Update status to success
				uploadProgress[fileName] = 'success';
			} catch (error) {
				console.error(`Error uploading ${fileName}:`, error);
				uploadProgress[fileName] = 'error';
			}
		}

		// Refresh the file list after uploads
		await loadAssetFiles();

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

		// Create a map of cloud files by filename
		const cloudFileMap = new Map<string, (typeof assetFiles)[0]>();
		assetFiles.forEach((file) => {
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

		// Add all cloud files first
		assetFiles.forEach((cloudFile) => {
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
</script>

<div class="mt-8">
	<Accordion
		{value}
		rounded="rounded-lg"
		padding="p-0"
		spaceY="space-y-0"
		base="overflow-hidden border-2 border-gray-300"
		collapsible
		onValueChange={(e) => (value = e.value)}
	>
		<Accordion.Item value="asset-files" panelPadding="p-0">
			{#snippet lead()}
				<i class="fa-solid fa-file-lines"></i>
			{/snippet}
			{#snippet control()}
				<h3 class="my-4 text-lg font-semibold">Asset Files Section</h3>
			{/snippet}
			{#snippet panel()}
				{#if isLoadingFiles && simfileId}
					<div class="flex justify-center p-4">
						<p>Loading files...</p>
					</div>
				{:else if fileLoadError}
					<div class="p-4 text-red-500">
						<p>{fileLoadError}</p>
						<button
							class="mt-2 rounded-sm bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
							onclick={loadAssetFiles}
						>
							Retry
						</button>
					</div>
				{:else if mergedFiles.length === 0}
					<div class="p-4">
						<p>No asset files found for this simfile.</p>
					</div>
				{:else}
					<div class="relative">
						<table class="w-full table-auto border-collapse">
							<thead>
								<tr class="border-b border-gray-300 bg-gray-50">
									<th class="w-10 px-4 py-2 text-center">
										<input
											type="checkbox"
											checked={allFilesSelected}
											onchange={toggleSelectAll}
											class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
											disabled={isUploading}
										/>
									</th>
									<th class="px-4 py-2 text-left">File Name</th>
									<th class="px-4 py-2 text-left">Size</th>
									<th class="px-4 py-2 text-left">Last Modified</th>
									<th class="px-4 py-2 text-left">Status</th>
									<th class="px-4 py-2 text-center">Actions</th>
								</tr>
							</thead>
							<tbody>
								{#each mergedFiles as file}
									<tr
										class="border-b border-gray-300 hover:bg-gray-50"
										class:bg-green-50={file.status === 'new'}
										class:bg-yellow-50={file.status === 'replacing'}
									>
										<td class="px-4 py-2 text-center">
											{#if file.userFile}
												<input
													type="checkbox"
													checked={selectedFiles.has(file.name)}
													onclick={() => toggleFileSelection(file.name)}
													class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
													disabled={isUploading}
												/>
											{/if}
										</td>
										<td class="px-4 py-2">{file.name}</td>
										<td class="px-4 py-2">{formatFileSize(file.size)}</td>
										<td class="px-4 py-2">{formatDate(file.lastModified)}</td>
										<td class="px-4 py-2">
											{#if uploadProgress[file.name] === 'pending'}
												<span
													class="rounded-sm bg-gray-100 px-2 py-1 text-xs font-medium text-gray-800"
													>Pending</span
												>
											{:else if uploadProgress[file.name] === 'uploading'}
												<span
													class="rounded-sm bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800"
													>Uploading...</span
												>
											{:else if uploadProgress[file.name] === 'success'}
												<span
													class="rounded-sm bg-green-100 px-2 py-1 text-xs font-medium text-green-800"
													>Uploaded</span
												>
											{:else if uploadProgress[file.name] === 'error'}
												<span
													class="rounded-sm bg-red-100 px-2 py-1 text-xs font-medium text-red-800"
													>Failed</span
												>
											{:else if file.status === 'new'}
												<span
													class="rounded-sm bg-green-100 px-2 py-1 text-xs font-medium text-green-800"
													>New</span
												>
											{:else if file.status === 'replacing'}
												<span
													class="rounded-sm bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800"
													>Replacing</span
												>
											{:else}
												<span class="text-gray-500">-</span>
											{/if}
										</td>
										<td class="px-4 py-2 text-center">
											{#if file.source === 'cloud' && file.key}
												<a
													href={getDownloadUrl(file.key)}
													target="_blank"
													download={file.name}
													class="inline-flex items-center rounded-full bg-blue-100 p-2 text-blue-700 hover:bg-blue-200"
													title="Download file"
												>
													<DownloadCloud />
												</a>
											{:else}
												<span class="text-gray-400">-</span>
											{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>

						<!-- Bulk upload button -->
						{#if selectedFiles.size > 0}
							<div class="absolute right-4 bottom-4">
								<button
									class="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
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
