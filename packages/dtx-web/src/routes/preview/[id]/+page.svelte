<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { _ } from 'svelte-i18n';
	import { SimFile, buildNotationChart, type NotationChart, type ChartTiming } from '@dtx/common';
	import type { DTXFile } from '@dtx/common';
	import { PreviewAudioEngine } from '@dtx/common/audio';
	import { getPreviewSimfile, type PreviewLevel } from '$lib/api';
	import { PUBLIC_SIMFILE_BUCKET_URL } from '$env/static/public';
	import NotationView from '$lib/components/preview/NotationView.svelte';
	import PreviewTransport from '$lib/components/preview/PreviewTransport.svelte';
	import toastStore from '$lib/toaster';

	type Status = 'loading' | 'error' | 'ready';

	let status = $state<Status>('loading');
	let title = $state('');
	let artist = $state('');
	let chart = $state<NotationChart | null>(null);
	let levels = $state<PreviewLevel[]>([]);
	// Selection state holds the chosen chart's fileUrl, NOT its numeric
	// `level`: the API documents (label, level) as non-unique (duplicate
	// dtx_files rows can share the same level), so keying the dropdown and
	// lookup by level collapses duplicate-level charts into one selectable
	// entry. fileUrl is the unique per-row identifier.
	let selectedFileUrl = $state<string | null>(null);
	let audioReady = $state(false);
	let playing = $state(false);
	let engine: PreviewAudioEngine | null = null;
	let currentId = '';
	// Bumped on every (re)load so a superseded async load (rapid level switch)
	// cannot write state for an engine that is no longer current.
	let loadGeneration = 0;
	// Bumped on every handleLevelChange so a stale switch (superseded by a
	// newer switch before its DTX fetch returned) cannot commit its chart/audio
	// or revert the dropdown. loadGeneration is only bumped on successful commit
	// (line ~331), so two rapid switches share the same priorGeneration — this
	// token is the per-switch guard that distinguishes them.
	let switchToken = 0;
	// The fileUrl of the chart currently committed to the notation area +
	// engine — i.e. the last level whose DTX fetch succeeded and whose chart
	// was built via buildForLevel. Updated on successful initial load and on
	// successful level-switch commit. Used to revert the dropdown when a
	// pending switch's DTX fetch fails, so we snap back to the still-rendered
	// chart rather than a transient pending selection (e.g. when the user
	// rapid-switches A→B→C and C fails: prev would be B, not A).
	let committedFileUrl = $state<string | null>(null);
	// The audioReady state of the committed chart's engine. Mirrored from
	// audioReady inside loadAudioForLevel only when the live load's generation
	// is current (which implies it belongs to the committed level), so a failed
	// switch can restore the transport to the committed engine's actual
	// readiness instead of the stale value captured at switch start.
	let committedAudioReady = false;
	let timing = $state<ChartTiming | null>(null);
	let cursorMeasure = $state(0);
	let cursorFraction = $state(0);
	let currentSeconds = $state(0);
	let totalSeconds = $derived(timing?.totalDuration ?? 0);
	let rafId = 0;
	let wallClockStart = 0;

	const loadAudioForLevel = async (
		dtx: DTXFile,
		built: ReturnType<typeof buildNotationChart>,
		generation: number,
		chartFileUrl: string
	) => {
		audioReady = false;
		playing = false;
		engine?.dispose();
		const localEngine = new PreviewAudioEngine();
		engine = localEngine;
		try {
			// Parse sound chips inside the guarded path so a malformed #WAV line
			// that parseSoundChips() cannot handle degrades to the visual-only
			// fallback below instead of throwing synchronously before the try
			// block. loadAudioForLevel is invoked fire-and-forget (void ...), so
			// an unguarded throw would be an unhandled rejection and audioReady
			// would stay false, leaving the transport stuck on "Loading audio".
			const soundChips = dtx.parseSoundChips();
			const result = await localEngine.load({
				simfileID: currentId,
				bucketUrl: PUBLIC_SIMFILE_BUCKET_URL,
				chartFileUrl,
				soundChips,
				notesByLane: built.notesByLane,
				timing: built.timing
			});
			// A newer level switch superseded this load; drop its results.
			// Dispose explicitly so this bail path is self-contained even if a
			// future refactor decouples `engine` from `localEngine`; dispose() is
			// idempotent, so this is safe even if the newer load already disposed it.
			if (generation !== loadGeneration) {
				localEngine.dispose();
				return;
			}
			localEngine.onEnded = () => {
				playing = false;
				// Snap the transport to the exact end so the replay-after-end check
				// (currentSeconds >= totalDuration) is reliable. Without this, the
				// last animation frame may have left currentSeconds a few ms short of
				// the end, so the replay reset below would not trigger.
				if (timing) currentSeconds = timing.totalDuration;
				cancelAnimationFrame(rafId);
			};
			if (result.failedFiles.length) {
				toastStore.error({ title: $_('preview.audio_partial'), duration: 4000 });
			}
			audioReady = true;
			// Mirror into committedAudioReady: this load's generation is current
			// (guard above), which implies it belongs to committedFileUrl, so the
			// committed chart's engine is now ready.
			committedAudioReady = true;
			// Sync the engine to the current visual cursor position. If the user
			// seeked while audio was still loading, handleSeek took the wall-clock
			// branch and never called engine.seek() — so engine.currentTime is
			// still 0. Without this sync, pressing Play after audio loads would
			// jump back to the beginning instead of resuming from the visible
			// cursor position.
			if (currentSeconds > 0) localEngine.seek(currentSeconds);
		} catch {
			// Superseded load: same self-contained dispose as the success path.
			if (generation !== loadGeneration) {
				localEngine.dispose();
				return;
			}
			// Total audio failure: drop the engine so playback falls back to the
			// visual-only wall clock; keep the notation usable.
			localEngine.dispose();
			engine = null;
			toastStore.error({ title: $_('preview.audio_partial'), duration: 4000 });
			audioReady = true;
			// Visual-only fallback is "ready" from the transport's perspective;
			// mirror so a failed switch can restore this state.
			committedAudioReady = true;
		}
	};

	// Resolve the level data for a selection, falling back to the highest
	// (levels[0], since the list is sorted descending). Looked up by fileUrl
	// because (label, level) is not unique across dtx_files rows — see the
	// comment on selectedFileUrl.
	const pickLevel = (fileUrl: string | null) =>
		(fileUrl != null && levels.find((l) => l.fileUrl === fileUrl)) ?? levels[0];

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
		// Replay-after-end: if playback finished, restart from the beginning
		// (standard media-player behavior). Without this, engine.currentTime
		// reports the full duration, play(duration) computes remaining = 0, and
		// the end timer fires instantly — transport flickers to Play then Pause
		// with no audio.
		const atEnd = timing != null && currentSeconds >= timing.totalDuration;
		if (atEnd) {
			cursorMeasure = 0;
			cursorFraction = 0;
			currentSeconds = 0;
		}
		playing = true;
		if (engine && audioReady) {
			// Pass engine.currentTime (the AudioContext clock), NOT the page's
			// currentSeconds. play() sets the engine's startOffset, and seek()
			// already advanced the engine to the right position — so resuming just
			// continues from wherever the engine clock currently is. At-end restart
			// explicitly passes 0 to rewind.
			engine.play(atEnd ? 0 : engine.currentTime);
		} else {
			// Audio unavailable: visual-only playback from the current cursor
			// position (already reset to the start above when at end).
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

	const buildForLevel = (dtx: DTXFile): ReturnType<typeof buildNotationChart> => {
		const built = buildNotationChart(dtx);
		chart = built.chart;
		timing = built.timing;
		// Re-initialize cursor/time so the transport display and notation cursor
		// don't carry a stale position (possibly past the new chart's end) into the
		// freshly rebuilt chart.
		cursorMeasure = 0;
		cursorFraction = 0;
		currentSeconds = 0;
		return built;
	};

	// Fetch the DTXFile for a single level on demand. The preview only renders
	// one level at a time, so this replaces parseFromRemoteURL (which eagerly
	// fetched set.def + all five levels) and avoids four wasted round-trips on
	// load. Returns null if superseded by a newer load. On success returns the
	// parsed DTXFile plus the level's `fileUrl`, which the audio engine uses to
	// resolve `#WAV` sample paths relative to the chart's directory.
	const fetchLevelDtx = async (
		fileUrl: string | null,
		generation: number
	): Promise<{ dtx: DTXFile; fileUrl: string } | null | 'error'> => {
		const levelData = pickLevel(fileUrl);
		if (!levelData) return null;
		try {
			const dtx = await SimFile.parseLevelFromRemoteURL(levelData.fileUrl, levelData.label);
			if (generation !== loadGeneration) return null;
			return { dtx, fileUrl: levelData.fileUrl };
		} catch {
			if (generation !== loadGeneration) return null;
			return 'error' as const;
		}
	};

	const load = async () => {
		// Re-entry cleanup for in-app navigation between /preview/[id] routes:
		// SvelteKit reuses this component across id changes, so drop the previous
		// chart's engine + animation loop before loading the new one.
		cancelAnimationFrame(rafId);
		engine?.dispose();
		engine = null;
		// Invalidate any in-flight loadAudioForLevel from the previous page
		// immediately. Without this, a stale audio load whose `await
		// localEngine.load(...)` resolves while the new getPreviewSimfile fetch
		// is still pending would pass the generation guard (loadGeneration is
		// otherwise only bumped at line ~284, after that fetch resolves) and
		// set audioReady / fire a toast / seek on a disposed engine for the
		// wrong page. The bail path in loadAudioForLevel self-disposes its
		// localEngine, which is idempotent, so this is safe.
		loadGeneration++;
		audioReady = false;
		playing = false;
		status = 'loading';
		title = '';
		artist = '';
		chart = null;
		levels = [];
		selectedFileUrl = null;
		committedFileUrl = null;
		committedAudioReady = false;
		cursorMeasure = 0;
		cursorFraction = 0;
		currentSeconds = 0;

		const id = $page.params.id;
		if (!id) {
			status = 'error';
			return;
		}
		try {
			const meta = await getPreviewSimfile(id);
			// A newer navigation superseded this load; drop its results.
			if (id !== $page.params.id) return;
			title = meta.title;
			artist = meta.artist;
			levels = [...meta.levels].sort((a, b) => b.level - a.level);
			if (!levels.length) {
				status = 'error';
				return;
			}
			currentId = id;
			selectedFileUrl = levels[0].fileUrl;

			// Fetch ONLY the selected level's DTX file (was: set.def + all five
			// levels via parseFromRemoteURL). One round-trip instead of six.
			const generation = ++loadGeneration;
			const fetched = await fetchLevelDtx(selectedFileUrl, generation);
			if (fetched === null) return; // a newer load superseded this one
			// A navigation to a different /preview/[id] superseded this load while
			// the fetch was in flight; drop its results (success or error) so a
			// failed old chart cannot overwrite the new page's loading/ready state.
			// The cleanup at the top of load() now bumps loadGeneration immediately,
			// so fetchLevelDtx's generation guard already bails on supersession —
			// but this route-id check is kept as belt-and-suspenders defense in
			// depth (e.g. for any future await added between the bump and the fetch
			// that could re-enter load() without a fresh bump).
			if (id !== $page.params.id) return;
			if (fetched === 'error') {
				status = 'error';
				return;
			}
			const built = buildForLevel(fetched.dtx);
			committedFileUrl = fetched.fileUrl;
			committedAudioReady = false;
			status = 'ready';
			void loadAudioForLevel(fetched.dtx, built, generation, fetched.fileUrl);
		} catch {
			// Same stale-route guard as above: getPreviewSimfile (or any earlier
			// await) can reject after navigation has moved on to a new id.
			if (id !== $page.params.id) return;
			status = 'error';
		}
	};

	const handleLevelChange = async (event: Event) => {
		const value = (event.target as HTMLSelectElement).value;
		// On fetch failure we revert the dropdown to committedFileUrl (the last
		// level whose chart was actually built and is still on screen) and
		// restore committedAudioReady — NOT the current selectedFileUrl/audioReady,
		// which may already reflect a transient pending switch. Capturing the
		// current select value would snap back to a pending level whose chart was
		// never rendered (e.g. rapid A→B→C where C fails: prev would be B, not A)
		// and could leave the transport disabled even though the committed
		// engine is still alive and ready.
		selectedFileUrl = value;
		// Fetch the newly selected level on demand (single round-trip), then
		// rebuild the chart + reload audio. The old chart stays visible until
		// the new DTXFile arrives so the notation area does not flash empty.
		audioReady = false;
		playing = false;
		cancelAnimationFrame(rafId);
		// Silence the currently-playing engine immediately: the UI transport
		// stopped above, but the audio sources/scheduler keep sounding until
		// loadAudioForLevel disposes this engine after the (async) DTX fetch.
		engine?.pause();
		// Bump the switch token so a stale switch (superseded by a newer switch
		// before this fetch returned) cannot commit its chart or revert the
		// dropdown. loadGeneration is only bumped on successful commit, so two
		// rapid switches share the same priorGeneration — the switch token is
		// the per-switch guard that distinguishes them.
		const token = ++switchToken;
		// Capture the generation BEFORE bumping so fetchLevelDtx can still bail
		// when a navigation (load()) supersedes this switch. We deliberately do
		// NOT bump loadGeneration here: bumping would invalidate the previous
		// level's in-flight audio load (loadAudioForLevel bails and disposes its
		// engine when its generation no longer matches). If this fetch then
		// failed, the revert path below would re-enable audioReady even though
		// `engine` still points at the disposed engine — so Play would no-op on
		// a dead engine. The generation is bumped only once the fetch succeeds
		// and we are committed to reloading audio for the new level.
		const priorGeneration = loadGeneration;
		const fetched = await fetchLevelDtx(value, priorGeneration);
		if (fetched === null) return; // a newer navigation superseded this switch
		// A newer level switch superseded this one while the fetch was in flight;
		// let the newer switch own the dropdown and chart state.
		if (token !== switchToken) return;
		if (fetched === 'error') {
			// A newer load (e.g. navigation) superseded this switch while the
			// fetch was in flight; let the newer load own the state.
			if (priorGeneration !== loadGeneration) return;
			// On fetch failure keep the previous chart usable and re-enable the
			// transport so the user can retry or switch back. The failure here is
			// the DTX chart file fetch, not a sound file — use a distinct toast.
			// Revert AFTER the generation guard so a superseded load can never
			// overwrite the level now owned by a newer in-flight request.
			selectedFileUrl = committedFileUrl;
			toastStore.error({ title: $_('preview.level_load_failed'), duration: 4000 });
			// Restore the committed chart's audio readiness. committedAudioReady
			// is mirrored inside loadAudioForLevel whenever the live load's
			// generation is current, so it reflects the committed engine's actual
			// state — including the case where the committed level's audio
			// finished loading during this failed fetch.
			audioReady = committedAudioReady;
			return;
		}
		// Commit to the new level: now bump the generation to invalidate any
		// still-in-flight previous audio load, then dispose+reload the engine.
		const generation = ++loadGeneration;
		const built = buildForLevel(fetched.dtx);
		committedFileUrl = fetched.fileUrl;
		committedAudioReady = false;
		void loadAudioForLevel(fetched.dtx, built, generation, fetched.fileUrl);
	};

	// React to the route id itself. SvelteKit reuses this component across
	// /preview/[id] navigations, so onMount alone would leave the previous song's
	// title/chart/audio in place; this effect re-runs load() on every id change
	// (and once on mount).
	//
	// load() is untracked so the effect's ONLY dependency is `$page.params.id`.
	// Without untrack, any future $state read added to load()'s synchronous
	// prefix would silently become an effect dependency and could trigger loops.
	$effect(() => {
		void $page.params.id;
		untrack(() => void load());
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
						value={selectedFileUrl}
						onchange={handleLevelChange}
					>
						{#each levels as lvl (lvl.fileUrl)}
							<option value={lvl.fileUrl}>{lvl.label}</option>
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
