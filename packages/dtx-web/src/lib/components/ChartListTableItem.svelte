<script lang="ts">
	import type { Tables } from '@dtx/common';
	import { Modal, Popover, Tooltip } from '@skeletonlabs/skeleton-svelte';
	import { formatLevelDisplay } from '$lib/utils';
	import { EllipsisVertical, ExternalLink } from '@lucide/svelte/icons';

	let { item, isBlog, togglePublishChart, onFileDelete } = $props<{
		item: Partial<Tables<'simfiles'>>;
		isBlog: boolean;
		togglePublishChart: (id: number, published: boolean) => Promise<void>;
		onFileDelete: (id: number, preview_url?: string, sound_preview_url?: string) => void;
	}>();

	let popoverOpen = $state(false);
	let openState = $state(false);
	let tooltipOpen = $state(false);

	function modalClose() {
		openState = false;
	}

	// Format the publish date
	function formatDate(dateString: string | undefined | null): string {
		if (!dateString) return 'N/A';
		const date = new Date(dateString);
		return date.toLocaleDateString();
	}
</script>

<tr class="border-b hover:bg-gray-50">
	<td class="px-4 py-3 text-center">{item.display_id || 'N/A'}</td>
	<td class="px-4 py-3">{item.title || 'N/A'}</td>
	<td class="px-4 py-3">{item.artist || 'N/A'}</td>
	<td class="px-4 py-3 text-center">{item.bpm || 'N/A'}</td>
	<td class="px-4 py-3 text-center">{formatDate(item.publish_date)}</td>
	<td class="px-4 py-3 text-center">{formatLevelDisplay(item.dtx_files)}</td>
	<td class="px-4 py-3 text-center">
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

						<Modal
							open={openState}
							onOpenChange={(e) => (openState = e.open)}
							triggerBase="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
							contentBase="card bg-surface-100-900 p-4 space-y-4 shadow-xl max-w-screen-sm"
							backdropClasses="backdrop-blur-sm"
						>
							{#snippet trigger()}Delete{/snippet}
							{#snippet content()}
								<header class="flex justify-between">
									<h4 class="h4">Delete Chart</h4>
								</header>
								<article>
									<p class="opacity-60">
										Are you sure you want to delete this chart?
									</p>
								</article>
								<footer class="flex justify-end gap-4">
									<button
										type="button"
										class="btn preset-tonal"
										onclick={modalClose}>Cancel</button
									>
									<button
										type="button"
										class="btn preset-filled"
										onclick={() => {
											modalClose();
											onFileDelete(
												item.id,
												item.preview_url,
												item.sound_preview_url
											);
										}}>Confirm</button
									>
								</footer>
							{/snippet}
						</Modal>
					</div>
				{/snippet}
			</Popover>
		{:else if item.download_url}
			<a
				href={item.download_url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex items-center justify-center rounded-full bg-blue-100 p-2 text-blue-600 hover:bg-blue-200"
				title="Download Simfile"
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
	</td>
</tr>
