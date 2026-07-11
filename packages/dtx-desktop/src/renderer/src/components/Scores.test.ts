import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

const host = vi.hoisted(() => ({
	defaultDtxmaniaDbPath: vi.fn(),
	selectDtxmaniaDb: vi.fn(),
	parseDtxmaniaScores: vi.fn(),
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
				['Played SongArtist A']: '42'
			})
		);
		unmount();

		// Next mount: saved link is restored -> fetchCloudSongCharts called for '42'.
		host.readScoreSongLinks.mockResolvedValue({ ['Played SongArtist A']: '42' });
		host.fetchCloudSongCharts.mockClear();
		render(Scores);
		await waitFor(() => expect(host.fetchCloudSongCharts).toHaveBeenCalledWith('42'));
	});
});
