<script lang="ts">
	import type { SimfileModel } from '@dtx/common';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import { EllipsisVertical, ExternalLink, Eye } from '@lucide/svelte/icons';
	import DownloadDropdown from '$lib/components/DownloadDropdown.svelte';
	import { Modal } from '@dtx/ui-components/components';
	import { Button } from '@dtx/ui-components';
	import { goto } from '$app/navigation';
	import toastStore from '$lib/toaster';
	import { isPreviewable } from '$lib/components/ChartList.helpers';
	import { _ } from 'svelte-i18n';

	type ChartListTableItemData = Pick<SimfileModel, 'id' | 'isPublished' | 'downloadUrl'> & {
		hasUploadedFiles?: boolean;
	};

	let {
		item,
		isBlog,
		enableDownload = false,
		togglePublishChart,
		onFileDelete
	} = $props<{
		item: ChartListTableItemData;
		isBlog: boolean;
		enableDownload?: boolean;
		togglePublishChart: (id: number, published: boolean) => Promise<void>;
		onFileDelete: (id: number) => void;
	}>();

	let popoverOpen = $state(false);
	let modalOpen = $state(false);

	const canOpenEditor = $derived(item.hasUploadedFiles === true);
	const previewable = $derived(isPreviewable(item));

	function handleDeleteConfirm() {
		onFileDelete(item.id);
	}

	const handleOpenInEditor = async () => {
		try {
			await goto(`/editor/${item.id}`);
		} catch (error) {
			console.error('Failed to navigate to editor:', error);
			toastStore.error({ title: 'Failed to open chart in editor', duration: 3000 });
		}
	};

	function openModal() {
		modalOpen = true;
		popoverOpen = false; // Close popover when modal opens
	}
</script>

{#if !isBlog}
	<Popover
		open={popoverOpen}
		onOpenChange={(details) => (popoverOpen = details.open)}
		zIndex="120"
		positioning={{ placement: 'bottom-start' }}
		triggerAriaLabel="Actions"
		triggerClasses="inline-flex h-9 w-9 items-center justify-center rounded p-1 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2"
		contentBase="w-48 p-0 rounded-sm border border-gray-300 bg-white shadow-lg"
	>
		{#snippet trigger()}
			<EllipsisVertical />
		{/snippet}
		{#snippet content()}
			<div class="py-1">
				{#if canOpenEditor}
					<Button
						onclick={handleOpenInEditor}
						variant="menuItem"
						fullWidth
						justify="start"
					>
						{#snippet children()}Open in Editor{/snippet}
					</Button>
				{/if}

				{#if previewable}
					<a
						href={`/preview/${item.id}`}
						class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
						role="menuitem"
					>
						{$_('preview.open')}
					</a>
				{/if}

				<a
					href={`/app/chart/${item.id}`}
					class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
					role="menuitem"
				>
					Edit details
				</a>

				<Button
					onclick={() => togglePublishChart(item.id, item.isPublished)}
					variant="menuItem"
					fullWidth
					justify="start"
				>
					{#snippet children()}{item.isPublished ? 'Unpublish' : 'Publish'}{/snippet}
				</Button>

				<Button onclick={openModal} variant="menuItem" fullWidth justify="start">
					{#snippet children()}Delete{/snippet}
				</Button>
			</div>
		{/snippet}
	</Popover>
{:else}
	<div class="flex items-center gap-2">
		{#if previewable}
			<a
				href={`/preview/${item.id}`}
				class="inline-flex items-center justify-center rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"
				aria-label={$_('preview.open')}
				title={$_('preview.open')}
			>
				<Eye size="16" />
			</a>
		{/if}
		{#if enableDownload}
			<DownloadDropdown
				simfileId={item.id}
				externalUrl={item.downloadUrl ?? null}
				hasUploadedFiles={item.hasUploadedFiles}
				compact={true}
			/>
		{:else if item.downloadUrl}
			<a
				href={item.downloadUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center justify-center rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"
				aria-label="External download link"
				title="External download link"
			>
				<ExternalLink size="16" />
			</a>
		{:else}
			<span
				class="inline-flex cursor-not-allowed items-center justify-center rounded-full p-2 text-slate-300 opacity-50"
				aria-disabled="true"
				title="No external link available"
			>
				<ExternalLink size="16" />
			</span>
		{/if}
	</div>
{/if}

<!-- Delete Confirmation Modal -->
<Modal
	bind:open={modalOpen}
	title="Delete Chart"
	onConfirm={handleDeleteConfirm}
	confirmText="Delete"
	confirmVariant="danger"
>
	<p class="text-gray-600">
		Are you sure you want to delete this chart? This action cannot be undone.
	</p>
</Modal>
