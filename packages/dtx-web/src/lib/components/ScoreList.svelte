<script lang="ts">
	import { onMount } from 'svelte';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import { myScoredSimfiles, type ScoredSimfile } from '$lib/api';
	import ScoreCard from './ScoreCard.svelte';

	interface Props {
		pageSize?: number;
	}
	let { pageSize = 10 }: Props = $props();

	let songs: ScoredSimfile[] = $state([]);
	let currentPage = $state(1);
	let totalCount = $state(0);
	let totalPages = $state(1);
	let loading = $state(false);
	let loadError = $state(false);

	const loadScores = async () => {
		loading = true;
		loadError = false;
		try {
			const result = await myScoredSimfiles({ page: currentPage, pageSize });
			songs = result.data;
			totalCount = result.count;
			totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
		} catch (error) {
			console.error('Failed to load scores:', error);
			loadError = true;
		} finally {
			loading = false;
		}
	};

	const handlePageChange = (event: { page: number }) => {
		currentPage = event.page;
		loadScores();
	};

	onMount(loadScores);
</script>

{#if loading}
	<div class="flex items-center justify-center py-12">
		<p class="font-medium text-slate-300">Loading scores…</p>
	</div>
{:else if loadError}
	<div class="music-card p-8 text-center">
		<p class="text-slate-300">Failed to load your scores. Please try again.</p>
	</div>
{:else if songs.length === 0}
	<div class="music-card p-8 text-center">
		<p class="mb-2 font-medium text-slate-200">No scores yet</p>
		<p class="text-sm text-slate-400">
			Import your scores from the DTX desktop app to see them here.
		</p>
	</div>
{:else}
	<div class="space-y-6">
		{#each songs as song (song.id)}
			<ScoreCard {song} />
		{/each}
	</div>
	{#if totalPages > 1}
		<div class="mt-8 flex justify-center">
			<div class="music-card p-4">
				<Pagination
					data={songs}
					count={totalCount}
					page={currentPage}
					{pageSize}
					onPageChange={handlePageChange}
					siblingCount={1}
					showFirstLastButtons={true}
				/>
			</div>
		</div>
	{/if}
{/if}
