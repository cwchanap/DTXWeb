import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use the real testing library (override global setup mock)
vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

// Mock Accordion from skeleton-svelte with stubs that render their content
vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: AccordionStub } = await import('../../tests/stubs/AccordionStub.svelte');
	const { default: AccordionItemStub } =
		await import('../../tests/stubs/AccordionItemStub.svelte');
	// Attach Item as a property to match Accordion.Item usage
	(AccordionStub as unknown as Record<string, unknown>).Item = AccordionItemStub;
	return { Accordion: AccordionStub };
});

// Mock lucide icon
vi.mock('@lucide/svelte', () => ({
	DownloadCloud: vi.fn()
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import UploadedAssetFiles from './UploadedAssetFiles.svelte';

const mockAssetFiles = [
	{
		fileName: 'song.dtx',
		size: 1024,
		lastModified: '2024-01-01T00:00:00Z',
		key: 'songs/1/song.dtx'
	},
	{
		fileName: 'bass.xa',
		size: 2048,
		lastModified: '2024-06-15T12:00:00Z',
		key: 'songs/1/bass.xa'
	}
];

const makeProps = (overrides = {}) => ({
	simfileBucketUrl: 'https://cdn.example.com',
	loadAssetFiles: vi.fn().mockResolvedValue(mockAssetFiles),
	...overrides
});

describe('UploadedAssetFiles', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		// Restore window.electron to undefined to prevent state leakage between tests
		Object.defineProperty(window, 'electron', {
			value: undefined,
			writable: true,
			configurable: true
		});
	});

	it('renders without crashing when no simfileId provided', () => {
		render(UploadedAssetFiles, { props: makeProps() });
		expect(screen.getByText('Asset Files Section')).toBeInTheDocument();
	});

	it('shows empty state when no files and simfileId provided', async () => {
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', loadAssetFiles })
		});
		await waitFor(() => {
			expect(screen.getByText('No asset files found for this simfile.')).toBeInTheDocument();
		});
	});

	it('calls loadAssetFiles with simfileId when simfileId is provided', async () => {
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-42', loadAssetFiles })
		});
		await waitFor(() => {
			expect(loadAssetFiles).toHaveBeenCalledWith('sim-42');
		});
	});

	it('does not call loadAssetFiles when simfileId is empty', async () => {
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: '', loadAssetFiles })
		});
		// Flush microtasks and verify no call was made
		await Promise.resolve();
		expect(loadAssetFiles).not.toHaveBeenCalled();
	});

	it('renders cloud file names after loading', async () => {
		render(UploadedAssetFiles, { props: makeProps({ simfileId: 'sim-1' }) });
		await waitFor(() => {
			expect(screen.getByText('song.dtx')).toBeInTheDocument();
			expect(screen.getByText('bass.xa')).toBeInTheDocument();
		});
	});

	it('renders file sizes using formatFileSize', async () => {
		render(UploadedAssetFiles, { props: makeProps({ simfileId: 'sim-1' }) });
		await waitFor(() => {
			expect(screen.getByText('1 KB')).toBeInTheDocument();
			expect(screen.getByText('2 KB')).toBeInTheDocument();
		});
	});

	it('formats 0 bytes correctly', async () => {
		const loadAssetFiles = vi.fn().mockResolvedValue([
			{
				fileName: 'empty.dtx',
				size: 0,
				lastModified: '2024-01-01T00:00:00Z',
				key: 'songs/1/empty.dtx'
			}
		]);
		render(UploadedAssetFiles, { props: makeProps({ simfileId: 'sim-1', loadAssetFiles }) });
		await waitFor(() => {
			expect(screen.getByText('0 Bytes')).toBeInTheDocument();
		});
	});

	it('renders download links for cloud files', async () => {
		render(UploadedAssetFiles, { props: makeProps({ simfileId: 'sim-1' }) });
		await waitFor(() => {
			const links = screen.getAllByTitle('Download file');
			expect(links.length).toBe(2);
			expect(links[0]).toHaveAttribute('href', 'https://cdn.example.com/songs/1/song.dtx');
		});
	});

	it('shows error state when loadAssetFiles throws', async () => {
		const loadAssetFiles = vi.fn().mockRejectedValue(new Error('Network failed'));
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', loadAssetFiles })
		});
		await waitFor(() => {
			expect(screen.getByText('Network failed')).toBeInTheDocument();
		});
	});

	it('shows retry button when error occurs', async () => {
		const loadAssetFiles = vi.fn().mockRejectedValue(new Error('Connection error'));
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', loadAssetFiles })
		});
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		});
	});

	it('retries loading when Retry button clicked', async () => {
		const loadAssetFiles = vi
			.fn()
			.mockRejectedValueOnce(new Error('fail'))
			.mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', loadAssetFiles })
		});
		await waitFor(() => screen.getByRole('button', { name: 'Retry' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await waitFor(() => {
			expect(loadAssetFiles).toHaveBeenCalledTimes(2);
		});
	});

	it('handles non-Error thrown objects', async () => {
		const loadAssetFiles = vi.fn().mockRejectedValue('string error');
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', loadAssetFiles })
		});
		await waitFor(() => {
			expect(screen.getByText('Error loading files')).toBeInTheDocument();
		});
	});

	it('auto-selects new user files when added', async () => {
		const validFile = new File(['content'], 'test.dtx', { type: 'text/plain' });
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', userFiles: [validFile] })
		});
		await waitFor(() => {
			// File should appear in the merged list
			expect(screen.getByText('test.dtx')).toBeInTheDocument();
		});
	});

	it('filters out invalid file extensions from userFiles', async () => {
		const invalidFile = new File(['content'], 'video.mp4', { type: 'video/mp4' });
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: '', userFiles: [invalidFile] })
		});
		// No files should appear (.mp4 is not a valid DTX file extension)
		expect(screen.queryByText('video.mp4')).not.toBeInTheDocument();
	});

	it('renders column headers when files are present', async () => {
		render(UploadedAssetFiles, { props: makeProps({ simfileId: 'sim-1' }) });
		await waitFor(() => {
			expect(screen.getByText('File Name')).toBeInTheDocument();
			expect(screen.getByText('Size')).toBeInTheDocument();
			expect(screen.getByText('Last Modified')).toBeInTheDocument();
		});
	});

	it('shows dash for local-only user files with no cloud key', async () => {
		const localFile = new File(['content'], 'local.dtx', { type: 'text/plain' });
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', userFiles: [localFile], loadAssetFiles })
		});
		await waitFor(() => {
			expect(screen.getByText('local.dtx')).toBeInTheDocument();
		});
	});

	it('disableUploads prop hides upload controls', async () => {
		render(UploadedAssetFiles, {
			props: makeProps({ simfileId: 'sim-1', isDesktop: true, disableUploads: true })
		});
		await waitFor(() => {
			// No checkbox column header when uploads are disabled
			expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
		});
	});

	it('shows "Replacing" status when user file matches a cloud file name', async () => {
		// A user file whose name matches one of the mockAssetFiles (song.dtx)
		const replacingFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: true,
				userFiles: [replacingFile]
			})
		});
		await waitFor(() => {
			// getMergedFiles merges user file with existing cloud file → "replacing" status
			expect(screen.getByText('Replacing')).toBeInTheDocument();
		});
	});

	it('shows "New" status for user file with no cloud counterpart', async () => {
		const newFile = new File(['content'], 'brand-new.dtx', { type: 'text/plain' });
		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: true,
				userFiles: [newFile]
			})
		});
		await waitFor(() => {
			expect(screen.getByText('New')).toBeInTheDocument();
		});
	});

	it('shows bulk upload button when isDesktop, file is selected, and simfileId present', async () => {
		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: true,
				userFiles: [dtxFile]
			})
		});
		await waitFor(() => {
			// Checkbox for the file should auto-select → shows bulk upload button
			expect(screen.getByRole('button', { name: /Bulk Upload/i })).toBeInTheDocument();
		});
	});

	it('calls uploadSelectedFiles when bulk upload button clicked (desktop, IPC success)', async () => {
		const ipcInvoke = vi.fn().mockResolvedValue({ success: true });
		// Set electron on the existing window object (don't replace the whole window)
		Object.defineProperty(window, 'electron', {
			value: { ipcRenderer: { invoke: ipcInvoke } },
			writable: true,
			configurable: true
		});

		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: true,
				songFolderPath: '/songs/sim-1',
				userFiles: [dtxFile],
				loadAssetFiles
			})
		});

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Bulk Upload/i })).toBeInTheDocument();
		});

		await fireEvent.click(screen.getByRole('button', { name: /Bulk Upload/i }));

		await waitFor(() => {
			expect(ipcInvoke).toHaveBeenCalledWith(
				'upload-file',
				'song.dtx',
				'/songs/sim-1',
				'sim-1'
			);
		});
	});

	it('uses injected uploadFile handler for desktop bulk uploads when Electron IPC is unavailable', async () => {
		Object.defineProperty(window, 'electron', {
			value: undefined,
			writable: true,
			configurable: true
		});
		const uploadFile = vi.fn().mockResolvedValue({ success: true });

		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: true,
				songFolderPath: '/songs/sim-1',
				userFiles: [dtxFile],
				loadAssetFiles,
				uploadFile
			})
		});

		await waitFor(() => {
			expect(screen.getByRole('button', { name: /Bulk Upload/i })).toBeInTheDocument();
		});

		await fireEvent.click(screen.getByRole('button', { name: /Bulk Upload/i }));

		await waitFor(() => {
			expect(uploadFile).toHaveBeenCalledWith('song.dtx', '/songs/sim-1', 'sim-1');
			expect(screen.getByText('Uploaded')).toBeInTheDocument();
		});
	});

	it('shows "Failed" status when IPC upload returns an error', async () => {
		const ipcInvoke = vi.fn().mockResolvedValue({ success: false, error: 'Upload failed' });
		Object.defineProperty(window, 'electron', {
			value: { ipcRenderer: { invoke: ipcInvoke } },
			writable: true,
			configurable: true
		});

		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: true,
				songFolderPath: '/songs/sim-1',
				userFiles: [dtxFile],
				loadAssetFiles
			})
		});

		await waitFor(() => screen.getByRole('button', { name: /Bulk Upload/i }));
		await fireEvent.click(screen.getByRole('button', { name: /Bulk Upload/i }));

		await waitFor(() => {
			expect(screen.getByText('Failed')).toBeInTheDocument();
		});
	});

	it('shows "Failed" status when IPC renderer is not available (invokeIpc throws)', async () => {
		// Ensure window.electron is undefined → invokeIpc throws "IPC Renderer is not available"
		Object.defineProperty(window, 'electron', {
			value: undefined,
			writable: true,
			configurable: true
		});

		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });
		const loadAssetFiles = vi.fn().mockResolvedValue([]);
		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: true,
				songFolderPath: '/songs/sim-1',
				userFiles: [dtxFile],
				loadAssetFiles
			})
		});

		await waitFor(() => screen.getByRole('button', { name: /Bulk Upload/i }));
		await fireEvent.click(screen.getByRole('button', { name: /Bulk Upload/i }));

		await waitFor(() => {
			expect(screen.getByText('Failed')).toBeInTheDocument();
		});
	});

	it('upload controls are not shown when isDesktop is false', async () => {
		const dtxFile = new File(['content'], 'song.dtx', { type: 'text/plain' });

		render(UploadedAssetFiles, {
			props: makeProps({
				simfileId: 'sim-1',
				isDesktop: false,
				userFiles: [dtxFile]
			})
		});

		await waitFor(() => {
			expect(screen.queryByRole('button', { name: /Bulk Upload/i })).not.toBeInTheDocument();
			expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
		});
	});
});
