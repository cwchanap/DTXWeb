<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { _ } from 'svelte-i18n';
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

	// Maps technical skip reasons from the server (score.ts validateChartScores)
	// and client (duplicate match) to user-friendly text. Unknown reasons fall
	// back to the raw string so new server-side reasons are still visible.
	//
	// Stable reason strings are matched exactly. Entries whose server text
	// carries a volatile numeric parameter (e.g. "too many scores (max 10)")
	// are matched by prefix so a cap change on the server doesn't silently
	// drop the friendly text. Prefixes are checked after the exact map and
	// are specific enough to avoid false positives. Friendly text is sourced
	// from the `score.skip.*` i18n namespace so it localizes with the locale.
	const humanizeSkipReason = (reason: string): string => {
		const exact: Record<string, string> = {
			'invalid chart id': 'score.skip.invalid_chart_id',
			'duplicate chart id': 'score.skip.duplicate_chart_id',
			'playCount must be a non-negative integer': 'score.skip.invalid_play_count',
			'clearCount must be a non-negative integer': 'score.skip.invalid_clear_count',
			'clearCount cannot exceed playCount': 'score.skip.clear_exceeds_play',
			'no scores provided': 'score.skip.no_scores',
			'more than one best score': 'score.skip.multiple_best',
			'more than 5 recent scores': 'score.skip.too_many_recent',
			'non-best score without displayOrder': 'score.skip.missing_order',
			'duplicate displayOrder': 'score.skip.duplicate_order',
			'score must be a non-negative integer': 'score.skip.invalid_score',
			'achievementRate out of range': 'score.skip.achievement_out_of_range',
			'invalid performedAt': 'score.skip.invalid_performed_at',
			'judgment counts must be non-negative integers': 'score.skip.invalid_judgments',
			'no valid scores after filtering': 'score.skip.no_valid_scores',
			'best score row invalid': 'score.skip.best_invalid',
			'chart not found': 'score.skip.chart_not_found',
			'write failed': 'score.skip.write_failed'
		};
		const prefixes: [string, string][] = [
			['too many scores', 'score.skip.too_many_scores'],
			['too many charts', 'score.skip.too_many_charts'],
			['displayOrder out of range', 'score.skip.order_out_of_range'],
			['rankLabel must be one of', 'score.skip.unknown_rank']
		];
		if (exact[reason]) return $_(exact[reason]);
		for (const [prefix, key] of prefixes) {
			if (reason.startsWith(prefix)) return $_(key);
		}
		return reason;
	};

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
		restoreLinksForPage(loadGeneration);
	};

	let links = $state<Record<number, CloudSong>>({});
	let cloudChartsBySong = $state<Record<number, CloudChart[]>>({});
	let matchesBySong = $state<Record<number, (string | null)[]>>({});
	let autocompleteFor = $state<number | null>(null);

	let uploadStatus = $state<string | null>(null);
	let skipped = $state<{ chartId: string; reason: string }[]>([]);
	let uploading = $state(false);
	// In-flight chart fetches after a manual link. Upload must wait for these
	// because restoreLinksFor skips songs already present in `links`, so a
	// fast click before matchesBySong is populated would report "Nothing to
	// upload" even though matching is still running.
	const inflightLinkFetches = new Set<Promise<void>>();
	let linkingCharts = $state(false);

	// Stable song identity is the DTXMania `Songs.Id` (songId) scoped to the
	// selected songs.db path. `Songs.Id` is only unique within one database
	// file, so an unscoped key would restore DB A's cloud links onto DB B's
	// local songs when the user switches files. Collapse state uses the same
	// scoped key. Separator is U+001F (unit separator) so it cannot appear in
	// a filesystem path. Legacy unscoped keys (bare songId / title+artist) are
	// orphaned and pruned on the next load.
	const SCORE_LINK_KEY_SEP = '\u001f';
	const songKey = (song: DtxmaniaSong): string =>
		dbPath ? `${dbPath}${SCORE_LINK_KEY_SEP}${song.songId}` : String(song.songId);
	let savedLinks = $state<Record<string, string>>({});

	// Monotonically increasing load generation: discard in-flight parse/restore
	// results when the user reloads or switches databases mid-flight so DB A's
	// cloud links cannot be applied to DB B's local songs.
	let loadGeneration = 0;

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
	// Set by onDestroy so a stale restore continuation (its generation check
	// may have passed before destruction) cannot schedule a post-unmount
	// write that would overwrite a newer instance's persisted links.
	let destroyed = false;
	const schedulePersist = (): void => {
		if (destroyed) return;
		if (persistTimer) clearTimeout(persistTimer);
		persistTimer = setTimeout(() => {
			persistTimer = null;
			desktopHost.writeScoreSongLinks(savedLinks).catch(() => {
				toastStore.error($_('score.save_links_failed'));
			});
		}, 300);
	};
	onDestroy(() => {
		// Invalidate any in-flight restore continuations so they bail at their
		// next generation check instead of mutating state and calling
		// schedulePersist after unmount. Without this, a restore suspended at
		// an IPC await would pass its generation check (loadGeneration was
		// unchanged), commit links, and schedule a 300ms write whose callback
		// closes over this instance's savedLinks — potentially overwriting a
		// newly mounted Scores view's fresher persisted map.
		destroyed = true;
		loadGeneration += 1;
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
		// Guard against a manual DB selection during these startup awaits:
		// the chooser is enabled while `loading` is still false, so a user
		// picking a database before the default-path lookup resolves would
		// otherwise have this continuation overwrite `dbPath` with the
		// default and start a competing parse against the wrong file.
		// `handleChooseDb` -> `loadScores` increments `loadGeneration`, so if
		// it advanced past `startGeneration` during either await, bail.
		const startGeneration = loadGeneration;
		// Read the persisted link map BEFORE assigning it: a manual DB
		// selection during the await increments loadGeneration (via
		// loadScores), and assigning the stale disk map after that would
		// overwrite any manual link the user made in the meantime. The
		// generation check must gate the assignment, not just the subsequent
		// loadScores call.
		const loadedLinks = await desktopHost.readScoreSongLinks();
		if (startGeneration !== loadGeneration) return;
		savedLinks = loadedLinks;
		const path = await desktopHost.defaultDtxmaniaDbPath();
		if (startGeneration !== loadGeneration) return;
		if (path) {
			dbPath = path;
			await loadScores(path);
		}
	});

	// Drops saved links whose song no longer appears in the *current* database,
	// while preserving links scoped to other songs.db paths. Also drops legacy
	// unscoped keys (no path separator) that can collide across databases.
	// Persists only when entries were actually dropped. Best-effort: a persist
	// failure is non-fatal — the in-memory map is still pruned for this session.
	const pruneSavedLinks = () => {
		if (Object.keys(savedLinks).length === 0) return;
		// Guard against a transient parse failure (corrupt/locked songs.db):
		// songs = [] would classify every current-db link as orphaned. Skip
		// pruning when no songs were parsed — the links are almost certainly
		// still valid.
		if (songs.length === 0 || !dbPath) return;
		const currentKeys = new Set(songs.map(songKey));
		const currentPrefix = `${dbPath}${SCORE_LINK_KEY_SEP}`;
		let dropped = 0;
		const pruned: Record<string, string> = {};
		for (const [key, cloudId] of Object.entries(savedLinks)) {
			// Keep links belonging to other databases intact.
			if (key.includes(SCORE_LINK_KEY_SEP) && !key.startsWith(currentPrefix)) {
				pruned[key] = cloudId;
				continue;
			}
			// Drop legacy unscoped keys and orphans for this database.
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

	// Restore cloud links for the given song indices: optionally fetch the
	// real cloud song title (so a restored link shows the actual title instead
	// of a "Simfile #<id>" placeholder) and always fetch cloud charts for
	// auto-matching. `indices` is gated to the visible page by
	// restoreLinksForPage so opening the view no longer fires N GraphQL
	// requests for the whole library; handleUpload passes every index so the
	// full library is restored before building the upload payload. Title
	// lookup is cosmetic for upload, so handleUpload sets fetchTitles:false
	// and only pays for chart fetches. Songs already linked (manual link or
	// prior restore) are skipped to avoid re-fetching on page-back or
	// repeated restores — EXCEPT placeholder links (title "Simfile #<id>")
	// left by an upload-time fetchTitles:false restore: those have charts
	// loaded but a placeholder title, so when fetchTitles is true (paging
	// path) only the title is refreshed without re-fetching charts.
	const PLACEHOLDER_PREFIX = 'Simfile #';
	const isPlaceholderLink = (song: CloudSong): boolean =>
		song.title === `${PLACEHOLDER_PREFIX}${song.id}`;
	const RESTORE_CONCURRENCY = 8;
	const restoreLinksFor = async (
		indices: number[],
		generation = loadGeneration,
		options: { fetchTitles?: boolean } = {}
	) => {
		const fetchTitles = options.fetchTitles !== false;
		// Partition into new entries (no link yet — need title + charts) and
		// placeholder entries (linked with a placeholder title — need title
		// refresh only). Placeholder refresh only runs when fetchTitles is
		// true; handleUpload's fetchTitles:false path must not touch them.
		const newEntries: { i: number; cloudId: string }[] = [];
		const placeholderEntries: { i: number; cloudId: string }[] = [];
		for (const i of indices) {
			const cloudId = savedLinks[songKey(songs[i])];
			if (!cloudId) continue;
			const existing = links[i];
			if (!existing) {
				newEntries.push({ i, cloudId });
			} else if (fetchTitles && isPlaceholderLink(existing) && existing.id === cloudId) {
				placeholderEntries.push({ i, cloudId });
			}
		}
		if (newEntries.length === 0 && placeholderEntries.length === 0) return;

		// Fetch real cloud song titles for both groups in bounded-concurrency
		// chunks so a large library (hundreds of saved links) doesn't fire
		// hundreds of concurrent GraphQL/D1 requests at once. A fetch failure
		// falls back to the placeholder so one bad link doesn't block the
		// rest. Skipped entirely when fetchTitles is false (upload restore).
		const allTitleEntries = [...newEntries, ...placeholderEntries];
		const titleResults: PromiseSettledResult<FetchCloudSongResult>[] = [];
		if (fetchTitles) {
			for (let i = 0; i < allTitleEntries.length; i += RESTORE_CONCURRENCY) {
				if (generation !== loadGeneration) return;
				const chunk = allTitleEntries.slice(i, i + RESTORE_CONCURRENCY);
				const results = await Promise.allSettled(
					chunk.map((e) => desktopHost.fetchCloudSong<FetchCloudSongResult>(e.cloudId))
				);
				titleResults.push(...results);
			}
			if (generation !== loadGeneration) return;
		}

		// Refresh placeholder titles in place. Charts/matches are already
		// loaded from the upload-time restore, so only the title/artist/
		// is_published fields are updated — no chart re-fetch needed.
		let applied = 0;
		for (let idx = 0; idx < placeholderEntries.length; idx++) {
			const { i, cloudId } = placeholderEntries[idx];
			// Re-check after the async title fetch: the user may have manually
			// re-linked (or unlinked) this song during the await window.
			const existing = links[i];
			if (!existing || !isPlaceholderLink(existing) || existing.id !== cloudId) continue;
			const result = titleResults[newEntries.length + idx];
			if (
				result?.status === 'fulfilled' &&
				result.value.success &&
				result.value.cloudSongData
			) {
				links[i] = {
					id: cloudId,
					title: result.value.cloudSongData.title,
					artist: result.value.cloudSongData.artist,
					is_published: result.value.cloudSongData.is_published
				};
				applied += 1;
			}
		}

		// Build the CloudSong objects for new entries from title results,
		// re-checking for manual links made during the async title-fetch
		// window. Entries that were clobbered by a manual link are skipped.
		const toApply: { i: number; song: CloudSong }[] = [];
		for (let idx = 0; idx < newEntries.length; idx++) {
			const { i, cloudId } = newEntries[idx];
			// Re-check after the async title fetches: the user may have manually
			// linked (or unlinked then re-linked) this song during the await
			// window. Without this guard, the restore would clobber the manual
			// link with the saved-link value.
			if (links[i]) continue;
			const songRow = songs[i];
			if (!songRow) continue;
			let song: CloudSong = {
				id: cloudId,
				title: `${PLACEHOLDER_PREFIX}${cloudId}`,
				artist: songRow.artist,
				is_published: false
			};
			if (fetchTitles) {
				const result = titleResults[idx];
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
			}
			toApply.push({ i, song });
		}

		// Fetch cloud charts in bounded-concurrency chunks (parallelized like
		// the title fetches above) so M saved links don't issue M sequential
		// fetchCloudSongCharts round-trips before the first upload byte.
		// State mutations are applied sequentially after all fetches complete
		// to avoid races on shared state (savedLinks spread, links map).
		const chartResults: PromiseSettledResult<FetchCloudSongChartsResult>[] = [];
		for (let i = 0; i < toApply.length; i += RESTORE_CONCURRENCY) {
			if (generation !== loadGeneration) return;
			const chunk = toApply.slice(i, i + RESTORE_CONCURRENCY);
			const results = await Promise.allSettled(
				chunk.map((e) =>
					desktopHost.fetchCloudSongCharts<FetchCloudSongChartsResult>(e.song.id)
				)
			);
			chartResults.push(...results);
		}
		if (generation !== loadGeneration) return;

		for (let idx = 0; idx < toApply.length; idx++) {
			const { i, song } = toApply[idx];
			// Final re-check: a manual link may have been made during the
			// chart-fetch await window.
			if (links[i]) continue;
			const songRow = songs[i];
			if (!songRow) continue;
			const chartResult = chartResults[idx];
			// Only commit the link when charts loaded successfully. A failed
			// fetch must leave the index unlinked so a later page/upload
			// restore retries instead of permanently storing an empty match
			// set that filters the entry out of future restores.
			if (chartResult.status !== 'fulfilled' || !chartResult.value.success) {
				continue;
			}
			const charts = chartResult.value.data ?? [];
			links[i] = song;
			savedLinks = { ...savedLinks, [songKey(songRow)]: song.id };
			cloudChartsBySong[i] = charts;
			matchesBySong[i] = matchCharts(songRow.charts, charts);
			applied += 1;
		}

		// Persist the full restored map once, not once per link.
		if (applied > 0) schedulePersist();
	};

	const restoreLinksForPage = (generation = loadGeneration) =>
		restoreLinksFor(pagedIndices, generation);

	const loadScores = async (path: string) => {
		const generation = ++loadGeneration;
		loading = true;
		error = null;
		currentPage = 1;
		try {
			const parsed = await desktopHost.parseDtxmaniaScores<DtxmaniaSong[]>(path);
			if (generation !== loadGeneration) return;
			songs = parsed;
			links = {};
			cloudChartsBySong = {};
			matchesBySong = {};
			uploadStatus = null;
			skipped = [];
			pruneSavedLinks();
			try {
				await restoreLinksForPage(generation);
			} catch {
				// restoreLinksFor handles per-link errors internally; swallow unexpected errors.
			}
		} catch (e) {
			if (generation !== loadGeneration) return;
			error = e instanceof Error ? e.message : $_('score.read_failed');
			songs = [];
		} finally {
			if (generation === loadGeneration) {
				loading = false;
			}
		}
	};

	const handleChooseDb = async () => {
		const result = await desktopHost.selectDtxmaniaDb();
		if (!result.canceled && result.filePaths[0]) {
			dbPath = result.filePaths[0];
			await loadScores(dbPath);
		}
	};

	// Cloud song IDs already linked to other local songs. Passed to each
	// card's autocomplete so already-linked cloud songs are hidden from
	// search results, preventing two local songs from linking to the same
	// cloud simfile (which would leave the second song's scores unuploaded
	// — buildUpload dedups by cloud chart ID). The current song's own link
	// is excluded from the list so the user can still see and re-pick it
	// when changing links.
	const excludeIdsFor = (songIndex: number): string[] => {
		const ids: string[] = [];
		for (const [i, existing] of Object.entries(links)) {
			if (Number(i) !== songIndex && existing) ids.push(existing.id);
		}
		// Also exclude cloud song IDs persisted for songs on unopened pages.
		// `links` only holds restored/loaded links for the visible page plus any
		// manually linked songs; saved links for songs on later pages live solely
		// in `savedLinks`. Without this, the autocomplete would permit linking a
		// visible song to a cloud simfile already persisted for an unopened page,
		// and buildUpload's per-chart-ID dedup would silently drop one song's
		// scores. Scope by the current dbPath prefix so links belonging to other
		// databases (kept in savedLinks for cross-DB persistence) don't false-
		// exclude a cloud song that a different database legitimately links to.
		const currentPrefix = dbPath ? `${dbPath}${SCORE_LINK_KEY_SEP}` : '';
		const ownKey = songs[songIndex] ? songKey(songs[songIndex]) : null;
		for (const [key, cloudId] of Object.entries(savedLinks)) {
			if (currentPrefix && !key.startsWith(currentPrefix)) continue;
			// Exclude the current song's own persisted link so the user can
			// still see and re-pick it when changing links, mirroring the
			// `links` loop's Number(i) !== songIndex guard above.
			if (ownKey && key === ownKey) continue;
			if (cloudId && !ids.includes(cloudId)) ids.push(cloudId);
		}
		return ids;
	};

	const handleLinkSelect = async (songIndex: number, song: CloudSong) => {
		links[songIndex] = song;
		savedLinks = { ...savedLinks, [songKey(songs[songIndex])]: song.id };
		schedulePersist();
		autocompleteFor = null;
		// Drop the prior link's charts/matches immediately. Until the new
		// link's chart fetch resolves there must be no stale cloud chart IDs
		// for this song: restoreLinksFor skips songs already present in
		// `links`, so an Upload during that window would otherwise pair the
		// new link with the old link's chart IDs and write scores to the
		// wrong cloud charts. An empty match makes buildUpload skip the song
		// (no chartId) until the fresh fetch lands.
		cloudChartsBySong[songIndex] = [];
		matchesBySong[songIndex] = [];
		const fetchWork = (async () => {
			try {
				const result = await desktopHost.fetchCloudSongCharts<FetchCloudSongChartsResult>(
					song.id
				);
				// Ignore stale responses: if the user changed the link to a different
				// song before this fetch resolved, discard the result so we don't
				// overwrite the current link's charts/matches with the prior link's.
				if (links[songIndex]?.id !== song.id) return;
				if (!result.success) {
					// Roll back the link so restoreLinksFor retries on the next
					// page/upload. Keeping the link with empty charts would leave
					// the song visibly linked but silently un-uploadable, and
					// restoreLinksFor skips songs already in `links` so the fetch
					// would never be retried. This mirrors restoreLinksFor's own
					// guard which does not commit a link when the chart fetch fails.
					delete links[songIndex];
					const key = songKey(songs[songIndex]);
					const nextSaved = { ...savedLinks };
					delete nextSaved[key];
					savedLinks = nextSaved;
					schedulePersist();
					cloudChartsBySong[songIndex] = [];
					matchesBySong[songIndex] = [];
					toastStore.error($_('score.fetch_charts_failed'));
					return;
				}
				const charts = result.data ?? [];
				cloudChartsBySong[songIndex] = charts;
				matchesBySong[songIndex] = matchCharts(songs[songIndex].charts, charts);
			} catch {
				if (links[songIndex]?.id !== song.id) return;
				// Same rollback as the !result.success branch above.
				delete links[songIndex];
				const key = songKey(songs[songIndex]);
				const nextSaved = { ...savedLinks };
				delete nextSaved[key];
				savedLinks = nextSaved;
				schedulePersist();
				cloudChartsBySong[songIndex] = [];
				matchesBySong[songIndex] = [];
				toastStore.error($_('score.fetch_charts_failed'));
			}
		})();
		inflightLinkFetches.add(fetchWork);
		linkingCharts = true;
		try {
			await fetchWork;
		} finally {
			inflightLinkFetches.delete(fetchWork);
			linkingCharts = inflightLinkFetches.size > 0;
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
			fullCombo: boolean;
			maxCombo: number;
			bestAchievementRate: number | null;
			bestRankLabel: string | null;
			lastPlayedAt: string | null;
			scores: ScorePayload[];
		}>;
		clientSkipped: { chartId: string; reason: string }[];
	} => {
		const charts: Array<{
			chartId: string;
			playCount: number;
			clearCount: number;
			fullCombo: boolean;
			maxCombo: number;
			bestAchievementRate: number | null;
			bestRankLabel: string | null;
			lastPlayedAt: string | null;
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
				const scores = [...(chart.best ? [chart.best] : []), ...chart.recent];
				// Skip empty charts before reserving the chart ID. A chart with
				// no best/recent rows produces no upload, so it must not block a
				// later chart that links to the same cloud chart ID but actually
				// has scores to send.
				if (scores.length === 0) return;
				// Deduplicate: never send the same cloud chart ID twice. Surface
				// the dropped match so the user knows a chart was skipped, not
				// silently lost.
				if (seenChartIds.has(chartId)) {
					const label = chart.difficultyLabel || $_('score.drums_fallback');
					clientSkipped.push({
						chartId,
						reason: $_('score.duplicate_match', {
							values: { title: song.title, label }
						})
					});
					return;
				}
				seenChartIds.add(chartId);
				charts.push({
					chartId,
					playCount: chart.aggregate.playCount,
					clearCount: chart.aggregate.clearCount,
					fullCombo: chart.aggregate.fullCombo,
					maxCombo: chart.aggregate.maxCombo,
					bestAchievementRate: chart.aggregate.bestAchievementRate,
					bestRankLabel: chart.aggregate.bestRankLabel,
					lastPlayedAt: chart.aggregate.lastPlayedAt,
					scores
				});
			});
		});
		return { charts, clientSkipped };
	};

	// Initial batch size for uploadScores. The server (score.ts) returns a
	// sentinel skip with chartId '*' when a batch exceeds its MAX_UPLOAD_CHARTS
	// cap; the client detects that sentinel and halves the batch size,
	// retrying without advancing — so this value is a starting hint, not a
	// hard coupling to the server cap. If the server cap is lowered, the
	// client adapts automatically instead of silently dropping batches.
	const INITIAL_BATCH_SIZE = 100;

	const handleUpload = async () => {
		if (uploading || loading) return;
		uploading = true;
		uploadStatus = $_('score.uploading');
		skipped = [];
		// Counters live outside the try so a thrown batch rejection still
		// reports how many charts/scores already committed, and so server
		// skips from earlier successful batches are not lost.
		let totalUpdated = 0;
		let totalInserted = 0;
		const serverSkipped: { chartId: string; reason: string }[] = [];
		let clientSkipped: { chartId: string; reason: string }[] = [];
		// The try/finally wraps the ENTIRE post-guard body (restore + build +
		// batch loop) so a throw anywhere resets `uploading`. Previously
		// restoreLinksFor/buildUpload ran before the try, so a mid-upload
		// Reparse click (not disabled during upload) could set songs = [] →
		// restoreLinksFor read songs[i] undefined → threw → finally never ran
		// → Upload button stuck disabled forever.
		try {
			// Wait for any in-flight manual link chart fetches. restoreLinksFor
			// skips songs already in `links`, so without this a fast Upload
			// after linking would build an empty payload.
			if (inflightLinkFetches.size > 0) {
				await Promise.allSettled([...inflightLinkFetches]);
			}
			// Paging only restores cloud links for the visible page. Upload walks
			// the full `songs` array, so restore every saved link first — upload is
			// an explicit user action, so the burst of chart fetches is expected
			// and the user is already waiting on the result. Title lookup is
			// cosmetic on this path (matching only needs charts), so skip it to
			// roughly halve the restore requests. Songs already linked are
			// skipped inside restoreLinksFor.
			await restoreLinksFor(
				songs.map((_, i) => i),
				loadGeneration,
				{ fetchTitles: false }
			);
			const input = buildUpload();
			if (input.charts.length === 0) {
				uploadStatus = $_('score.nothing_to_upload');
				return;
			}
			// Surface client-side skips (duplicate chart matches) alongside any
			// server-side skips returned in the upload response.
			clientSkipped = input.clientSkipped;
			skipped = clientSkipped;
			// Adaptive batching: start at INITIAL_BATCH_SIZE and halve whenever
			// the server returns the "too many charts" sentinel (chartId '*'),
			// retrying the same charts without advancing. This decouples the
			// client from the server's exact MAX_UPLOAD_CHARTS cap — if the cap
			// is lowered server-side, the client shrinks its batches instead of
			// silently dropping them.
			let batchSize = INITIAL_BATCH_SIZE;
			let i = 0;
			while (i < input.charts.length) {
				const batch = input.charts.slice(i, i + batchSize);
				const result = await desktopHost.uploadScores<UploadScoresResult>({
					charts: batch
				});
				if (!result.success || !result.data) {
					// Earlier batches in this loop already committed server-side.
					// Surface the partial progress so the user knows what landed
					// before the failure, instead of a bare "Upload failed."
					const partial =
						totalUpdated > 0 || totalInserted > 0
							? ' ' +
								$_('score.partial_upload', {
									values: { updated: totalUpdated, inserted: totalInserted }
								})
							: '';
					uploadStatus = `${result.error ?? $_('score.upload_failed')}${partial}`;
					// Merge accumulated server skips from already-committed batches
					// before returning — otherwise rejected charts (e.g. "chart not
					// found") from successful earlier batches are lost.
					skipped = [...clientSkipped, ...serverSkipped];
					return;
				}
				// Detect the sentinel "too many charts" skip. The server returns
				// it as a successful response with 0 updated/inserted — without
				// this guard the batch would be silently dropped. Halve the batch
				// size and retry the same charts. A single-chart batch that still
				// hits the sentinel means the server cap is 0 (or broken) —
				// surface the sentinel skip and give up on this chart.
				const sentinel = (result.data.skipped ?? []).find((s) => s.chartId === '*');
				if (sentinel && batch.length > 1) {
					batchSize = Math.max(1, Math.floor(batchSize / 2));
					continue;
				}
				totalUpdated += result.data.updatedCharts;
				totalInserted += result.data.insertedScores;
				serverSkipped.push(...(result.data.skipped ?? []));
				i += batch.length;
			}
			uploadStatus = $_('score.uploaded', {
				values: { updated: totalUpdated, inserted: totalInserted }
			});
			skipped = [...clientSkipped, ...serverSkipped];
		} catch (e) {
			const partial =
				totalUpdated > 0 || totalInserted > 0
					? ' ' +
						$_('score.partial_upload', {
							values: { updated: totalUpdated, inserted: totalInserted }
						})
					: '';
			uploadStatus = `${e instanceof Error ? e.message : $_('score.upload_failed')}${partial}`;
			skipped = [...clientSkipped, ...serverSkipped];
		} finally {
			uploading = false;
		}
	};
