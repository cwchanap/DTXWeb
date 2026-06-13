import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('@lucide/svelte');

const mockDesktopHost = vi.hoisted(() => ({
	searchCloudSongs: vi.fn()
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

import CloudSongAutocomplete from './CloudSongAutocomplete.svelte';

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

const defaultSongs = [
	{ id: '1', title: 'Song Alpha', artist: 'Artist One', bpm: 120, is_published: true },
	{ id: '2', title: 'Song Beta', artist: 'Artist Two', bpm: 140, is_published: false }
];

describe('CloudSongAutocomplete – closed state', () => {
	it('renders nothing when isOpen is false', () => {
		render(CloudSongAutocomplete, { props: { isOpen: false } });
		expect(screen.queryByPlaceholderText(/search by song title/i)).not.toBeInTheDocument();
	});
});

describe('CloudSongAutocomplete – open state', () => {
	it('renders search input when open', () => {
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		expect(screen.getByPlaceholderText(/search by song title or artist/i)).toBeInTheDocument();
	});

	it('shows "Link to Cloud Song" heading', () => {
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		expect(screen.getByText('Link to Cloud Song')).toBeInTheDocument();
	});

	it('shows "Start typing to search" prompt for empty query', () => {
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		expect(screen.getByText('Start typing to search')).toBeInTheDocument();
	});

	it('renders the Close button', () => {
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
	});
});

describe('CloudSongAutocomplete – close behavior', () => {
	it('calls onclose when Close button is clicked', async () => {
		const onclose = vi.fn();
		render(CloudSongAutocomplete, { props: { isOpen: true, onclose } });
		await fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('calls onclose when Escape is pressed in the search input', async () => {
		const onclose = vi.fn();
		render(CloudSongAutocomplete, { props: { isOpen: true, onclose } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('calls onclose when backdrop is clicked', async () => {
		const onclose = vi.fn();
		render(CloudSongAutocomplete, { props: { isOpen: true, onclose } });
		await fireEvent.click(screen.getByRole('button', { name: /close popup/i }));
		expect(onclose).toHaveBeenCalledOnce();
	});
});

describe('CloudSongAutocomplete – search behavior', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not search when query has fewer than 2 characters', async () => {
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'A' } });
		vi.advanceTimersByTime(400);
		expect(mockDesktopHost.searchCloudSongs).not.toHaveBeenCalled();
	});

	it('searches via desktopHost after debounce when query has 2+ characters', async () => {
		mockDesktopHost.searchCloudSongs.mockResolvedValue({ success: true, data: defaultSongs });
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'So' } });
		vi.advanceTimersByTime(350);
		await waitFor(() =>
			expect(mockDesktopHost.searchCloudSongs).toHaveBeenCalledWith(
				expect.objectContaining({ query: 'So', limit: 20 })
			)
		);
	});

	it('displays song results after successful search', async () => {
		mockDesktopHost.searchCloudSongs.mockResolvedValue({ success: true, data: defaultSongs });
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Song' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => {
			expect(screen.getByText('Song Alpha')).toBeInTheDocument();
			expect(screen.getByText('Song Beta')).toBeInTheDocument();
		});
	});

	it('shows "No songs found" when search returns empty results', async () => {
		mockDesktopHost.searchCloudSongs.mockResolvedValue({ success: true, data: [] });
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'zz' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => {
			expect(screen.getByText('No songs found')).toBeInTheDocument();
		});
	});

	it('shows "No songs found" when desktopHost returns failure', async () => {
		mockDesktopHost.searchCloudSongs.mockResolvedValue({
			success: false,
			error: 'Search failed'
		});
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'er' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => {
			expect(screen.getByText('No songs found')).toBeInTheDocument();
		});
	});

	it('shows "No songs found" when desktopHost throws an error', async () => {
		mockDesktopHost.searchCloudSongs.mockRejectedValue(new Error('Host error'));
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'er' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => {
			expect(screen.getByText('No songs found')).toBeInTheDocument();
		});
	});

	it('filters out excluded linked song IDs from results', async () => {
		mockDesktopHost.searchCloudSongs.mockResolvedValue({ success: true, data: defaultSongs });
		render(CloudSongAutocomplete, {
			props: { isOpen: true, excludeLinkedSongIds: ['1'] }
		});
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'So' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => {
			expect(screen.queryByText('Song Alpha')).not.toBeInTheDocument();
			expect(screen.getByText('Song Beta')).toBeInTheDocument();
		});
	});

	it('shows clear button when search query is non-empty', async () => {
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'test' } });
		expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument();
	});

	it('clears results when clear button is clicked', async () => {
		mockDesktopHost.searchCloudSongs.mockResolvedValue({ success: true, data: defaultSongs });
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'Song' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => expect(screen.getByText('Song Alpha')).toBeInTheDocument());

		await fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
		expect(screen.queryByText('Song Alpha')).not.toBeInTheDocument();
		expect(screen.getByText('Start typing to search')).toBeInTheDocument();
	});
});

describe('CloudSongAutocomplete – keyboard navigation', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockDesktopHost.searchCloudSongs.mockResolvedValue({
			success: true,
			data: defaultSongs
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const loadResults = async () => {
		render(CloudSongAutocomplete, { props: { isOpen: true } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'So' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => expect(screen.getByText('Song Alpha')).toBeInTheDocument());
		return input;
	};

	it('calls onselect and onclose when Enter is pressed on the selected item', async () => {
		const onselect = vi.fn();
		const onclose = vi.fn();
		render(CloudSongAutocomplete, { props: { isOpen: true, onselect, onclose } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'So' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => expect(screen.getByText('Song Alpha')).toBeInTheDocument());

		await fireEvent.keyDown(input, { key: 'ArrowDown' });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(onselect).toHaveBeenCalledWith(defaultSongs[0]);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('does not call onselect when Enter is pressed with no selection', async () => {
		const onselect = vi.fn();
		const input = await loadResults();
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onselect).not.toHaveBeenCalled();
	});

	it('calls onselect when a result is clicked', async () => {
		const onselect = vi.fn();
		render(CloudSongAutocomplete, { props: { isOpen: true, onselect } });
		const input = screen.getByPlaceholderText(/search by song title or artist/i);
		await fireEvent.input(input, { target: { value: 'So' } });
		vi.advanceTimersByTime(350);
		await waitFor(() => expect(screen.getByText('Song Alpha')).toBeInTheDocument());

		await fireEvent.click(screen.getByText('Song Alpha'));
		expect(onselect).toHaveBeenCalledWith(defaultSongs[0]);
	});
});
