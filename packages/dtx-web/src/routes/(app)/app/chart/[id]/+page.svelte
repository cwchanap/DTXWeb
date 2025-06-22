<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import type { Tables } from '@dtx/common';
	import { goto } from '$app/navigation';
	import type { SimFile, DTXFile } from '@dtx/common';
	import { UploadedAssetFiles, ChartDetail } from '@dtx/common/components';
	import toastStore from '@/lib/toaster';
	import IconUpload from '@lucide/svelte/icons/upload';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import { loadAssetFiles } from '$lib/services/assetFileService';

	let simfile: Tables<'simfiles'> | null = $state(null);
	let loading = $state(true);
	let error: string | null = $state(null);
	let updatedHighestDtx: DTXFile | null = $state(null);
	let updatedSimfile: SimFile | null = $state(null);
	let userUploadedFiles: File[] = $state([]);
	let { data } = $props();
	let { supabase } = $derived(data);

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
			toastStore.error({
				title: 'Error updating simfile',
				duration: 5000
			});
		} else {
			toastStore.success({
				title: 'Simfile updated successfully',
				duration: 5000
			});
		}
	}
</script>

<div class="container mx-auto p-4">
	<button onclick={goBack} class="mb-4 text-blue-500 hover:text-blue-700">
		← Back to List
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
			{#snippet asset_files()}
				<UploadedAssetFiles
					simfileId={simfile?.id?.toString() || ''}
					userFiles={userUploadedFiles}
					supabaseClient={data.supabase}
					simfileBucketUrl={PUBLIC_SIMFILE_BUCKET_URL}
					{loadAssetFiles}
				/>
			{/snippet}
		</ChartDetail>
	{:else}
		<p class="text-red-500">Simfile not found</p>
	{/if}
</div>
