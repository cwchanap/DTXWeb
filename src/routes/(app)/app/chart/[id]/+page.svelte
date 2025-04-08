<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import type { Tables } from '@/types/supabase.types';
	import { goto } from '$app/navigation';
	import { getToastStore } from '@skeletonlabs/skeleton';
	import ChartFolderUpload from '$lib/components/ChartFolderUpload.svelte';
	import type { SimFile } from '$lib/chart/simFile';
	import type { DTXFile } from '$lib/chart/dtx';
	import ChartDetail from '$lib/components/ChartDetail.svelte';
	import { Accordion, AccordionItem } from '@skeletonlabs/skeleton';
	import { DownloadSolid } from 'flowbite-svelte-icons';
	import dayjs from 'dayjs';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';

	const toastStore = getToastStore();

	let simfile: Tables<'simfiles'> | null = $state(null);
	let loading = $state(true);
	let error: string | null = $state(null);
	let updatedHighestDtx: DTXFile | null = $state(null);
	let updatedSimfile: SimFile | null = $state(null);
	let { data } = $props();
	let { supabase } = $derived(data);

	let assetFiles = $state<
		{ fileName: string; size: number; lastModified: string; key: string }[]
	>([]);
	let isLoadingFiles = $state(false);
	let fileLoadError = $state<string | null>(null);

	onMount(async () => {
		const { id } = $page.params;
		await loadSimfileDetails(id);
		await loadAssetFiles();
	});

	async function loadSimfileDetails(id: string) {
		try {
			const { data, error: fetchError } = await supabase
				.from('simfiles')
				.select('*, dtx_files(level, label)')
				.eq('id', id)
				.single();

			if (fetchError) throw fetchError;
			simfile = data;
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

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

	function goBack() {
		goto('/app/chart');
	}

	async function updateSimfile(
		displayId: number,
		publishDate: string,
		isPublished: boolean,
		downloadUrl: string,
		videoPreviewUrl: string
	) {
		const { id } = $page.params;
		let updateFields: any = {
			download_url: downloadUrl,
			video_preview_url: videoPreviewUrl,
			publish_date: publishDate,
			is_published: isPublished,
			display_id: displayId
		};

		if (updatedSimfile && updatedHighestDtx) {
			updateFields.bpm = updatedHighestDtx.bpm;
			updateFields.artist = updatedHighestDtx.artist;
			updateFields.title = updatedSimfile.title;
		}

		const { data, error } = await supabase
			.from('simfiles')
			.update(updateFields)
			.eq('id', id)
			.select();

		if (!data || error) {
			toastStore.trigger({
				message: 'Error updating simfile',
				background: 'variant-filled-error',
				timeout: 5000
			});
		} else {
			toastStore.trigger({
				message: 'Simfile updated successfully',
				background: 'variant-filled-success',
				timeout: 5000
			});
		}
	}

	function onFileUpload(newSimfile: SimFile, newHighestDtx: DTXFile) {
		updatedSimfile = newSimfile;
		updatedHighestDtx = newHighestDtx;
		if (simfile) {
			simfile.bpm = newHighestDtx.bpm;
			simfile.artist = newHighestDtx.artist;
			simfile.title = newSimfile.title;
		}
	}
</script>

<div class="container mx-auto p-4">
	<button onclick={goBack} class="mb-4 text-blue-500 hover:text-blue-700">
		&larr; Back to List
	</button>
	{#if loading}
		<p>Loading...</p>
	{:else if error}
		<p class="text-red-500">Error: {error}</p>
	{:else if simfile}
		<ChartDetail
			{simfile}
			on:onSave={(e) =>
				updateSimfile(
					e.detail.displayId,
					e.detail.publishDate,
					e.detail.isPublished,
					e.detail.downloadUrl,
					e.detail.videoPreviewUrl
				)}
		>
			{#snippet folder_upload()}
				<div class="col-span-1 flex items-center">
					<label for="folder_upload" class="mb-2 mr-2 block">Upload Folder:</label>
				</div>
				<div class="col-span-7">
					<ChartFolderUpload large={false} {onFileUpload} />
				</div>
			{/snippet}

			{#snippet asset_files()}
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
													<th class="px-4 py-2 text-left"
														>Last Modified</th
													>
													<th class="px-4 py-2 text-center">Actions</th>
												</tr>
											</thead>
											<tbody>
												{#each assetFiles as file}
													<tr
														class="border-b border-gray-300 hover:bg-gray-50"
													>
														<td class="px-4 py-2">{file.fileName}</td>
														<td class="px-4 py-2"
															>{formatFileSize(file.size)}</td
														>
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
			{/snippet}
		</ChartDetail>
	{:else}
		<p class="text-red-500">Simfile not found</p>
	{/if}
</div>
