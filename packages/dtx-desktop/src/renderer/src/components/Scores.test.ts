import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

const host = vi.hoisted(() => ({
	defaultDtxmaniaDbPath: vi.fn(),
	selectDtxmaniaDb: vi.fn(),
	parseDtxmaniaScores: vi.fn(),
	fetchCloudSong: vi.fn(),
	fetchCloudSongCharts: vi.fn(),
	uploadScores: vi.fn(),
	searchCloudSongs: vi.fn(),
	readScoreSongLinks: vi.fn(),
	writeScoreSongLinks: vi.fn()
}));
vi.mock('@/services/desktopHost', () => ({ desktopHost: host }));

import Scores from './Scores.svelte';

const bestRow = {
	isBest: true,
	score: 950000,
	// 75.0 falls in the A band (73 ≤ rate < 80) per derive_rank_label in
	// scores.rs, so rankLabel:'A' is internally consistent. (91.3 would be S.)
	achievementRate: 75.0,
	rankLabel: 'A',
	fullCombo: true,
	cleared: true,
	maxCombo: 800,
	perfect: 500,
	great: 30,
	good: 10,
	poor: 5,
	miss: 2,
	performedAt: '2026-06-02',
	displayOrder: null
};
const recentRow = {
	isBest: false,
	score: null,
	achievementRate: 91.3,
	rankLabel: 'S',
	fullCombo: false,
	cleared: true,
	maxCombo: null,
	perfect: null,
	great: null,
	good: null,
	poor: null,
	miss: null,
	performedAt: '2026-06-02T00:00:00',
	displayOrder: 1
};
const parsedSongs = [
	{
		songId: 1,
		title: 'Played Song',
		artist: 'Artist A',
		genre: 'Rock',
		charts: [
			{
				difficultyLevel: 2,
				difficultyLabel: 'BASIC',
				drumLevel: 55,
				fileHash: 'hash-basic',
				aggregate: { playCount: 7, clearCount: 5 },
				best: bestRow,
				recent: [recentRow]
			}
		]
	}
];

