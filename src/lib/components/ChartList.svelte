<script lang="ts">
	import { onMount } from 'svelte';
	import { PREVIEW_BUCKET_NAME, SOUND_PREVIEW_BUCKET_NAME } from '@/constant';
	import { _ } from 'svelte-i18n';
	import toastStore from '@/lib/toaster';
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import ChartListItem from './ChartListItem.svelte';
	import ChartListTableItem from './ChartListTableItem.svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import IconX from '@lucide/svelte/icons/x';
	import IconCheck from '@lucide/svelte/icons/check';
	import IconTable from '@lucide/svelte/icons/table';
	import IconGrid from '@lucide/svelte/icons/grid';

	interface Props {
		pageSize?: number;
		isBlog?: boolean;
		supabase: SupabaseClient;
	}

	interface DtxFile {
		level: number | string;
	}

	interface SimfileWithDtx {
		id: number;
		title: string;
		artist: string;
		bpm: number;
		preview_url: string | null;
		sound_preview_url: string | null;
		download_url: string | null;
		is_published: boolean;
		display_id: number | null;
		created_at?: string;
		publish_date?: string;
		updated_at?: string;
		user_id?: string;
		video_preview_url?: string | null;
		dtx_files?: Partial<DtxFile>[];
	}

	let { supabase, pageSize = 12, isBlog = false }: Props = $props();

	let items: SimfileWithDtx[] = $state([]);
	let currentPage = $state(1);
	let totalPages = $state(1);
	let loading = $state(false);
	let artistFilter: string = $state('');
	let songNameFilter: string = $state('');
	let searchTimeout: NodeJS.Timeout;
	let hideUnpublished = $state(false);
	let filteredItems = $state<SimfileWithDtx[]>([]);
	let viewMode = $state<'card' | 'table'>('card');

	// Replace the run() function with a reactive effect using $effect
	$effect(() => {
		filteredItems = hideUnpublished ? items.filter((item) => item.is_published) : items;
	});

	async function togglePublishChart(id: number, published: boolean) {
		const { error } = await supabase
			.from('simfiles')
			.update({ is_published: !published })
			.eq('id', id);

		if (error) {
			toastStore.error({
				title: `Failed to ${published ? 'unpublish' : 'publish'} chart`,
				duration: 3000
			});
		} else {
			toastStore.success({
				title: `Chart ${published ? 'unpublished' : 'published'}`,
				duration: 3000
			});
		}
	}

	async function loadItems() {
		loading = true;
		try {
			let query = supabase
				.from('simfiles')
				.select(
					`id, title, artist, bpm, preview_url, sound_preview_url, download_url, is_published, display_id, dtx_files(level)`,
					{ count: 'exact' }
				)
				.order('publish_date', { ascending: false })
				.ilike('artist', `%${artistFilter}%`)
				.ilike('title', `%${songNameFilter}%`)
				.range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

			if (!isBlog) {
				const {
					data: { user }
				} = await supabase.auth.getUser();
				if (!user) return;
				query = query.eq('user_id', user.id);
			} else {
				query = query.eq('is_published', true);
			}

			const { data, error, count } = await query;

			if (error) {
				console.error('Failed to load items:', error);
				return;
			}
			items = data || [];
			totalPages = Math.ceil((count || 0) / pageSize);
		} catch (error) {
			console.error('Failed to load items:', error);
		} finally {
			loading = false;
		}
	}

	function changePage(newPage: number) {
		if (newPage >= 1 && newPage <= totalPages) {
			currentPage = newPage;
			loadItems();
		}
	}

	function getPreviewUrl(preview_url: string) {
		return supabase.storage.from(PREVIEW_BUCKET_NAME).getPublicUrl(`${preview_url}`).data
			.publicUrl;
	}

	function getSoundPreviewUrl(sound_preview_url: string | null) {
		if (!sound_preview_url) return null;
		return supabase.storage.from(SOUND_PREVIEW_BUCKET_NAME).getPublicUrl(`${sound_preview_url}`)
			.data.publicUrl;
	}

	function handleSearchInput() {
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			currentPage = 1;
			loadItems();
		}, 500);
	}

	async function onFileDelete(id: number, preview_url?: string, sound_preview_url?: string) {
		if (preview_url) {
			const { error: deletePreviewError } = await supabase.storage
				.from(PREVIEW_BUCKET_NAME)
				.remove([preview_url]);
			if (deletePreviewError) {
				toastStore.error({
					title: 'Failed to delete preview',
					duration: 3000
				});
			}
		}
		if (sound_preview_url) {
			const { error: deleteSoundPreviewError } = await supabase.storage
				.from(SOUND_PREVIEW_BUCKET_NAME)
				.remove([sound_preview_url]);
			if (deleteSoundPreviewError) {
				toastStore.error({
					title: 'Failed to delete sound preview',
					duration: 3000
				});
			}
		}
		const { error } = await supabase.from('simfiles').delete().eq('id', id);
		if (error) {
			toastStore.error({
				title: 'Failed to delete chart',
				duration: 3000
			});
		} else {
			toastStore.success({
				title: 'Chart deleted',
				duration: 3000
			});
			filteredItems = filteredItems.filter((item) => item.id !== id);
		}
		loadItems();
	}

	onMount(() => {
		loadItems();
	});
