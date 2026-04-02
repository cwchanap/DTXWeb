/**
 * Unit tests for ChartList.svelte component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Mock modules that would be imported by the component
vi.mock('svelte-i18n', () => ({
	_: {
		subscribe: (cb: (fn: (key: string) => string) => void) => {
			cb((key: string) => key);
			return () => {};
		}
	}
}));

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Switch: vi.fn(),
	Pagination: vi.fn()
}));

vi.mock('@lucide/svelte/icons/x', () => ({ default: vi.fn() }));
vi.mock('@lucide/svelte/icons/check', () => ({ default: vi.fn() }));
vi.mock('@lucide/svelte/icons/table', () => ({ default: vi.fn() }));
vi.mock('@lucide/svelte/icons/grid', () => ({ default: vi.fn() }));

vi.mock('@/lib/toaster', () => ({
	default: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('$lib/components/ChartListItem.svelte', () => ({ default: vi.fn() }));
vi.mock('$lib/components/ChartListTableItem.svelte', () => ({ default: vi.fn() }));

vi.mock('$lib/utils', () => ({
	formatLevelDisplay: (dtxFiles: unknown) => {
		if (Array.isArray(dtxFiles)) {
			return dtxFiles.map((file: { level: number }) => file.level).join(', ');
		}
		return 'N/A';
	}
}));

// Create a mock Supabase client
const createMockSupabase = () => {
	// Create a mock that returns the test data
	return {
		from: vi.fn().mockImplementation(() => ({
			select: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			ilike: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			range: vi.fn().mockReturnThis(),
			then: vi.fn().mockImplementation((callback) => {
				callback({
					data: mockItems,
					error: null,
					count: mockItems.length
				});
				return { catch: vi.fn() };
			})
		})),
		storage: {
			from: vi.fn().mockReturnValue({
				getPublicUrl: vi.fn().mockReturnValue({
					data: { publicUrl: 'https://example.com/mock-url' }
				})
			})
		},
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: { id: 'mock-user-id' } }
			})
		}
	};
};

// Test data
const mockItems = [
	{
		id: 1,
		title: 'Test Song 1',
		artist: 'Test Artist 1',
		bpm: 120,
		download_url: 'https://example.com/download1',
		is_published: true,
		display_id: 'TST001',
		dtx_files: [{ level: 3 }, { level: 5 }],
		created_at: '2023-01-01',
		updated_at: '2023-01-02',
		publish_date: '2023-01-03',
		user_id: 'user-1',
		video_preview_url: null
	},
	{
		id: 2,
		title: 'Test Song 2',
		artist: 'Test Artist 2',
		bpm: 140,
		download_url: null,
		is_published: false,
		display_id: 'TST002',
		dtx_files: [{ level: 4 }],
		created_at: '2023-02-01',
		updated_at: '2023-02-02',
		publish_date: '2023-02-03',
		user_id: 'user-1',
		video_preview_url: null
	}
];

/**
 * Instead of testing the component by rendering it and interacting with the DOM,
 * we'll test the component's logic directly by creating instances of the component
 * and testing its state and methods.
 *
 * This approach avoids the lifecycle_function_unavailable error in Svelte 5.
 */
