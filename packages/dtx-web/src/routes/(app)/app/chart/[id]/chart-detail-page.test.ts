import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$env/static/public', () => ({
	PUBLIC_SIMFILE_BUCKET_URL: 'http://example.com'
}));

vi.mock('$app/environment', () => ({
	browser: false
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: unknown) => void) => {
			run({
				params: { id: '123' },
				url: new URL('http://localhost/app/chart/123')
			});
			return () => {};
		}
	}
}));

const gotoMock = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({
	goto: gotoMock
}));

vi.mock('$lib/toaster', () => ({
	default: { error: vi.fn(), success: vi.fn() }
}));

vi.mock('@dtx/common/components', () => ({
	ChartDetail: vi.fn(),
	UploadedAssetFiles: vi.fn()
}));

vi.mock('@dtx/common/services/assetFileService', () => ({
	loadAssetFiles: vi.fn().mockResolvedValue([])
}));

vi.mock('@dtx/common', () => ({
	ChartDetail: vi.fn(),
	UploadedAssetFiles: vi.fn()
}));

import { fireEvent, waitFor } from '@testing-library/svelte';
import ChartDetailPage from './+page.svelte';
import { ChartDetail } from '@dtx/common/components';
import toastStore from '$lib/toaster';

describe('Chart Detail Page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				json: vi.fn().mockResolvedValue({ error: 'Not found' })
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders loading state initially', () => {
		render(ChartDetailPage);
		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('renders the back button', () => {
		render(ChartDetailPage);
		expect(screen.getByText('← Back to List')).toBeInTheDocument();
	});

	it('shows error state after failed fetch', async () => {
		render(ChartDetailPage);
		await vi.waitFor(() => {
			expect(screen.getByText(/Error: Not found/i)).toBeInTheDocument();
		});
	});

	it('shows error when fetch response has no error field', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: false,
				json: vi.fn().mockResolvedValue({})
			})
		);
		render(ChartDetailPage);
		await vi.waitFor(() => {
			expect(screen.getByText(/Error: Failed to load chart/i)).toBeInTheDocument();
		});
	});

	it('shows simfile data after successful fetch', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ id: '123', title: 'Test Song' })
			})
		);
		render(ChartDetailPage);
		await vi.waitFor(() => {
			expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
		});
	});

	it('calls goto when back button is clicked', async () => {
		render(ChartDetailPage);
		const backBtn = screen.getByText('← Back to List');
		await fireEvent.click(backBtn);
		expect(gotoMock).toHaveBeenCalledWith('/app/chart');
	});
});

// Helper: get the props passed to the last call of a mocked Svelte 5 component
function getLastProps<T>(mockFn: ReturnType<typeof vi.fn>): T | undefined {
	const calls = mockFn.mock.calls;
	const lastCall = calls[calls.length - 1];
	return (lastCall?.[1] ?? lastCall?.[0]) as T | undefined;
}

describe('handleUpdateSimfile via ChartDetail onSave prop', () => {
	const mockSimfileResponse = { id: 123, title: 'Test Song', is_published: false };

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it('calls PATCH and shows success toast when update succeeds', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue(mockSimfileResponse)
				})
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue({})
				})
		);

		render(ChartDetailPage);

		// Wait for ChartDetail to be called (simfile loaded successfully)
		await waitFor(() => {
			expect(vi.mocked(ChartDetail).mock.calls.length).toBeGreaterThan(0);
		});

		const props = getLastProps<Record<string, unknown>>(vi.mocked(ChartDetail));
		// NOTE: Svelte 5 compiles `on:onSave` event handlers into a `$$events` object on the
		// component props. This is a Svelte internal implementation detail and may break in
		// future Svelte versions. If tests fail here after a Svelte upgrade, check whether
		// the events API has changed (e.g. different property name or pattern).
		const events = props?.$$events as Record<
			string,
			(e: { detail: Record<string, unknown> }) => Promise<void>
		>;
		const onSaveHandler = events?.onSave;
		expect(onSaveHandler).toBeDefined();

		await onSaveHandler({
			detail: {
				displayId: 1,
				publishDate: '2024-01-01',
				isPublished: true,
				downloadUrl: 'http://download.com',
				videoPreviewUrl: 'http://video.com'
			}
		});

		expect(vi.mocked(toastStore.success)).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Simfile updated successfully' })
		);
	});

	it('shows error toast when PATCH request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					json: vi.fn().mockResolvedValue(mockSimfileResponse)
				})
				.mockResolvedValueOnce({
					ok: false,
					json: vi.fn().mockResolvedValue({})
				})
		);

		render(ChartDetailPage);

		await waitFor(() => {
			expect(vi.mocked(ChartDetail).mock.calls.length).toBeGreaterThan(0);
		});

		const props = getLastProps<Record<string, unknown>>(vi.mocked(ChartDetail));
		const events = props?.$$events as Record<
			string,
			(e: { detail: Record<string, unknown> }) => Promise<void>
		>;
		const onSaveHandler = events?.onSave;
		expect(onSaveHandler).toBeDefined();

		await onSaveHandler({
			detail: {
				displayId: 0,
				publishDate: '2024-01-01',
				isPublished: false,
				downloadUrl: '',
				videoPreviewUrl: ''
			}
		});

		expect(vi.mocked(toastStore.error)).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Error updating simfile' })
		);
	});
});
