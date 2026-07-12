<script lang="ts">
	import { onMount } from 'svelte';
	import { Pagination } from '@skeletonlabs/skeleton-svelte';
	import {
		RefreshCw,
		FolderOpen,
		Trophy,
		Upload,
		AlertTriangle,
		ChevronDown,
		ChevronRight
	} from '@lucide/svelte';
	import { desktopHost } from '../services/desktopHost';
	import CloudSongAutocomplete from './CloudSongAutocomplete.svelte';
	import { matchCharts, type CloudChart } from '../lib/scoreMatching';
	import { toastStore } from '../stores/toastStore';

	interface ScorePayload {
		isBest: boolean;
		score: number | null;
		achievementRate: number | null;
		rankLabel: string | null;
		fullCombo: boolean;
		cleared: boolean;
		maxCombo: number | null;
		perfect: number | null;
		great: number | null;
		good: number | null;
		poor: number | null;
		miss: number | null;
		performedAt: string | null;
		displayOrder: number | null;
	}
	interface LocalChartData {
		difficultyLevel: number;
		difficultyLabel: string;
		drumLevel: number;
		fileHash: string;
		aggregate: { playCount: number; clearCount: number };
		best: ScorePayload | null;
		recent: ScorePayload[];
	}
	interface DtxmaniaSong {
		title: string;
		artist: string;
		genre: string;
		charts: LocalChartData[];
	}
	interface CloudSong {
		id: string;
		title: string;
		artist: string;
		is_published: boolean;
	}

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

	const handlePageChange = (event: { page: number }) => {
		currentPage = event.page;
	};

	let links = $state<Record<number, CloudSong>>({});
	let cloudChartsBySong = $state<Record<number, CloudChart[]>>({});
	let matchesBySong = $state<Record<number, (string | null)[]>>({});
	let autocompleteFor = $state<number | null>(null);

	let uploadStatus = $state<string | null>(null);
	let skipped = $state<{ chartId: string; reason: string }[]>([]);

	const formatScore = (value: number | null): string =>
		value === null ? '—' : value.toLocaleString('en-US');

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

	onMount(async () => {
		savedLinks = await desktopHost.readScoreSongLinks();
		const path = await desktopHost.defaultDtxmaniaDbPath();
		if (path) {
			dbPath = path;
			await loadScores(path);
		}
	});

	const restoreLinks = async () => {
		const entries = songs
			.map((song, i) => ({ i, cloudId: savedLinks[songKey(song)] }))
			.filter((e): e is { i: number; cloudId: string } => !!e.cloudId);
		if (entries.length === 0) return;

		// Fetch real cloud song titles in parallel so restored links show the
		// actual song title instead of a "Simfile #<id>" placeholder. A fetch
		// failure falls back to the placeholder so one bad link doesn't block
		// the rest of the restore.
		const titleResults = await Promise.allSettled(
			entries.map((e) =>
				desktopHost.fetchCloudSong<{
					success: boolean;
					cloudSongData?: {
						id: number;
						title: string;
						artist: string;
						is_published: boolean;
					};
				}>(e.cloudId)
			)
		);

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
				await handleLinkSelect(i, song);
			} catch {
				// handleLinkSelect handles its own fetch errors; continue.
			}
		}
	};

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
		try {
			await restoreLinks();
		} catch {
			// restoreLinks handles per-link errors internally; swallow unexpected errors.
		}
	};

	const handleChooseDb = async () => {
		const result = await desktopHost.selectDtxmaniaDb();
		if (!result.canceled && result.filePaths[0]) {
			dbPath = result.filePaths[0];
			await loadScores(dbPath);
		}
	};

	const handleLinkSelect = async (songIndex: number, song: CloudSong) => {
		links[songIndex] = song;
		savedLinks = { ...savedLinks, [songKey(songs[songIndex])]: song.id };
		desktopHost.writeScoreSongLinks(savedLinks).catch(() => {
			toastStore.error('Could not save song link');
		});
		autocompleteFor = null;
		try {
			const result = await desktopHost.fetchCloudSongCharts<{
				success: boolean;
				data?: CloudChart[];
			}>(song.id);
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

	const buildUpload = () => {
		const charts: Array<{
			chartId: string;
			playCount: number;
			clearCount: number;
			scores: ScorePayload[];
		}> = [];
		const seenChartIds = new Set<string>();
		songs.forEach((song, songIndex) => {
			if (!links[songIndex]) return;
			const matches = matchesBySong[songIndex] ?? [];
			song.charts.forEach((chart, chartIndex) => {
				const chartId = matches[chartIndex];
				if (!chartId) return;
				// Deduplicate: never send the same cloud chart ID twice.
				if (seenChartIds.has(chartId)) return;
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
		return { charts };
	};

	const handleUpload = async () => {
		uploadStatus = 'Uploading…';
		skipped = [];
		const input = buildUpload();
		if (input.charts.length === 0) {
			uploadStatus = 'Nothing to upload — link a song and match at least one chart first.';
			return;
		}
		try {
			const result = await desktopHost.uploadScores<{
				success: boolean;
				data?: { updatedCharts: number; insertedScores: number; skipped: typeof skipped };
				error?: string;
			}>(input);
			if (result.success && result.data) {
				uploadStatus = `Uploaded ${result.data.updatedCharts} chart(s), ${result.data.insertedScores} score(s).`;
				skipped = result.data.skipped ?? [];
			} else {
				uploadStatus = result.error ?? 'Upload failed.';
			}
		} catch (e) {
			uploadStatus = e instanceof Error ? e.message : 'Upload failed.';
		}
	};
</script>

<div class="bg-base text-base-text min-w-0 flex-1 overflow-auto p-6">
	<div class="mb-4 flex items-center gap-3">
		<Trophy size={22} class="text-cyan" />
		<h1 class="font-display text-hi text-xl font-semibold">Scores</h1>
		<div class="ml-auto flex items-center gap-2">
			<button
				class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
				onclick={handleChooseDb}
			>
				<FolderOpen size={16} /> Choose songs.db
			</button>
			{#if dbPath}
				<button
					class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
					onclick={() => dbPath && loadScores(dbPath)}
				>
					<RefreshCw size={16} /> Reparse
				</button>
				<button
					class="border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium"
					onclick={handleUpload}
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
				<div class="border-hairline bg-surface-1 rounded-xl border p-4">
					<div class="mb-2 flex items-center gap-3">
						<button
							type="button"
							class="hover:text-hi flex min-w-0 flex-1 items-center gap-2 text-left"
							onclick={() => toggleSong(song)}
							aria-expanded={isSongExpanded(song)}
							aria-label="Toggle {song.title}"
						>
							{#if isSongExpanded(song)}
								<ChevronDown size={16} class="text-faint shrink-0" />
							{:else}
								<ChevronRight size={16} class="text-faint shrink-0" />
							{/if}
							<span class="min-w-0">
								<span class="text-hi block truncate font-medium">{song.title}</span>
								<span class="text-dim block truncate text-sm">{song.artist}</span>
							</span>
						</button>
						<div class="relative ml-auto">
							{#if links[songIndex]}
								<span class="text-cyan text-sm"
									>Linked: {links[songIndex].title}</span
								>
								<button
									class="text-faint hover:text-hi ml-2 text-xs underline"
									onclick={() => (autocompleteFor = songIndex)}>change</button
								>
							{:else}
								<button
									class="border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20 rounded-lg border px-3 py-1.5 text-sm"
									onclick={() => (autocompleteFor = songIndex)}
									aria-label="Link to cloud song"
								>
									Link to cloud song
								</button>
							{/if}
							<CloudSongAutocomplete
								isOpen={autocompleteFor === songIndex}
								onclose={() => (autocompleteFor = null)}
								onselect={(cloudSong) => handleLinkSelect(songIndex, cloudSong)}
							/>
						</div>
					</div>

					{#if isSongExpanded(song)}
						<div class="flex flex-col gap-2">
							{#each song.charts as chart, chartIndex (chart.fileHash + chartIndex)}
								{@const matchedId =
									(matchesBySong[songIndex] ?? [])[chartIndex] ?? null}
								{@const cloudCharts = cloudChartsBySong[songIndex] ?? []}
								<div class="border-hairline rounded-lg border p-3">
									<div class="mb-1 flex items-center gap-2 text-sm">
										<span class="text-hi font-medium"
											>{chart.difficultyLabel || 'DRUMS'}</span
										>
										<span class="text-faint">Lv {chart.drumLevel / 10}</span>
										<span class="text-dim"
											>· plays {chart.aggregate.playCount} · clears {chart
												.aggregate.clearCount}</span
										>
										{#if links[songIndex]}
											{#if matchedId}
												<span class="text-green ml-auto text-xs">
													→ matched
												</span>
											{:else}
												<span
													class="ml-auto inline-flex items-center gap-1 text-xs text-red-300"
												>
													<AlertTriangle size={12} /> Unmatched
												</span>
											{/if}
										{/if}
									</div>

									{#if links[songIndex] && cloudCharts.length > 0}
										<label class="text-faint mb-2 block text-xs">
											Target chart:
											<select
												class="border-hairline bg-surface-2 text-hi ml-1 rounded px-2 py-1 text-xs"
												value={matchedId ?? ''}
												onchange={(e) =>
													handleOverrideMatch(
														songIndex,
														chartIndex,
														(e.currentTarget as HTMLSelectElement).value
													)}
											>
												<option value="">— none —</option>
												{#each cloudCharts as cc}
													<option value={cc.id}
														>{cc.label || 'chart'} (Lv {cc.level})</option
													>
												{/each}
											</select>
										</label>
									{/if}

									{#if chart.best}
										<div class="text-dim text-xs">
											Best: {formatScore(chart.best.score)} · {chart.best
												.rankLabel} ·
											{chart.best.achievementRate}% · combo {chart.best
												.maxCombo}
											{#if chart.best.fullCombo}· FC{/if}
										</div>
									{:else}
										<div class="text-faint text-xs">
											No best score recorded.
										</div>
									{/if}

									{#if chart.recent.length > 0}
										<ul class="text-faint mt-1 text-xs">
											{#each chart.recent as recent}
												<li>
													<span
														class:text-green-300={recent.cleared}
														class:text-red-300={!recent.cleared}
														>{recent.cleared
															? 'Cleared'
															: 'Failed'}</span
													>
													· {recent.rankLabel ?? '—'} · {recent.achievementRate ??
														'—'}% · {recent.performedAt}
												</li>
											{/each}
										</ul>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
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
