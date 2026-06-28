<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { _ } from 'svelte-i18n';
	import {
		SimFile,
		buildNotationChart,
		PreviewAudioEngine,
		type NotationChart,
		type ChartTiming
	} from '@dtx/common';
	import type { DTXFile } from '@dtx/common';
	import { getSimfile } from '$lib/api';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import NotationView from '$lib/components/preview/NotationView.svelte';
	import PreviewTransport from '$lib/components/preview/PreviewTransport.svelte';
	import toastStore from '$lib/toaster';

	type Status = 'loading' | 'error' | 'ready';

	let status = $state<Status>('loading');
	let title = $state('');
	let artist = $state('');
	let chart = $state<NotationChart | null>(null);
	let levels = $state<{ level: number; label: string }[]>([]);
	let selectedLevel = $state<number | null>(null);
	let simFile: SimFile | null = null;
	let audioReady = $state(false);
	let playing = $state(false);
	let engine: PreviewAudioEngine | null = null;
	let currentId = '';
	// Bumped on every (re)load so a superseded async load (rapid level switch)
	// cannot write state for an engine that is no longer current.
	let loadGeneration = 0;
	let timing = $state<ChartTiming | null>(null);
	let cursorMeasure = $state(0);
	let cursorFraction = $state(0);
	let currentSeconds = $state(0);
	let totalSeconds = $derived(timing?.totalDuration ?? 0);
	let rafId = 0;
	let wallClockStart = 0;

	const loadAudioForLevel = async (level: number | null) => {
		if (!simFile) return;
		const generation = ++loadGeneration;
		audioReady = false;
		playing = false;
		engine?.dispose();
		const localEngine = new PreviewAudioEngine();
		engine = localEngine;
		const dtx: DTXFile =
			(level ? simFile.getLevel(level) : simFile.getHighestLevel()) ??
			simFile.getHighestLevel();
		const built = buildNotationChart(dtx);
		const soundChips = dtx.parseSoundChips();
		try {
			const result = await localEngine.load({
				simfileID: currentId,
				bucketUrl: PUBLIC_SIMFILE_BUCKET_URL,
				soundChips,
				notesByLane: built.notesByLane,
				timing: built.timing
			});
			// A newer level switch superseded this load; drop its results.
			if (generation !== loadGeneration) return;
			localEngine.onEnded = () => {
				playing = false;
				cancelAnimationFrame(rafId);
			};
			if (result.failedFiles.length) {
				toastStore.error({ title: $_('preview.audio_partial'), duration: 4000 });
			}
			audioReady = true;
		} catch {
			if (generation !== loadGeneration) return;
			// Total audio failure: drop the engine so playback falls back to the
			// visual-only wall clock; keep the notation usable.
			localEngine.dispose();
			engine = null;
			toastStore.error({ title: $_('preview.audio_partial'), duration: 4000 });
			audioReady = true;
		}
	};

	const tickCursor = () => {
		if (!timing) return;
		const t =
			engine && audioReady ? engine.currentTime : (performance.now() - wallClockStart) / 1000;
		currentSeconds = t;
		const pos = timing.timeToPosition(t);
		cursorMeasure = pos.measure;
		cursorFraction = pos.fraction;
		if (t >= timing.totalDuration) {
			playing = false;
			return;
		}
		if (playing) rafId = requestAnimationFrame(tickCursor);
	};

	const handleSeek = (pos: { measure: number; fraction: number }) => {
		if (!timing) return;
		const seconds = timing.positionToTime(pos.measure, pos.fraction);
		cursorMeasure = pos.measure;
		cursorFraction = pos.fraction;
		// Keep the transport display in sync with the seek; otherwise it keeps
		// showing the pre-seek time until the next animation frame.
		currentSeconds = seconds;
		if (engine && audioReady) engine.seek(seconds);
		else wallClockStart = performance.now() - seconds * 1000;
	};

	const handleToggle = () => {
		if (playing) {
			engine?.pause();
			playing = false;
			cancelAnimationFrame(rafId);
			return;
		}
		playing = true;
		if (engine && audioReady) {
			engine.play(engine.currentTime);
		} else {
			// Audio unavailable: visual-only playback from the current cursor position.
			const startSeconds = timing ? timing.positionToTime(cursorMeasure, cursorFraction) : 0;
			wallClockStart = performance.now() - startSeconds * 1000;
		}
		rafId = requestAnimationFrame(tickCursor);
	};

	const handleWindowKeydown = (event: KeyboardEvent) => {
		if (event.key !== ' ' && event.code !== 'Space') return;
		if (status !== 'ready') return;
		// Match the disabled transport button: ignore the shortcut until audio is
		// ready so playback can't start on the wall clock during engine.load().
		if (!audioReady) return;
		// Let form controls and buttons keep their native space behavior.
		const tag = (event.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
		event.preventDefault();
		handleToggle();
	};

	onDestroy(() => {
		// onDestroy also runs during SSR teardown, where browser-only rAF APIs do
		// not exist (Cloudflare Worker). Nothing is scheduled/created server-side.
		if (!browser) return;
		cancelAnimationFrame(rafId);
		engine?.dispose();
	});

	const buildForLevel = (level: number | null) => {
		if (!simFile) return;
		const dtx: DTXFile =
			(level ? simFile.getLevel(level) : simFile.getHighestLevel()) ??
			simFile.getHighestLevel();
		const built = buildNotationChart(dtx);
		chart = built.chart;
		timing = built.timing;
		// Re-initialize cursor/time so the transport display and notation cursor
		// don't carry a stale position (possibly past the new chart's end) into the
		// freshly rebuilt chart.
		cursorMeasure = 0;
		cursorFraction = 0;
		currentSeconds = 0;
	};

	const load = async () => {
		// Re-entry cleanup for in-app navigation between /preview/[id] routes:
		// SvelteKit reuses this component across id changes, so drop the previous
		// chart's engine + animation loop before loading the new one.
		cancelAnimationFrame(rafId);
		engine?.dispose();
		engine = null;
		audioReady = false;
		playing = false;
		status = 'loading';
		title = '';
		artist = '';
		chart = null;
		levels = [];
		selectedLevel = null;
		simFile = null;
		cursorMeasure = 0;
		cursorFraction = 0;
		currentSeconds = 0;

		const id = $page.params.id;
		if (!id) {
			status = 'error';
			return;
		}
		try {
			const meta = await getSimfile(id);
			// A newer navigation superseded this load; drop its results.
			if (id !== $page.params.id) return;
			title = meta.title;
			artist = meta.artist;
			levels = (meta.dtx_files ?? [])
				.map((f) => ({ level: f.level, label: f.label }))
				.sort((a, b) => b.level - a.level);

			simFile = await SimFile.parseFromRemoteURL(id, PUBLIC_SIMFILE_BUCKET_URL);
			if (id !== $page.params.id) return;
			currentId = id;
			selectedLevel = levels.length ? levels[0].level : null;
			buildForLevel(selectedLevel);
			status = 'ready';
			void loadAudioForLevel(selectedLevel);
		} catch {
			status = 'error';
		}
	};

	const handleLevelChange = (event: Event) => {
		const value = Number((event.target as HTMLSelectElement).value);
		selectedLevel = value;
		buildForLevel(value);
		void loadAudioForLevel(value);
	};

	// React to the route id itself. SvelteKit reuses this component across
	// /preview/[id] navigations, so onMount alone would leave the previous song's
	// title/chart/audio in place; this effect re-runs load() on every id change
	// (and once on mount).
	$effect(() => {
		void $page.params.id;
		void load();
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="mx-auto max-w-5xl p-4">
	{#if status === 'error'}
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
		<div class="mb-3">
			<PreviewTransport
				{playing}
				{audioReady}
				onToggle={handleToggle}
				currentTime={currentSeconds}
				duration={totalSeconds}
			/>
		</div>
		<NotationView {chart} {cursorMeasure} {cursorFraction} {playing} onSeek={handleSeek} />
	{/if}
</div>
