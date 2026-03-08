<script lang="ts">
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import type { DtxFileRow } from '../types/d1.types';
	import { createEventDispatcher } from 'svelte';
	import dayjs from 'dayjs';
	import IconX from '@lucide/svelte/icons/x';
	import IconCheck from '@lucide/svelte/icons/check';

	type SimfileWithDtxFiles = {
		id?: number;
		title?: string;
		artist?: string;
		bpm?: number;
		user_id?: string;
		display_id?: number | null;
		download_url?: string | null;
		preview_url?: string | null;
		video_preview_url?: string | null;
		publish_date?: string;
		created_at?: string;
		updated_at?: string;
		is_published?: boolean;
		dtx_files?: Partial<DtxFileRow>[];
	};

	interface Props {
		simfile?: Partial<SimfileWithDtxFiles> | null;
		preview?: import('svelte').Snippet;
		folder_upload?: import('svelte').Snippet;
		asset_files?: import('svelte').Snippet;
		save?: import('svelte').Snippet;
		// Desktop-specific snippets
		header?: import('svelte').Snippet;
		desktop_info?: import('svelte').Snippet;
		local_files?: import('svelte').Snippet;
		// Configuration props
		showEditor?: boolean;
		showPublishingControls?: boolean;
		showPublishedToggle?: boolean;
		saveButtonText?: string;
		// Reactive form value bindings (for parent component access)
		displayId?: number | string;
		publishDate?: string;
		isPublished?: boolean;
		downloadUrl?: string;
		videoPreviewUrl?: string;
	}

	let {
		simfile = null,
		preview,
		folder_upload,
		asset_files,
		save,
		header,
		desktop_info,
		local_files,
		showEditor = true,
		showPublishingControls = true,
		showPublishedToggle = true,
		saveButtonText = 'Update',
		displayId = $bindable(simfile?.display_id || 0),
		publishDate = $bindable(simfile?.publish_date || dayjs().format('YYYY-MM-DD')),
		isPublished = $bindable(simfile?.is_published || true),
		downloadUrl = $bindable(simfile?.download_url || ''),
		videoPreviewUrl = $bindable(simfile?.video_preview_url || '')
	}: Props = $props();

	let dtxFiles = $derived((simfile?.dtx_files || []) as Partial<DtxFileRow>[]);

	// Derived values for display
	let displayBpm = $derived(simfile?.bpm);
	let displayArtist = $derived(simfile?.artist);
	let displayLevels = $derived(() => {
		if (dtxFiles.length > 0) {
			return dtxFiles.slice().sort((a, b) => (a.level || 0) - (b.level || 0));
		}
		return [];
	});

	const onSave = createEventDispatcher();
</script>