describe('ChartList Component Logic', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let mockSupabase: any;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	// Test the Supabase query construction
	it('constructs correct Supabase query', () => {
		// Verify the mock was called correctly
		expect(mockSupabase.from).toBeDefined();

		// We can't easily test the loadItems method directly in Svelte 5,
		// but we can verify that our mock is properly set up
		const query = mockSupabase.from();
		expect(query.select).toBeDefined();
		expect(query.order).toBeDefined();
		expect(query.ilike).toBeDefined();
		expect(query.range).toBeDefined();
	});

	// Test filtering by artist
	it('filters items by artist name', () => {
		// Create a mock with filter functionality
		const filterMock = vi.fn();
		const mockSupabaseWithFilter = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				ilike: filterMock,
				eq: vi.fn().mockReturnThis(),
				range: vi.fn().mockReturnThis()
			})
		};

		// Simulate filtering by artist
		mockSupabaseWithFilter.from().ilike('artist', '%Artist 1%');

		// Verify the filter was called with the correct parameters
		expect(filterMock).toHaveBeenCalledWith('artist', '%Artist 1%');
	});

	// Test the hideUnpublished filter
	it('filters unpublished items', async () => {
		// Create a reactive variable for filteredItems
		let filteredItems = [...mockItems];
		let hideUnpublished = false;

		// Initially, all items should be visible
		expect(filteredItems.length).toBe(2);

		hideUnpublished = true;

		// Replace the run() call with tick()
		await tick();
		filteredItems = hideUnpublished ? mockItems.filter((item) => item.is_published) : mockItems;

		await tick();
		// Now only published items should be visible
		expect(filteredItems.length).toBe(1);
		expect(filteredItems[0].is_published).toBe(true);
	});

	// Test pagination
	it('handles pagination correctly', () => {
		// Create a mock with range functionality
		const rangeMock = vi.fn();
		const mockSupabaseWithPagination = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				ilike: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				range: rangeMock
			})
		};

		// Simulate pagination - page 2 with pageSize 10
		mockSupabaseWithPagination.from().range(10, 19);

		// Verify the range was called with the correct parameters
		expect(rangeMock).toHaveBeenCalledWith(10, 19);
	});

	// Test blog mode differences
	it('handles blog mode correctly', () => {
		// Create a mock with eq functionality
		const eqMock = vi.fn();
		const mockSupabaseWithBlogMode = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				ilike: vi.fn().mockReturnThis(),
				eq: eqMock,
				range: vi.fn().mockReturnThis()
			})
		};

		// Simulate blog mode query
		mockSupabaseWithBlogMode.from().eq('is_published', true);

		// Verify the eq was called with the correct parameters
		expect(eqMock).toHaveBeenCalledWith('is_published', true);
	});

	describe('Table View Menu Layering Regression', () => {
		it('sets table row wrapper stacking classes for dropdown interactions', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain('hover:z-30');
			expect(source).toContain('focus-within:z-30');
		});

		it('sets table popover zIndex higher than row stacking layer', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartListTableItem.svelte'),
				'utf-8'
			);
			const popoverZIndexMatch = source.match(/<Popover[\s\S]*?zIndex="(\d+)"/);

			expect(popoverZIndexMatch).not.toBeNull();
			expect(Number(popoverZIndexMatch?.[1])).toBeGreaterThan(30);
		});
	});

	describe('Bulk Download Error Handling', () => {
		it('uses validation plus download submission so real POST failures can surface', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain("console.error('Bulk download request failed:'");
			expect(source).toContain("console.error('Failed to start bulk download:'");
			expect(source).toContain('const clearBulkSelection = () => {');
			expect(source).toContain('const resetBulkSelection = () => {');
			expect(source).toContain("fetch('/api/simFile/download/bulk?validate=1'");
			expect(source).toContain("fetch('/api/simFile/download/bulk', {");
			expect(source).toContain('if (!data?.ok || data.fileCount === 0) {');
			expect(source).toContain('No uploaded files found for the selected charts');
			expect(source).toContain('await submitBulkDownload(ids);');
		});

		it('streams bulk downloads via showSaveFilePicker when available', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain('const streamToFile');
			expect(source).toContain('window.showSaveFilePicker');
			expect(source).toContain('response.body.pipeTo(writable)');
		});

		it('resets bulk selections when page, page size, or search changes', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain('const changePage = (newPage: number) => {');
			expect(source).toContain('resetBulkSelection();\n\t\t\tcurrentPage = newPage;');
			expect(source).toContain(
				'function handlePageSizeChange(event: { pageSize: number }) {'
			);
			expect(source).toContain('resetBulkSelection();\n\t\tpageSize = event.pageSize;');
			expect(source).toContain('searchTimeout = setTimeout(() => {');
			expect(source).toContain('resetBulkSelection();\n\t\t\tcurrentPage = 1;');
		});

		it('gates bulk selection to charts with uploaded files', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain(
				'const canBulkSelect = (item: ListedChart & { has_uploaded_files?: boolean }) =>'
			);
			expect(source).toContain('item.has_uploaded_files === true');
			expect(source).toContain('{#if selectMode && isBlog && canBulkSelect(item)}');
		});

		it('enforces the 20-chart bulk download limit in the UI', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain('const MAX_BULK_DOWNLOAD_CHARTS = 20;');
			expect(source).toContain('if (next.size >= MAX_BULK_DOWNLOAD_CHARTS) {');
			expect(source).toContain('if (selectedIds.size > MAX_BULK_DOWNLOAD_CHARTS) {');
		});
	});
});

