<script lang="ts">
	import type { Tables } from '@dtx/common';
	import { Popover, Tooltip } from '@skeletonlabs/skeleton-svelte';
	import { EllipsisVertical, ExternalLink } from '@lucide/svelte/icons';
	import { Modal } from '@dtx/ui-components/components';

	let { item, isBlog, togglePublishChart, onFileDelete } = $props<{
		item: Partial<Tables<'simfiles'>>;
		isBlog: boolean;
		togglePublishChart: (id: number, published: boolean) => Promise<void>;
		onFileDelete: (id: number, preview_url?: string, sound_preview_url?: string) => void;
	}>();

	let popoverOpen = $state(false);
	let modalOpen = $state(false);
	let tooltipOpen = $state(false);

	function handleDeleteConfirm() {
		onFileDelete(item.id, item.preview_url, item.sound_preview_url);
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
		positioning={{ placement: 'bottom-start' }}
		contentBase="w-48 p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
	>
		{#snippet trigger()}
			<button class="rounded p-1 hover:bg-gray-100">
				<EllipsisVertical />
			</button>
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

				<button
					onclick={() => togglePublishChart(item.id, item.is_published)}
					class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
					role="menuitem"
				>
					{item.is_published ? 'Unpublish' : 'Publish'}
				</button>

				<button
					onclick={openModal}
					class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
					role="menuitem"
				>
					Delete
				</button>
			</div>
		{/snippet}
	</Popover>
{:else if item.download_url}
	<a
		href={item.download_url}
		target="_blank"
		rel="noopener noreferrer"
		class="inline-flex items-center justify-center rounded-full bg-blue-100 p-2 text-blue-600 hover:bg-blue-200"
		title={$_('chart.download_simfile')}
	>
		<Tooltip
			open={tooltipOpen}
			onOpenChange={(e) => (tooltipOpen = e.open)}
			positioning={{ placement: 'top' }}
			triggerBase="underline"
			contentBase="card preset-filled p-2"
			openDelay={200}
			arrow
		>
			{#snippet trigger()}<ExternalLink size="16" />{/snippet}
			{#snippet content()}Download Simfile{/snippet}
		</Tooltip>
	</a>
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
