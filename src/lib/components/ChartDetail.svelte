<script lang="ts">
	import { SlideToggle, Accordion, AccordionItem } from '@skeletonlabs/skeleton';
	import type { Tables } from '@/types/supabase.types';
	import { createEventDispatcher, onMount } from 'svelte';
	import dayjs from 'dayjs';
	import { DownloadSolid } from 'flowbite-svelte-icons';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';

	type simFileWithDtxFiles = Tables<'simfiles'> & {
		dtx_files: Partial<Tables<'dtx_files'>>[];
	};

	interface FileInfo {
		fileName: string;
		key: string;
		size: number;
		lastModified: string;
	}

	interface Props {
		simfile?: Partial<simFileWithDtxFiles> | null;
		preview?: import('svelte').Snippet;
		folder_upload?: import('svelte').Snippet;
		save?: import('svelte').Snippet;
	}

	let { simfile = null, preview, folder_upload, save }: Props = $props();
	let dtxFiles = $derived((simfile?.dtx_files || []) as Tables<'dtx_files'>[]);

	let displayId: number = $state(simfile?.display_id || 0);
	let publishDate: string = $state(simfile?.publish_date || dayjs().format('YYYY-MM-DD'));
	let isPublished: boolean = $state(simfile?.is_published || true);
	let downloadUrl: string = $state(simfile?.download_url || '');
	let videoPreviewUrl: string = $state(simfile?.video_preview_url || '');

	// Asset files state
	let assetFiles: FileInfo[] = $state([]);
	let isLoadingFiles: boolean = $state(false);
	let fileLoadError: string | null = $state(null);

	const onSave = createEventDispatcher();

	// Format file size to human-readable format
	function formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	// Format date to YYYY-MM-DD HH:MM format
	function formatDate(dateString: string): string {
		return dayjs(dateString).format('YYYY-MM-DD HH:mm');
	}

	// Load asset files for the simfile
	async function loadAssetFiles() {
		if (!simfile?.id) return;

		isLoadingFiles = true;
		fileLoadError = null;

		try {
			const response = await fetch(`/api/simFile/listFiles/${simfile.id}`);
			if (!response.ok) {
				throw new Error(`Error fetching files: ${response.statusText}`);
			}

			const data = await response.json();
			assetFiles = data.files || [];
		} catch (error) {
			console.error('Failed to load asset files:', error);
			fileLoadError = error instanceof Error ? error.message : 'Failed to load asset files';
		} finally {
			isLoadingFiles = false;
		}
	}

	// Generate download URL for a file
	function getDownloadUrl(key: string): string {
		return `${PUBLIC_SIMFILE_BUCKET_URL}/${key}`;
	}

	onMount(() => {
		if (simfile?.id) {
			loadAssetFiles();
		}
	});
</script>

