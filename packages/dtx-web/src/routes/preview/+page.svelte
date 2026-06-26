<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { _ } from 'svelte-i18n';
	import { SimFile, buildNotationChart, type NotationChart } from '@dtx/common';
	import type { DTXFile } from '@dtx/common';
	import { getSimfile } from '$lib/api';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import NotationView from '$lib/components/preview/NotationView.svelte';

	type Status = 'loading' | 'error' | 'no-id' | 'ready';

	let status = $state<Status>('loading');
	let title = $state('');
	let artist = $state('');
	let chart = $state<NotationChart | null>(null);
	let levels = $state<{ level: number; label: string }[]>([]);
	let selectedLevel = $state<number | null>(null);
	let simFile: SimFile | null = null;

	const buildForLevel = (level: number | null) => {
		if (!simFile) return;
		const dtx: DTXFile =
			(level ? simFile.getLevel(level) : simFile.getHighestLevel()) ??
			simFile.getHighestLevel();
		const built = buildNotationChart(dtx);
		chart = built.chart;
	};

	const load = async () => {
		const id = $page.url.searchParams.get('id');
		if (!id) {
			status = 'no-id';
			return;
		}
		try {
			const meta = await getSimfile(id);
			title = meta.title;
			artist = meta.artist;
			levels = (meta.dtx_files ?? [])
				.map((f) => ({ level: f.level, label: f.label }))
				.sort((a, b) => b.level - a.level);

			simFile = await SimFile.parseFromRemoteURL(id, PUBLIC_SIMFILE_BUCKET_URL);
			selectedLevel = levels.length ? levels[0].level : null;
			buildForLevel(selectedLevel);
			status = 'ready';
		} catch {
			status = 'error';
		}
	};

	const handleLevelChange = (event: Event) => {
		const value = Number((event.target as HTMLSelectElement).value);
		selectedLevel = value;
		buildForLevel(value);
	};

	onMount(load);
</script>

<div class="mx-auto max-w-5xl p-4">
	{#if status === 'no-id'}
		<p class="text-center text-lg">{$_('preview.no_id')}</p>
	{:else if status === 'error'}
		<p class="text-center text-lg">{$_('preview.not_available')}</p>
	{:else if status === 'loading'}
		<p class="text-center text-lg">{$_('preview.loading')}</p>
	{:else if status === 'ready' && chart}
		<header class="mb-4 flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-bold">{title}</h1>
				<p class="text-sm opacity-70">{artist}</p>
			</div>
			{#if levels.length > 1}
				<label class="flex items-center gap-2">
					<span>{$_('preview.level')}</span>
					<select
						class="rounded border px-2 py-1"
						value={selectedLevel}
						onchange={handleLevelChange}
					>
						{#each levels as lvl (lvl.level)}
							<option value={lvl.level}>{lvl.label}</option>
						{/each}
					</select>
				</label>
			{/if}
		</header>
		<NotationView {chart} />
	{/if}
</div>
