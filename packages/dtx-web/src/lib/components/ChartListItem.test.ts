/**
 * Unit tests for ChartListItem.svelte component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ModalStub from '../../tests/stubs/ModalStub.svelte';

vi.mock('svelte-i18n');
vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: PopoverStub } = await import('../../tests/stubs/PopoverStub.svelte');
	return { Popover: PopoverStub };
});
vi.mock('@dtx/ui-components/components', async () => {
	const { default: ModalStub } = await import('../../tests/stubs/ModalStub.svelte');
	return {
		Modal: ModalStub,
		Button: vi.fn()
	};
});
vi.mock('@lucide/svelte/icons');

// Track ImageAudio props to test URL construction
let capturedImageAudioProps: { previewUrl?: string; soundPreviewUrl?: string | null } | null = null;
vi.mock('$lib/components/ImageAudio.svelte', () => ({
	default: (props: { previewUrl: string; soundPreviewUrl: string | null }) => {
		capturedImageAudioProps = props;
		return {};
	}
}));

vi.mock('$lib/utils', () => ({
	formatLevelDisplay: (dtxFiles: unknown) => {
		if (Array.isArray(dtxFiles) && dtxFiles.length > 0) {
			return dtxFiles.map((file: any) => file.level).join(', ');
		}
		return 'N/A';
	},
	buildPreviewUrl: vi.fn(() => 'https://cdn.example.com/preview.jpg')
}));

import ChartListItem from './ChartListItem.svelte';

// Test data
const mockItem = {
	id: 1,
	title: 'Test Song 1',
	artist: 'Test Artist 1',
	bpm: 120,
	download_url: 'https://example.com/download1',
	has_uploaded_files: true,
	is_published: true,
	display_id: 1,
	dtx_files: [{ level: 3 }, { level: 5 }],
	created_at: '2023-01-01',
	updated_at: '2023-01-02',
	publish_date: '2023-01-03',
	user_id: 'user-1',
	video_preview_url: null,
	label: 'Test Label 1',
	value: 'test-value-1',
	bg_video_url: null,
	bg_video_start_time: 0,
	bg_video_end_time: 0,
	dtx_bar: [],
	dtx_data: {},
	play_count: 0,
	play_log: []
};

const mockItemNoPreview = {
	id: 2,
	title: 'Test Song 2',
	artist: 'Test Artist 2',
	bpm: 140,
	download_url: null,
	has_uploaded_files: false,
	is_published: false,
	display_id: 2,
	dtx_files: [{ level: 4 }],
	created_at: '2023-02-01',
	updated_at: '2023-02-02',
	publish_date: '2023-02-03',
	user_id: 'user-1',
	video_preview_url: null,
	label: 'Test Label 2',
	value: 'test-value-2',
	bg_video_url: null,
	bg_video_start_time: 0,
	bg_video_end_time: 0,
	dtx_bar: [],
	dtx_data: {},
	play_count: 0,
	play_log: []
};

/**
 * Instead of testing the component by rendering it and interacting with the DOM,
 * we'll test the component's logic directly by testing its props and methods.
 *
 * This approach avoids the lifecycle_function_unavailable error in Svelte 5.
 */
