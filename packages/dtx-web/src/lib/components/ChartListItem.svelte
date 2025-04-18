<script lang="ts">
	import { _ } from 'svelte-i18n';
	import ImageAudio from './ImageAudio.svelte';
	import type { Tables } from '@/types/supabase.types';
	import { Modal, Popover } from '@skeletonlabs/skeleton-svelte';
	import { formatLevelDisplay } from '$lib/utils';
	import { EllipsisVertical } from '@lucide/svelte/icons';

	let { item, isBlog, togglePublishChart, getPreviewUrl, getSoundPreviewUrl, onFileDelete } =
		$props<{
			item: Partial<Tables<'simfiles'>>;
			isBlog: boolean;
			togglePublishChart: (id: number, published: boolean) => Promise<void>;
			getPreviewUrl: (preview_url: string) => string;
			getSoundPreviewUrl: (sound_preview_url: string | null) => string | null;
			onFileDelete: (id: number, preview_url?: string, sound_preview_url?: string) => void;
		}>();

	let popoverOpen = $state(false);
	let openState = $state(false);

	function modalClose() {
		openState = false;
	}
</script>

<div class="relative flex min-h-[200px] flex-col justify-between rounded-lg border bg-white p-6">
	<div class="mb-2 flex items-center justify-between">
		<h2 class="text-2xl font-bold">{item.display_id}. {item.title}</h2>
		{#if !isBlog}
			<Popover
				open={popoverOpen}
				onOpenChange={(details) => (popoverOpen = details.open)}
				positioning={{ placement: 'bottom-start' }}
				contentBase="w-48 p-0 z-50 rounded-sm border border-gray-300 bg-white shadow-lg"
			>
				{#snippet trigger()}
					<EllipsisVertical />
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
		{/if}
	</div>
	<div>
		<p class="mb-2 text-lg text-gray-600">{item.artist}</p>
		<p class="mb-2 text-lg">BPM: {item.bpm}</p>
	</div>
	{#if item.preview_url}
		<div class="relative">
			<ImageAudio
				previewUrl={getPreviewUrl(item.preview_url)}
				soundPreviewUrl={getSoundPreviewUrl(item.sound_preview_url) ?? undefined}
			/>
		</div>
	{:else}
		<div class="mb-4 flex h-60 w-full items-center justify-center rounded-lg bg-gray-200">
			<span class="text-gray-500">No preview available</span>
		</div>
	{/if}
	<div class="mt-4 text-sm text-gray-600">
		{$_('blog.level')}: {formatLevelDisplay(item.dtx_files)}
	</div>
	{#if isBlog}
		{#if item.download_url}
			<a
				href={item.download_url ?? undefined}
				target="_blank"
				rel="noopener noreferrer"
				class="mt-4 text-blue-500 hover:underline"
			>
				{$_('blog.download')}
			</a>
		{:else}
			<div class="mt-4 text-sm text-gray-600">Download not available</div>
		{/if}
	{/if}
</div>
