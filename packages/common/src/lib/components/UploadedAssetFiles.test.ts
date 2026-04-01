import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use the real testing library (override global setup mock)
vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

// Mock Accordion from skeleton-svelte with stubs that render their content
vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: AccordionStub } = await import('../../tests/stubs/AccordionStub.svelte');
	const { default: AccordionItemStub } =
		await import('../../tests/stubs/AccordionItemStub.svelte');
	// Attach Item as a property to match Accordion.Item usage
	(AccordionStub as Record<string, unknown>).Item = AccordionItemStub;
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
		// Wait a tick and verify no call was made
		await new Promise((r) => setTimeout(r, 50));
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
		const loadAssetFiles = vi
			.fn()
			.mockResolvedValue([
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
});
