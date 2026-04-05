import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { simFileStore } from '../stores/simFileStore';
import { workspaceStore } from '../stores/workspaceStore';
import type { SimfileWithDtx } from '@dtx/common';

vi.mock('@lucide/svelte');

vi.mock('../services/simFileService', () => ({
	simFileService: {
		refreshUserSimFiles: vi.fn()
	}
}));

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Pagination: vi.fn()
}));

import SimFileList from './SimFileList.svelte';
import { simFileService } from '../services/simFileService';

const makeSimFile = (overrides: Partial<SimfileWithDtx> = {}): SimfileWithDtx =>
	({
		id: 1,
		title: 'Test Song',
		artist: 'Test Artist',
		bpm: 120,
		is_published: false,
		publish_date: null,
		dtx_files: [],
		...overrides
	}) as SimfileWithDtx;

describe('SimFileList', () => {
	beforeEach(() => {
		simFileStore.reset();
		workspaceStore.reset();
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	describe('empty state', () => {
		it('renders My SimFiles heading', () => {
			render(SimFileList);
			expect(screen.getByText(/My SimFiles/i)).toBeInTheDocument();
		});

		it('shows empty state message when no simFiles', () => {
			render(SimFileList);
			expect(screen.getByText('No simFiles found')).toBeInTheDocument();
		});

		it('shows Refresh button', () => {
			render(SimFileList);
			expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
		});
	});

	describe('loading state', () => {
		it('shows loading indicator when isLoading is true', () => {
			simFileStore.setLoading(true);
			render(SimFileList);
			expect(screen.getByText('Loading simFiles...')).toBeInTheDocument();
		});

		it('Refresh button is disabled when loading', () => {
			simFileStore.setLoading(true);
			render(SimFileList);
			expect(screen.getByRole('button', { name: /Refresh/i })).toBeDisabled();
		});
	});

	describe('error state', () => {
		it('shows error message when there is an error', () => {
			simFileStore.setError('Network error');
			render(SimFileList);
			expect(screen.getByText('Network error')).toBeInTheDocument();
		});
	});

	describe('with simfiles', () => {
		it('renders simFile cards with title and artist', () => {
			simFileStore.setUserSimFiles([
				makeSimFile({ id: 1, title: 'Song One', artist: 'Artist One' }),
				makeSimFile({ id: 2, title: 'Song Two', artist: 'Artist Two' })
			]);
			render(SimFileList);
			expect(screen.getByText('Song One')).toBeInTheDocument();
			expect(screen.getByText('Artist One')).toBeInTheDocument();
			expect(screen.getByText('Song Two')).toBeInTheDocument();
		});

		it('shows Published badge for published simFiles', () => {
			simFileStore.setUserSimFiles([makeSimFile({ id: 1, is_published: true })]);
			render(SimFileList);
			expect(screen.getByText('Published')).toBeInTheDocument();
		});

		it('shows Draft badge for unpublished simFiles', () => {
			simFileStore.setUserSimFiles([makeSimFile({ id: 1, is_published: false })]);
			render(SimFileList);
			expect(screen.getByText('Draft')).toBeInTheDocument();
		});

		it('shows BPM value', () => {
			simFileStore.setUserSimFiles([makeSimFile({ id: 1, bpm: 180 })]);
			render(SimFileList);
			expect(screen.getByText('180 BPM')).toBeInTheDocument();
		});

		it('shows cached data indicator when fromCache is true', () => {
			simFileStore.setUserSimFiles([makeSimFile()], true);
			render(SimFileList);
			expect(screen.getByText('Cached data')).toBeInTheDocument();
		});

		it('shows Linked badge when simFile is linked to a workspace folder', () => {
			simFileStore.setUserSimFiles([makeSimFile({ id: 42 })]);
			workspaceStore.setTreeStructure([
				{
					name: 'Song Folder',
					path: '/songs/folder',
					isExpanded: false,
					isLoading: false,
					children: [],
					hasChildren: false,
					containsDtxFiles: true,
					linkedSimFileId: '42'
				}
			]);
			render(SimFileList);
			expect(screen.getByText('Linked')).toBeInTheDocument();
		});
	});

	describe('search functionality', () => {
		it('renders search input', () => {
			render(SimFileList);
			expect(
				screen.getByPlaceholderText(/Search by song title or artist/i)
			).toBeInTheDocument();
		});

		it('filters simFiles by title when searching', async () => {
			simFileStore.setUserSimFiles([
				makeSimFile({ id: 1, title: 'Rock Anthem', artist: 'Band One' }),
				makeSimFile({ id: 2, title: 'Jazz Ballad', artist: 'Band Two' })
			]);
			render(SimFileList);
			const searchInput = screen.getByPlaceholderText(/Search by song title or artist/i);
			await fireEvent.input(searchInput, { target: { value: 'Rock' } });
			expect(screen.getByText('Rock Anthem')).toBeInTheDocument();
			expect(screen.queryByText('Jazz Ballad')).not.toBeInTheDocument();
		});

		it('filters simFiles by artist when searching', async () => {
			simFileStore.setUserSimFiles([
				makeSimFile({ id: 1, title: 'Song A', artist: 'The Beatles' }),
				makeSimFile({ id: 2, title: 'Song B', artist: 'Led Zeppelin' })
			]);
			render(SimFileList);
			const searchInput = screen.getByPlaceholderText(/Search by song title or artist/i);
			await fireEvent.input(searchInput, { target: { value: 'beatles' } });
			expect(screen.getByText('Song A')).toBeInTheDocument();
			expect(screen.queryByText('Song B')).not.toBeInTheDocument();
		});

		it('shows no results message when search finds nothing', async () => {
			simFileStore.setUserSimFiles([
				makeSimFile({ id: 1, title: 'My Song', artist: 'Artist' })
			]);
			render(SimFileList);
			const searchInput = screen.getByPlaceholderText(/Search by song title or artist/i);
			await fireEvent.input(searchInput, { target: { value: 'xyz_no_match' } });
			expect(screen.getByText(/No simFiles found for/i)).toBeInTheDocument();
		});

		it('shows clear search button when search query is set', async () => {
			render(SimFileList);
			const searchInput = screen.getByPlaceholderText(/Search by song title or artist/i);
			await fireEvent.input(searchInput, { target: { value: 'query' } });
			expect(screen.getByRole('button', { name: /Clear search/i })).toBeInTheDocument();
		});

		it('clears search when clear button is clicked', async () => {
			simFileStore.setUserSimFiles([
				makeSimFile({ id: 1, title: 'A Song', artist: 'Artist' })
			]);
			render(SimFileList);
			const searchInput = screen.getByPlaceholderText(/Search by song title or artist/i);
			await fireEvent.input(searchInput, { target: { value: 'A Song' } });
			const clearBtn = screen.getByRole('button', { name: /Clear search/i });
			await fireEvent.click(clearBtn);
			expect(screen.queryByRole('button', { name: /Clear search/i })).not.toBeInTheDocument();
		});
	});

	describe('refresh functionality', () => {
		it('calls simFileService.refreshUserSimFiles when Refresh is clicked', async () => {
			vi.mocked(simFileService.refreshUserSimFiles).mockResolvedValue({
				data: [],
				error: null,
				fromCache: false
			});
			render(SimFileList);
			await fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
			await waitFor(() => {
				expect(simFileService.refreshUserSimFiles).toHaveBeenCalled();
			});
		});

		it('sets error in store when refresh returns an error', async () => {
			vi.mocked(simFileService.refreshUserSimFiles).mockResolvedValue({
				data: [],
				error: 'API error',
				fromCache: false
			});
			render(SimFileList);
			await fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
			await waitFor(() => {
				expect(screen.getByText('API error')).toBeInTheDocument();
			});
		});

		it('handles refresh network error gracefully', async () => {
			vi.mocked(simFileService.refreshUserSimFiles).mockRejectedValue(
				new Error('Network failure')
			);
			render(SimFileList);
			await fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
			await waitFor(() => {
				expect(screen.getByText('Network failure')).toBeInTheDocument();
			});
		});
	});
});
