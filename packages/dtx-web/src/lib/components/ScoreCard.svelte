<script lang="ts">
	import { _, locale } from 'svelte-i18n';
	import type { ScoredSimfile } from '$lib/api/score';

	interface Props {
		song: ScoredSimfile;
	}
	let { song }: Props = $props();

	// svelte-i18n uses 'jp' for Japanese, but Intl expects the BCP 47 tag 'ja'.
	// Map the active svelte-i18n locale to a valid Intl locale so number/date
	// formatting follows the UI language instead of the browser default.
	const intlLocale = (): string => ($locale === 'jp' ? 'ja' : ($locale ?? 'en'));

	const formatScore = (score: number | null): string =>
		score == null ? '—' : score.toLocaleString(intlLocale());
	const formatRate = (rate: number | null): string =>
		rate == null
			? '—'
			: `${rate.toLocaleString(intlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
	const formatDate = (iso: string | null): string =>
		iso ? new Date(iso).toLocaleDateString(intlLocale()) : '—';
</script>

<div class="music-card p-6">
	<div class="mb-4">
		<h2 class="text-xl font-semibold text-slate-100">{song.title}</h2>
		<p class="text-sm text-purple-300">{song.artist}</p>
	</div>

	<div class="space-y-4">
		{#each song.charts as chart (chart.id)}
			<div class="rounded-lg border border-purple-500/20 bg-slate-800/40 p-4">
				<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
					<span
						class="rounded-full border border-purple-500/30 bg-purple-600/20 px-2 py-1 text-xs font-medium text-purple-200"
					>
						{chart.label} · {$_('score.level_short')}
						{chart.level}
					</span>
					{#if chart.chartScore}
						<span class="text-xs text-slate-400">
							{$_('score.plays')}
							{chart.chartScore.playCount} · {$_('score.clears')}
							{chart.chartScore.clearCount}
						</span>
					{/if}
				</div>

				{#if chart.chartScore?.best}
					{@const best = chart.chartScore.best}
					<div class="flex flex-wrap items-center gap-3 text-sm">
						<span class="font-semibold text-slate-100">{formatScore(best.score)}</span>
						<span class="text-cyan-300">{formatRate(best.achievementRate)}</span>
						{#if best.rankLabel}
							<span
								class="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300"
							>
								{best.rankLabel}
							</span>
						{/if}
						{#if best.fullCombo}
							<span
								class="rounded bg-green-500/20 px-2 py-0.5 text-xs font-bold text-green-300"
							>
								FC
							</span>
						{/if}
						{#if best.maxCombo != null}
							<span class="text-slate-400"
								>{$_('score.max_combo')} {best.maxCombo}</span
							>
						{/if}
					</div>
					{#if best.perfect != null || best.great != null || best.good != null || best.poor != null || best.miss != null}
						<div class="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
							<span>{$_('score.perfect')} {best.perfect ?? '—'}</span>
							<span>{$_('score.great')} {best.great ?? '—'}</span>
							<span>{$_('score.good')} {best.good ?? '—'}</span>
							<span>{$_('score.poor')} {best.poor ?? '—'}</span>
							<span>{$_('score.miss')} {best.miss ?? '—'}</span>
						</div>
					{/if}
				{:else if chart.chartScore}
					<!-- A score record exists but no best row (e.g. only recent
					     plays, no best yet). Show the placeholder only here —
					     never-played charts (chartScore null) render nothing in
					     this block so a song with several unplayed charts does
					     not repeat "No best score" once per chart. -->
					<p class="text-xs text-slate-500">{$_('score.no_best_score')}</p>
				{/if}

				{#if chart.chartScore && chart.chartScore.recent.length > 0}
					<div class="mt-3 border-t border-slate-700/50 pt-2">
						<p class="mb-1 text-xs font-medium text-slate-400">{$_('score.recent')}</p>
						<ul class="space-y-1">
							{#each chart.chartScore.recent.slice(0, 5) as recent (recent.id)}
								<li
									class="flex flex-wrap items-center gap-2 text-xs text-slate-300"
								>
									<span class="text-slate-500"
										>{formatDate(recent.performedAt)}</span
									>
									<span
										class:text-green-300={recent.cleared}
										class:text-red-300={!recent.cleared}
									>
										{recent.cleared ? $_('score.cleared') : $_('score.failed')}
									</span>
									{#if recent.rankLabel}
										<span class="text-amber-300">{recent.rankLabel}</span>
									{/if}
									<span class="text-cyan-300"
										>{formatRate(recent.achievementRate)}</span
									>
									{#if recent.score != null}
										<span class="text-slate-400"
											>{formatScore(recent.score)}</span
										>
									{/if}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
