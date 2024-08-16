<script lang="ts">
	import { SlideToggle } from '@skeletonlabs/skeleton';
	import type { Tables } from '@/types/supabase.types';
	import { createEventDispatcher } from 'svelte';
	import dayjs from 'dayjs';

	type simFileWithDtxFiles = Tables<'simfiles'> & {
		dtx_files: Partial<Tables<'dtx_files'>>[];
	};

	export let simfile: Partial<simFileWithDtxFiles> | null = null;
	$: dtxFiles = (simfile?.dtx_files || []) as Tables<'dtx_files'>[];

	let displayId: number = simfile?.display_id || 0;
	let publishDate: string = simfile?.publish_date || dayjs().format('YYYY-MM-DD');
	let isPublished: boolean = simfile?.is_published || true;
	let downloadUrl: string = simfile?.download_url || '';
	let videoPreviewUrl: string = simfile?.video_preview_url || '';

	const onSave = createEventDispatcher();
</script>

<div class="flex-grow rounded-lg bg-white p-6 shadow-md">
	<h1 class="mb-4 text-2xl font-bold">{simfile?.title}</h1>
	<div class="mt-4 grid grid-cols-8 gap-4">
		<slot name="preview" />
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
				class="mb-4 w-1/7 rounded border p-2"
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
		<slot name="folder_upload" />
	</div>
	<button
		on:click={() =>
			onSave('onSave', {
				displayId,
				publishDate,
				isPublished,
				downloadUrl,
				videoPreviewUrl
			})}
		class="mt-4 rounded bg-green-500 px-4 py-2 font-bold text-white hover:bg-green-700"
	>
		<slot name="save">Update</slot>
	</button>
</div>
