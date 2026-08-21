<script lang="ts">
	import { _ } from 'svelte-i18n';
	import ImageAudio from './ImageAudio.svelte';
	import type { SimfileModel } from '@dtx/common';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import { formatLevelDisplay, buildPreviewUrl } from '$lib/utils';
	import { EllipsisVertical } from '@lucide/svelte/icons';
	import { Modal, Button } from '@dtx/ui-components/components';
	import DownloadDropdown from '$lib/components/DownloadDropdown.svelte';
	import { goto } from '$app/navigation';
	import toastStore from '$lib/toaster';
	import { isPreviewable, chartTitleHref } from '$lib/components/ChartList.helpers';
	import { createAudioPreview } from '$lib/audioPreview.svelte';

	type ChartListItemData = Partial<SimfileModel>;

	let {
		item,
		isBlog,
		enableDownload = false,
		togglePublishChart,
		simfileBucketUrl,
		onFileDelete
	} = $props<{
		item: ChartListItemData;
		isBlog: boolean;
		enableDownload?: boolean;
		togglePublishChart: (id: number, published: boolean) => Promise<void>;
		simfileBucketUrl: string;
		onFileDelete: (id: number) => void;
	}>();

	let popoverOpen = $state(false);
	let modalOpen = $state(false);

	const hasUploadedChart = $derived(item.id !== undefined && item.hasUploadedFiles === true);
	const previewable = $derived(isPreviewable(item));
	const titleHref = $derived(chartTitleHref(item, isBlog));

	const audio = createAudioPreview(() => item.previewUrl ?? null);
	const blogMenuVisible = $derived(isBlog && (previewable || hasUploadedChart));

	const handleDeleteConfirm = () => {
		if (item.id !== undefined) {
			onFileDelete(item.id);
		}
	};

	const handleOpenModal = () => {
		modalOpen = true;
		popoverOpen = false;
	};

	const handleOpenInEditor = async () => {
		if (item.id === undefined) return;
		try {
			await goto(`/editor/${item.id}`);
		} catch (error) {
			console.error('Failed to navigate to editor:', error);
			toastStore.error({ title: 'Failed to open chart in editor', duration: 3000 });
		}
	};
</script>

