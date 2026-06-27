import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$env/static/public', () => ({
	PUBLIC_SIMFILE_BUCKET_URL: 'http://example.com'
}));

vi.mock('$env/dynamic/public', () => ({
	env: {}
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

// The page now uses `$_` from svelte-i18n for the /preview link label; activate
// the global __mocks__/svelte-i18n.ts so `_` returns the key unchanged.
vi.mock('svelte-i18n');

const capturedLoadAssetFiles = vi.hoisted(() => vi.fn());

vi.mock('@dtx/common/components', () => ({
	ChartDetail: vi.fn((...args: unknown[]) => {
		const props = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown> | undefined;
		if (props) {
			const snippets = Object.entries(props).filter(
				([k, v]) => !k.startsWith('$$') && typeof v === 'function'
			);
			for (const [, snippet] of snippets) {
				try {
					const anchor = document.createComment('');
					document.body.appendChild(anchor);
					(snippet as (anchor: Node, ...rest: (() => unknown)[]) => void)(
						anchor,
						() => {}
					);
				} catch {
					// snippet rendering may fail in test env
				}
			}
		}
		return {};
	}),
	UploadedAssetFiles: vi.fn((...args: unknown[]) => {
		const props = (args.length > 1 ? args[1] : args[0]) as Record<string, unknown> | undefined;
		if (props?.loadAssetFiles) {
			capturedLoadAssetFiles.mockImplementation(
				props.loadAssetFiles as ReturnType<typeof vi.fn>
			);
		}
		return {};
	})
}));

const mockGetSimfile = vi.hoisted(() => vi.fn());
const mockUpdateSimfile = vi.hoisted(() => vi.fn());

vi.mock('$lib/api', () => ({
	getSimfile: mockGetSimfile,
	updateSimfile: mockUpdateSimfile
}));

vi.mock('$lib/api/download', () => ({
	downloadSimfile: vi.fn(),
	bulkDownloadBaseUrl: vi.fn(),
	bulkDownloadHeaders: vi.fn()
}));

import ChartDetailPage from './+page.svelte';
import { ChartDetail, UploadedAssetFiles } from '@dtx/common/components';
import toastStore from '$lib/toaster';

const mockSimfileResponse = { id: 123, title: 'Test Song', is_published: false };

describe('Chart Detail Page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetSimfile.mockRejectedValue(new Error('Not found'));
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('renders loading state initially', () => {
		mockGetSimfile.mockReturnValue(new Promise(() => {}));
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

	it('shows error when getSimfile rejects with generic error', async () => {
		mockGetSimfile.mockRejectedValue(new Error('Failed to load chart'));
		render(ChartDetailPage);
		await vi.waitFor(() => {
			expect(screen.getByText(/Error: Failed to load chart/i)).toBeInTheDocument();
		});
	});

	it('shows simfile data after successful fetch', async () => {
		mockGetSimfile.mockResolvedValue(mockSimfileResponse);
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
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('calls updateSimfile and shows success toast when update succeeds', async () => {
		mockGetSimfile.mockResolvedValue(mockSimfileResponse);
		mockUpdateSimfile.mockResolvedValue({ ...mockSimfileResponse, is_published: true });

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

		expect(mockUpdateSimfile).toHaveBeenCalledWith(
			'123',
			expect.objectContaining({
				downloadUrl: 'http://download.com',
				videoPreviewUrl: 'http://video.com',
				publishDate: '2024-01-01',
				isPublished: true,
				displayId: 1
			})
		);
		expect(vi.mocked(toastStore.success)).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Simfile updated successfully' })
		);
	});

	it('shows error toast when updateSimfile rejects', async () => {
		mockGetSimfile.mockResolvedValue(mockSimfileResponse);
		mockUpdateSimfile.mockRejectedValue(new Error('update failed: 500'));

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

describe('loadAssetFiles via ChartDetail snippet', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('maps simfile files to component shape', async () => {
		const simfileWithFiles = {
			...mockSimfileResponse,
			files: [
				{ key: '123/audio.wav', size: 1024, uploaded: '2024-01-01T00:00:00Z' },
				{ key: '123/chart.dtx', size: 512, uploaded: '2024-01-02T00:00:00Z' }
			]
		};
		mockGetSimfile.mockResolvedValue(simfileWithFiles);

		render(ChartDetailPage);

		await waitFor(() => {
			expect(vi.mocked(ChartDetail).mock.calls.length).toBeGreaterThan(0);
		});

		expect(capturedLoadAssetFiles).toBeDefined();
		const result = await capturedLoadAssetFiles('123');
		expect(result).toEqual([
			{
				key: '123/audio.wav',
				size: 1024,
				lastModified: '2024-01-01T00:00:00Z',
				fileName: 'audio.wav'
			},
			{
				key: '123/chart.dtx',
				size: 512,
				lastModified: '2024-01-02T00:00:00Z',
				fileName: 'chart.dtx'
			}
		]);
	});

	it('preserves nested directory paths in fileName', async () => {
		const simfileWithNestedFiles = {
			...mockSimfileResponse,
			files: [
				{ key: '456/sound/snare.wav', size: 2048, uploaded: '2024-02-01T00:00:00Z' },
				{ key: '456/music/snare.wav', size: 4096, uploaded: '2024-02-02T00:00:00Z' },
				{ key: '456/chart.dtx', size: 256, uploaded: '2024-02-03T00:00:00Z' }
			]
		};
		mockGetSimfile.mockResolvedValue(simfileWithNestedFiles);

		render(ChartDetailPage);

		await waitFor(() => {
			expect(vi.mocked(ChartDetail).mock.calls.length).toBeGreaterThan(0);
		});

		expect(capturedLoadAssetFiles).toBeDefined();
		const result = await capturedLoadAssetFiles('456');
		expect(result).toEqual([
			{
				key: '456/sound/snare.wav',
				size: 2048,
				lastModified: '2024-02-01T00:00:00Z',
				fileName: 'sound/snare.wav'
			},
			{
				key: '456/music/snare.wav',
				size: 4096,
				lastModified: '2024-02-02T00:00:00Z',
				fileName: 'music/snare.wav'
			},
			{
				key: '456/chart.dtx',
				size: 256,
				lastModified: '2024-02-03T00:00:00Z',
				fileName: 'chart.dtx'
			}
		]);
	});

	it('throws when simfileId is empty', async () => {
		mockGetSimfile.mockResolvedValue({ ...mockSimfileResponse, files: [] });

		render(ChartDetailPage);

		await waitFor(() => {
			expect(vi.mocked(ChartDetail).mock.calls.length).toBeGreaterThan(0);
		});

		expect(capturedLoadAssetFiles).toBeDefined();
		await expect(capturedLoadAssetFiles('')).rejects.toThrow('SimfileId is required');
	});

	it('returns empty array when simfile has no files', async () => {
		mockGetSimfile.mockResolvedValue({ ...mockSimfileResponse, files: undefined });

		render(ChartDetailPage);

		await waitFor(() => {
			expect(vi.mocked(ChartDetail).mock.calls.length).toBeGreaterThan(0);
		});

		expect(capturedLoadAssetFiles).toBeDefined();
		const result = await capturedLoadAssetFiles('123');
		expect(result).toEqual([]);
	});
});

describe('Chart Detail Page - simfile not found', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('renders "Simfile not found" when getSimfile resolves with null', async () => {
		mockGetSimfile.mockResolvedValue(null);

		render(ChartDetailPage);

		await vi.waitFor(() => {
			expect(screen.getByText('Simfile not found')).toBeInTheDocument();
		});
	});
});

describe('handleUpdateSimfile basic update flow', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('sends basic update fields when updatedSimfile and updatedHighestDtx are not set', async () => {
		const simfileResponse = {
			...mockSimfileResponse,
			title: 'Original Title',
			artist: 'Original Artist',
			bpm: 120
		};
		mockGetSimfile.mockResolvedValue(simfileResponse);
		mockUpdateSimfile.mockResolvedValue({ ...simfileResponse, is_published: true });

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
				displayId: 1,
				publishDate: '2024-01-01',
				isPublished: true,
				downloadUrl: 'http://download.com',
				videoPreviewUrl: 'http://video.com'
			}
		});

		expect(mockUpdateSimfile).toHaveBeenCalledWith(
			'123',
			expect.objectContaining({
				downloadUrl: 'http://download.com',
				videoPreviewUrl: 'http://video.com',
				publishDate: '2024-01-01',
				isPublished: true,
				displayId: 1
			})
		);
		expect(vi.mocked(toastStore.success)).toHaveBeenCalled();
	});

	it('sends displayId as null when displayId is 0', async () => {
		mockGetSimfile.mockResolvedValue(mockSimfileResponse);
		mockUpdateSimfile.mockResolvedValue({ ...mockSimfileResponse });

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

		await onSaveHandler({
			detail: {
				displayId: 0,
				publishDate: '',
				isPublished: false,
				downloadUrl: '',
				videoPreviewUrl: ''
			}
		});

		expect(mockUpdateSimfile).toHaveBeenCalledWith(
			'123',
			expect.objectContaining({
				displayId: null
			})
		);
	});
});

describe('Chart Detail Page - error handling', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('shows generic error when getSimfile rejects with non-Error', async () => {
		mockGetSimfile.mockRejectedValue('string error');

		render(ChartDetailPage);

		await vi.waitFor(() => {
			expect(screen.getByText(/Error: Failed to load chart/i)).toBeInTheDocument();
		});
	});
});
