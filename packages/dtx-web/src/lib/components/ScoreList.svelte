<script lang="ts">
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import { Button } from '@dtx/ui-components';
	import { myScoredSimfiles, type ScoredSimfile } from '$lib/api';
	import ScoreCard from '$lib/components/ScoreCard.svelte';

	interface Props {
		pageSize?: number;
	}
	let { pageSize = 10 }: Props = $props();

	let songs: ScoredSimfile[] = $state([]);
	let currentPage = $state(1);
	let totalCount = $state(0);
	// Derived from totalCount so it can't drift out of sync with the latest
	// fetch result. Recomputes reactively when totalCount changes.
	const totalPages = $derived(Math.max(1, Math.ceil(totalCount / pageSize)));
	let loading = $state(true);
	let loadError = $state(false);
	// Monotonically increasing request ID: only the latest page load's response
	// is applied, so rapid page changes can't overwrite the current page or hide
	// the loading state prematurely.
	let loadRequestId = 0;

	const loadScores = async (): Promise<void> => {
		const requestId = ++loadRequestId;
		loading = true;
		loadError = false;
		try {
			const result = await myScoredSimfiles({ page: currentPage, pageSize });
			if (requestId !== loadRequestId) return;
			songs = result.data;
			totalCount = result.count;
			// Stale-page guard: if scores were deleted and the current page now
			// exceeds the total page count, clamp to the last valid page and
			// reload instead of leaving the user stranded on an empty page with
			// no pagination control (the Pagination component only renders when
			// totalPages > 1, so a high empty page has no way back without this).
			const fetchedTotalPages = Math.max(1, Math.ceil(result.count / pageSize));
			if (currentPage > fetchedTotalPages) {
				currentPage = fetchedTotalPages;
				await loadScores();
				return;
			}
		} catch (error) {
			if (requestId !== loadRequestId) return;
			console.error('Failed to load scores:', error);
			loadError = true;
		} finally {
			if (requestId === loadRequestId) {
				loading = false;
			}
		}
	};

	const handlePageChange = (event: { page: number }): void => {
		currentPage = event.page;
		loadScores();
	};

	onMount(loadScores);
</script>

{#if loadError && songs.length > 0}
	<!-- Non-blocking error banner: a page-change network blip shows the error
	     without hiding the existing list (mirrors the loading branch pattern
	     which only shows the full spinner on initial load). The list renders
	     below via the {:else} branch of the second if-block. -->
	<div class="music-card mb-4 flex items-center justify-between p-4">
		<p class="text-sm text-slate-300">{$_('score.load_error')}</p>
		<Button onclick={loadScores} variant="primary"
			>{#snippet children()}{$_('score.retry')}{/snippet}</Button
		>
	</div>
{/if}
{#if loadError && songs.length === 0}
	<div class="music-card p-8 text-center">
		<p class="mb-4 text-slate-300">{$_('score.load_error')}</p>
		<Button onclick={loadScores} variant="primary"
			>{#snippet children()}{$_('score.retry')}{/snippet}</Button
		>
	</div>
{:else if loading && songs.length === 0}
	<!-- Initial load only: a full-page spinner. During a page-change load the
	     list below stays visible (showing the previous page) instead of
	     flashing to a loading state, so paging feels continuous. -->
	<div class="flex items-center justify-center py-12">
		<p class="font-medium text-slate-300">{$_('score.loading')}</p>
	</div>
{:else if songs.length === 0}
	<div class="music-card p-8 text-center">
		<p class="mb-2 font-medium text-slate-200">{$_('score.no_scores')}</p>
		<p class="text-sm text-slate-400">
			{$_('score.no_scores_hint')}
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
