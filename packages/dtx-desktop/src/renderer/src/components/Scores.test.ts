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
	achievementRate: 91.3,
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
				['Played Song\u0000Artist A\u0000Rock']: '42'
			})
		);
		unmount();

		// Next mount: saved link is restored -> fetchCloudSong fetches the real
		// title, then fetchCloudSongCharts is called for '42'.
		host.readScoreSongLinks.mockResolvedValue({
			['Played Song\u0000Artist A\u0000Rock']: '42'
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
		// savedLinks has one live entry (Played Song) and one orphan (Ghost Song).
		host.readScoreSongLinks.mockResolvedValue({
			['Played Song\u0000Artist A\u0000Rock']: '42',
			['Ghost Song\u0000Ghost Artist\u0000Jazz']: '99'
		});

		render(Scores);
		expect(await screen.findByText('Played Song')).toBeInTheDocument();

		// The orphan must be dropped and the pruned map persisted.
		await waitFor(() =>
			expect(host.writeScoreSongLinks).toHaveBeenCalledWith({
				['Played Song\u0000Artist A\u0000Rock']: '42'
			})
		);
	});

	it('paginates the parsed songs, rendering one page at a time', async () => {
		const manySongs = Array.from({ length: 25 }, (_, i) => ({
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
});