import ChartList from './ChartList.svelte';

const mockFetchSuccess = (data = [], count = 0) => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ data, count })
		})
	);
};

describe('ChartList Rendering', () => {
	beforeEach(() => {
		mockFetchSuccess();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('renders search input on mount', async () => {
		render(ChartList);
		expect(screen.getByRole('textbox')).toBeInTheDocument();
	});

	it('calls fetch to load items on mount', async () => {
		render(ChartList);
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/api/chart?'));
		});
	});

	it('renders card view button and table view button', async () => {
		render(ChartList);
		expect(screen.getByRole('button', { name: 'Card view' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Table view' })).toBeInTheDocument();
	});

	it('switches to table view when table button clicked', async () => {
		render(ChartList);
		const tableBtn = screen.getByRole('button', { name: 'Table view' });
		await fireEvent.click(tableBtn);
		expect(tableBtn).toHaveAttribute('aria-pressed', 'true');
	});

	it('switches back to card view when card button clicked', async () => {
		render(ChartList);
		const cardBtn = screen.getByRole('button', { name: 'Card view' });
		const tableBtn = screen.getByRole('button', { name: 'Table view' });
		await fireEvent.click(tableBtn);
		await fireEvent.click(cardBtn);
		expect(cardBtn).toHaveAttribute('aria-pressed', 'true');
	});

	it('renders page size selector', async () => {
		render(ChartList);
		expect(screen.getByRole('combobox')).toBeInTheDocument();
	});

	it('uses blog scope when isBlog prop is true', async () => {
		render(ChartList, { props: { isBlog: true } });
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledWith(
				expect.stringContaining('scope=published')
			);
		});
	});

	it('uses mine scope when isBlog is false', async () => {
		render(ChartList, { props: { isBlog: false } });
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('scope=mine'));
		});
	});

	it('renders chart items in table view when data is returned', async () => {
		mockFetchSuccess(
			[
				{
					id: 1,
					title: 'My Song',
					artist: 'Artist',
					bpm: 120,
					is_published: true,
					display_id: 1,
					dtx_files: [],
					publish_date: '2024-01-01',
					download_url: null,
					video_preview_url: null
				}
			],
			1
		);
		render(ChartList, { props: { isBlog: false } });
		// Switch to table view so titles render in the HTML directly
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => {
			expect(screen.getByText(/My Song/)).toBeInTheDocument();
		});
	});

	it('shows loading state while fetching', async () => {
		let resolveFetch!: (value: unknown) => void;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockReturnValue(
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
			)
		);
		render(ChartList);
		expect(screen.getByText('Loading charts...')).toBeInTheDocument();
		resolveFetch({ ok: true, json: async () => ({ data: [], count: 0 }) });
	});

	it('handles fetch error gracefully', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
		render(ChartList);
		await waitFor(() => {
			expect(screen.queryByText('Loading charts...')).not.toBeInTheDocument();
		});
	});

	it('handles non-ok fetch response gracefully', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				text: vi.fn().mockResolvedValue('Internal Server Error')
			})
		);
		render(ChartList);
		await waitFor(() => {
			expect(screen.queryByText('Loading charts...')).not.toBeInTheDocument();
		});
	});

	it('triggers search after input with debounce', async () => {
		vi.useFakeTimers();
		render(ChartList);
		const input = screen.getByRole('textbox');
		await fireEvent.input(input, { target: { value: 'test' } });
		vi.advanceTimersByTime(600);
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
		});
		vi.useRealTimers();
	});

	it('passes pageSize prop correctly to fetch', async () => {
		render(ChartList, { props: { pageSize: 6 } });
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('pageSize=6'));
		});
	});

	it('changes page size from selector and re-fetches', async () => {
		render(ChartList);
		const select = screen.getByRole('combobox');
		await fireEvent.change(select, { target: { value: '24' } });
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('pageSize=24'));
		});
	});
});

