<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { DotsVerticalOutline } from 'flowbite-svelte-icons';
	import ImageAudio from './ImageAudio.svelte';
	import { popup } from '@skeletonlabs/skeleton';
	import type { Tables } from '@/types/supabase.types';

	interface DtxFile {
		level: number | string;
	}

	export let item: Tables<'simfiles'>;
	export let isBlog: boolean;
	export let togglePublishChart: (id: number, published: boolean) => Promise<void>;
	export let openDeleteModal: (
		id: number,
		preview_url?: string,
		sound_preview_url?: string
	) => void;
	export let getPreviewUrl: (preview_url: string) => string;
	export let getSoundPreviewUrl: (sound_preview_url: string | null) => string | null;
	export let formatLevelDisplay: (dtx_files: { level: number | string }[]) => string;
</script>

<div
	class="relative flex min-h-[200px] flex-col justify-between rounded-lg border bg-white p-6 shadow-md"
>
	<div class="mb-2 flex items-center justify-between">
		<h2 class="text-2xl font-bold">{item.display_id}. {item.title}</h2>
		{#if !isBlog}
			<div class="relative">
				<button
					class="text-gray-500 hover:text-gray-700 focus:outline-none"
					use:popup={{
						event: 'click',
						target: 'popupFeatured-' + item.id,
						placement: 'bottom'
					}}
				>
					<DotsVerticalOutline size="xl" />
				</button>

				<div
					class="z-10 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5"
					data-popup="popupFeatured-{item.id}"
				>
					<div
						class="py-1"
						role="menu"
						aria-orientation="vertical"
						aria-labelledby="options-menu"
					>
						<a
							href={`/app/chart/${item.id}`}
							class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
							role="menuitem"
						>
							Edit
						</a>

						<button
							on:click={() => togglePublishChart(item.id, item.is_published)}
							class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
							role="menuitem"
						>
							{item.is_published ? 'Unpublish' : 'Publish'}
						</button>

						<button
							on:click={() =>
								openDeleteModal(item.id, item.preview_url, item.sound_preview_url)}
							class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
							role="menuitem"
						>
							Delete
						</button>
					</div>
				</div>
			</div>
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
		{$_('blog.level')}: {formatLevelDisplay((item as { dtx_files: DtxFile[] }).dtx_files)}
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
