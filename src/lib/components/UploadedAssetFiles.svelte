<script lang="ts">
	import { Accordion, AccordionItem } from '@skeletonlabs/skeleton';
	import { DownloadSolid } from 'flowbite-svelte-icons';
	import dayjs from 'dayjs';
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

		// Create merged file objects
		const merged: MergedFile[] = [];

		// Add all cloud files first
		assetFiles.forEach((cloudFile) => {
			const userFile = safeUserFiles.find((f) => f.name === cloudFile.fileName);
			merged.push({
				name: cloudFile.fileName,
				size: cloudFile.size,
				lastModified: cloudFile.lastModified,
				key: cloudFile.key,
				source: 'cloud',
				status: userFile ? 'replacing' : 'existing',
				userFile
			});
		});

		// Add user files that don't exist in the cloud
		if (safeUserFiles.length > 0) {
			safeUserFiles.forEach((userFile) => {
				if (!cloudFileMap.has(userFile.name)) {
					merged.push({
						name: userFile.name,
						size: userFile.size,
						lastModified: new Date(userFile.lastModified).toISOString(),
						key: '',
						source: 'local' as const,
						status: 'new' as const,
						userFile
					});
				}
			});
		}

		return merged;
	}
</script>

<div class="mt-8">
	<Accordion
		class="overflow-hidden rounded-lg border-2 border-gray-300"
		autocollapse={false}
		padding="p-0"
	>
		<AccordionItem class="bg-white">
			<svelte:fragment slot="lead">
				<i class="fa-solid fa-file-lines"></i>
			</svelte:fragment>
			<svelte:fragment slot="summary"
				><h3 class="my-4 text-lg font-semibold">Asset Files Section</h3></svelte:fragment
			>
			<svelte:fragment slot="content">
				{#if isLoadingFiles && simfileId}
					<div class="flex justify-center p-4">
						<p>Loading files...</p>
					</div>
				{:else if fileLoadError}
					<div class="p-4 text-red-500">
						<p>{fileLoadError}</p>
						<button
							class="mt-2 rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
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
					<table class="w-full table-auto border-collapse">
						<thead>
							<tr class="border-b border-gray-300 bg-gray-50">
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
									<td class="px-4 py-2">{file.name}</td>
									<td class="px-4 py-2">{formatFileSize(file.size)}</td>
									<td class="px-4 py-2">{formatDate(file.lastModified)}</td>
									<td class="px-4 py-2">
										{#if file.status === 'new'}
											<span
												class="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800"
												>New</span
											>
										{:else if file.status === 'replacing'}
											<span
												class="rounded bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800"
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
												<DownloadSolid size="sm" />
											</a>
										{:else}
											<span class="text-gray-400">-</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</svelte:fragment>
		</AccordionItem>
	</Accordion>
</div>
