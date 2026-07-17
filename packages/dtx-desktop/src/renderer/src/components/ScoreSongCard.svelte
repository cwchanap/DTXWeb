<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import CloudSongAutocomplete from './CloudSongAutocomplete.svelte';
	import ScoreChartRow from './ScoreChartRow.svelte';
	import type { CloudChart } from '../lib/scoreMatching';
	import type { DtxmaniaSong, CloudSong } from '../lib/scoreTypes';

	interface Props {
		song: DtxmaniaSong;
		link: CloudSong | undefined;
		cloudCharts: CloudChart[];
		matches: (string | null)[];
		expanded: boolean;
		autocompleteOpen: boolean;
		onToggle: () => void;
		onLinkSelect: (song: CloudSong) => void;
		onOverrideMatch: (chartIndex: number, cloudChartId: string) => void;
		onAutocompleteToggle: () => void;
		onAutocompleteClose: () => void;
	}

	let {
		song,
		link,
		cloudCharts,
		matches,
		expanded,
		autocompleteOpen,
		onToggle,
		onLinkSelect,
		onOverrideMatch,
		onAutocompleteToggle,
		onAutocompleteClose
	}: Props = $props();
</script>

<div class="border-hairline bg-surface-1 rounded-xl border p-4">
	<div class="mb-2 flex items-center gap-3">
		<button
			type="button"
			class="hover:text-hi flex min-w-0 flex-1 items-center gap-2 text-left"
			onclick={onToggle}
			aria-expanded={expanded}
			aria-label={$_('score.link.toggle', { values: { title: song.title } })}
		>
			{#if expanded}
				<ChevronDown size={16} class="text-faint shrink-0" />
			{:else}
				<ChevronRight size={16} class="text-faint shrink-0" />
			{/if}
			<span class="min-w-0">
				<span class="text-hi block truncate font-medium">{song.title}</span>
				<span class="text-dim block truncate text-sm">{song.artist}</span>
			</span>
		</button>
		<div class="relative ml-auto" data-cloud-song-autocomplete-trigger>
			{#if link}
				<span class="text-cyan text-sm"
					>{$_('score.link.linked', { values: { title: link.title } })}</span
				>
				<button
					class="text-faint hover:text-hi ml-2 text-xs underline"
					onclick={onAutocompleteToggle}>{$_('score.link.change')}</button
				>
			{:else}
				<button
					class="border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20 rounded-lg border px-3 py-1.5 text-sm"
					onclick={onAutocompleteToggle}
					aria-label={$_('score.link.to_cloud')}
				>
					{$_('score.link.to_cloud')}
				</button>
			{/if}
			<CloudSongAutocomplete
				isOpen={autocompleteOpen}
				onclose={onAutocompleteClose}
				onselect={onLinkSelect}
			/>
		</div>
	</div>

	{#if expanded}
		<div class="flex flex-col gap-2">
			{#each song.charts as chart, chartIndex (chart.fileHash + chartIndex)}
				<ScoreChartRow
					{chart}
					{chartIndex}
					matchedId={matches[chartIndex] ?? null}
					{cloudCharts}
					linked={!!link}
					{onOverrideMatch}
				/>
			{/each}
		</div>
	{/if}
</div>
