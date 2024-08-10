<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { supabase } from '@/lib/supabase';
	import type { Tables } from '@/types/supabase.types';
	import { goto } from '$app/navigation';
	import { getToastStore, SlideToggle } from '@skeletonlabs/skeleton';
	import { formatLevelDisplay } from '@/lib/utils';
	import ChartFolderUpload from '@/lib/components/ChartFolderUpload.svelte';
	import type { SimFile } from '@/lib/chart/simFile';
	import type { DTXFile } from '@/lib/chart/dtx';

	const toastStore = getToastStore();

	let simfile: Tables<'simfiles'> | null = null;
	let loading = true;
	let error: string | null = null;
	let downloadLink: string | null = null;
	let videoPreviewLink: string | null = null;
	let publishDate: string;
	let isPublished: boolean;
	let updatedHighestDtx: DTXFile | null = null;
	let updatedSimfile: SimFile | null = null;
	let displayId: number | null = null;

	onMount(async () => {
		const { id } = $page.params;
		await loadSimfileDetails(id);
	});

	async function loadSimfileDetails(id: string) {
		try {
			const { data, error: fetchError } = await supabase
				.from('simfiles')
				.select('*, dtx_files(level)')
				.eq('id', id)
				.single();

			if (fetchError) throw fetchError;
			simfile = data;
			downloadLink = data?.download_url;
			videoPreviewLink = data?.video_preview_url;
			publishDate = data?.publish_date;
			isPublished = data?.is_published;
			displayId = data?.display_id;
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	}

	function goBack() {
		goto('/app/chart');
	}

	async function updateSimfile() {
		const { id } = $page.params;
		let updateFields: any = {
			download_url: downloadLink,
			video_preview_url: videoPreviewLink,
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
		<div class="flex-grow rounded-lg bg-white p-6 shadow-md">
			<h1 class="mb-4 text-2xl font-bold">{simfile.title}</h1>
			<div class="mt-4 grid grid-cols-8 gap-4">
				<div class="col-span-1 flex items-center">
					<label for="bpm" class="mr-2 block">BPM:</label>
				</div>
				<div class="col-span-7">
					{simfile.bpm}
				</div>
				<div class="col-span-1 flex items-center">
					<label for="artist" class="mr-2 block">Artist:</label>
				</div>
				<div class="col-span-7">
					{simfile.artist || 'N/A'}
				</div>
				<div class="col-span-1 flex items-center">
					<label for="level" class="mr-2 block">Level:</label>
				</div>
				<div class="col-span-7">
					{formatLevelDisplay(simfile.dtx_files)}
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
						class="mb-4 w-full rounded border p-2"
					/>
				</div>
				<div class="col-span-1 flex items-center">
					<label for="is_published" class="mb-2 mr-2 block">Published:</label>
				</div>
				<div class="col-span-7">
					<SlideToggle
						name="slide-large"
						active="bg-primary-500"
						bind:checked={isPublished}
					/>
				</div>
				<div class="col-span-1 flex items-center">
					<label for="download_link" class="mb-2 mr-2 block">Download Link:</label>
				</div>
				<div class="col-span-7">
					<input
						id="download_link"
						type="text"
						bind:value={downloadLink}
						class="mb-4 w-full rounded border p-2"
					/>
				</div>
				<div class="col-span-1 flex items-center">
					<label for="video_preview_link" class="mb-2 mr-2 block"
						>Video Preview Link:</label
					>
				</div>
				<div class="col-span-7">
					<input
						id="video_preview_link"
						type="text"
						bind:value={videoPreviewLink}
						class="mb-4 w-full rounded border p-2"
					/>
				</div>
				<div class="col-span-1 flex items-center">
					<label for="folder_upload" class="mb-2 mr-2 block">Upload Folder:</label>
				</div>
				<div class="col-span-7">
					<ChartFolderUpload large={false} {onFileUpload} />
				</div>
			</div>
			<button
				on:click={updateSimfile}
				class="mt-4 rounded bg-green-500 px-4 py-2 font-bold text-white hover:bg-green-700"
			>
				Update
			</button>
		</div>
	{:else}
		<p class="text-red-500">Simfile not found</p>
	{/if}
</div>