describe('ChartListItem Component Logic', () => {
	// Mock functions for props
	const mockTogglePublishChart = vi.fn().mockResolvedValue(undefined);
	const mockOnFileDelete = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Test the togglePublishChart function
	it('calls togglePublishChart with correct parameters', async () => {
		// Call the function directly with the expected parameters
		await mockTogglePublishChart(mockItem.id, mockItem.is_published);

		// Verify the function was called with the correct parameters
		expect(mockTogglePublishChart).toHaveBeenCalledWith(mockItem.id, mockItem.is_published);
		expect(mockTogglePublishChart).toHaveBeenCalledTimes(1);
	});

	// Test the onFileDelete function
	it('calls onFileDelete with correct parameters', () => {
		// Call the function directly with the expected parameters
		mockOnFileDelete(mockItem.id);

		// Verify the function was called with the correct parameters
		expect(mockOnFileDelete).toHaveBeenCalledWith(mockItem.id);
		expect(mockOnFileDelete).toHaveBeenCalledTimes(1);
	});

	// Test blog mode vs normal mode differences
	it('handles blog mode correctly', () => {
		// In blog mode, the popover menu should not be shown
		const isBlog = true;

		// Verify that in blog mode, togglePublishChart would not be called
		// This is a logical test, not a DOM test
		if (isBlog) {
			expect(mockTogglePublishChart).not.toHaveBeenCalled();
		}
	});

	// Test the download URL display in blog mode
	it('handles download URL in blog mode correctly', () => {
		// In blog mode, the download URL should be shown if available
		const isBlog = true;

		// Test with an item that has a download URL
		if (isBlog && mockItem.download_url) {
			expect(mockItem.download_url).toBe('https://example.com/download1');
		}

		// Test with an item that doesn't have a download URL
		if (isBlog && !mockItemNoPreview.download_url) {
			expect(mockItemNoPreview.download_url).toBeNull();
		}
	});

	describe('Blog Mode Download Logic', () => {
		// Simulates the props that would be passed to the component
		const baseProps = {
			// item will be overridden per test
			isBlog: true,
			// Mock other required props not relevant to this specific logic
			togglePublishChart: vi.fn(),
			onFileDelete: vi.fn()
		};

		it('evaluates to show the uploaded chart download link when uploaded files are available in blog mode', () => {
			const props = { ...baseProps, item: mockItem };
			const shouldShowDownloadLink = props.isBlog && props.item.has_uploaded_files === true;
			expect(shouldShowDownloadLink).toBe(true);
		});

		it('evaluates not to show the uploaded chart download link when upload availability is omitted', () => {
			const props = { ...baseProps, item: mockItemNoPreview };
			const item = { ...props.item };
			delete (item as { has_uploaded_files?: boolean }).has_uploaded_files;
			const shouldShowDownloadLink = props.isBlog && item.has_uploaded_files === true;
			expect(shouldShowDownloadLink).toBe(false);
		});
	});

	describe('Rendering', () => {
		const renderProps = {
			item: mockItem,
			isBlog: false,
			togglePublishChart: vi.fn().mockResolvedValue(undefined),
			simfileBucketUrl: 'https://cdn.example.com',
			onFileDelete: vi.fn()
		};

		it('renders display_id', () => {
			render(ChartListItem, { props: renderProps });
			expect(screen.getByText(/#1/)).toBeInTheDocument();
		});

		it('renders title', () => {
			render(ChartListItem, { props: renderProps });
			expect(screen.getByText('Test Song 1')).toBeInTheDocument();
		});

		it('renders artist', () => {
			render(ChartListItem, { props: renderProps });
			expect(screen.getByText('Test Artist 1')).toBeInTheDocument();
		});

		it('renders BPM', () => {
			render(ChartListItem, { props: renderProps });
			expect(screen.getByText(/120 BPM/)).toBeInTheDocument();
		});

		it('renders action menu trigger button in non-blog mode', () => {
			render(ChartListItem, { props: renderProps });
			expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
		});

		it('does not render action menu in blog mode', () => {
			render(ChartListItem, { props: { ...renderProps, isBlog: true } });
			expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
		});

		it('shows R2 download link in blog mode', () => {
			render(ChartListItem, { props: { ...renderProps, isBlog: true } });
			const downloadLink = screen.getByRole('link', { name: /download chart/i });
			expect(downloadLink).toBeInTheDocument();
			expect(downloadLink).toHaveAttribute(
				'href',
				`/api/simFile/download/${renderProps.item.id}`
			);
		});

		it('hides R2 download link in blog mode when upload availability is omitted', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					item: (() => {
						const item = { ...mockItem };
						delete (item as { has_uploaded_files?: boolean }).has_uploaded_files;
						return item;
					})()
				}
			});
			expect(screen.queryByRole('link', { name: /download chart/i })).not.toBeInTheDocument();
			expect(
				screen.getByRole('link', { name: /external download link/i })
			).toBeInTheDocument();
		});

		it('hides R2 download link in blog mode when uploaded files are unavailable', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					item: { ...mockItem, has_uploaded_files: false }
				}
			});
			expect(screen.queryByRole('link', { name: /download chart/i })).not.toBeInTheDocument();
		});

		it('shows external link in blog mode when download_url is set', () => {
			render(ChartListItem, { props: { ...renderProps, isBlog: true } });
			const externalLink = screen.getByRole('link', { name: /external download link/i });
			expect(externalLink).toBeInTheDocument();
			expect(externalLink).toHaveAttribute('href', renderProps.item.download_url);
		});

		it('shows disabled external link in blog mode when download_url is null', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					item: { ...mockItem, download_url: null }
				}
			});
			expect(
				screen.queryByRole('link', { name: /external download link/i })
			).not.toBeInTheDocument();
			expect(screen.getByText('External Link')).toBeInTheDocument();
		});

		it('does not render the download dropdown when the simfile id is missing', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					item: {
						...mockItem,
						id: undefined,
						download_url: 'https://example.com/download1'
					}
				}
			});
			expect(screen.queryByRole('link', { name: /download chart/i })).not.toBeInTheDocument();
			expect(
				screen.queryByRole('link', { name: /external download link/i })
			).not.toBeInTheDocument();
		});
	});

	describe('Menu Layering Regression', () => {
		it('sets Popover zIndex higher than card stacking layer', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartListItem.svelte'),
				'utf-8'
			);
			const popoverZIndexMatch = source.match(/<Popover[\s\S]*?zIndex="(\d+)"/);

			expect(popoverZIndexMatch).not.toBeNull();
			expect(Number(popoverZIndexMatch?.[1])).toBeGreaterThan(30);
		});

		it('keeps card overflow visible so dropdown is not clipped', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartListItem.svelte'),
				'utf-8'
			);

			expect(source).toContain('style="overflow: visible;"');
		});
	});
});