<!-- Custom Header (for desktop back button, etc.) -->
{#if header}
	{@render header()}
{/if}

<div
	class="relative min-h-0 flex-1 overflow-y-auto rounded-lg bg-white shadow-md dark:bg-slate-800 dark:shadow-slate-700/50"
>
	<div class="p-6">
		{#if showEditor}
			<a
				href={`/editor/${simfile?.id}`}
				target="_blank"
				rel="noopener noreferrer"
				class="absolute top-2 right-2 rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
			>
				Open in Editor
			</a>
		{/if}

		<h1 class="mb-4 text-2xl font-bold text-slate-900 dark:text-slate-100">{simfile?.title}</h1>

		<!-- Desktop-specific information (status section outside of grid) -->
		{#if desktop_info}
			<div class="mb-4">
				{@render desktop_info()}
			</div>
		{/if}

		<!-- Preview Section - Outside of grid to avoid layout issues -->
		{#if preview}
			<div class="mb-4">
				{@render preview()}
			</div>
		{/if}

		<div class="mt-4 grid grid-cols-8 gap-4">
			<div class="col-span-1 flex items-center">
				<label for="bpm" class="mr-2 block text-slate-700 dark:text-slate-300">BPM:</label>
			</div>
			<div class="col-span-7">
				<span class="text-slate-900 dark:text-slate-100">{displayBpm || 'N/A'}</span>
			</div>
			<div class="col-span-1 flex items-center">
				<label for="artist" class="mr-2 block text-slate-700 dark:text-slate-300"
					>Artist:</label
				>
			</div>
			<div class="col-span-7">
				<span class="text-slate-900 dark:text-slate-100">{displayArtist || 'N/A'}</span>
			</div>
			<div class="col-span-1 flex items-center">
				<label for="level" class="mr-2 block text-slate-700 dark:text-slate-300"
					>Level:</label
				>
			</div>
			<div class="col-span-7 flex">
				{#each displayLevels() as level}
					{#if level}
						<div class="card mr-2 rounded-lg bg-gray-100 p-2 dark:bg-slate-700">
							<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">
								{level.label}
							</h4>
							<p class="text-xs text-slate-600 dark:text-slate-400">{level.level}</p>
						</div>
					{/if}
				{/each}
			</div>
			{#if showPublishingControls}
				<div class="col-span-1 flex items-center">
					<label for="display_id" class="mr-2 block text-slate-700 dark:text-slate-300"
						>Display ID:</label
					>
				</div>
				<div class="col-span-7">
					<input
						id="display_id"
						type="text"
						bind:value={displayId}
						class="mb-4 w-full rounded-sm border border-gray-300 p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
					/>
				</div>
				<div class="col-span-1 flex items-center">
					<label
						for="publish_date"
						class="mr-2 mb-2 block text-slate-700 dark:text-slate-300"
						>Publish Date:</label
					>
				</div>
				<div class="col-span-7">
					<input
						id="publish_date"
						type="date"
						bind:value={publishDate}
						class="mb-4 w-1/7 rounded-sm border border-gray-300 p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
						style="min-width: 140px;"
					/>
				</div>
				{#if showPublishedToggle}
					<div class="col-span-1 flex items-center">
						<label
							for="is_published"
							class="mr-2 mb-2 block text-slate-700 dark:text-slate-300"
							>Published:</label
						>
					</div>
					<div class="col-span-7">
						<Switch
							checked={isPublished}
							onCheckedChange={(e) => (isPublished = e.checked)}
						>
							{#snippet inactiveChild()}<IconX size="14" />{/snippet}
							{#snippet activeChild()}<IconCheck size="14" />{/snippet}
						</Switch>
					</div>
				{/if}
				<div class="col-span-1 flex items-center">
					<label
						for="download_link"
						class="mr-2 mb-2 block text-slate-700 dark:text-slate-300"
						>Download Link:</label
					>
				</div>
				<div class="col-span-7">
					<input
						id="download_link"
						type="text"
						bind:value={downloadUrl}
						class="mb-4 w-full rounded-sm border border-gray-300 p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
					/>
				</div>
				<div class="col-span-1 flex items-center">
					<label
						for="video_preview_link"
						class="mr-2 mb-2 block text-slate-700 dark:text-slate-300"
						>Video Preview Link:</label
					>
				</div>
				<div class="col-span-7">
					<input
						id="video_preview_link"
						type="text"
						bind:value={videoPreviewUrl}
						class="mb-4 w-full rounded-sm border border-gray-300 p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
					/>
				</div>
			{/if}
			{@render folder_upload?.()}
		</div>

		<!-- Local Files Section (for desktop) -->
		{#if local_files}
			{@render local_files()}
		{:else}
			<!-- Asset Files Section (for web) -->
			{@render asset_files?.()}
		{/if}

		{#if showPublishingControls && !save}
			<button
				onclick={() =>
					onSave('onSave', {
						displayId,
						publishDate,
						isPublished,
						downloadUrl,
						videoPreviewUrl
					})}
				class="mt-4 rounded-sm bg-green-500 px-4 py-2 font-bold text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-800"
			>
				{saveButtonText}
			</button>
		{/if}
		{#if save}
			<!-- Show custom save snippet -->
			<div class="mt-4">
				{@render save()}
			</div>
		{/if}
	</div>
</div>
