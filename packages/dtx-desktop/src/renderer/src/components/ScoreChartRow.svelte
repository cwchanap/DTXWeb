<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';
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
</script>

<div class="border-hairline rounded-lg border p-3">
	<div class="mb-1 flex items-center gap-2 text-sm">
		<span class="text-hi font-medium">{chart.difficultyLabel || 'DRUMS'}</span>
		<span class="text-faint">Lv {chart.drumLevel / 10}</span>
		<span class="text-dim"
			>· plays {chart.aggregate.playCount} · clears {chart.aggregate.clearCount}</span
		>
		{#if linked}
			{#if matchedId}
				<span class="text-green ml-auto text-xs"> → matched </span>
			{:else}
				<span class="ml-auto inline-flex items-center gap-1 text-xs text-red-300">
					<AlertTriangle size={12} /> Unmatched
				</span>
			{/if}
		{/if}
	</div>

	{#if linked && cloudCharts.length > 0}
		<label class="text-faint mb-2 block text-xs">
			Target chart:
			<select
				class="border-hairline bg-surface-2 text-hi ml-1 rounded px-2 py-1 text-xs"
				value={matchedId ?? ''}
				onchange={(e) =>
					onOverrideMatch(chartIndex, (e.currentTarget as HTMLSelectElement).value)}
			>
				<option value="">— none —</option>
				{#each cloudCharts as cc}
					<option value={cc.id}
						>{cc.label || 'chart'} (Lv {formatCloudLevel(cc.level)})</option
					>
				{/each}
			</select>
		</label>
	{/if}

	{#if chart.best}
		<div class="text-dim text-xs">
			Best: {formatScore(chart.best.score)} ·
			{#if chart.best.rankLabel}{chart.best.rankLabel} ·
			{/if}
			{chart.best.achievementRate != null ? `${chart.best.achievementRate}%` : '—'} ·
			{#if chart.best.maxCombo != null}combo {chart.best.maxCombo}{/if}
			{#if chart.best.fullCombo}· FC{/if}
		</div>
	{:else}
		<div class="text-faint text-xs">No best score recorded.</div>
	{/if}

	{#if chart.recent.length > 0}
		<ul class="text-faint mt-1 text-xs">
			{#each chart.recent as recent (recent.performedAt + '-' + recent.displayOrder)}
				<li>
					<span class:text-green-300={recent.cleared} class:text-red-300={!recent.cleared}
						>{recent.cleared ? 'Cleared' : 'Failed'}</span
					>
					· {recent.rankLabel ?? '—'} · {recent.achievementRate ?? '—'}% · {recent.performedAt}
				</li>
			{/each}
		</ul>
	{/if}
</div>
