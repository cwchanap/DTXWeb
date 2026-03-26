<script lang="ts">
	import type { SimfileWithDtx } from '@dtx/common';
	import { Popover } from '@skeletonlabs/skeleton-svelte';
	import { EllipsisVertical } from '@lucide/svelte/icons';
	import DownloadDropdown from './DownloadDropdown.svelte';
	import { Modal } from '@dtx/ui-components/components';
	import { Button } from '@dtx/ui-components';

	type ChartListTableItemData = Pick<SimfileWithDtx, 'id' | 'is_published' | 'download_url'> & {
		has_uploaded_files?: boolean;
	};

	let { item, isBlog, togglePublishChart, onFileDelete } = $props<{
		item: ChartListTableItemData;
		isBlog: boolean;
		togglePublishChart: (id: number, published: boolean) => Promise<void>;
		onFileDelete: (id: number) => void;
	}>();

	let popoverOpen = $state(false);
	let modalOpen = $state(false);

	function handleDeleteConfirm() {
		onFileDelete(item.id);
	}

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
		contentBase="w-48 p-0 rounded-sm border border-gray-300 bg-white shadow-lg"
	>
		{#snippet trigger()}
			<Button variant="ghost" size="icon" padding="1">
				{#snippet children()}<EllipsisVertical />{/snippet}
			</Button>
		{/snippet}
		{#snippet content()}
			<div class="py-1">
				<a
					href={`/app/chart/${item.id}`}
					class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
					role="menuitem"
				>
					Edit
				</a>

				<Button
					onclick={() => togglePublishChart(item.id, item.is_published)}
					variant="menuItem"
					fullWidth
					justify="start"
				>
					{#snippet children()}{item.is_published ? 'Unpublish' : 'Publish'}{/snippet}
				</Button>

				<Button onclick={openModal} variant="menuItem" fullWidth justify="start">
					{#snippet children()}Delete{/snippet}
				</Button>
			</div>
		{/snippet}
	</Popover>
{:else}
	<DownloadDropdown
		simfileId={item.id}
		externalUrl={item.download_url ?? null}
		hasUploadedFiles={item.has_uploaded_files ?? false}
		compact={true}
	/>
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
