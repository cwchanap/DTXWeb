<script lang="ts">
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import type { Tables } from '../types/supabase.types';
	import { createEventDispatcher } from 'svelte';
	import dayjs from 'dayjs';
	import IconX from '@lucide/svelte/icons/x';
	import IconCheck from '@lucide/svelte/icons/check';

	type simFileWithDtxFiles = Tables<'simfiles'> & {
		dtx_files: Partial<Tables<'dtx_files'>>[];
	};

	interface Props {
		simfile?: Partial<simFileWithDtxFiles> | null;
		preview?: import('svelte').Snippet;
		folder_upload?: import('svelte').Snippet;
		asset_files?: import('svelte').Snippet;
		save?: import('svelte').Snippet;
	}

	let { simfile = null, preview, folder_upload, asset_files, save }: Props = $props();
	let dtxFiles = $derived((simfile?.dtx_files || []) as Tables<'dtx_files'>[]);

	let displayId: number = $state(simfile?.display_id || 0);
	let publishDate: string = $state(simfile?.publish_date || dayjs().format('YYYY-MM-DD'));
	let isPublished: boolean = $state(simfile?.is_published || true);
	let downloadUrl: string = $state(simfile?.download_url || '');
	let videoPreviewUrl: string = $state(simfile?.video_preview_url || '');

	const onSave = createEventDispatcher();
</script>

<div class="relative grow rounded-lg bg-white p-6 shadow-md">
	<a
		href={`/editor/${simfile?.id}`}
		target="_blank"
		rel="noopener noreferrer"
		class="absolute top-2 right-2 rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-600"
	>
		Open in Editor
	</a>
	<h1 class="mb-4 text-2xl font-bold">{simfile?.title}</h1>

	<!-- Preview Section - Outside of grid to avoid layout issues -->
	{#if preview}
		<div class="mb-4">
			{@render preview()}
		</div>
	{/if}

	<div class="mt-4 grid grid-cols-8 gap-4">
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
				class="mb-4 w-full rounded-sm border p-2"
			/>
		</div>
		<div class="col-span-1 flex items-center">
			<label for="publish_date" class="mr-2 mb-2 block">Publish Date:</label>
		</div>
		<div class="col-span-7">
			<input
				id="publish_date"
				type="date"
				bind:value={publishDate}
				class="mb-4 w-1/7 rounded-sm border p-2"
			/>
		</div>
		<div class="col-span-1 flex items-center">
			<label for="is_published" class="mr-2 mb-2 block">Published:</label>
		</div>
		<div class="col-span-7">
			<Switch checked={isPublished} onCheckedChange={(e) => (isPublished = e.checked)}>
				{#snippet inactiveChild()}<IconX size="14" />{/snippet}
				{#snippet activeChild()}<IconCheck size="14" />{/snippet}
			</Switch>
		</div>
		<div class="col-span-1 flex items-center">
			<label for="download_link" class="mr-2 mb-2 block">Download Link:</label>
		</div>
		<div class="col-span-7">
			<input
				id="download_link"
				type="text"
				bind:value={downloadUrl}
				class="mb-4 w-full rounded-sm border p-2"
			/>
		</div>
		<div class="col-span-1 flex items-center">
			<label for="video_preview_link" class="mr-2 mb-2 block">Video Preview Link:</label>
		</div>
		<div class="col-span-7">
			<input
				id="video_preview_link"
				type="text"
				bind:value={videoPreviewUrl}
				class="mb-4 w-full rounded-sm border p-2"
			/>
		</div>
		{@render folder_upload?.()}
	</div>

	<!-- Asset Files Section -->
	{@render asset_files?.()}

	<button
		onclick={() =>
			onSave('onSave', {
				displayId,
				publishDate,
				isPublished,
				downloadUrl,
				videoPreviewUrl
			})}
		class="mt-4 rounded-sm bg-green-500 px-4 py-2 font-bold text-white hover:bg-green-700"
	>
		{#if save}{@render save()}{:else}Update{/if}
	</button>
</div>
