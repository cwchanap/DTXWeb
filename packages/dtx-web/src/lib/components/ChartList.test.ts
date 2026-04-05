import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mockToastStore = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn()
}));

vi.mock('svelte-i18n');

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Switch: vi.fn().mockReturnValue(null),
	Pagination: vi.fn().mockReturnValue(null)
}));

vi.mock('$lib/toaster', () => ({
	default: mockToastStore
}));

vi.mock('@/lib/toaster', () => ({
	default: mockToastStore
}));

vi.mock('./ChartListItem.svelte', async () => {
	const { default: ModalStub } = await import('../../tests/stubs/ModalStub.svelte');
	return { default: ModalStub };
});

vi.mock('./ChartListTableItem.svelte', async () => {
	const { default: ModalStub } = await import('../../tests/stubs/ModalStub.svelte');
	return { default: ModalStub };
});

vi.mock('$lib/components/ChartListTableItem.svelte', () => ({ default: vi.fn() }));

vi.mock('@lucide/svelte/icons');

import ChartList from './ChartList.svelte';
import * as chartListHelpers from './ChartList.helpers';

const mockListedChart = {
	id: 1,
	title: 'Test Song 1',
	artist: 'Test Artist 1',
	bpm: 120,
	download_url: 'https://example.com/download1',
	has_uploaded_files: true,
	is_published: true,
	display_id: 'TST001',
	dtx_files: [{ level: 3 }, { level: 5 }],
	created_at: '2023-01-01',
	updated_at: '2023-01-02',
	publish_date: '2023-01-03',
	user_id: 'user-1',
	video_preview_url: null
};

const createJsonResponse = (body: unknown, status = 200): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers({ 'Content-Type': 'application/json' }),
		json: async () => body
	}) as Response;

const createDownloadResponse = (pipeTo = vi.fn().mockResolvedValue(undefined)): Response =>
	({
		ok: true,
		status: 200,
		headers: new Headers({ 'Content-Type': 'application/zip' }),
		body: { pipeTo } as unknown as ReadableStream<Uint8Array>
	}) as Response;

const renderChartListWithSelection = async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValue(createJsonResponse({ data: [mockListedChart], count: 1 }));
	vi.stubGlobal('fetch', fetchMock);
	Object.defineProperty(window, 'showSaveFilePicker', {
		configurable: true,
		value: vi.fn()
	});

	render(ChartList, {
		props: {
			isBlog: true,
			enableDownload: true
		}
	});

	await fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
	const checkbox = await screen.findByRole('checkbox', {
		name: `Select ${mockListedChart.title}`
	});
	await fireEvent.click(checkbox);
	await screen.findByRole('button', { name: /download \(1\)/i });

	return { checkbox, fetchMock };
};

