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

	// Exercises the non-blocking error banner branch (ScoreList.svelte:66-77):
	// a page-change fetch that rejects while songs from the previous page are
	// still on screen. The list must stay visible and the error banner must
	// appear (with a retry button), instead of the full-page error state.
	it('shows a non-blocking error banner and keeps the list when a page change fails', async () => {
		const page1 = Array.from({ length: 10 }, (_, i) => ({
			...song,
			id: i + 1,
			title: `Song ${i + 1}`
		}));
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page1, count: 15 });
		// Page 2 rejects — a network blip mid-pagination.
		myScoredSimfilesMock.mockRejectedValueOnce(new Error('boom'));

		render(ScoreList);
		await waitFor(() => expect(screen.getByText('Song 1')).toBeInTheDocument());
		expect(screen.getByText('Song 10')).toBeInTheDocument();

		await fireEvent.click(screen.getByText('2'));
		// The banner appears...
		await waitFor(() => expect(screen.getByText(/score\.load_error/)).toBeInTheDocument());
		// ...and the previous page's list is still visible (not hidden by the
		// full-page error state, which only renders when songs.length === 0).
		expect(screen.getByText('Song 1')).toBeInTheDocument();
		expect(screen.getByText('Song 10')).toBeInTheDocument();
		// A retry button is rendered alongside the banner.
		expect(screen.getByRole('button', { name: /score\.retry/i })).toBeInTheDocument();
	});

	// The loadRequestId guard in ScoreList prevents stale responses from
	// overwriting current data when rapid page changes occur. The list stays
	// visible during a page-change load (only the initial load shows the
	// full-page loading state), so the pagination buttons remain clickable
	// mid-load — the guard is what keeps concurrent loads safe
	// (ScoreList.svelte:25-42: requestId check in try/catch/finally).

	it('ignores a stale response when a later page change resolves first (loadRequestId guard)', async () => {
		// 25 songs → 3 pages (10 + 10 + 5). Page 1 loads on mount. Then the
		// user clicks page 2 (slow response) and immediately page 3 (fast
		// response). Page 3 resolves first; page 2's stale response must NOT
		// overwrite page 3's data when it eventually resolves.
		const page1 = Array.from({ length: 10 }, (_, i) => ({
			...song,
			id: i + 1,
			title: `Song ${i + 1}`
		}));
		const page2 = Array.from({ length: 10 }, (_, i) => ({
			...song,
			id: i + 11,
			title: `Song ${i + 11}`
		}));
		const page3 = Array.from({ length: 5 }, (_, i) => ({
			...song,
			id: i + 21,
			title: `Song ${i + 21}`
		}));

		// Page 1 resolves immediately (initial mount load).
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page1, count: 25 });

		render(ScoreList);
		await waitFor(() => expect(screen.getByText('Song 1')).toBeInTheDocument());

		// Page 2: deferred (slow). Page 3: immediate (fast).
		let resolvePage2!: (value: { data: typeof page2; count: number }) => void;
		const page2Promise = new Promise<{ data: typeof page2; count: number }>((resolve) => {
			resolvePage2 = resolve;
		});
		myScoredSimfilesMock.mockReturnValueOnce(page2Promise);
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page3, count: 25 });

		// Click page 2, then immediately page 3 (before page 2 resolves).
		await fireEvent.click(screen.getByText('2'));
		await fireEvent.click(screen.getByText('3'));

		// Page 3 resolves first — its data must be rendered.
		await waitFor(() => expect(screen.getByText('Song 21')).toBeInTheDocument());

		// Now resolve page 2 (the stale response). It must NOT overwrite
		// page 3's data — the loadRequestId guard drops it.
		resolvePage2({ data: page2, count: 25 });
		await waitFor(() => expect(myScoredSimfilesMock).toHaveBeenCalledTimes(3));

		// Page 3's data is still shown; page 2's stale data is NOT.
		expect(screen.getByText('Song 21')).toBeInTheDocument();
		expect(screen.queryByText('Song 11')).not.toBeInTheDocument();
	});
});
