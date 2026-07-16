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
vi.mock('../services/desktopHost', () => ({ desktopHost: host }));

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
		data: [{ id: '10', label: 'BASIC', level: 5.5 }]
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

		// writeScoreSongLinks must NOT be called with an empty object — that
		// would wipe all persisted links on a transient parse failure.
		await waitFor(() => {
			const calls = host.writeScoreSongLinks.mock.calls;
			for (const [arg] of calls) {
				expect(Object.keys(arg as Record<string, string>).length).toBeGreaterThan(0);
			}
		});
		expect(host.writeScoreSongLinks).not.toHaveBeenCalledWith({});
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
				{ id: '10', label: 'BASIC', level: 5.5 },
				{ id: '11', label: 'EXTREME', level: 8.8 }
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
			data: [{ id: '10', label: 'BASIC', level: 5.5 }]
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

	it('chunks uploads into ≤100-chart batches when the payload exceeds the server limit', async () => {
		// 101 charts on one song, each at a unique drum level matched to a
		// unique cloud chart, so buildUpload produces 101 chart entries —
		// exceeding the server's MAX_UPLOAD_CHARTS=100 cap.
		const charts = Array.from({ length: 101 }, (_, i) => ({
			difficultyLevel: 2,
			difficultyLabel: `LV${i}`,
			drumLevel: (i + 1) * 10,
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
				level: (i + 1) * 1.0
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

	it('surfaces partial success when a mid-batch failure leaves earlier batches committed', async () => {
		// 101 charts → two batches (100 + 1). The first batch succeeds, the
		// second fails. The status must include both the error and the counts
		// from the already-committed first batch.
		const charts = Array.from({ length: 101 }, (_, i) => ({
			difficultyLevel: 2,
			difficultyLabel: `LV${i}`,
			drumLevel: (i + 1) * 10,
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
				level: (i + 1) * 1.0
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
			drumLevel: (i + 1) * 10,
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
				level: (i + 1) * 1.0
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
		// upload. fetchCloudSong throws synchronously so the .map() inside
		// restoreLinksFor throws before Promise.allSettled can catch it —
		// simulating the kind of unexpected error that the old try/finally
		// scope (which only wrapped the batch loop) missed, leaving the Upload
		// button stuck disabled forever.
		host.readScoreSongLinks.mockResolvedValue({
			['/path/songs.db\u001f1']: '42'
		});
		host.fetchCloudSong.mockImplementation(() => {
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

		// CloudSongAutocomplete registers a click-outside handler on
		// document 100ms after mount. By the time we click "change" to
		// re-link, that handler is active and closes the autocomplete the
		// instant it opens. Intercept document.addEventListener to suppress
		// the click-outside handler for this test only.
		const realAdd = document.addEventListener.bind(document);
		const addSpy = vi.spyOn(document, 'addEventListener').mockImplementation(((
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions
		) => {
			if (type === 'click') return;
			return realAdd(type, listener, options);
		}) as typeof document.addEventListener);

		try {
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
			await fireEvent.click(screen.getByRole('button', { name: 'change' }));
			input = await screen.findByPlaceholderText(/search by song title or artist/i);
			await fireEvent.input(input, { target: { value: 'Cloud Song' } });
			await waitFor(() => expect(host.searchCloudSongs).toHaveBeenCalledTimes(2));
			await fireEvent.click(await screen.findByText('Cloud Song B'));
			await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('99'));

			// Resolve B first, then A (the stale response that must be discarded).
			deferreds['99'].resolve({
				success: true,
				data: [{ id: '99-chart', label: 'BASIC', level: 5.5 }]
			});
			deferreds['42'].resolve({
				success: true,
				data: [{ id: '42-chart', label: 'BASIC', level: 5.5 }]
			});

			// Upload — must use B's chart ID ('99-chart'), not A's stale '42-chart'.
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
		} finally {
			addSpy.mockRestore();
		}
	});
});
