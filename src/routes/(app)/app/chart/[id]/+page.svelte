<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Tables } from '@/types/supabase.types';
	import { goto } from '$app/navigation';
	import { getToastStore } from '@skeletonlabs/skeleton';
	import ChartFolderUpload from '@/lib/components/ChartFolderUpload.svelte';
	import type { SimFile } from '@/lib/chart/simFile';
	import type { DTXFile } from '@/lib/chart/dtx';
	import ChartDetail from '@/lib/components/ChartDetail.svelte';

	const toastStore = getToastStore();

	let simfile: Tables<'simfiles'> | null = null;
	let loading = true;
	let error: string | null = null;
	let updatedHighestDtx: DTXFile | null = null;
	let updatedSimfile: SimFile | null = null;

	onMount(async () => {
		const { id } = $page.params;
		await loadSimfileDetails(id);
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
	<button on:click={goBack} class="mb-4 text-blue-500 hover:text-blue-700">
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
			<svelte:fragment slot="folder_upload">
				<div class="col-span-1 flex items-center">
					<label for="folder_upload" class="mb-2 mr-2 block">Upload Folder:</label>
				</div>
				<div class="col-span-7">
					<ChartFolderUpload large={false} {onFileUpload} />
				</div>
			</svelte:fragment>
		</ChartDetail>
	{:else}
		<p class="text-red-500">Simfile not found</p>
	{/if}
</div>