<div class="music-card group relative flex min-h-[280px] flex-col" style="overflow: visible">
	<!-- Header with title and menu -->
	<div class="p-6 pb-4">
		<div class="mb-3 flex items-start justify-between">
			<div class="flex-1">
				<div class="mb-2 flex items-center gap-2">
					<div
						class="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-purple-400 to-cyan-400"
					></div>
					<span class="text-xs font-medium tracking-wider text-purple-300 uppercase"
						>#{item.displayId}</span
					>
				</div>
				<h2
					class="text-xl leading-tight font-bold text-slate-100 transition-colors duration-200 group-hover:text-purple-300"
				>
					{#if titleHref}
						<a href={titleHref} class="hover:text-purple-300">{item.title}</a>
					{:else}
						{item.title}
					{/if}
				</h2>
			</div>
			{#if !isBlog || blogMenuVisible}
				<Popover
					open={popoverOpen}
					onOpenChange={(details) => (popoverOpen = details.open)}
					zIndex="120"
					positioning={{ placement: 'bottom-start' }}
					triggerAriaLabel="Actions"
					triggerClasses="rounded-lg p-2 text-slate-400 transition-all duration-200 hover:bg-purple-600/20 hover:text-purple-300"
					contentBase="w-48 p-0 rounded-lg border border-purple-500/30 bg-slate-800 shadow-xl backdrop-blur-sm"
				>
					{#snippet trigger()}
						<EllipsisVertical size="18" />
					{/snippet}
					{#snippet content()}
						<div class="py-2">
							{#if hasUploadedChart}
								<Button
									onclick={handleOpenInEditor}
									variant="menuItem"
									fullWidth
									justify="start"
									class="text-slate-300 hover:bg-purple-600/20 hover:text-purple-200"
								>
									{#snippet children()}
										<svg
											class="mr-3 h-4 w-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
											></path>
										</svg>
										Open in Editor
									{/snippet}
								</Button>
							{/if}
							{#if previewable}
								<a
									href={`/preview/${item.id}`}
									class="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-purple-600/20 hover:text-purple-200"
									role="menuitem"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
										></path>
									</svg>
									{$_('preview.open')}
								</a>
							{/if}
							{#if !isBlog && item.id !== undefined}
								<a
									href={`/app/chart/${item.id}`}
									class="flex items-center gap-3 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-purple-600/20 hover:text-purple-200"
									role="menuitem"
								>
									<svg
										class="h-4 w-4"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
										></path>
									</svg>
									Edit details
								</a>
							{/if}

							{#if !isBlog && item.id !== undefined && item.isPublished !== undefined}
								<Button
									onclick={() => {
										togglePublishChart(item.id!, item.isPublished!);
									}}
									variant="menuItem"
									fullWidth
									justify="start"
									class="text-slate-300 hover:bg-cyan-600/20 hover:text-cyan-200"
								>
									{#snippet children()}
										<svg
											class="mr-3 h-4 w-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d={item.isPublished
													? 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L12 12m-3-3l6-6'
													: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z'}
											></path>
										</svg>
										{item.isPublished ? 'Unpublish' : 'Publish'}
									{/snippet}
								</Button>
							{/if}

							{#if !isBlog && item.id !== undefined}
								<Button
									onclick={handleOpenModal}
									variant="menuItem"
									fullWidth
									justify="start"
									class="text-slate-300 hover:bg-red-600/20 hover:text-red-200"
								>
									{#snippet children()}
										<svg
											class="mr-3 h-4 w-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											></path>
										</svg>
										Delete
									{/snippet}
								</Button>
							{/if}
						</div>
					{/snippet}
				</Popover>
			{/if}
		</div>

		<!-- Artist and BPM info -->
		<div class="mb-4 space-y-2">
			<div class="flex items-center gap-2">
				<svg
					class="h-4 w-4 text-purple-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
					></path>
				</svg>
				<span class="font-medium text-slate-300">{item.artist}</span>
			</div>
			<div class="flex items-center gap-2">
				<svg
					class="h-4 w-4 text-cyan-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
					></path>
				</svg>
				<span class="font-medium text-slate-300">{item.bpm} BPM</span>
			</div>
		</div>
	</div>

	<!-- Preview image/audio section -->
	<div class="flex-1 px-6">
		<div
			class="relative overflow-hidden rounded-lg transition-shadow duration-200 group-hover:shadow-lg"
		>
			{#if item.id !== undefined}
				<ImageAudio
					previewUrl={buildPreviewUrl(simfileBucketUrl, item.id, 'jpg')!}
					{audio}
				/>
			{:else}
				<div
					class="flex h-full min-h-[120px] items-center justify-center text-xs text-slate-500"
				>
					Preview unavailable
				</div>
			{/if}
		</div>
	</div>

	<!-- Footer with levels and actions -->
	<div class="p-6 pt-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<span class="text-xs font-medium text-slate-400">{$_('blog.level')}:</span>
				<div class="flex flex-wrap gap-1">
					{#each formatLevelDisplay(item.dtxFiles ?? []).split(', ') as level}
						<span
							class="rounded-full border border-amber-500/30 bg-gradient-to-r from-amber-600/30 to-orange-600/30 px-2 py-0.5 text-xs text-amber-200"
						>
							{level}
						</span>
					{/each}
				</div>
			</div>
		</div>

		{#if isBlog && item.id !== undefined}
			<div class="mt-4 flex flex-wrap items-center gap-3">
				{#if enableDownload}
					<DownloadDropdown
						simfileId={item.id}
						externalUrl={item.downloadUrl ?? null}
						hasUploadedFiles={item.hasUploadedFiles}
					/>
				{:else if item.downloadUrl}
					<a
						href={item.downloadUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="music-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"
					>
						<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
							></path>
						</svg>
						{$_('blog.download')}
					</a>
				{:else}
					<div class="text-sm text-slate-500 italic">Download not available</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<!-- Delete Confirmation Modal -->
<Modal
	bind:open={modalOpen}
	title="Delete Chart"
	onConfirm={handleDeleteConfirm}
	confirmText="Delete"
	confirmVariant="danger"
>
	<div class="space-y-4">
		<div class="flex items-center gap-3">
			<div
				class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-600/20"
			>
				<svg
					class="h-5 w-5 text-red-400"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
					></path>
				</svg>
			</div>
			<div>
				<h3 class="text-lg font-semibold text-slate-100">Confirm Deletion</h3>
				<p class="mt-1 text-slate-300">
					Are you sure you want to delete "<span class="font-medium text-purple-300"
						>{item.title}</span
					>"?
				</p>
			</div>
		</div>
		<p class="rounded-lg border border-red-500/20 bg-red-600/10 p-3 text-sm text-slate-400">
			⚠️ This action cannot be undone and will permanently remove the chart and all associated
			files.
		</p>
	</div>
</Modal>
