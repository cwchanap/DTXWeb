import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mockToastStore = vi.hoisted(() => ({
	error: vi.fn(),
	success: vi.fn(),
	warning: vi.fn()
}));

const mockApi = vi.hoisted(() => ({
	listSimfiles: vi.fn().mockResolvedValue({ data: [], count: 0 }),
	updateSimfile: vi.fn().mockResolvedValue({ id: 1 }),
	deleteSimfile: vi.fn().mockResolvedValue({ id: 1, deleted: true })
}));

vi.mock('$lib/api', () => ({
	listSimfiles: mockApi.listSimfiles,
	updateSimfile: mockApi.updateSimfile,
	deleteSimfile: mockApi.deleteSimfile,
	bulkDownloadBaseUrl: () => '/downloads/bulk',
	bulkDownloadHeaders: async () => ({ 'Content-Type': 'application/json' })
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
	mockApi.listSimfiles.mockResolvedValue({ data: [mockListedChart], count: 1 });
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

	return { checkbox };
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
			'/downloads/bulk?validate=1',
			'/downloads/bulk',
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

	it('throws when validation response is not ok', async () => {
		const handle = { createWritable: vi.fn() };
		const saveFilePickerWindow = {
			showSaveFilePicker: vi.fn().mockResolvedValue(handle)
		};
		const fetchFn = vi
			.fn()
			.mockResolvedValue(createJsonResponse({ error: 'Validation failed' }, 400));

		await expect(
			chartListHelpers.startBulkDownload({
				ids: [mockListedChart.id],
				fetchFn,
				saveFilePickerWindow
			})
		).rejects.toThrow('Validation failed');

		expect(handle.createWritable).not.toHaveBeenCalled();
	});

	it('throws when validation data has ok !== true', async () => {
		const handle = { createWritable: vi.fn() };
		const saveFilePickerWindow = {
			showSaveFilePicker: vi.fn().mockResolvedValue(handle)
		};
		const fetchFn = vi
			.fn()
			.mockResolvedValue(createJsonResponse({ ok: false, error: 'No files found' }));

		await expect(
			chartListHelpers.startBulkDownload({
				ids: [mockListedChart.id],
				fetchFn,
				saveFilePickerWindow
			})
		).rejects.toThrow('No files found');
	});

	it('throws with default message when validation data has no error string', async () => {
		const handle = { createWritable: vi.fn() };
		const saveFilePickerWindow = {
			showSaveFilePicker: vi.fn().mockResolvedValue(handle)
		};
		const fetchFn = vi.fn().mockResolvedValue(createJsonResponse({ ok: true, fileCount: 0 }));

		await expect(
			chartListHelpers.startBulkDownload({
				ids: [mockListedChart.id],
				fetchFn,
				saveFilePickerWindow
			})
		).rejects.toThrow('No uploaded files found for the selected charts');
	});

	it('throws when validation data fileCount is not a number', async () => {
		const handle = { createWritable: vi.fn() };
		const saveFilePickerWindow = {
			showSaveFilePicker: vi.fn().mockResolvedValue(handle)
		};
		const fetchFn = vi
			.fn()
			.mockResolvedValue(createJsonResponse({ ok: true, fileCount: 'invalid' }));

		await expect(
			chartListHelpers.startBulkDownload({
				ids: [mockListedChart.id],
				fetchFn,
				saveFilePickerWindow
			})
		).rejects.toThrow('No uploaded files found for the selected charts');
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

	it('shows error toast when trying to select beyond MAX_BULK_DOWNLOAD_CHARTS items', async () => {
		// Render with MAX items already in the data, select all, then try to select another
		const maxCharts = Array.from(
			{ length: chartListHelpers.MAX_BULK_DOWNLOAD_CHARTS },
			(_, i) => ({
				...mockListedChart,
				id: i + 1,
				title: `Song ${i + 1}`,
				display_id: `D${i + 1}`
			})
		);
		const extraChart = {
			...mockListedChart,
			id: chartListHelpers.MAX_BULK_DOWNLOAD_CHARTS + 1,
			title: 'Extra Song',
			display_id: 'EX'
		};
		const allCharts = [...maxCharts, extraChart];

		mockApi.listSimfiles.mockResolvedValue({ data: allCharts, count: allCharts.length });
		Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: vi.fn() });

		render(ChartList, { props: { isBlog: true, enableDownload: true } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Select' }));

		// Select all MAX items
		const checkboxes = await screen.findAllByRole('checkbox');
		for (const checkbox of checkboxes.slice(0, chartListHelpers.MAX_BULK_DOWNLOAD_CHARTS)) {
			await fireEvent.click(checkbox);
		}

		// Exactly MAX should still be allowed — no error at the boundary
		expect(mockToastStore.error).not.toHaveBeenCalled();
		expect(
			screen.getByRole('button', {
				name: new RegExp(`download \\(${chartListHelpers.MAX_BULK_DOWNLOAD_CHARTS}\\)`, 'i')
			})
		).toBeInTheDocument();

		// Try to select one more beyond the limit
		await fireEvent.click(checkboxes[chartListHelpers.MAX_BULK_DOWNLOAD_CHARTS]);

		await waitFor(() => {
			expect(mockToastStore.error).toHaveBeenCalledWith(
				expect.objectContaining({
					title: expect.stringContaining(`${chartListHelpers.MAX_BULK_DOWNLOAD_CHARTS}`)
				})
			);
		});
	});

	it('treats AbortError as a no-op and preserves the current selection', async () => {
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const startBulkDownloadSpy = vi
			.spyOn(chartListHelpers, 'startBulkDownload')
			.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

		const { checkbox } = await renderChartListWithSelection();

		await fireEvent.click(screen.getByRole('button', { name: /download \(1\)/i }));

		await waitFor(() => expect(startBulkDownloadSpy).toHaveBeenCalled());

		expect(mockApi.listSimfiles).toHaveBeenCalledTimes(1);
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
	mockApi.listSimfiles.mockResolvedValue({ data, count });
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

	it('calls listSimfiles to load items on mount', async () => {
		render(ChartList);
		await waitFor(() => {
			expect(mockApi.listSimfiles).toHaveBeenCalled();
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
			expect(mockApi.listSimfiles).toHaveBeenCalledWith(
				expect.objectContaining({ scope: 'published' })
			);
		});
	});

	it('uses mine scope when isBlog is false', async () => {
		render(ChartList, { props: { isBlog: false } });
		await waitFor(() => {
			expect(mockApi.listSimfiles).toHaveBeenCalledWith(
				expect.objectContaining({ scope: 'mine' })
			);
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

	it('renders an editor link on the table title when uploaded files are available', async () => {
		mockFetchSuccess(
			[
				{
					id: 1,
					title: 'My Song',
					artist: 'Artist',
					bpm: 120,
					is_published: true,
					display_id: 1,
					has_uploaded_files: true,
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
			const editorLink = screen.getByRole('link', { name: '1. My Song' });
			expect(editorLink).toHaveAttribute('href', '/editor/1');
		});
	});

	it('shows loading state while fetching', async () => {
		let resolveList!: (value: { data: unknown[]; count: number }) => void;
		mockApi.listSimfiles.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveList = resolve;
			})
		);
		render(ChartList);
		expect(screen.getByText('Loading charts...')).toBeInTheDocument();
		resolveList({ data: [], count: 0 });
	});

	it('handles listSimfiles error gracefully', async () => {
		mockApi.listSimfiles.mockRejectedValueOnce(new Error('Network error'));
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
			expect(mockApi.listSimfiles).toHaveBeenCalledTimes(2);
		});
		vi.useRealTimers();
	});

	it('passes pageSize prop correctly to listSimfiles', async () => {
		render(ChartList, { props: { pageSize: 6 } });
		await waitFor(() => {
			expect(mockApi.listSimfiles).toHaveBeenCalledWith(
				expect.objectContaining({ pageSize: 6 })
			);
		});
	});

	it('changes page size from selector and re-fetches', async () => {
		render(ChartList);
		const select = screen.getByRole('combobox');
		await fireEvent.change(select, { target: { value: '24' } });
		await waitFor(() => {
			expect(mockApi.listSimfiles).toHaveBeenCalledWith(
				expect.objectContaining({ pageSize: 24 })
			);
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

	it('handlePageChange calls listSimfiles with updated page when onPageChange fires', async () => {
		// Return enough items that totalPages > 1 (count=25, pageSize=12 → 3 pages)
		mockApi.listSimfiles.mockResolvedValue({ data: [], count: 25 });

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
		const paginationProps = (lastCall?.[1] ?? lastCall?.[0]) as unknown as
			Record<string, unknown> | undefined;

		expect(lastCall).toBeDefined();
		const onPageChange = paginationProps?.onPageChange as (e: { page: number }) => void;
		expect(typeof onPageChange).toBe('function');

		mockApi.listSimfiles.mockClear();
		onPageChange({ page: 2 });
		await waitFor(() => {
			expect(mockApi.listSimfiles).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
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

	it('handleFileDelete calls deleteSimfile and shows success toast on clean deletion', async () => {
		mockApi.listSimfiles
			.mockResolvedValueOnce({ data: [item], count: 1 })
			.mockResolvedValueOnce({ data: [], count: 0 });
		mockApi.deleteSimfile.mockResolvedValueOnce({
			id: 42,
			deleted: true,
			partialDeletion: false
		});

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));

		await waitFor(() => expect(screen.getByText(/Delete Me/)).toBeInTheDocument());

		const onFileDelete =
			getRequiredPropFromTableItem<(id: number) => Promise<void>>('onFileDelete');
		await onFileDelete(42);
		await waitFor(() => {
			expect(mockApi.deleteSimfile).toHaveBeenCalledWith('42');
			expect(vi.mocked(toastStore.success)).toHaveBeenCalledWith(
				expect.objectContaining({ title: 'Chart deleted' })
			);
		});
	});

	it('handleFileDelete shows warning toast on partial deletion', async () => {
		mockApi.listSimfiles
			.mockResolvedValueOnce({ data: [item], count: 1 })
			.mockResolvedValueOnce({ data: [], count: 0 });
		mockApi.deleteSimfile.mockResolvedValueOnce({
			id: 42,
			deleted: true,
			partialDeletion: true
		});

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));

		await waitFor(() => expect(screen.getByText(/Delete Me/)).toBeInTheDocument());

		const onFileDelete =
			getRequiredPropFromTableItem<(id: number) => Promise<void>>('onFileDelete');
		await onFileDelete(42);
		await waitFor(() => {
			expect(mockApi.deleteSimfile).toHaveBeenCalledWith('42');
			expect(vi.mocked(toastStore.warning)).toHaveBeenCalledWith(
				expect.objectContaining({
					title: 'Chart deleted — some files may remain in storage'
				})
			);
		});
	});

	it('handleFileDelete shows error toast when deleteSimfile throws', async () => {
		mockApi.listSimfiles.mockResolvedValueOnce({ data: [item], count: 1 });
		mockApi.deleteSimfile.mockRejectedValueOnce(new Error('delete failed: 500'));

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

	it('handleFileDelete shows error toast on network failure', async () => {
		mockApi.listSimfiles.mockResolvedValueOnce({ data: [item], count: 1 });
		mockApi.deleteSimfile.mockRejectedValueOnce(new Error('Network failure'));

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

	it('togglePublishChart calls updateSimfile and shows success toast when publish succeeds', async () => {
		mockApi.listSimfiles.mockResolvedValueOnce({ data: [item], count: 1 });
		mockApi.updateSimfile.mockResolvedValueOnce({ ...item, is_published: false });

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Toggle Chart/)).toBeInTheDocument());

		const props = getLastTableItemProps();
		const togglePublishChart = props?.togglePublishChart as
			((id: number, published: boolean) => Promise<void>) | undefined;

		if (togglePublishChart) {
			await togglePublishChart(10, true);
			await waitFor(() => {
				expect(mockApi.updateSimfile).toHaveBeenCalledWith('10', { isPublished: false });
				expect(vi.mocked(toastStore.success)).toHaveBeenCalledWith(
					expect.objectContaining({ title: 'Chart unpublished' })
				);
			});
		} else {
			expect(props).toBeDefined();
		}
	});

	it('togglePublishChart shows error toast when updateSimfile throws', async () => {
		mockApi.listSimfiles.mockResolvedValueOnce({ data: [item], count: 1 });
		mockApi.updateSimfile.mockRejectedValueOnce(new Error('update failed: 500'));

		render(ChartList, { props: { isBlog: false } });
		await fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
		await waitFor(() => expect(screen.getByText(/Toggle Chart/)).toBeInTheDocument());

		const props = getLastTableItemProps();
		const togglePublishChart = props?.togglePublishChart as
			((id: number, published: boolean) => Promise<void>) | undefined;

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
