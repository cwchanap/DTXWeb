import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

vi.mock('svelte-i18n');

vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: PaginationStub } = await import('../../tests/stubs/PaginationStub.svelte');
	return { Pagination: PaginationStub };
});

const { myScoredSimfilesMock, gotoMock, pageMock } = vi.hoisted(() => ({
	myScoredSimfilesMock: vi.fn(),
	gotoMock: vi.fn(),
	pageMock: { url: new URL('http://localhost/app/score') }
}));
vi.mock('$lib/api', () => ({ myScoredSimfiles: myScoredSimfilesMock }));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: unknown) => void) => {
			run({ url: pageMock.url });
			return () => {};
		}
	}
}));

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
			chartScore: {
				playCount: 3,
				clearCount: 1,
				fullCombo: false,
				maxCombo: 0,
				bestAchievementRate: null,
				bestRankLabel: null,
				lastPlayedAt: null,
				best: null,
				recent: []
			}
		}
	]
};

beforeEach(() => {
	myScoredSimfilesMock.mockReset();
	gotoMock.mockReset();
	pageMock.url = new URL('http://localhost/app/score');
});

// Expected /login target with the current path preserved via `next`.
const loginWithNext = (path = '/app/score') => `/login?next=${encodeURIComponent(path)}`;

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
		expect(gotoMock).not.toHaveBeenCalled();
	});

	it('redirects to /login when the HTTP response is 403 (FORBIDDEN)', async () => {
		// graphql-request attaches a `response` with the HTTP status to its
		// ClientError. A 403 means the session expired — route to /login
		// instead of a dead-end Retry. This tests the structured status check
		// (not substring matching on the message, which is fragile).
		const err = Object.assign(new Error('Forbidden'), {
			response: { status: 403 }
		});
		myScoredSimfilesMock.mockRejectedValue(err);
		render(ScoreList);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith(loginWithNext()));
		expect(screen.queryByText(/score\.load_error/)).not.toBeInTheDocument();
	});

	// Regression: goto('/login') is async and returns before the route
	// changes. Without the redirecting flag, the finally block sets
	// loading=false while songs is still [] and loadError is false, so the
	// "no scores" empty state flashes briefly before /login navigation
	// completes. The redirecting flag keeps loading=true so the spinner
	// shows instead.
	it('does not flash the "no scores" empty state while redirecting to /login', async () => {
		const err = Object.assign(new Error('Forbidden'), {
			response: { status: 403 }
		});
		myScoredSimfilesMock.mockRejectedValue(err);
		render(ScoreList);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith(loginWithNext()));
		// The "no scores" empty state must NOT appear during the redirect.
		expect(screen.queryByText(/score\.no_scores/)).not.toBeInTheDocument();
		// The loading spinner stays visible (loading was not cleared).
		expect(screen.getByText(/score\.loading/)).toBeInTheDocument();
	});

	it('redirects to /login when the GraphQL response carries FORBIDDEN', async () => {
		const err = Object.assign(new Error('Forbidden'), {
			response: { errors: [{ extensions: { code: 'FORBIDDEN' } }] }
		});
		myScoredSimfilesMock.mockRejectedValue(err);
		render(ScoreList);
		await waitFor(() => expect(gotoMock).toHaveBeenCalledWith(loginWithNext()));
	});

	// The `next` param must reflect the current route so the login flow can
	// return the user to the page they were on, not a hardcoded path.
	it('preserves the current path (including query string) in the next param', async () => {
		pageMock.url = new URL('http://localhost/app/score?page=3');
		const err = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
		myScoredSimfilesMock.mockRejectedValue(err);
		render(ScoreList);
		await waitFor(() =>
			expect(gotoMock).toHaveBeenCalledWith(loginWithNext('/app/score?page=3'))
		);
	});

	it('treats a bare error without a response shape as a non-auth load failure', async () => {
		// A bare Error (no response.status / response.errors) must NOT be
		// treated as an auth error — it should show the Retry path, not
		// redirect to /login. This guards against false positives from
		// substring matching on arbitrary error messages.
		myScoredSimfilesMock.mockRejectedValue(new Error('Forbidden'));
		render(ScoreList);
		await waitFor(() => expect(screen.getByText(/score\.load_error/)).toBeInTheDocument());
		expect(gotoMock).not.toHaveBeenCalled();
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

	// Regression: the retry button used to vanish the instant it was clicked
	// because loadScores() cleared loadError at the start of the call, hiding
	// the banner (gated on loadError) before the fetch resolved. The user got
	// no feedback that the retry was in flight. The banner must stay visible
	// while the retry load is pending, then clear on success.
	it('keeps the error banner visible while a retry is in flight', async () => {
		myScoredSimfilesMock.mockRejectedValueOnce(new Error('boom'));
		render(ScoreList);
		const retry = await screen.findByRole('button', { name: /score\.retry/i });

		// Hold the retry load pending so we can assert the banner state
		// mid-flight (before success/failure resolves).
		let resolveRetry!: (value: { data: ScoredSimfile[]; count: number }) => void;
		myScoredSimfilesMock.mockReturnValueOnce(
			new Promise<{ data: ScoredSimfile[]; count: number }>((resolve) => {
				resolveRetry = resolve;
			})
		);

		await fireEvent.click(retry);

		// The banner + retry button are still visible while the load is pending.
		await waitFor(() => expect(myScoredSimfilesMock).toHaveBeenCalledTimes(2));
		expect(screen.getByText(/score\.load_error/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /score\.retry/i })).toBeInTheDocument();

		// Now resolve the retry — the banner must clear on success.
		resolveRetry({ data: [song], count: 1 });
		await waitFor(() => expect(screen.getByText('Song A')).toBeInTheDocument());
		expect(screen.queryByText(/score\.load_error/)).not.toBeInTheDocument();
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
		// The pagination must still mark page 1 active: the failed page-2
		// fetch retained the prior `songs` (page 1's data), so the active
		// page must match the rendered data, not the requested page whose
		// data never landed. Regression guard for the displayedPage fix.
		expect(screen.getByText('1')).toHaveAttribute('aria-current', 'page');
		expect(screen.getByText('2')).not.toHaveAttribute('aria-current', 'page');
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

	// Exercises the stale-page guard (ScoreList.svelte:71-76): if scores are
	// deleted and the current page now exceeds the total page count, the guard
	// clamps currentPage to the last valid page and reloads instead of leaving
	// the user stranded on an empty page with no pagination control.
	it('clamps to the last valid page and reloads when the current page exceeds the total', async () => {
		const page1 = Array.from({ length: 10 }, (_, i) => ({
			...song,
			id: i + 1,
			title: `Song ${i + 1}`
		}));
		const page3 = Array.from({ length: 5 }, (_, i) => ({
			...song,
			id: i + 21,
			title: `Song ${i + 21}`
		}));
		// After deletion: only 5 songs remain (1 page).
		const shrunkPage1 = Array.from({ length: 5 }, (_, i) => ({
			...song,
			id: i + 1,
			title: `Shrunk Song ${i + 1}`
		}));

		// 1. Initial mount → page 1, 25 songs (3 pages).
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page1, count: 25 });
		render(ScoreList);
		await waitFor(() => expect(screen.getByText('Song 1')).toBeInTheDocument());

		// 2. Navigate to page 3.
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page3, count: 25 });
		await fireEvent.click(screen.getByText('3'));
		await waitFor(() => expect(screen.getByText('Song 21')).toBeInTheDocument());

		// 3. Trigger another load while still on page 3, but now the count has
		//    shrunk to 5 (1 page). The guard must detect currentPage(3) >
		//    fetchedTotalPages(1), clamp to 1, and reload.
		myScoredSimfilesMock.mockResolvedValueOnce({ data: [], count: 5 });
		myScoredSimfilesMock.mockResolvedValueOnce({ data: shrunkPage1, count: 5 });

		await fireEvent.click(screen.getByText('3'));

		// The guard fired a recursive reload for page 1 — 4 total calls.
		await waitFor(() => expect(myScoredSimfilesMock).toHaveBeenCalledTimes(4));
		// The last call was for page 1 (the clamped reload).
		expect(myScoredSimfilesMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 });
		// The shrunk page 1 data is rendered, not the stale page 3 data.
		await waitFor(() => expect(screen.getByText('Shrunk Song 1')).toBeInTheDocument());
		expect(screen.queryByText('Song 21')).not.toBeInTheDocument();
	});

	// Depth guard on the stale-page clamp: a pathological API that returns an
	// ever-shrinking count would recurse unbounded without the cap. The guard
	// allows exactly one recursive reload; if the page is still stale after
	// that, the component renders with the clamped currentPage instead of
	// looping. This test would hang or stack-overflow without the cap.
	it('caps the stale-page recursive reload at one hop', async () => {
		const page1 = Array.from({ length: 10 }, (_, i) => ({
			...song,
			id: i + 1,
			title: `Song ${i + 1}`
		}));
		const page3 = Array.from({ length: 5 }, (_, i) => ({
			...song,
			id: i + 21,
			title: `Song ${i + 21}`
		}));
		const shrunkPage1 = Array.from({ length: 5 }, (_, i) => ({
			...song,
			id: i + 1,
			title: `Shrunk Song ${i + 1}`
		}));

		// Initial mount → page 1, 25 songs (3 pages).
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page1, count: 25 });
		render(ScoreList);
		await waitFor(() => expect(screen.getByText('Song 1')).toBeInTheDocument());

		// Navigate to page 3.
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page3, count: 25 });
		await fireEvent.click(screen.getByText('3'));
		await waitFor(() => expect(screen.getByText('Song 21')).toBeInTheDocument());

		// First stale fetch: currentPage=3, count=15 → fetchedTotalPages=2,
		// clamp to 2, recursive reload (isStaleClampRetry=false → true).
		myScoredSimfilesMock.mockResolvedValueOnce({ data: [], count: 15 });
		// Second fetch (the one allowed recursive reload): STILL stale.
		// currentPage=2, count=5 → fetchedTotalPages=1, 2>1. Without the cap
		// this would recurse again; with the cap, clamp to 1 and stop.
		myScoredSimfilesMock.mockResolvedValueOnce({ data: shrunkPage1, count: 5 });
		// A third fetch would only happen if the cap were missing. Provide a
		// resolver so the test fails loudly (vi.fn() returns undefined →
		// myScoredSimfiles throws → test errors) instead of silently passing.
		myScoredSimfilesMock.mockResolvedValueOnce({ data: page1, count: 25 });

		await fireEvent.click(screen.getByText('3'));

		// Exactly 4 calls: initial + page 3 + stale fetch + one recursive
		// reload. The fifth mock is NEVER consumed — the depth cap held.
		await waitFor(() => expect(myScoredSimfilesMock).toHaveBeenCalledTimes(4));
		expect(myScoredSimfilesMock).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 });
		// The recursive reload's data (shrunkPage1) is rendered; currentPage
		// was clamped to 1 after the second stale detection.
		await waitFor(() => expect(screen.getByText('Shrunk Song 1')).toBeInTheDocument());
	});
});
