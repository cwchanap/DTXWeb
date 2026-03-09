<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import type { SimfileWithDtxFiles } from '@dtx/common';
	import { goto } from '$app/navigation';
	import type { SimFile, DTXFile } from '@dtx/common';
	import { UploadedAssetFiles, ChartDetail } from '@dtx/common/components';
	import toastStore from '@/lib/toaster';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import { loadAssetFiles } from '@dtx/common/services/assetFileService';

	let simfile: SimfileWithDtxFiles | null = $state(null);
	let loading = $state(true);
	let error: string | null = $state(null);
	let updatedHighestDtx = $state<DTXFile | null>(null);
	let updatedSimfile = $state<SimFile | null>(null);
	let userUploadedFiles: File[] = $state([]);

	onMount(async () => {
		const id = $page.params.id;
		if (id) await loadSimfileDetails(id);
	});

	const loadSimfileDetails = async (id: string) => {
		try {
			const response = await fetch(`/api/chart/${id}`);
			if (!response.ok) {
				const err = await response.json();
				throw new Error(err.error || 'Failed to load chart');
			}
			simfile = await response.json();
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load chart';
		} finally {
			loading = false;
		}
	};

	const handleGoBack = () => {
		goto('/app/chart');
	};

	const handleUpdateSimfile = async (
		displayId: number,
		publishDate: string,
		isPublished: boolean,
		downloadUrl: string,
		videoPreviewUrl: string
	) => {
		const { id } = $page.params;
		let updateFields: Record<string, unknown> = {
			download_url: downloadUrl,
			video_preview_url: videoPreviewUrl,
			publish_date: publishDate,
			is_published: isPublished,
			display_id: displayId ? Number(displayId) : null
		};

		if (updatedSimfile && updatedHighestDtx) {
			updateFields.bpm = updatedHighestDtx.bpm;
			updateFields.artist = updatedHighestDtx.artist;
			updateFields.title = updatedSimfile.title;
		}

		try {
			const response = await fetch(`/api/chart/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updateFields)
			});

			if (!response.ok) {
				throw new Error('Failed to update');
			}

			toastStore.success({
				title: 'Simfile updated successfully',
				duration: 5000
			});
		} catch {
			toastStore.error({
				title: 'Error updating simfile',
				duration: 5000
			});
		}
	};
</script>

<div class="container mx-auto p-4">
	<button onclick={handleGoBack} class="mb-4 text-blue-500 hover:text-blue-700">
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
				handleUpdateSimfile(
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
					simfileBucketUrl={PUBLIC_SIMFILE_BUCKET_URL}
					{loadAssetFiles}
				/>
			{/snippet}
		</ChartDetail>
	{:else}
		<p class="text-red-500">Simfile not found</p>
	{/if}
</div>
