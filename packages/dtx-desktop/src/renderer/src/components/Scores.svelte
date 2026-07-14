<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import { RefreshCw, FolderOpen, Trophy, Upload } from '@lucide/svelte';
	import { desktopHost } from '../services/desktopHost';
	import ScoreSongCard from './ScoreSongCard.svelte';
	import { matchCharts, type CloudChart } from '../lib/scoreMatching';
	import { toastStore } from '../stores/toastStore';
	import type {
		ScorePayload,
		DtxmaniaSong,
		CloudSong,
		FetchCloudSongResult,
		FetchCloudSongChartsResult,
		UploadScoresResult
	} from '../lib/scoreTypes';

	let dbPath = $state<string | null>(null);
	let songs = $state<DtxmaniaSong[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Client-side pagination over the parsed local songs list. The upload flow
	// still walks the full `songs` array; paging only limits what is rendered.
	// `pageStart` keeps the global song index stable so links/matches, which are
	// keyed by index into `songs`, stay correct across pages.
	let currentPage = $state(1);
	const pageSize = 10;
	const pageStart = $derived((currentPage - 1) * pageSize);
	const pagedSongs = $derived(songs.slice(pageStart, pageStart + pageSize));
	// Global song indices currently visible on the page. Used to gate cloud
	// link restoration (see restoreLinksFor) so opening the view only fetches
	// titles/charts for the visible page, not the whole library at once.
	const pagedIndices = $derived(
		Array.from({ length: pagedSongs.length }, (_, i) => pageStart + i)
	);

	const handlePageChange = (event: { page: number }) => {
		currentPage = event.page;
		// Restore cloud links for the newly visible page. Songs already linked
		// are skipped inside restoreLinksFor, so paging back is a no-op.
		restoreLinksForPage();
	};

	let links = $state<Record<number, CloudSong>>({});
	let cloudChartsBySong = $state<Record<number, CloudChart[]>>({});
	let matchesBySong = $state<Record<number, (string | null)[]>>({});
	let autocompleteFor = $state<number | null>(null);

	let uploadStatus = $state<string | null>(null);
	let skipped = $state<{ chartId: string; reason: string }[]>([]);
	let uploading = $state(false);

	// Key includes genre to reduce collision risk for duplicate DTXMania
	// titles with the same artist. The DTXMania Songs table has a Genre column
	// that further disambiguates entries.
	const songKey = (song: DtxmaniaSong): string =>
		`${song.title}\u0000${song.artist}\u0000${song.genre}`;
	let savedLinks = $state<Record<string, string>>({});

	// Per-song collapse state, keyed by song identity so it survives paging.
	// Absent key = expanded (default), so songs start open until collapsed.
	let expandedByKey = $state<Record<string, boolean>>({});
	const isSongExpanded = (song: DtxmaniaSong): boolean => expandedByKey[songKey(song)] ?? true;
	const toggleSong = (song: DtxmaniaSong): void => {
		const key = songKey(song);
		expandedByKey[key] = !(expandedByKey[key] ?? true);
	};

	// Debounce persisted writes of savedLinks so a burst of link selections
	// (or a page restore followed by a manual change) coalesces into one disk
	// write instead of one write per selection.
	let persistTimer: ReturnType<typeof setTimeout> | null = null;
	const schedulePersist = (): void => {
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistTimer = null;
			desktopHost.writeScoreSongLinks(savedLinks).catch(() => {
				toastStore.error('Could not save song links');
			});
		}, 300);
	};
	onDestroy(() => {
		// Flush any pending debounced write so a link change made within the
		// 300ms window is not lost when the component unmounts. Clearing the
		// timer alone would silently drop the last edit.
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = null;
			desktopHost.writeScoreSongLinks(savedLinks).catch(() => {
				// Best-effort flush on unmount; failure is non-fatal.
			});
		}
	});

	onMount(async () => {
		savedLinks = await desktopHost.readScoreSongLinks();
		const path = await desktopHost.defaultDtxmaniaDbPath();
		if (path) {
			dbPath = path;
			await loadScores(path);
		}
	});

	// Drops saved links whose song no longer appears in the parsed DTXMania
	// database, so the score_links map in preferences.json can't grow unbounded
	// or renamed. Persists only when entries were actually dropped (avoids
	// spurious writes on a stable song set). Best-effort: a persist failure is
	// non-fatal — the in-memory map is still pruned for this session.
	const pruneSavedLinks = () => {
		if (Object.keys(savedLinks).length === 0) return;
		// Guard against a transient parse failure (corrupt/locked songs.db):
		// songs = [] would classify every saved link as orphaned and persist
		// an empty map, silently wiping all persisted links. Skip pruning when
		// no songs were parsed — the links are almost certainly still valid.
		if (songs.length === 0) return;
		const currentKeys = new Set(songs.map(songKey));
		let dropped = 0;
		const pruned: Record<string, string> = {};
		for (const [key, cloudId] of Object.entries(savedLinks)) {
			if (currentKeys.has(key)) {
				pruned[key] = cloudId;
			} else {
				dropped += 1;
			}
		}
		if (dropped === 0) return;
		savedLinks = pruned;
		desktopHost.writeScoreSongLinks(savedLinks).catch(() => {
			// Best-effort prune persist; failure is non-fatal.
		});
	};

	// Restore cloud links for the given song indices: fetch the real cloud
	// song title (so a restored link shows the actual title instead of a
	// "Simfile #<id>" placeholder) and the cloud charts for auto-matching.
	// `indices` is gated to the visible page by restoreLinksForPage so opening
	// the view no longer fires N GraphQL requests for the whole library;
	// handleUpload passes every index so the full library is restored before
	// building the upload payload (an explicit user action justifies the
	// full restore, but the fetches are still capped to avoid overwhelming
	// the API/D1 with hundreds of concurrent requests). Songs already linked
	// (manual link or prior restore) are skipped to avoid re-fetching on
	// page-back or repeated restores.
	const RESTORE_CONCURRENCY = 8;
	const restoreLinksFor = async (indices: number[]) => {
		const entries = indices
			.map((i) => ({ i, cloudId: savedLinks[songKey(songs[i])] }))
			.filter((e): e is { i: number; cloudId: string } => !!e.cloudId)
			.filter((e) => !links[e.i]);
		if (entries.length === 0) return;

		// Fetch real cloud song titles in bounded-concurrency chunks so a
		// large library (hundreds of saved links) doesn't fire hundreds of
		// concurrent GraphQL/D1 requests at once. A fetch failure falls back
		// to the placeholder so one bad link doesn't block the rest.
		const titleResults: PromiseSettledResult<FetchCloudSongResult>[] = [];
		for (let i = 0; i < entries.length; i += RESTORE_CONCURRENCY) {
			const chunk = entries.slice(i, i + RESTORE_CONCURRENCY);
			const results = await Promise.allSettled(
				chunk.map((e) => desktopHost.fetchCloudSong<FetchCloudSongResult>(e.cloudId))
			);
			titleResults.push(...results);
		}

		for (let idx = 0; idx < entries.length; idx++) {
			const { i, cloudId } = entries[idx];
			const result = titleResults[idx];
			let song: CloudSong = {
				id: cloudId,
				title: `Simfile #${cloudId}`,
				artist: songs[i].artist,
				is_published: false
			};
			if (
				result.status === 'fulfilled' &&
				result.value.success &&
				result.value.cloudSongData
			) {
				song = {
					id: cloudId,
					title: result.value.cloudSongData.title,
					artist: result.value.cloudSongData.artist,
					is_published: result.value.cloudSongData.is_published
				};
			}
			try {
				await handleLinkSelect(i, song, false);
			} catch {
				// handleLinkSelect handles its own fetch errors; continue.
			}
		}

		// Persist the full restored map once, not once per link.
		schedulePersist();
	};

	const restoreLinksForPage = () => restoreLinksFor(pagedIndices);

	const loadScores = async (path: string) => {
		loading = true;
		error = null;
		currentPage = 1;
		try {
			songs = await desktopHost.parseDtxmaniaScores<DtxmaniaSong[]>(path);
			links = {};
			cloudChartsBySong = {};
			matchesBySong = {};
			uploadStatus = null;
			skipped = [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to read songs.db';
			songs = [];
		} finally {
			loading = false;
		}
		pruneSavedLinks();
		try {
			await restoreLinksForPage();
		} catch {
			// restoreLinksFor handles per-link errors internally; swallow unexpected errors.
		}
	};

	const handleChooseDb = async () => {
		const result = await desktopHost.selectDtxmaniaDb();
		if (!result.canceled && result.filePaths[0]) {
			dbPath = result.filePaths[0];
			await loadScores(dbPath);
		}
	};

	const handleLinkSelect = async (songIndex: number, song: CloudSong, persist = true) => {
		links[songIndex] = song;
		savedLinks = { ...savedLinks, [songKey(songs[songIndex])]: song.id };
		if (persist) schedulePersist();
		autocompleteFor = null;
		try {
			const result = await desktopHost.fetchCloudSongCharts<FetchCloudSongChartsResult>(
				song.id
			);
			const charts = result.success ? (result.data ?? []) : [];
			cloudChartsBySong[songIndex] = charts;
			matchesBySong[songIndex] = matchCharts(songs[songIndex].charts, charts);
		} catch {
			cloudChartsBySong[songIndex] = [];
			matchesBySong[songIndex] = [];
			toastStore.error('Could not fetch cloud charts for linked song');
		}
	};

	const handleOverrideMatch = (songIndex: number, chartIndex: number, cloudChartId: string) => {
		const next = [...(matchesBySong[songIndex] ?? [])];
		const targetId = cloudChartId || null;
		// Enforce one-to-one: if the chosen cloud chart is already assigned to
		// another chart in this song, clear that other chart's match first.
		if (targetId) {
			for (let i = 0; i < next.length; i++) {
				if (i !== chartIndex && next[i] === targetId) {
					next[i] = null;
				}
			}
		}
		next[chartIndex] = targetId;
		matchesBySong[songIndex] = next;
	};

	const buildUpload = (): {
		charts: Array<{
			chartId: string;
			playCount: number;
			clearCount: number;
			scores: ScorePayload[];
		}>;
		clientSkipped: { chartId: string; reason: string }[];
	} => {
		const charts: Array<{
			chartId: string;
			playCount: number;
			clearCount: number;
			scores: ScorePayload[];
		}> = [];
		const clientSkipped: { chartId: string; reason: string }[] = [];
		const seenChartIds = new Set<string>();
		songs.forEach((song, songIndex) => {
			if (!links[songIndex]) return;
			const matches = matchesBySong[songIndex] ?? [];
			song.charts.forEach((chart, chartIndex) => {
				const chartId = matches[chartIndex];
				if (!chartId) return;
				// Deduplicate: never send the same cloud chart ID twice. Surface
				// the dropped match so the user knows a chart was skipped, not
				// silently lost.
				if (seenChartIds.has(chartId)) {
					const label = chart.difficultyLabel || 'DRUMS';
					clientSkipped.push({
						chartId,
						reason: `duplicate match — "${song.title}" ${label} already linked from another song`
					});
					return;
				}
				seenChartIds.add(chartId);
				const scores = [...(chart.best ? [chart.best] : []), ...chart.recent];
				if (scores.length === 0) return;
				charts.push({
					chartId,
					playCount: chart.aggregate.playCount,
					clearCount: chart.aggregate.clearCount,
					scores
				});
			});
		});
		return { charts, clientSkipped };
	};

	// Server-side cap (score.ts MAX_UPLOAD_CHARTS). The API returns a sentinel
	// skip with chartId '*' when exceeded, so the client slices into batches
	// of at most this size and calls uploadScores per batch, accumulating
	// results. This lets a busy player with >100 matched charts upload in one
	// click instead of hitting the sentinel with no recovery.
	const MAX_UPLOAD_CHARTS = 100;

	const handleUpload = async () => {
		if (uploading) return;
		uploading = true;
		uploadStatus = 'Uploading…';
		skipped = [];
		// The try/finally wraps the ENTIRE post-guard body (restore + build +
		// batch loop) so a throw anywhere resets `uploading`. Previously
		// restoreLinksFor/buildUpload ran before the try, so a mid-upload
		// Reparse click (not disabled during upload) could set songs = [] →
		// restoreLinksFor read songs[i] undefined → threw → finally never ran
		// → Upload button stuck disabled forever.
		try {
			// Paging only restores cloud links for the visible page. Upload walks
			// the full `songs` array, so restore every saved link first — upload is
			// an explicit user action, so the burst of fetches is expected and the
			// user is already waiting on the result. Songs already linked are
			// skipped inside restoreLinksFor.
			await restoreLinksFor(songs.map((_, i) => i));
			const input = buildUpload();
			if (input.charts.length === 0) {
				uploadStatus =
					'Nothing to upload — link a song and match at least one chart first.';
				return;
			}
			// Surface client-side skips (duplicate chart matches) alongside any
			// server-side skips returned in the upload response.
			skipped = input.clientSkipped;
			let totalUpdated = 0;
			let totalInserted = 0;
			const serverSkipped: { chartId: string; reason: string }[] = [];
			for (let i = 0; i < input.charts.length; i += MAX_UPLOAD_CHARTS) {
				const batch = input.charts.slice(i, i + MAX_UPLOAD_CHARTS);
				const result = await desktopHost.uploadScores<UploadScoresResult>({
					charts: batch
				});
				if (!result.success || !result.data) {
					// Earlier batches in this loop already committed server-side.
					// Surface the partial progress so the user knows what landed
					// before the failure, instead of a bare "Upload failed."
					const partial =
						totalUpdated > 0 || totalInserted > 0
							? ` Partial upload: ${totalUpdated} chart(s), ${totalInserted} score(s) committed before failure.`
							: '';
					uploadStatus = `${result.error ?? 'Upload failed.'}${partial}`;
					return;
				}
				totalUpdated += result.data.updatedCharts;
				totalInserted += result.data.insertedScores;
				serverSkipped.push(...(result.data.skipped ?? []));
			}
			uploadStatus = `Uploaded ${totalUpdated} chart(s), ${totalInserted} score(s).`;
			skipped = [...input.clientSkipped, ...serverSkipped];
		} catch (e) {
			uploadStatus = e instanceof Error ? e.message : 'Upload failed.';
		} finally {
			uploading = false;
		}
	};
</script>

<div class="bg-base text-base-text min-w-0 flex-1 overflow-auto p-6">
	<div class="mb-4 flex items-center gap-3">
		<Trophy size={22} class="text-cyan" />
		<h1 class="font-display text-hi text-xl font-semibold">Scores</h1>
		<div class="ml-auto flex items-center gap-2">
			<button
				class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
				onclick={handleChooseDb}
				disabled={uploading}
			>
				<FolderOpen size={16} /> Choose songs.db
			</button>
			{#if dbPath}
				<button
					class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
					onclick={() => dbPath && loadScores(dbPath)}
					disabled={uploading}
				>
					<RefreshCw size={16} /> Reparse
				</button>
				<button
					class="border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
					onclick={handleUpload}
					disabled={uploading}
				>
					<Upload size={16} /> Upload
				</button>
			{/if}
		</div>
	</div>

	{#if uploadStatus}
		<p class="text-dim mb-3 text-sm">{uploadStatus}</p>
	{/if}
	{#if skipped.length > 0}
		<ul class="mb-3 text-xs text-red-300">
			{#each skipped as row}
				<li>Chart {row.chartId} skipped: {row.reason}</li>
			{/each}
		</ul>
	{/if}

	{#if loading}
		<p class="text-dim text-sm">Reading songs.db…</p>
	{:else if error}
		<p class="text-sm text-red-300">{error}</p>
	{:else if !dbPath}
		<p class="text-dim text-sm">
			No DTXManiaCX <code>songs.db</code> found. Use “Choose songs.db” to locate it.
		</p>
	{:else if songs.length === 0}
		<p class="text-dim text-sm">No drum scores found in this database.</p>
	{:else}
		<div class="flex flex-col gap-4">
			{#each pagedSongs as song, i (songKey(song) + (pageStart + i))}
				{@const songIndex = pageStart + i}
				<ScoreSongCard
					{song}
					link={links[songIndex]}
					cloudCharts={cloudChartsBySong[songIndex] ?? []}
					matches={matchesBySong[songIndex] ?? []}
					expanded={isSongExpanded(song)}
					autocompleteOpen={autocompleteFor === songIndex}
					onToggle={() => toggleSong(song)}
					onLinkSelect={(cloudSong) => handleLinkSelect(songIndex, cloudSong)}
					onOverrideMatch={(chartIndex, cloudChartId) =>
						handleOverrideMatch(songIndex, chartIndex, cloudChartId)}
					onAutocompleteToggle={() => (autocompleteFor = songIndex)}
					onAutocompleteClose={() => (autocompleteFor = null)}
				/>
			{/each}
		</div>

		{#if songs.length > pageSize}
			<div class="mt-6 flex justify-center">
				<Pagination
					data={songs}
					page={currentPage}
					{pageSize}
					onPageChange={handlePageChange}
					siblingCount={2}
					showFirstLastButtons={true}
					classes="flex items-center gap-2"
					buttonBase="btn btn-sm"
					buttonActive="preset-filled-primary-500"
					buttonInactive="preset-tonal-surface"
				/>
			</div>
		{/if}
	{/if}
</div>
