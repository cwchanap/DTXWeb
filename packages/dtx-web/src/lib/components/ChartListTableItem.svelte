<script lang="ts">
	import type { Tables } from '@dtx/common';
	import { Popover, Tooltip } from '@skeletonlabs/skeleton-svelte';
	import { EllipsisVertical, ExternalLink } from '@lucide/svelte/icons';
	import { Modal } from '@dtx/ui-components/components';
	import { Button } from '@dtx/ui-components';
	import { _ } from 'svelte-i18n';
	import { get } from 'svelte/store';
	import toastStore from '$lib/toaster';

	let { item, isBlog, togglePublishChart, onFileDelete } = $props<{
		item: Partial<Tables<'simfiles'>>;
		isBlog: boolean;
		togglePublishChart: (id: number, published: boolean) => Promise<void>;
		onFileDelete: (id: number) => void;
	}>();

	let popoverOpen = $state(false);
	let modalOpen = $state(false);
	let tooltipOpen = $state(false);

	function handleDeleteConfirm() {
		if (item.id !== undefined) {
			onFileDelete(item.id);
		} else {
			toastStore.error({
				title: get(_)('toast.error_title'),
				description: get(_)('toast.cannot_delete_chart_invalid_id')
			});
		}
	}

	function openModal() {
		if (item.id === undefined) {
			toastStore.error({
				title: get(_)('toast.error_title'),
				description: get(_)('toast.cannot_delete_chart_invalid_id')
			});
			return;
		}
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
					onclick={() => togglePublishChart(item.id!, !!item.is_published)}
					variant="menuItem"
					fullWidth
					justify="start"
					disabled={item.id === undefined}
				>
					{#snippet children()}{item.is_published ? 'Unpublish' : 'Publish'}{/snippet}
				</Button>

				<Button
					onclick={openModal}
					variant="menuItem"
					fullWidth
					justify="start"
					disabled={item.id === undefined}
				>
					{#snippet children()}Delete{/snippet}
				</Button>
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