beforeEach(() => {
	Object.values(host).forEach((fn) => fn.mockReset());
	host.defaultDtxmaniaDbPath.mockResolvedValue('/path/songs.db');
	host.parseDtxmaniaScores.mockResolvedValue(parsedSongs);
	host.searchCloudSongs.mockResolvedValue({
		success: true,
		data: [{ id: '42', title: 'Cloud Song', artist: 'Artist A', is_published: true }]
	});
	host.fetchCloudSong.mockResolvedValue({
		success: true,
		cloudSongData: { id: 42, title: 'Cloud Song', artist: 'Artist A', is_published: true }
	});
	host.fetchCloudSongCharts.mockResolvedValue({
		success: true,
		data: [{ id: '10', label: 'BASIC', level: 55 }]
	});
	host.uploadScores.mockResolvedValue({
		success: true,
		data: { updatedCharts: 1, insertedScores: 2, skipped: [] }
	});
	host.readScoreSongLinks.mockResolvedValue({});
	host.writeScoreSongLinks.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('Scores', () => {
	it('parses the default db and renders songs, charts, and the best score', async () => {
		render(Scores);
		await waitFor(() =>
			expect(host.parseDtxmaniaScores).toHaveBeenCalledWith('/path/songs.db')
		);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();
		expect(screen.getByText(/950,?000/)).toBeInTheDocument();
	});

	it('links a cloud song, auto-matches the chart, and uploads the expected payload', async () => {
		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Open the link autocomplete for the song.
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));

		// Drive the real CloudSongAutocomplete (300ms debounce elapses inside waitFor).
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		const suggestion = await screen.findByText('Cloud Song');
		await fireEvent.click(suggestion);

		// After select, charts are fetched and matched.
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// Upload.
		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		await waitFor(() =>
			expect(host.uploadScores).toHaveBeenCalledWith({
				charts: [
					{
						chartId: '10',
						playCount: 7,
						clearCount: 5,
						scores: [bestRow, recentRow]
					}
				]
			})
		);
		expect(await screen.findByText(/uploaded 1 chart/i)).toBeInTheDocument();
	});

	it('flags an unmatched chart when no cloud chart matches', async () => {
		host.fetchCloudSongCharts.mockResolvedValue({ success: true, data: [] });
		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		expect(await screen.findByText(/unmatched/i)).toBeInTheDocument();
	});

	it('persists a link selection and restores it on next mount', async () => {
		const { unmount } = render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));

		await waitFor(() =>
			expect(host.writeScoreSongLinks).toHaveBeenCalledWith({
				['/path/songs.db\u001f1']: '42'
			})
		);
		unmount();

		// Next mount: saved link is restored -> fetchCloudSong fetches the real
		// title, then fetchCloudSongCharts is called for '42'.
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		host.fetchCloudSong.mockClear();
		host.fetchCloudSongCharts.mockClear();
		render(Scores);
		await waitFor(() => expect(host.fetchCloudSong).toHaveBeenCalledWith('42'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));
		// The restored link shows the real cloud title, not a "Simfile #42" placeholder.
		expect(await screen.findByText('Linked: Cloud Song')).toBeInTheDocument();
	});

	it('prunes orphaned saved links for songs no longer in the database', async () => {
		// savedLinks has one live entry for this db, one orphan for this db,
		// one legacy unscoped key, and one link scoped to a different db
		// (which must be preserved).
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42',
			['/path/songs.db\u001f999']: '99',
			['1']: 'legacy',
			['/other/songs.db\u001f1']: '77'
		});

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Orphans for this db and legacy unscoped keys are dropped; other-db
		// links are kept.
		await waitFor(() =>
			expect(host.writeScoreSongLinks).toHaveBeenCalledWith({
				['/path/songs.db\u001f1']: '42',
				['/other/songs.db\u001f1']: '77'
			})
		);
	});

	it('paginates the parsed songs, rendering one page at a time', async () => {
		const manySongs = Array.from({ length: 25 }, (_, i) => ({
			songId: i + 1,
			title: `Song ${i + 1}`,
			artist: 'Artist',
			genre: 'Rock',
			charts: [
				{
					difficultyLevel: 2,
					difficultyLabel: 'BASIC',
					drumLevel: 55,
					fileHash: `hash-${i}`,
					aggregate: { playCount: 1, clearCount: 1 },
					best: bestRow,
					recent: []
				}
			]
		}));
		host.parseDtxmaniaScores.mockResolvedValue(manySongs);

		render(Scores);

		// Page 1 renders only the first 10 songs.
		expect(await screen.findByText('Song 1')).toBeInTheDocument();
		expect(screen.getByText('Song 10')).toBeInTheDocument();
		expect(screen.queryByText('Song 11')).not.toBeInTheDocument();

		// Navigating to page 2 renders the next slice and drops the first page.
		await fireEvent.click(screen.getByText('2'));

		expect(await screen.findByText('Song 11')).toBeInTheDocument();
		expect(screen.getByText('Song 20')).toBeInTheDocument();
		expect(screen.queryByText('Song 1')).not.toBeInTheDocument();
		expect(screen.queryByText('Song 21')).not.toBeInTheDocument();
	});

	it('refreshes placeholder titles for off-page songs after an upload-time restore', async () => {
		// 11 songs (2 pages). Song 11 is on page 2 and has a saved link to
		// cloudId '42'. The initial load only restores page 1, so song 11 has
		// no link yet. Upload restores ALL songs with fetchTitles:false, which
		// commits a placeholder "Simfile #42" link for song 11 (charts are
		// fetched, titles are not). Navigating to page 2 must then refresh
		// the placeholder title via fetchCloudSong without re-fetching charts.
		const songs = Array.from({ length: 11 }, (_, i) => ({
			songId: i + 1,
			title: `Song ${i + 1}`,
			artist: 'Artist',
			genre: 'Rock',
			charts: [
				{
					difficultyLevel: 2,
					difficultyLabel: 'BASIC',
					drumLevel: 55,
					fileHash: `hash-${i}`,
					aggregate: { playCount: 1, clearCount: 1 },
					best: bestRow,
					recent: []
				}
			]
		}));
		host.parseDtxmaniaScores.mockResolvedValue(songs);
		// Saved link for song 11 (page 2) only.
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f11']: '42'
		});
		host.fetchCloudSong.mockResolvedValue({
			success: true,
			cloudSongData: {
				id: 42,
				title: 'Cloud Song 11',
				artist: 'Artist',
				is_published: true
			}
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: [{ id: '10', label: 'BASIC', level: 55 }]
		});

		render(Scores);
		expect(await screen.findByText('Song 1')).toBeInTheDocument();
		// Page 1 restore must not have fetched the title for song 11's link.
		expect(host.fetchCloudSong).not.toHaveBeenCalledWith('42');

		// Upload restores all songs with fetchTitles:false → song 11 gets a
		// placeholder link (charts fetched, title not).
		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));
		// fetchCloudSong must still NOT have been called — upload skips titles.
		expect(host.fetchCloudSong).not.toHaveBeenCalledWith('42');

		// Clear chart fetch calls so we can assert no re-fetch on page nav.
		host.fetchCloudSongCharts.mockClear();

		// Navigate to page 2 — the placeholder title must be refreshed.
		await fireEvent.click(screen.getByText('2'));
		await waitFor(() => expect(host.fetchCloudSong).toHaveBeenCalledWith('42'));
		// Charts must NOT be re-fetched (they were loaded during upload).
		expect(host.fetchCloudSongCharts).not.toHaveBeenCalled();
		// The real title is now shown, not the "Simfile #42" placeholder.
		expect(await screen.findByText('Linked: Cloud Song 11')).toBeInTheDocument();
	});

	it('collapses and expands a song to hide and show its charts', async () => {
		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();
		// Charts are shown by default (the best score is visible).
		expect(screen.getByText(/950,?000/)).toBeInTheDocument();

		// Collapsing hides the chart details but keeps the song header.
		await fireEvent.click(screen.getByRole('button', { name: /toggle played song/i }));
		expect(screen.getByText('Played Song')).toBeInTheDocument();
		expect(screen.queryByText(/950,?000/)).not.toBeInTheDocument();

		// Expanding again brings the charts back.
		await fireEvent.click(screen.getByRole('button', { name: /toggle played song/i }));
		expect(screen.getByText(/950,?000/)).toBeInTheDocument();
	});

	it('shows the no-db prompt when no default songs.db is found', async () => {
		host.defaultDtxmaniaDbPath.mockResolvedValue(null);
		render(Scores);
		expect(await screen.findByText(/No DTXManiaCX/i)).toBeInTheDocument();
		expect(host.parseDtxmaniaScores).not.toHaveBeenCalled();
	});

	it('shows an error message when parsing the database fails', async () => {
		host.parseDtxmaniaScores.mockRejectedValue(new Error('corrupt db'));
		render(Scores);
		expect(await screen.findByText('corrupt db')).toBeInTheDocument();
	});

	it('does not wipe saved links when parsing fails (transient DB lock)', async () => {
		// savedLinks has entries that must survive a transient parse failure.
		host.readScoreSongLinks.mockResolvedValue({
			['Played Song\u0000Artist A\u0000Rock']: '42',
			['Other Song\u0000Artist B\u0000Pop']: '88'
		});
		host.parseDtxmaniaScores.mockRejectedValue(new Error('database is locked'));

		render(Scores);
		expect(await screen.findByText('database is locked')).toBeInTheDocument();

		// On a parse failure `loadScores` sets songs=[] and never reaches the
		// prune/restore path, so NO persistence write may occur — not even an
		// empty or partial link set, which would wipe saved links on a
		// transient DB lock.
		expect(host.writeScoreSongLinks).not.toHaveBeenCalled();
	});

	it('shows the empty state when the database has no drum scores', async () => {
		host.parseDtxmaniaScores.mockResolvedValue([]);
		render(Scores);
		expect(await screen.findByText(/No drum scores found/i)).toBeInTheDocument();
	});

	it('loads scores from a manually chosen songs.db', async () => {
		host.defaultDtxmaniaDbPath.mockResolvedValue(null);
		host.selectDtxmaniaDb.mockResolvedValue({
			canceled: false,
			filePaths: ['/custom/songs.db']
		});
		host.parseDtxmaniaScores.mockResolvedValue(parsedSongs);

		render(Scores);
		expect(await screen.findByText(/No DTXManiaCX/i)).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /choose songs\.db/i }));
		await waitFor(() =>
			expect(host.parseDtxmaniaScores).toHaveBeenCalledWith('/custom/songs.db')
		);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();
	});

	it('does not load when the file picker is canceled', async () => {
		host.defaultDtxmaniaDbPath.mockResolvedValue(null);
		host.selectDtxmaniaDb.mockResolvedValue({ canceled: true, filePaths: [] });

		render(Scores);
		expect(await screen.findByText(/No DTXManiaCX/i)).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /choose songs\.db/i }));
		expect(host.parseDtxmaniaScores).not.toHaveBeenCalled();
	});

	it('does not let a late default-db resolution overwrite a manually chosen db', async () => {
		// The default-path lookup resolves slowly; the user picks a DB before
		// it lands. The onMount continuation must not overwrite dbPath or
		// start a competing parse against the default path. Regression guard
		// for the startup race where the chooser is enabled (loading=false)
		// during the onMount awaits.
		let resolveDefault!: (v: string | null) => void;
		host.defaultDtxmaniaDbPath.mockReturnValue(
			new Promise<string | null>((resolve) => {
				resolveDefault = resolve;
			})
		);
		host.selectDtxmaniaDb.mockResolvedValue({
			canceled: false,
			filePaths: ['/custom/songs.db']
		});
		host.parseDtxmaniaScores.mockResolvedValue(parsedSongs);

		render(Scores);

		// readScoreSongLinks resolves synchronously, so the chooser is
		// clickable while defaultDtxmaniaDbPath is still pending.
		await fireEvent.click(await screen.findByRole('button', { name: /choose songs\.db/i }));
		await waitFor(() =>
			expect(host.parseDtxmaniaScores).toHaveBeenCalledWith('/custom/songs.db')
		);

		// Release the late default-path resolution. It must NOT trigger a
		// second parse against the default path.
		resolveDefault('/default/songs.db');
		await Promise.resolve();
		await Promise.resolve();
		expect(host.parseDtxmaniaScores).not.toHaveBeenCalledWith('/default/songs.db');
		expect(await screen.findByText('Played Song')).toBeInTheDocument();
	});

	it('shows nothing-to-upload when no songs are linked', async () => {
		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		expect(await screen.findByText(/Nothing to upload/i)).toBeInTheDocument();
		expect(host.uploadScores).not.toHaveBeenCalled();
	});

	it('shows an error message when the upload fails', async () => {
		host.uploadScores.mockResolvedValue({ success: false, error: 'Server exploded' });

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Link the song first so there's something to upload.
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		expect(await screen.findByText('Server exploded')).toBeInTheDocument();
	});

	it('renders skipped chart details after a partial upload', async () => {
		host.uploadScores.mockResolvedValue({
			success: true,
			data: {
				updatedCharts: 0,
				insertedScores: 0,
				skipped: [{ chartId: '10', reason: 'chart not found' }]
			}
		});

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		expect(await screen.findByText(/Chart 10 skipped/i)).toBeInTheDocument();
		expect(screen.getByText(/chart not found/i)).toBeInTheDocument();
	});

	it('shows no-best-score placeholder for a chart without a best row', async () => {
		host.parseDtxmaniaScores.mockResolvedValue([
			{
				title: 'No Best Song',
				artist: 'Artist B',
				genre: 'Pop',
				charts: [
					{
						difficultyLevel: 2,
						difficultyLabel: 'BASIC',
						drumLevel: 55,
						fileHash: 'hash-nb',
						aggregate: { playCount: 0, clearCount: 0 },
						best: null,
						recent: []
					}
				]
			}
		]);

		render(Scores);
		expect(await screen.findByText('No Best Song')).toBeInTheDocument();
		expect(screen.getByText(/No best score recorded/i)).toBeInTheDocument();
	});

	it('overrides a chart match via the target-chart select dropdown', async () => {
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: [
				{ id: '10', label: 'BASIC', level: 55 },
				{ id: '11', label: 'EXTREME', level: 88 }
			]
		});

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// The auto-match selects chart '10'. Override to '11' via the dropdown.
		const select = await screen.findByRole('combobox');
		await fireEvent.change(select, { target: { value: '11' } });

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		await waitFor(() =>
			expect(host.uploadScores).toHaveBeenCalledWith({
				charts: [
					{
						chartId: '11',
						playCount: 7,
						clearCount: 5,
						scores: [bestRow, recentRow]
					}
				]
			})
		);
	});

	it('surfaces cross-song duplicate chart matches as skipped instead of silently dropping them', async () => {
		// Two songs, each with one BASIC chart. Both are linked to the same
		// cloud song whose only chart is '10' — so both auto-match to chartId
		// '10'. The upload must send only the first and surface the second as
		// a client-side skipped duplicate.
		const twoSongs = [
			{
				songId: 1,
				title: 'First Song',
				artist: 'Artist A',
				genre: 'Rock',
				charts: [
					{
						difficultyLevel: 2,
						difficultyLabel: 'BASIC',
						drumLevel: 55,
						fileHash: 'hash-a',
						aggregate: { playCount: 7, clearCount: 5 },
						best: bestRow,
						recent: [recentRow]
					}
				]
			},
			{
				songId: 2,
				title: 'Second Song',
				artist: 'Artist B',
				genre: 'Pop',
				charts: [
					{
						difficultyLevel: 2,
						difficultyLabel: 'BASIC',
						drumLevel: 55,
						fileHash: 'hash-b',
						aggregate: { playCount: 3, clearCount: 1 },
						best: bestRow,
						recent: []
					}
				]
			}
		];
		host.parseDtxmaniaScores.mockResolvedValue(twoSongs);
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42',
			['/path/songs.db\u001f2']: '42'
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: [{ id: '10', label: 'BASIC', level: 55 }]
		});

		render(Scores);
		// Wait for both songs to render and their links to restore.
		expect(await screen.findByText('First Song')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByText('Second Song')).toBeInTheDocument());
		// Wait for both chart fetches to complete so matches are populated.
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledTimes(2));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));

		// The upload payload contains only the first chart; the second is
		// dropped as a duplicate.
		await waitFor(() =>
			expect(host.uploadScores).toHaveBeenCalledWith({
				charts: [
					{
						chartId: '10',
						playCount: 7,
						clearCount: 5,
						scores: [bestRow, recentRow]
					}
				]
			})
		);

		// The skipped duplicate is surfaced to the user.
		expect(await screen.findByText(/Chart 10 skipped/i)).toBeInTheDocument();
		expect(screen.getByText(/duplicate match/i)).toBeInTheDocument();
	});

	it('does not skip a chart with scores when an empty chart reserved the same cloud ID first', async () => {
		// Two songs linked to the same cloud chart '10'. The first song has
		// no best/recent rows (empty), the second has scores. The empty chart
		// must NOT reserve the cloud chart ID — otherwise the second chart's
		// scores are silently dropped as a "duplicate".
		const twoSongs = [
			{
				songId: 1,
				title: 'Empty Song',
				artist: 'Artist A',
				genre: 'Rock',
				charts: [
					{
						difficultyLevel: 2,
						difficultyLabel: 'BASIC',
						drumLevel: 55,
						fileHash: 'hash-empty',
						aggregate: { playCount: 0, clearCount: 0 },
						best: null,
						recent: []
					}
				]
			},
			{
				songId: 2,
				title: 'Played Song',
				artist: 'Artist B',
				genre: 'Pop',
				charts: [
					{
						difficultyLevel: 2,
						difficultyLabel: 'BASIC',
						drumLevel: 55,
						fileHash: 'hash-played',
						aggregate: { playCount: 3, clearCount: 1 },
						best: bestRow,
						recent: []
					}
				]
			}
		];
		host.parseDtxmaniaScores.mockResolvedValue(twoSongs);
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42',
			['/path/songs.db\u001f2']: '42'
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: [{ id: '10', label: 'BASIC', level: 55 }]
		});

		render(Scores);
		expect(await screen.findByText('Empty Song')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByText('Played Song')).toBeInTheDocument());
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledTimes(2));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));

		// The played chart's scores must be uploaded — not skipped as a
		// duplicate of the empty chart.
		await waitFor(() =>
			expect(host.uploadScores).toHaveBeenCalledWith({
				charts: [
					{
						chartId: '10',
						playCount: 3,
						clearCount: 1,
						scores: [bestRow]
					}
				]
			})
		);
		expect(screen.queryByText(/duplicate match/i)).not.toBeInTheDocument();
	});

	it('chunks uploads into ≤100-chart batches when the payload exceeds the server limit', async () => {
		// 101 charts on one song, each at a unique drum level matched to a
		// unique cloud chart, so buildUpload produces 101 chart entries —
		// exceeding the server's MAX_UPLOAD_CHARTS=100 cap.
		const charts = Array.from({ length: 101 }, (_, i) => ({
			difficultyLevel: 2,
			difficultyLabel: `LV${i}`,
			drumLevel: i,
			fileHash: `hash-${i}`,
			aggregate: { playCount: 1, clearCount: 1 },
			best: bestRow,
			recent: []
		}));
		host.parseDtxmaniaScores.mockResolvedValue([
			{ songId: 1, title: 'Mega Song', artist: 'Artist A', genre: 'Rock', charts }
		]);
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		host.fetchCloudSong.mockResolvedValue({
			success: true,
			cloudSongData: {
				id: 42,
				title: 'Cloud Mega Song',
				artist: 'Artist A',
				is_published: true
			}
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: charts.map((c, i) => ({
				id: `${1000 + i}`,
				label: `LV${i}`,
				level: i
			}))
		});
		host.uploadScores.mockImplementation(async (payload: { charts: unknown[] }) => ({
			success: true,
			data: {
				updatedCharts: payload.charts.length,
				insertedScores: payload.charts.length * 2,
				skipped: []
			}
		}));

		render(Scores);
		expect(await screen.findByText('Mega Song')).toBeInTheDocument();
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));

		// Two batches: first 100 charts, then the remaining 1.
		await waitFor(() => expect(host.uploadScores).toHaveBeenCalledTimes(2));
		expect(host.uploadScores.mock.calls[0][0].charts).toHaveLength(100);
		expect(host.uploadScores.mock.calls[1][0].charts).toHaveLength(1);
		expect(await screen.findByText(/uploaded 101 chart/i)).toBeInTheDocument();
	}, 20_000);

	it('halves the batch size and retries when the server returns the "too many charts" sentinel', async () => {
		// 101 charts. The server rejects the first 100-chart batch with the
		// sentinel skip (chartId: '*'), meaning the server cap is lower than
		// the client's initial batch size. The client must halve to 50 and
		// retry — not silently drop the batch. The 50-chart batch succeeds,
		// then 50, then 1.
		const charts = Array.from({ length: 101 }, (_, i) => ({
			difficultyLevel: 2,
			difficultyLabel: `LV${i}`,
			drumLevel: i,
			fileHash: `hash-${i}`,
			aggregate: { playCount: 1, clearCount: 1 },
			best: bestRow,
			recent: []
		}));
		host.parseDtxmaniaScores.mockResolvedValue([
			{ songId: 1, title: 'Mega Song', artist: 'Artist A', genre: 'Rock', charts }
		]);
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		host.fetchCloudSong.mockResolvedValue({
			success: true,
			cloudSongData: {
				id: 42,
				title: 'Cloud Mega Song',
				artist: 'Artist A',
				is_published: true
			}
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: charts.map((c, i) => ({
				id: `${1000 + i}`,
				label: `LV${i}`,
				level: i
			}))
		});
		host.uploadScores.mockImplementation(async (payload: { charts: unknown[] }) => {
			// First call (100 charts) → sentinel skip (server cap < 100).
			if (payload.charts.length > 50) {
				return {
					success: true,
					data: {
						updatedCharts: 0,
						insertedScores: 0,
						skipped: [{ chartId: '*', reason: 'too many charts (max 50)' }]
					}
				};
			}
			return {
				success: true,
				data: {
					updatedCharts: payload.charts.length,
					insertedScores: payload.charts.length * 2,
					skipped: []
				}
			};
		});

		render(Scores);
		expect(await screen.findByText('Mega Song')).toBeInTheDocument();
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));

		// The first 100-chart batch hits the sentinel; the client halves to
		// 50 and retries. Three successful batches: 50 + 50 + 1 = 101.
		await waitFor(() => expect(host.uploadScores).toHaveBeenCalledTimes(4));
		expect(host.uploadScores.mock.calls[0][0].charts).toHaveLength(100);
		expect(host.uploadScores.mock.calls[1][0].charts).toHaveLength(50);
		expect(host.uploadScores.mock.calls[2][0].charts).toHaveLength(50);
		expect(host.uploadScores.mock.calls[3][0].charts).toHaveLength(1);
		expect(await screen.findByText(/uploaded 101 chart/i)).toBeInTheDocument();
	}, 20_000);

	it('surfaces partial success when a mid-batch failure leaves earlier batches committed', async () => {
		// 101 charts → two batches (100 + 1). The first batch succeeds, the
		// second fails. The status must include both the error and the counts
		// from the already-committed first batch.
		const charts = Array.from({ length: 101 }, (_, i) => ({
			difficultyLevel: 2,
			difficultyLabel: `LV${i}`,
			drumLevel: i,
			fileHash: `hash-${i}`,
			aggregate: { playCount: 1, clearCount: 1 },
			best: bestRow,
			recent: []
		}));
		host.parseDtxmaniaScores.mockResolvedValue([
			{ songId: 1, title: 'Mega Song', artist: 'Artist A', genre: 'Rock', charts }
		]);
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		host.fetchCloudSong.mockResolvedValue({
			success: true,
			cloudSongData: {
				id: 42,
				title: 'Cloud Mega Song',
				artist: 'Artist A',
				is_published: true
			}
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: charts.map((c, i) => ({
				id: `${1000 + i}`,
				label: `LV${i}`,
				level: i
			}))
		});
		let callCount = 0;
		host.uploadScores.mockImplementation(async (payload: { charts: unknown[] }) => {
			callCount++;
			if (callCount === 1) {
				return {
					success: true,
					data: {
						updatedCharts: payload.charts.length,
						insertedScores: payload.charts.length * 2,
						skipped: []
					}
				};
			}
			return { success: false, error: 'Server exploded on batch 2' };
		});

		render(Scores);
		expect(await screen.findByText('Mega Song')).toBeInTheDocument();
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));

		await waitFor(() => expect(host.uploadScores).toHaveBeenCalledTimes(2));
		expect(await screen.findByText(/server exploded on batch 2/i)).toBeInTheDocument();
		expect(screen.getByText(/partial upload: 100 chart/i)).toBeInTheDocument();
		expect(screen.getByText(/200 score/i)).toBeInTheDocument();
	}, 20_000);

	it('retains server skips from earlier batches when a later batch fails', async () => {
		// 101 charts -> two batches (100 + 1). The first batch succeeds but
		// returns server-side skips (e.g. "chart not found"). The second batch
		// fails. The skipped charts from the committed first batch must still
		// be surfaced — previously the early return dropped them.
		const charts = Array.from({ length: 101 }, (_, i) => ({
			difficultyLevel: 2,
			difficultyLabel: `LV${i}`,
			drumLevel: i,
			fileHash: `hash-${i}`,
			aggregate: { playCount: 1, clearCount: 1 },
			best: bestRow,
			recent: []
		}));
		host.parseDtxmaniaScores.mockResolvedValue([
			{ songId: 1, title: 'Mega Song', artist: 'Artist A', genre: 'Rock', charts }
		]);
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		host.fetchCloudSong.mockResolvedValue({
			success: true,
			cloudSongData: {
				id: 42,
				title: 'Cloud Mega Song',
				artist: 'Artist A',
				is_published: true
			}
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: charts.map((c, i) => ({
				id: `${1000 + i}`,
				label: `LV${i}`,
				level: i
			}))
		});
		let callCount = 0;
		host.uploadScores.mockImplementation(async (payload: { charts: unknown[] }) => {
			callCount++;
			if (callCount === 1) {
				return {
					success: true,
					data: {
						updatedCharts: payload.charts.length - 2,
						insertedScores: (payload.charts.length - 2) * 2,
						skipped: [
							{ chartId: '1000', reason: 'chart not found' },
							{ chartId: '1001', reason: 'chart not found' }
						]
					}
				};
			}
			return { success: false, error: 'Server exploded on batch 2' };
		});

		render(Scores);
		expect(await screen.findByText('Mega Song')).toBeInTheDocument();
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));

		await waitFor(() => expect(host.uploadScores).toHaveBeenCalledTimes(2));
		expect(await screen.findByText(/server exploded on batch 2/i)).toBeInTheDocument();
		// The two server-skipped charts from the committed first batch are
		// retained and rendered, not lost to the early return.
		expect(screen.getByText(/Chart 1000 skipped/i)).toBeInTheDocument();
		expect(screen.getByText(/Chart 1001 skipped/i)).toBeInTheDocument();
	}, 20_000);

	it('re-enables the Upload button even when restoreLinksFor throws during upload', async () => {
		// Seed a saved link so restoreLinksFor has entries to process during
		// upload. Upload restore skips title lookup (cosmetic) and only fetches
		// charts — throw synchronously from fetchCloudSongCharts so the .map()
		// inside restoreLinksFor throws before Promise.allSettled can catch it,
		// simulating the kind of unexpected error that the old try/finally
		// scope (which only wrapped the batch loop) missed, leaving the Upload
		// button stuck disabled forever.
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		// Page restore (fetchTitles:true) fails on title lookup so the link is
		// not committed; upload restore then retries with charts only.
		host.fetchCloudSong.mockImplementation(() => {
			throw new Error('title explosion');
		});
		host.fetchCloudSongCharts.mockImplementation(() => {
			throw new Error('synchronous explosion');
		});

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();
		// The onMount restoreLinksForPage call also throws, but loadScores
		// catches it (try/catch around restoreLinksForPage). Wait for that
		// call to land before triggering upload.
		await waitFor(() => expect(host.fetchCloudSong).toHaveBeenCalled());

		const uploadButton = screen.getByRole('button', { name: /^upload/i });
		await fireEvent.click(uploadButton);

		// The Upload button must be re-enabled (not stuck disabled) after the
		// throw. Before the fix, the try/finally didn't cover restoreLinksFor,
		// so `uploading` stayed true forever.
		await waitFor(() => expect(uploadButton).not.toBeDisabled());
		expect(screen.getByText(/synchronous explosion/i)).toBeInTheDocument();
	});

	it('disables Reparse and Choose buttons during upload and re-enables after', async () => {
		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Link the song so there is something to upload.
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// Hold the upload in-flight so we can inspect button state mid-upload.
		let resolveUpload!: (value: unknown) => void;
		host.uploadScores.mockReturnValue(
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
		);

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));

		// During upload: all three buttons must be disabled.
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /^upload/i })).toBeDisabled()
		);
		expect(screen.getByRole('button', { name: /choose songs\.db/i })).toBeDisabled();
		expect(screen.getByRole('button', { name: /reparse/i })).toBeDisabled();

		// Release the upload — buttons re-enable.
		resolveUpload({
			success: true,
			data: { updatedCharts: 1, insertedScores: 2, skipped: [] }
		});
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /^upload/i })).not.toBeDisabled()
		);
		expect(screen.getByRole('button', { name: /choose songs\.db/i })).not.toBeDisabled();
		expect(screen.getByRole('button', { name: /reparse/i })).not.toBeDisabled();
	});

	it('ignores stale cloud-chart responses when the link changes before the fetch resolves', async () => {
		// Two cloud songs the autocomplete can suggest, so the user can link
		// one then change to the other before the first chart fetch resolves.
		host.searchCloudSongs.mockResolvedValue({
			success: true,
			data: [
				{ id: '42', title: 'Cloud Song A', artist: 'Artist A', is_published: true },
				{ id: '99', title: 'Cloud Song B', artist: 'Artist A', is_published: true }
			]
		});

		// Deferred promises per song id so we can control resolution order:
		// B resolves first, then A (the stale response).
		const deferreds: Record<string, { resolve: (v: unknown) => void }> = {};
		host.fetchCloudSongCharts.mockImplementation(
			(songId: string) =>
				new Promise((r) => {
					deferreds[songId] = { resolve: r as (v: unknown) => void };
				})
		);

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Link cloud song A ('42') — fetchCloudSongCharts('42') is now pending.
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		let input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song A'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// Change the link to cloud song B ('99') before A's charts resolve.
		// Outside-click only listens while open and ignores the trigger region,
		// so "change" keeps the dialog open for a new search.
		await fireEvent.click(screen.getByRole('button', { name: 'change' }));
		input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalledTimes(2));
		await fireEvent.click(await screen.findByText('Cloud Song B'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('99'));

		// Resolve B first, then A (the stale response that must be discarded).
		deferreds['99'].resolve({
			success: true,
			data: [{ id: '99-chart', label: 'BASIC', level: 55 }]
		});
		deferreds['42'].resolve({
			success: true,
			data: [{ id: '42-chart', label: 'BASIC', level: 55 }]
		});

		// Upload — must use B's chart ID ('99-chart'), not A's stale '42-chart'.
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /^upload/i })).not.toBeDisabled()
		);
		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		await waitFor(() =>
			expect(host.uploadScores).toHaveBeenCalledWith({
				charts: [
					{
						chartId: '99-chart',
						playCount: 7,
						clearCount: 5,
						scores: [bestRow, recentRow]
					}
				]
			})
		);
	});

	it('waits for in-flight chart matching before building the upload payload', async () => {
		// After selecting a cloud song, matchesBySong is empty until
		// fetchCloudSongCharts resolves. Upload must wait rather than
		// immediately reporting "Nothing to upload".
		let resolveCharts: (v: unknown) => void = () => {};
		host.fetchCloudSongCharts.mockImplementation(
			() =>
				new Promise((r) => {
					resolveCharts = r as (v: unknown) => void;
				})
		);

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// Upload is disabled while the chart fetch is in flight.
		expect(screen.getByRole('button', { name: /^upload/i })).toBeDisabled();

		resolveCharts({
			success: true,
			data: [{ id: '10', label: 'BASIC', level: 55 }]
		});
		await waitFor(() =>
			expect(screen.getByRole('button', { name: /^upload/i })).not.toBeDisabled()
		);

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		await waitFor(() =>
			expect(host.uploadScores).toHaveBeenCalledWith({
				charts: [
					{
						chartId: '10',
						playCount: 7,
						clearCount: 5,
						scores: [bestRow, recentRow]
					}
				]
			})
		);
		expect(screen.queryByText(/Nothing to upload/i)).not.toBeInTheDocument();
	});

	it('preserves partial progress when a later batch throws', async () => {
		// 101 charts → two batches. First succeeds; second rejects. Status and
		// skipped list must still reflect the committed first batch.
		const charts = Array.from({ length: 101 }, (_, i) => ({
			difficultyLevel: 2,
			difficultyLabel: `LV${i}`,
			drumLevel: i,
			fileHash: `hash-${i}`,
			aggregate: { playCount: 1, clearCount: 1 },
			best: bestRow,
			recent: [] as (typeof recentRow)[]
		}));
		host.parseDtxmaniaScores.mockResolvedValue([
			{ songId: 1, title: 'Mega Song', artist: 'Artist A', genre: 'Rock', charts }
		]);
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		host.fetchCloudSong.mockResolvedValue({
			success: true,
			cloudSongData: {
				id: 42,
				title: 'Cloud Mega Song',
				artist: 'Artist A',
				is_published: true
			}
		});
		host.fetchCloudSongCharts.mockResolvedValue({
			success: true,
			data: charts.map((c, i) => ({
				id: `${1000 + i}`,
				label: `LV${i}`,
				level: i
			}))
		});
		host.uploadScores
			.mockResolvedValueOnce({
				success: true,
				data: {
					updatedCharts: 100,
					insertedScores: 200,
					skipped: [{ chartId: '1007', reason: 'chart not found' }]
				}
			})
			.mockRejectedValueOnce(new Error('network dropped'));

		render(Scores);
		expect(await screen.findByText('Mega Song')).toBeInTheDocument();
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		expect(await screen.findByText(/network dropped/i)).toBeInTheDocument();
		expect(
			screen.getByText(
				/Partial upload: 100 chart\(s\), 200 score\(s\) committed before failure/i
			)
		).toBeInTheDocument();
		expect(screen.getByText(/Chart 1007 skipped/i)).toBeInTheDocument();
	}, 20_000);

	it('does not overwrite a manual link with a late readScoreSongLinks resolution', async () => {
		// readScoreSongLinks is slow; the user picks a DB and makes a manual
		// link before it resolves. The late disk read must not overwrite the
		// in-memory savedLinks with stale disk data — the generation guard
		// must run BEFORE the assignment, not after.
		let resolveLinks!: (v: Record<string, string>) => void;
		host.readScoreSongLinks.mockReturnValue(
			new Promise<Record<string, string>>((resolve) => {
				resolveLinks = resolve;
			})
		);
		host.defaultDtxmaniaDbPath.mockResolvedValue(null);
		host.selectDtxmaniaDb.mockResolvedValue({
			canceled: false,
			filePaths: ['/custom/songs.db']
		});
		host.parseDtxmaniaScores.mockResolvedValue(parsedSongs);

		render(Scores);
		// Chooser is clickable while readScoreSongLinks is still pending.
		await fireEvent.click(await screen.findByRole('button', { name: /choose songs\.db/i }));
		await waitFor(() =>
			expect(host.parseDtxmaniaScores).toHaveBeenCalledWith('/custom/songs.db')
		);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Manually link the song — this populates savedLinks in memory.
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// Now the late readScoreSongLinks resolves with stale disk data that
		// does NOT contain the manual link. Without the fix, this overwrites
		// savedLinks and the manual link is lost from the in-memory map.
		resolveLinks({ ['/other/songs.db\u001f1']: '99' });
		// Drain microtasks + the 300ms persist debounce so any stale write
		// would have landed.
		await new Promise((r) => setTimeout(r, 400));

		// Re-parse: loadScores resets links={} and re-restores from savedLinks.
		// If the manual link survived the late resolve, restoreLinksForPage
		// re-fetches its charts. If savedLinks was overwritten, the link is
		// gone and no chart fetch happens for '42'.
		host.fetchCloudSongCharts.mockClear();
		host.fetchCloudSong.mockClear();
		await fireEvent.click(screen.getByRole('button', { name: /reparse/i }));
		await waitFor(() => expect(host.parseDtxmaniaScores).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));
	});

	it('does not persist saved links from a stale restore continuation after unmount', async () => {
		// Seed a saved link so restoreLinksFor has work to do on mount. Hold
		// the chart fetch pending so the restore continuation is in flight
		// when we unmount. After unmount, resolving the chart fetch must NOT
		// trigger a persist write — onDestroy must invalidate the load
		// generation so the continuation bails before schedulePersist.
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		let resolveCharts!: (v: unknown) => void;
		host.fetchCloudSongCharts.mockImplementation(
			() =>
				new Promise((r) => {
					resolveCharts = r as (v: unknown) => void;
				})
		);

		const { unmount } = render(Scores);
		// Wait for the title fetch to complete and the chart fetch to be
		// pending (restoreLinksFor is now suspended at the chart-fetch await).
		await waitFor(() => expect(host.fetchCloudSong).toHaveBeenCalledWith('42'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// No persist write should have landed yet (restore hasn't completed).
		host.writeScoreSongLinks.mockClear();

		unmount();

		// Resolve the chart fetch — the stale continuation must NOT persist.
		resolveCharts({
			success: true,
			data: [{ id: '10', label: 'BASIC', level: 55 }]
		});
		// Wait beyond the 300ms persist debounce so a stale timer would fire.
		await new Promise((r) => setTimeout(r, 400));

		expect(host.writeScoreSongLinks).not.toHaveBeenCalled();
	});

	it('clears a failed manual link so restoreLinksFor can retry on the next upload', async () => {
		// When fetchCloudSongCharts returns { success: false } after a manual
		// link, the link must be rolled back — otherwise restoreLinksFor
		// skips the song (it's already in `links`) and the fetch is never
		// retried, leaving the song silently un-uploadable.
		host.fetchCloudSongCharts.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({
			success: true,
			data: [{ id: '10', label: 'BASIC', level: 55 }]
		});

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// Manually link the song — the first chart fetch fails.
		await fireEvent.click(screen.getByRole('button', { name: /link to cloud song/i }));
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledTimes(1));

		// The failed link must be rolled back: the persisted link is cleared
		// so restoreLinksFor can retry during upload.
		await waitFor(() => expect(host.writeScoreSongLinks).toHaveBeenCalledWith({}));

		// Upload triggers restoreLinksFor, which retries the chart fetch
		// (the link was saved before the fetch, so savedLinks has it — but
		// the rollback removed it, so restoreLinksFor re-fetches from the
		// saved-link entry that no longer exists). Since the link was
		// cleared, there's nothing to restore, and upload reports nothing
		// to upload. The user can re-link manually.
		await fireEvent.click(screen.getByRole('button', { name: /^upload/i }));
		expect(await screen.findByText(/Nothing to upload/i)).toBeInTheDocument();
	});

	it('excludes already-linked cloud song IDs from the autocomplete search', async () => {
		// Two local songs. Link the first to cloud song '42'. Opening the
		// autocomplete for the second song must pass '42' as
		// excludeLinkedSongIds so the server (and client filter) hides it
		// from the results — preventing a second link to the same cloud
		// simfile, which would leave the second song's scores unuploaded
		// (buildUpload dedups by cloud chart ID).
		const twoSongs = [
			{
				songId: 1,
				title: 'First Song',
				artist: 'Artist A',
				genre: 'Rock',
				charts: [
					{
						difficultyLevel: 2,
						difficultyLabel: 'BASIC',
						drumLevel: 55,
						fileHash: 'hash-a',
						aggregate: { playCount: 7, clearCount: 5 },
						best: bestRow,
						recent: [recentRow]
					}
				]
			},
			{
				songId: 2,
				title: 'Second Song',
				artist: 'Artist B',
				genre: 'Pop',
				charts: [
					{
						difficultyLevel: 2,
						difficultyLabel: 'BASIC',
						drumLevel: 55,
						fileHash: 'hash-b',
						aggregate: { playCount: 3, clearCount: 1 },
						best: bestRow,
						recent: []
					}
				]
			}
		];
		host.parseDtxmaniaScores.mockResolvedValue(twoSongs);

		render(Scores);
		expect(await screen.findByText('First Song')).toBeInTheDocument();
		await waitFor(() => expect(screen.getByText('Second Song')).toBeInTheDocument());

		// Link the first song to cloud song '42'.
		const linkButtons = screen.getAllByRole('button', { name: /link to cloud song/i });
		await fireEvent.click(linkButtons[0]);
		const input = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());
		await fireEvent.click(await screen.findByText('Cloud Song'));
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));

		// Open the autocomplete for the second song and search again.
		host.searchCloudSongs.mockClear();
		const linkButtons2 = screen.getAllByRole('button', { name: /link to cloud song/i });
		await fireEvent.click(linkButtons2[0]);
		const input2 = await screen.findByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input2, { target: { value: 'Cloud Song' } });
		await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalled());

		// The search call for the second song must exclude the cloud ID
		// already linked to the first song.
		const lastCall = host.searchCloudSongs.mock.calls.at(-1)?.[0];
		expect(lastCall).toMatchObject({ excludeLinkedSongIds: ['42'] });
	});
});