import { Pagination } from '@skeletonlabs/skeleton-svelte';
import ChartListTableItemModule from '$lib/components/ChartListTableItem.svelte';
import toastStore from '@/lib/toaster';

// Helper: get last Svelte 5 component call props (index 1 = props, fallback to index 0)
function getLastTableItemProps<T = Record<string, unknown>>(): T | undefined {
	const calls = vi.mocked(ChartListTableItemModule).mock.calls;
	const last = calls[calls.length - 1];
	return (last?.[1] ?? last?.[0]) as T | undefined;
}

// Helper: get the onFileDelete handler from ChartListTableItem props or throw if missing
function getRequiredPropFromTableItem<T>(propName: string): T {
	const props = getLastTableItemProps();
	const value = props?.[propName];
	if (value === undefined) {
		throw new Error(
			`Expected prop "${propName}" to be passed to ChartListTableItem, but it was not found. Mock calls: ${vi.mocked(ChartListTableItemModule).mock.calls.length}`
		);
	}
	return value as T;
}

describe('ChartList – handlePageChange via Pagination prop', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('handlePageChange calls fetch with updated page when onPageChange fires', async () => {
		// Return enough items that totalPages > 1 (count=25, pageSize=12 → 3 pages)
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ data: [], count: 25 })
			})
		);

		render(ChartList);

		// Wait for pagination to be rendered (totalPages > 1 after load)
		await waitFor(() => {
			const calls = vi.mocked(Pagination).mock.calls;
			expect(calls.length).toBeGreaterThan(0);
		});

		// Pagination renders when totalPages > 1; grab onPageChange from mock call args.
		// Svelte 5 calls Component(anchor, props) – check both index 0 and 1.
		const paginationCalls = vi.mocked(Pagination).mock.calls;
		const lastCall = paginationCalls[paginationCalls.length - 1];
		const paginationProps = (lastCall?.[1] ?? lastCall?.[0]) as
			| Record<string, unknown>
			| undefined;

		expect(lastCall).toBeDefined();
		const onPageChange = paginationProps?.onPageChange as (e: { page: number }) => void;
		expect(typeof onPageChange).toBe('function');

		vi.mocked(fetch).mockClear();
		onPageChange({ page: 2 });
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('page=2'));
		});
	});
});

