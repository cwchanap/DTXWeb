<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { SimFile, DTXFile } from '@dtx/common';
	import { UploadedAssetFiles, ChartDetail } from '@dtx/common/components';
	import toastStore from '@/lib/toaster';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import { getSimfile, updateSimfile, type LegacySimfile } from '$lib/api';

	let simfile: LegacySimfile | null = $state(null);
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
			simfile = await getSimfile(id);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load chart';
		} finally {
			loading = false;
		}
	};

	// Phase 6: asset files come from the GraphQL getSimfile() result (simfile.files),
	// not a separate REST fetch. Adapt {key,size,uploaded} -> the component shape.
	const loadAssetFiles = async (simfileId: string) => {
		if (!simfileId) throw new Error('SimfileId is required');
		const files = simfile?.files ?? [];
		return files.map((f) => ({
			key: f.key,
			size: f.size,
			lastModified: f.uploaded,
			fileName: f.key.startsWith(`${simfileId}/`) ? f.key.slice(simfileId.length + 1) : f.key
		}));
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
		const updateFields = {
			downloadUrl,
			videoPreviewUrl,
			publishDate,
			isPublished,
			displayId: displayId ? Number(displayId) : null,
			...(updatedSimfile && updatedHighestDtx
				? {
						bpm: updatedHighestDtx.bpm,
						artist: updatedHighestDtx.artist,
						title: updatedSimfile.title
					}
				: {})
		};

		try {
			simfile = await updateSimfile(String(id), updateFields);

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
			simfile={simfile as import('@dtx/common').SimfileWithDtxFiles}
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
