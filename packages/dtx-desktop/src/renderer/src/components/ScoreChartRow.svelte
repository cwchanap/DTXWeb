<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { AlertTriangle } from '@lucide/svelte';
	import { normalizeLevel } from '@dtx/common';
	import type { LocalChartData } from '../lib/scoreTypes';
	import { formatCloudLevel, type CloudChart } from '../lib/scoreMatching';

	interface Props {
		chart: LocalChartData;
		chartIndex: number;
		matchedId: string | null;
		cloudCharts: CloudChart[];
		linked: boolean;
		onOverrideMatch: (chartIndex: number, cloudChartId: string) => void;
	}

	let { chart, chartIndex, matchedId, cloudCharts, linked, onOverrideMatch }: Props = $props();

	const formatScore = (value: number | null): string =>
		value === null ? '—' : value.toLocaleString('en-US');

	// Keep the best-score summary limited to the numeric best row. Chart-level
	// rate, rank, combo, and full-combo records render separately below.
	const bestParts = (best: NonNullable<LocalChartData['best']>): string[] => {
		return [`${$_('score.best')}: ${formatScore(best.score)}`];
	};
</script>

<div class="border-hairline rounded-lg border p-3">
	<div class="mb-1 flex items-center gap-2 text-sm">
		<span class="text-hi font-medium"
			>{chart.difficultyLabel || $_('score.drums_fallback')}</span
		>
		<span class="text-faint"
			>{$_('score.level_value', {
				values: { value: normalizeLevel(chart.drumLevel, chart.drumLevelDec) }
			})}</span
		>
		<span class="text-dim"
			>{$_('score.plays_clears', {
				values: { plays: chart.aggregate.playCount, clears: chart.aggregate.clearCount }
			})}</span
		>
		{#if linked}
			{#if matchedId}
				<span class="text-green ml-auto text-xs"> {$_('score.matched')} </span>
			{:else}
				<span class="ml-auto inline-flex items-center gap-1 text-xs text-red-300">
					<AlertTriangle size={12} />
					{$_('score.unmatched')}
				</span>
			{/if}
		{/if}
	</div>

	{#if linked && cloudCharts.length > 0}
		<label class="text-faint mb-2 block text-xs">
			{$_('score.target_chart')}
			<select
				class="border-hairline bg-surface-2 text-hi ml-1 rounded px-2 py-1 text-xs"
				value={matchedId ?? ''}
				onchange={(e) =>
					onOverrideMatch(chartIndex, (e.currentTarget as HTMLSelectElement).value)}
			>
				<option value="">{$_('score.none')}</option>
				{#each cloudCharts as cc}
					<option value={cc.id}
						>{cc.label || $_('score.chart_fallback')} ({$_('score.level_short')}
						{formatCloudLevel(cc.level)})</option
					>
				{/each}
			</select>
		</label>
	{/if}

	{#if chart.best}
		<div class="text-dim text-xs">
			{bestParts(chart.best).join(' · ')}
		</div>
	{:else}
		<div class="text-faint text-xs">{$_('score.no_best_score')}</div>
	{/if}

	<div class="text-dim flex items-center gap-2 text-xs">
		{#if chart.aggregate.bestRankLabel}
			<span class="text-amber-300">{chart.aggregate.bestRankLabel}</span>
		{/if}
		{#if chart.aggregate.bestAchievementRate != null}
			<span class="text-cyan">{chart.aggregate.bestAchievementRate}%</span>
		{/if}
		<span class="text-dim">{$_('score.combo')} {chart.aggregate.maxCombo}</span>
		{#if chart.aggregate.fullCombo}
			<span class="text-green">{$_('score.full_combo')}</span>
		{/if}
	</div>

	{#if chart.recent.length > 0}
		<ul class="text-faint mt-1 text-xs">
			{#each chart.recent as recent (recent.performedAt + '-' + recent.displayOrder)}
				<li>
					{#if recent.cleared === true}
						<span class="text-green-300">{$_('score.cleared')}</span>
					{:else if recent.cleared === false}
						<span class="text-red-300">{$_('score.failed')}</span>
					{:else}
						<span class="text-faint">—</span>
					{/if}
					· {recent.rankLabel ?? '—'} · {recent.achievementRate ?? '—'}% · {recent.performedAt}
				</li>
			{/each}
		</ul>
	{/if}
</div>