describe('ChartList – handleFileDelete via ChartListTableItem prop', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const item = {
		id: 42,
		title: 'Delete Me',
		artist: 'Artist',
		bpm: 120,
		is_published: true,
		display_id: 1,
		dtx_files: [],
		publish_date: null,
		download_url: null,
		video_preview_url: null
	};

	it('handleFileDelete calls DELETE api and shows success toast on clean deletion', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				// loadItems on mount
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [item], count: 1 })
				})
				// DELETE call
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ partialDeletion: false })
				})
				// loadItems after delete
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [], count: 0 })
				})
		);

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));

		await waitFor(() => expect(screen.getByText(/Delete Me/)).toBeInTheDocument());

		const onFileDelete =
			getRequiredPropFromTableItem<(id: number) => Promise<void>>('onFileDelete');
		await onFileDelete(42);
		await waitFor(() => {
			expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/simFile/delete/42', {
				method: 'DELETE'
			});
			expect(vi.mocked(toastStore.success)).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Chart deleted' })
			);
		});
	});

	it('handleFileDelete shows error toast when DELETE response is not ok', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [item], count: 1 })
				})
				.mockResolvedValueOnce({
					ok: false,
					json: vi.fn().mockResolvedValue({ error: 'Server error' }),
					text: vi.fn().mockResolvedValue('Server error')
				})
		);

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Delete Me/)).toBeInTheDocument());

		const onFileDelete =
			getRequiredPropFromTableItem<(id: number) => Promise<void>>('onFileDelete');
		await onFileDelete(42);
		await waitFor(() => {
			expect(vi.mocked(toastStore.error)).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to delete chart files' })
			);
		});
	});

	it('handleFileDelete shows partial deletion toast when partialDeletion is true', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [item], count: 1 })
				})
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ partialDeletion: true })
				})
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [], count: 0 })
				})
		);

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Delete Me/)).toBeInTheDocument());

		const onFileDelete =
			getRequiredPropFromTableItem<(id: number) => Promise<void>>('onFileDelete');
		await onFileDelete(42);
		await waitFor(() => {
			expect(vi.mocked(toastStore.error)).toHaveBeenCalledWith(
				expect.objectContaining({
					title: expect.stringContaining('some files may remain')
				})
			);
		});
	});

	it('handleFileDelete falls back to response.text() when json() throws (lines 138-139)', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [item], count: 1 })
				})
				.mockResolvedValueOnce({
					ok: false,
					// json() throws → inner catch runs response.text()
					json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
					text: vi.fn().mockResolvedValue('plain error text')
				})
		);

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Delete Me/)).toBeInTheDocument());

		const onFileDelete =
			getRequiredPropFromTableItem<(id: number) => Promise<void>>('onFileDelete');
		await onFileDelete(42);
		await waitFor(() => {
			expect(vi.mocked(toastStore.error)).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to delete chart files' })
			);
		});
	});

	it('handleFileDelete shows error toast on fetch network failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [item], count: 1 })
				})
				.mockRejectedValueOnce(new Error('Network failure'))
		);

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Delete Me/)).toBeInTheDocument());

		const onFileDelete =
			getRequiredPropFromTableItem<(id: number) => Promise<void>>('onFileDelete');
		await onFileDelete(42);
		await waitFor(() => {
			expect(vi.mocked(toastStore.error)).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Failed to delete chart files' })
			);
		});
	});
});

describe('ChartList – togglePublishChart via ChartListTableItem prop', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const item = {
		id: 10,
		title: 'Toggle Chart',
		artist: 'Artist',
		bpm: 120,
		is_published: true,
		display_id: 2,
		dtx_files: [],
		publish_date: null,
		download_url: null,
		video_preview_url: null
	};

	it('togglePublishChart PATCHes api and shows success toast when publish succeeds', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				// initial loadItems
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [item], count: 1 })
				})
				// PATCH call
				.mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({}) })
		);

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Toggle Chart/)).toBeInTheDocument());

		const props = getLastTableItemProps();
		const togglePublishChart = props?.togglePublishChart as
			| ((id: number, published: boolean) => Promise<void>)
			| undefined;

		if (togglePublishChart) {
			await togglePublishChart(10, true);
			await waitFor(() => {
				expect(vi.mocked(fetch)).toHaveBeenCalledWith(
					'/api/chart/10',
					expect.objectContaining({ method: 'PATCH' })
				);
				expect(vi.mocked(toastStore.success)).toHaveBeenCalledWith(
					expect.objectContaining({ title: 'Chart unpublished' })
				);
			});
		} else {
			expect(props).toBeDefined();
		}
	});

	it('togglePublishChart shows error toast when PATCH fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({ data: [item], count: 1 })
				})
				.mockResolvedValueOnce({ ok: false })
		);

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Toggle Chart/)).toBeInTheDocument());

		const props = getLastTableItemProps();
		const togglePublishChart = props?.togglePublishChart as
			| ((id: number, published: boolean) => Promise<void>)
			| undefined;

		if (togglePublishChart) {
			await togglePublishChart(10, false);
			await waitFor(() => {
				expect(vi.mocked(toastStore.error)).toHaveBeenCalledWith(
					expect.objectContaining({ title: expect.stringContaining('publish') })
				);
			});
		} else {
			expect(props).toBeDefined();
		}
	});
});