<div class="relative flex-grow rounded-lg bg-white p-6 shadow-md">
	<a
		href={`/editor/${simfile?.id}`}
		target="_blank"
		rel="noopener noreferrer"
		class="absolute right-2 top-2 rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-600"
	>
		Open in Editor
	</a>
	<h1 class="mb-4 text-2xl font-bold">{simfile?.title}</h1>
	<div class="mt-4 grid grid-cols-8 gap-4">
		{@render preview?.()}
		<div class="col-span-1 flex items-center">
			<label for="bpm" class="mr-2 block">BPM:</label>
		</div>
		<div class="col-span-7">
			{simfile?.bpm}
		</div>
		<div class="col-span-1 flex items-center">
			<label for="artist" class="mr-2 block">Artist:</label>
		</div>
		<div class="col-span-7">
			{simfile?.artist || 'N/A'}
		</div>
		<div class="col-span-1 flex items-center">
			<label for="level" class="mr-2 block">Level:</label>
		</div>
		<div class="col-span-7 flex">
			{#each dtxFiles as dtx}
				{#if dtx}
					<div class="card mr-2 rounded-lg bg-gray-100 p-2">
						<h4 class="text-sm font-bold">{dtx.label}</h4>
						<p class="text-xs">{dtx.level}</p>
					</div>
				{/if}
			{/each}
		</div>
		<div class="col-span-1 flex items-center">
			<label for="display_id" class="mr-2 block">Display ID:</label>
		</div>
		<div class="col-span-7">
			<input
				id="display_id"
				type="text"
				bind:value={displayId}
				class="mb-4 w-full rounded border p-2"
			/>
		</div>
		<div class="col-span-1 flex items-center">
			<label for="publish_date" class="mb-2 mr-2 block">Publish Date:</label>
		</div>
		<div class="col-span-7">
			<input
				id="publish_date"
				type="date"
				bind:value={publishDate}
				class="w-1/7 mb-4 rounded border p-2"
			/>
		</div>
		<div class="col-span-1 flex items-center">
			<label for="is_published" class="mb-2 mr-2 block">Published:</label>
		</div>
		<div class="col-span-7">
			<SlideToggle name="slide-large" active="bg-primary-500" bind:checked={isPublished} />
		</div>
		<div class="col-span-1 flex items-center">
			<label for="download_link" class="mb-2 mr-2 block">Download Link:</label>
		</div>
		<div class="col-span-7">
			<input
				id="download_link"
				type="text"
				bind:value={downloadUrl}
				class="mb-4 w-full rounded border p-2"
			/>
		</div>
		<div class="col-span-1 flex items-center">
			<label for="video_preview_link" class="mb-2 mr-2 block">Video Preview Link:</label>
		</div>
		<div class="col-span-7">
			<input
				id="video_preview_link"
				type="text"
				bind:value={videoPreviewUrl}
				class="mb-4 w-full rounded border p-2"
			/>
		</div>
		{@render folder_upload?.()}
	</div>

	<!-- Uploaded Asset Files Section -->
	<div class="mt-8">
		<Accordion>
			<AccordionItem class="bg-green-100">
				<svelte:fragment slot="lead">
					<i class="fa-solid fa-folder-open"></i>
				</svelte:fragment>
				<svelte:fragment slot="summary">Uploaded Asset Files</svelte:fragment>
				<svelte:fragment slot="content">
					{#if isLoadingFiles}
						<div class="flex justify-center py-4">
							<p>Loading files...</p>
						</div>
					{:else if fileLoadError}
						<div class="py-4 text-red-500">
							<p>{fileLoadError}</p>
							<button
								class="mt-2 rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
								onclick={loadAssetFiles}
							>
								Retry
							</button>
						</div>
					{:else if assetFiles.length === 0}
						<div class="py-4">
							<p>No asset files found for this simfile.</p>
						</div>
					{:else}
						<div class="overflow-x-auto">
							<table class="w-full table-auto border border-black">
								<thead>
									<tr class="border-b border-black">
										<th class="px-4 py-2 text-left">File Name</th>
										<th class="px-4 py-2 text-left">Size</th>
										<th class="px-4 py-2 text-left">Last Modified</th>
										<th class="px-4 py-2 text-center">Actions</th>
									</tr>
								</thead>
								<tbody>
									{#each assetFiles as file}
										<tr class="border-b border-gray-300 hover:bg-gray-50">
											<td class="px-4 py-2">{file.fileName}</td>
											<td class="px-4 py-2">{formatFileSize(file.size)}</td>
											<td class="px-4 py-2"
												>{formatDate(file.lastModified)}</td
											>
											<td class="px-4 py-2 text-center">
												<a
													href={getDownloadUrl(file.key)}
													target="_blank"
													download={file.fileName}
													class="inline-flex items-center rounded-full bg-blue-100 p-2 text-blue-700 hover:bg-blue-200"
													title="Download file"
												>
													<DownloadSolid size="sm" />
												</a>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</svelte:fragment>
			</AccordionItem>
		</Accordion>
	</div>

	<button
		onclick={() =>
			onSave('onSave', {
				displayId,
				publishDate,
				isPublished,
				downloadUrl,
				videoPreviewUrl
			})}
		class="mt-4 rounded bg-green-500 px-4 py-2 font-bold text-white hover:bg-green-700"
	>
		{#if save}{@render save()}{:else}Update{/if}
	</button>
</div>