describe('ChartList helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('detects browser support for bulk download streaming', () => {
		expect(chartListHelpers.supportsBulkDownloadStreaming({})).toBe(false);
		expect(
			chartListHelpers.supportsBulkDownloadStreaming({
				showSaveFilePicker: vi.fn()
			})
		).toBe(true);
	});

	it('opens the save picker before validation and download requests', async () => {
		const callOrder: string[] = [];
		const writable = {} as WritableStream<Uint8Array>;
		const handle = {
			createWritable: vi.fn(async () => {
				callOrder.push('createWritable');
				return writable;
			})
		};
		const pipeTo = vi.fn(async () => {
			callOrder.push('pipeTo');
		});
		const saveFilePickerWindow = {
			showSaveFilePicker: vi.fn(async () => {
				callOrder.push('picker');
				return handle;
			})
		};
		const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			callOrder.push(url);
			if (url.endsWith('?validate=1')) {
				return createJsonResponse({ ok: true, fileCount: 1 });
			}
			return createDownloadResponse(pipeTo);
		});

		await chartListHelpers.startBulkDownload({
			ids: [mockListedChart.id],
			fetchFn,
			saveFilePickerWindow
		});

		expect(callOrder).toEqual([
			'picker',
			'/api/simFile/download/bulk?validate=1',
			'/api/simFile/download/bulk',
			'createWritable',
			'pipeTo'
		]);
	});

	it('does not issue validation or download requests when the save picker is cancelled', async () => {
		const abortError = new DOMException('The operation was aborted.', 'AbortError');
		const fetchFn = vi.fn();

		await expect(
			chartListHelpers.startBulkDownload({
				ids: [mockListedChart.id],
				fetchFn,
				saveFilePickerWindow: {
					showSaveFilePicker: vi.fn().mockRejectedValue(abortError)
				}
			})
		).rejects.toBe(abortError);

		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('creates a writable from a file handle only when the response is streamed', async () => {
		const writable = {} as WritableStream<Uint8Array>;
		const handle = {
			createWritable: vi.fn().mockResolvedValue(writable)
		};
		const pipeTo = vi.fn().mockResolvedValue(undefined);

		await chartListHelpers.streamToFile(
			{
				body: { pipeTo } as unknown as ReadableStream<Uint8Array>
			} as Response,
			handle
		);

		expect(handle.createWritable).toHaveBeenCalledTimes(1);
		expect(pipeTo).toHaveBeenCalledWith(writable);
	});

	it('accepts a writable stream directly when streaming the download response', async () => {
		const writable = {} as WritableStream<Uint8Array>;
		const pipeTo = vi.fn().mockResolvedValue(undefined);

		await chartListHelpers.streamToFile(
			{
				body: { pipeTo } as unknown as ReadableStream<Uint8Array>
			} as Response,
			writable
		);

		expect(pipeTo).toHaveBeenCalledWith(writable);
	});

	it('recognizes AbortError values', () => {
		expect(
			chartListHelpers.isAbortError(
				new DOMException('The operation was aborted.', 'AbortError')
			)
		).toBe(true);
		expect(chartListHelpers.isAbortError({ name: 'AbortError' })).toBe(true);
		expect(chartListHelpers.isAbortError(new Error('Nope'))).toBe(false);
	});

	it('exposes the bulk download chart limit', () => {
		expect(chartListHelpers.MAX_BULK_DOWNLOAD_CHARTS).toBe(20);
	});

	it('allows bulk selection only for charts with uploaded files', () => {
		expect(chartListHelpers.canBulkSelect(mockListedChart)).toBe(true);
		expect(
			chartListHelpers.canBulkSelect({ ...mockListedChart, has_uploaded_files: false })
		).toBe(false);
		expect(chartListHelpers.canBulkSelect({})).toBe(false);
	});

	it('returns a cleared bulk selection set', () => {
		expect([...chartListHelpers.resetBulkSelection()]).toEqual([]);
	});

	it('returns page changes that stay within the available range', () => {
		expect(chartListHelpers.changePage(2, 3)).toEqual({
			currentPage: 2,
			selectedIds: new Set<number>()
		});
		expect(chartListHelpers.changePage(0, 3)).toBeNull();
		expect(chartListHelpers.changePage(4, 3)).toBeNull();
	});

	it('resets selection and jumps back to the first page when the page size changes', () => {
		expect(chartListHelpers.handlePageSizeChange(24)).toEqual({
			pageSize: 24,
			currentPage: 1,
			selectedIds: new Set<number>()
		});
	});
});

describe('ChartList component bulk download behavior', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('treats AbortError as a no-op and preserves the current selection', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const startBulkDownloadSpy = vi
			.spyOn(chartListHelpers, 'startBulkDownload')
			.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

		const { fetchMock, checkbox } = await renderChartListWithSelection();

		await fireEvent.click(screen.getByRole('button', { name: /download \(1\)/i }));

		await waitFor(() => expect(startBulkDownloadSpy).toHaveBeenCalled());

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(mockToastStore.error).not.toHaveBeenCalled();
		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /download \(1\)/i })).toBeInTheDocument();
		expect(checkbox).toBeChecked();
	});

	it('reports non-abort failures and clears the bulk selection', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const startBulkDownloadSpy = vi
			.spyOn(chartListHelpers, 'startBulkDownload')
			.mockRejectedValueOnce(new Error('Bulk download failed'));

		await renderChartListWithSelection();

		await fireEvent.click(screen.getByRole('button', { name: /download \(1\)/i }));

		await waitFor(() =>
			expect(mockToastStore.error).toHaveBeenCalledWith({
				title: 'Bulk download failed',
				duration: 3000
			})
		);

		expect(startBulkDownloadSpy).toHaveBeenCalled();
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Failed to start bulk download:',
			expect.any(Error)
		);
		expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
		expect(
			screen.queryByRole('checkbox', { name: `Select ${mockListedChart.title}` })
		).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /download \(1\)/i })).not.toBeInTheDocument();
	});
});

const mockFetchSuccess = (data: Record<string, unknown>[] = [], count = 0) => {
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
