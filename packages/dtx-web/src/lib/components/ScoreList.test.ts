import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

vi.mock('svelte-i18n');

vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: PaginationStub } = await import('../../tests/stubs/PaginationStub.svelte');
	return { Pagination: PaginationStub };
});

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
		await waitFor(() => expect(screen.getByText('score.no_scores')).toBeInTheDocument());
	});

	it('shows an error state when the query rejects', async () => {
		myScoredSimfilesMock.mockRejectedValue(new Error('boom'));
		render(ScoreList);
		await waitFor(() => expect(screen.getByText(/score\.load_error/)).toBeInTheDocument());
	});

	it('retries the load when the retry button is clicked', async () => {
		myScoredSimfilesMock.mockRejectedValueOnce(new Error('boom'));
		myScoredSimfilesMock.mockResolvedValueOnce({ data: [song], count: 1 });
		render(ScoreList);
		const retry = await screen.findByRole('button', { name: /score\.retry/i });
		await fireEvent.click(retry);
		await waitFor(() => expect(screen.getByText('Song A')).toBeInTheDocument());
		expect(myScoredSimfilesMock).toHaveBeenCalledTimes(2);
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

	// The loadRequestId guard in ScoreList prevents stale responses from
	// overwriting current data when rapid page changes occur. The list stays
	// visible during a page-change load (only the initial load shows the
	// full-page loading state), so the pagination buttons remain clickable
	// mid-load — the guard is what keeps concurrent loads safe
	// (ScoreList.svelte:25-42: requestId check in try/catch/finally).
});