</script>

<div class="bg-base text-base-text min-w-0 flex-1 overflow-auto p-6">
	<div class="mb-4 flex items-center gap-3">
		<Trophy size={22} class="text-cyan" />
		<h1 class="font-display text-hi text-xl font-semibold">{$_('score.title')}</h1>
		<div class="ml-auto flex items-center gap-2">
			<button
				class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
				onclick={handleChooseDb}
				disabled={uploading || loading || linkingCharts}
			>
				<FolderOpen size={16} />
				{$_('score.choose_db')}
			</button>
			{#if dbPath}
				<button
					class="border-hairline bg-surface-1 hover:bg-surface-2 text-dim inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm disabled:opacity-50"
					onclick={() => dbPath && loadScores(dbPath)}
					disabled={uploading || loading || linkingCharts}
				>
					<RefreshCw size={16} />
					{$_('score.reparse')}
				</button>
				<button
					class="border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
					onclick={handleUpload}
					disabled={uploading || loading || linkingCharts}
				>
					<Upload size={16} />
					{$_('score.upload')}
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
				<li>
					{$_('score.chart_skipped', {
						values: { chartId: row.chartId, reason: humanizeSkipReason(row.reason) }
					})}
				</li>
			{/each}
		</ul>
	{/if}

	{#if loading}
		<p class="text-dim text-sm">{$_('score.reading')}</p>
	{:else if error}
		<p class="text-sm text-red-300">{error}</p>
	{:else if !dbPath}
		<p class="text-dim text-sm">
			{$_('score.no_db')}
		</p>
	{:else if songs.length === 0}
		<p class="text-dim text-sm">{$_('score.empty')}</p>
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
					{uploading}
					excludeLinkedSongIds={excludeIdsFor(songIndex)}
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