</script>

<input
	type="text"
	placeholder={$_('blog.search_artist')}
	bind:value={artistFilter}
	class="mb-4 w-1/2 rounded-sm border p-2"
	oninput={handleSearchInput}
/>
<input
	type="text"
	placeholder={$_('blog.search_song_name')}
	bind:value={songNameFilter}
	class="mb-4 w-1/2 rounded-sm border p-2"
	oninput={handleSearchInput}
/>
<div class="mb-4 flex items-center justify-between">
	<div class="flex items-center">
		{#if !isBlog}
			<div class="mr-6 flex items-center">
				<label for="is_published" class="mr-2 mb-2 block">Hide unpublished:</label>
				<Switch
					checked={hideUnpublished}
					onCheckedChange={(e) => (hideUnpublished = e.checked)}
				>
					{#snippet inactiveChild()}<IconX size="14" />{/snippet}
					{#snippet activeChild()}<IconCheck size="14" />{/snippet}
				</Switch>
			</div>
		{/if}
	</div>
	<div class="flex items-center">
		<span class="mr-2">View:</span>
		<div class="flex rounded border">
			<button
				class="flex items-center justify-center p-2 {viewMode === 'card'
					? 'bg-blue-100'
					: 'hover:bg-gray-100'}"
				onclick={() => (viewMode = 'card')}
			>
				<IconGrid size="18" />
			</button>
			<button
				class="flex items-center justify-center p-2 {viewMode === 'table'
					? 'bg-blue-100'
					: 'hover:bg-gray-100'}"
				onclick={() => (viewMode = 'table')}
			>
				<IconTable size="18" />
			</button>
		</div>
	</div>
</div>
{#if loading}
	<div class="mt-4 text-center">
		<p>Loading more items...</p>
	</div>
{:else}
	{#if viewMode === 'card'}
		<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{#each filteredItems as item (item.id)}
				<ChartListItem
					{item}
					{isBlog}
					{togglePublishChart}
					{onFileDelete}
					{getPreviewUrl}
					{getSoundPreviewUrl}
				/>
			{/each}
		</div>
	{:else}
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full table-auto">
				<thead class="bg-gray-50 text-xs text-gray-700 uppercase">
					<tr>
						<th class="px-4 py-3 text-center">ID</th>
						<th class="px-4 py-3">Title</th>
						<th class="px-4 py-3">Artist</th>
						<th class="px-4 py-3 text-center">BPM</th>
						<th class="px-4 py-3 text-center">Publish Date</th>
						<th class="px-4 py-3 text-center">
							Level
							<div class="text-[10px] font-normal text-gray-500 normal-case">
								bas/adv/ext/mas/other
							</div>
						</th>
						<th class="px-4 py-3 text-center">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredItems as item (item.id)}
						<ChartListTableItem {item} {isBlog} {togglePublishChart} {onFileDelete} />
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<!-- Pagination controls -->

	<div class="mt-6 flex justify-center">
		<button
			class="mr-2 rounded-sm bg-blue-500 px-4 py-2 text-white"
			onclick={() => changePage(currentPage - 1)}
			disabled={currentPage === 1}>{$_('blog.pagination.previous')}</button
		>
		<span class="mx-4 self-center">
			{$_('blog.pagination.page', { values: { currentPage, totalPages } })}
		</span>
		<button
			class="ml-2 rounded-sm bg-blue-500 px-4 py-2 text-white"
			onclick={() => changePage(currentPage + 1)}
			disabled={currentPage === totalPages}>{$_('blog.pagination.next')}</button
		>
		<input
			type="number"
			min="1"
			max={totalPages}
			bind:value={currentPage}
			class="mx-2 w-16 rounded-sm border p-1"
			onchange={() => changePage(currentPage)}
		/>
	</div>
{/if}
