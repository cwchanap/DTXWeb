import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

const { myScoredSimfilesMock } = vi.hoisted(() => ({ myScoredSimfilesMock: vi.fn() }));
vi.mock('$lib/api', () => ({ myScoredSimfiles: myScoredSimfilesMock }));

import ScoreList from './ScoreList.svelte';
import type { ScoredSimfile } from '$lib/api/score';

const song: ScoredSimfile = {
	id: 42,
	title: 'Song A',
	artist: 'Artist A',
	charts: [
		{
			id: 10,
			label: 'BASIC',
			level: 5,
			chartScore: { playCount: 3, clearCount: 1, best: null, recent: [] }
		}
	]
};

beforeEach(() => {
	myScoredSimfilesMock.mockReset();
});

describe('ScoreList', () => {
	it('fetches and renders scored songs', async () => {
		myScoredSimfilesMock.mockResolvedValue({ data: [song], count: 1 });
		render(ScoreList);
		await waitFor(() => expect(screen.getByText('Song A')).toBeInTheDocument());
		expect(myScoredSimfilesMock).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
	});

	it('shows the empty state when the user has no scores', async () => {
		myScoredSimfilesMock.mockResolvedValue({ data: [], count: 0 });
		render(ScoreList);
		await waitFor(() => expect(screen.getByText('No scores yet')).toBeInTheDocument());
	});

	it('shows an error state when the query rejects', async () => {
		myScoredSimfilesMock.mockRejectedValue(new Error('boom'));
		render(ScoreList);
		await waitFor(() =>
			expect(screen.getByText(/Failed to load your scores/)).toBeInTheDocument()
		);
	});

	it('renders pagination and loads the next page on click', async () => {
		const page1 = Array.from({ length: 10 }, (_, i) => ({
			...song,
			id: i + 1,
			title: `Song ${i + 1}`
		}));
		const page2 = Array.from({ length: 5 }, (_, i) => ({
			...song,
			id: i + 11,
			title: `Song ${i + 11}`
		}));
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page1, count: 15 });
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page2, count: 15 });

		render(ScoreList);
		await waitFor(() => expect(screen.getByText('Song 1')).toBeInTheDocument());
		expect(screen.getByText('Song 10')).toBeInTheDocument();

		await fireEvent.click(screen.getByText('2'));
		await waitFor(() =>
			expect(myScoredSimfilesMock).toHaveBeenCalledWith({ page: 2, pageSize: 10 })
		);
		await waitFor(() => expect(screen.getByText('Song 11')).toBeInTheDocument());
	});
});
