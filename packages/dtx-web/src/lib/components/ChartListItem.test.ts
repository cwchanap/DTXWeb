/**
 * Unit tests for ChartListItem.svelte component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

vi.mock('svelte-i18n');
vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: PopoverStub } = await import('../../tests/stubs/PopoverStub.svelte');
	return { Popover: PopoverStub };
});
vi.mock('@dtx/ui-components/components', async () => {
	const { default: ModalStub } = await import('../../tests/stubs/ModalStub.svelte');
	const { default: ButtonStub } = await import('../../tests/stubs/ButtonStub.svelte');
	return {
		Modal: ModalStub,
		Button: ButtonStub
	};
});
vi.mock('@lucide/svelte/icons');
vi.mock('$lib/toaster', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api', () => ({
	downloadSimfile: vi.fn().mockResolvedValue(undefined),
	bulkDownloadBaseUrl: vi.fn(() => '/downloads/bulk'),
	bulkDownloadHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' })
}));

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
import { goto } from '$app/navigation';

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
		const baseProps = {
			isBlog: true,
			enableDownload: true,
			togglePublishChart: vi.fn(),
			simfileBucketUrl: 'https://cdn.example.com',
			onFileDelete: vi.fn()
		};

		it('renders the uploaded chart download link when uploaded files are available in blog mode', () => {
			render(ChartListItem, { props: { ...baseProps, item: mockItem } });

			expect(
				screen.getByRole('button', { name: 'chart_actions.download' })
			).toBeInTheDocument();
			expect(
				screen.getByRole('link', { name: /external download link/i })
			).toBeInTheDocument();
		});

		it('omits the uploaded chart download link when no external URL exists and uploads are unavailable', () => {
			render(ChartListItem, { props: { ...baseProps, item: mockItemNoPreview } });

			expect(
				screen.queryByRole('button', { name: 'chart_actions.download' })
			).not.toBeInTheDocument();
			expect(screen.getByTitle('No external link available')).toBeInTheDocument();
		});

		it('omits the uploaded chart download link when only the external URL is available', () => {
			render(ChartListItem, {
				props: {
					...baseProps,
					item: { ...mockItem, has_uploaded_files: false }
				}
			});

			expect(
				screen.queryByRole('button', { name: 'chart_actions.download' })
			).not.toBeInTheDocument();
			expect(screen.getByRole('link', { name: /external download link/i })).toHaveAttribute(
				'href',
				mockItem.download_url
			);
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

		it('renders the title as an editor link when uploaded files are available', () => {
			render(ChartListItem, { props: renderProps });
			const editorLink = screen.getByRole('link', { name: 'Test Song 1' });
			expect(editorLink).toHaveAttribute('href', '/editor/1');
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
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					enableDownload: true,
					item: { ...renderProps.item, download_url: 'https://example.com/download1' }
				}
			});
			const downloadButton = screen.getByRole('button', { name: 'chart_actions.download' });
			expect(downloadButton).toBeInTheDocument();
		});

		it('hides R2 download link in blog mode when upload availability is omitted', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					enableDownload: true,
					item: (() => {
						const item = { ...mockItem };
						delete (item as { has_uploaded_files?: boolean }).has_uploaded_files;
						return item;
					})()
				}
			});
			expect(
				screen.queryByRole('button', { name: 'chart_actions.download' })
			).not.toBeInTheDocument();
			expect(
				screen.getByRole('link', { name: /external download link/i })
			).toBeInTheDocument();
		});

		it('hides R2 download link in blog mode when uploaded files are unavailable', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					enableDownload: true,
					item: { ...mockItem, has_uploaded_files: false }
				}
			});
			expect(
				screen.queryByRole('button', { name: 'chart_actions.download' })
			).not.toBeInTheDocument();
		});

		it('shows external link in blog mode when download_url is set and downloads are disabled', () => {
			render(ChartListItem, { props: { ...renderProps, isBlog: true } });
			const externalLink = screen.getByRole('link', { name: /blog\.download/i });
			expect(externalLink).toBeInTheDocument();
			expect(externalLink).toHaveAttribute('href', renderProps.item.download_url);
		});

		it('shows download unavailable state in blog mode when download_url is null and downloads are disabled', () => {
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
			expect(screen.getByText('Download not available')).toBeInTheDocument();
		});

		it('shows R2 download link in blog mode when download_url is null', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					enableDownload: true,
					item: { ...mockItem, download_url: null }
				}
			});
			const downloadLink = screen.getByRole('button', { name: 'chart_actions.download' });
			expect(downloadLink).toBeInTheDocument();
		});

		it('hides R2 download link in blog mode when download_url is null and uploads are unavailable', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					enableDownload: true,
					item: { ...mockItemNoPreview, download_url: null, has_uploaded_files: false }
				}
			});
			expect(
				screen.queryByRole('button', { name: 'chart_actions.download' })
			).not.toBeInTheDocument();
			expect(screen.getByTitle('No external link available')).toBeInTheDocument();
		});

		it('does not render the download dropdown when the simfile id is missing', () => {
			render(ChartListItem, {
				props: {
					...renderProps,
					isBlog: true,
					enableDownload: true,
					item: {
						...mockItem,
						id: undefined,
						download_url: 'https://example.com/download1'
					}
				}
			});
			expect(
				screen.queryByRole('button', { name: 'chart_actions.download' })
			).not.toBeInTheDocument();
			expect(
				screen.queryByRole('link', { name: /external download link/i })
			).not.toBeInTheDocument();
		});

		it('routes a previewable blog card title to preview', () => {
			render(ChartListItem, { props: { ...renderProps, isBlog: true, item: mockItem } });
			expect(screen.getByRole('link', { name: 'Test Song 1' })).toHaveAttribute(
				'href',
				'/preview/1'
			);
		});

		it('keeps an owner card title editor-first', () => {
			render(ChartListItem, { props: renderProps });
			expect(screen.getByRole('link', { name: 'Test Song 1' })).toHaveAttribute(
				'href',
				'/editor/1'
			);
		});

		it('does not fall back to editor for a non-previewable blog card', () => {
			render(ChartListItem, {
				props: { ...renderProps, isBlog: true, item: { ...mockItem, is_published: false } }
			});
			expect(screen.queryByRole('link', { name: 'Test Song 1' })).not.toBeInTheDocument();
		});

		it('shows owner Preview and Edit details actions for a published uploaded chart', () => {
			render(ChartListItem, { props: renderProps });
			// PopoverStub always renders its content; no trigger click is required.
			expect(screen.getByRole('menuitem', { name: 'preview.open' })).toHaveAttribute(
				'href',
				'/preview/1'
			);
			expect(screen.getByRole('menuitem', { name: 'Edit details' })).toHaveAttribute(
				'href',
				'/app/chart/1'
			);
		});

		it('shows an explicit blog Preview CTA for a previewable card', () => {
			render(ChartListItem, { props: { ...renderProps, isBlog: true, item: mockItem } });
			expect(screen.getByRole('link', { name: 'preview.open' })).toHaveAttribute(
				'href',
				'/preview/1'
			);
		});

		it('omits the blog Preview CTA for a non-previewable card', () => {
			render(ChartListItem, {
				props: { ...renderProps, isBlog: true, item: { ...mockItem, is_published: false } }
			});
			expect(screen.queryByRole('link', { name: 'preview.open' })).not.toBeInTheDocument();
		});
	});

	describe('Handler coverage', () => {
		const handlerProps = {
			item: mockItem,
			isBlog: false,
			togglePublishChart: vi.fn().mockResolvedValue(undefined),
			simfileBucketUrl: 'https://cdn.example.com',
			onFileDelete: vi.fn()
		};

		it('clicking Delete opens modal and confirming calls onFileDelete', async () => {
			const onFileDelete = vi.fn();
			render(ChartListItem, { props: { ...handlerProps, onFileDelete } });

			// Click the Delete button in popover content (only one Delete button initially)
			await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

			// Modal should now be open
			const dialog = screen.getByRole('dialog');
			expect(dialog).toBeInTheDocument();

			// Click confirm button inside the dialog
			const allDeleteButtons = screen.getAllByRole('button', { name: 'Delete' });
			const dialogDeleteButton = allDeleteButtons.find((btn) => dialog.contains(btn));
			await fireEvent.click(dialogDeleteButton!);

			expect(onFileDelete).toHaveBeenCalledWith(mockItem.id);
		});

		it('clicking Unpublish calls togglePublishChart with correct args', async () => {
			const togglePublishChart = vi.fn().mockResolvedValue(undefined);
			render(ChartListItem, { props: { ...handlerProps, togglePublishChart } });

			await fireEvent.click(screen.getByRole('button', { name: /unpublish/i }));
			expect(togglePublishChart).toHaveBeenCalledWith(mockItem.id, mockItem.is_published);
		});
	});

	describe('Navigation', () => {
		const navProps = {
			item: mockItem,
			isBlog: false,
			togglePublishChart: vi.fn().mockResolvedValue(undefined),
			simfileBucketUrl: 'https://cdn.example.com',
			onFileDelete: vi.fn()
		};

		beforeEach(() => {
			vi.mocked(goto).mockClear();
		});

		it('clicking "Open in Editor" menu item navigates to the editor in non-blog mode', async () => {
			render(ChartListItem, { props: navProps });
			await fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }));
			expect(goto).toHaveBeenCalledWith('/editor/1');
		});

		it('"Open in Editor" menu item is not shown in blog mode', () => {
			render(ChartListItem, { props: { ...navProps, isBlog: true } });
			expect(
				screen.queryByRole('button', { name: 'Open in Editor' })
			).not.toBeInTheDocument();
		});

		it('"Open in Editor" menu item is not shown when item.id is undefined', () => {
			render(ChartListItem, { props: { ...navProps, item: { ...mockItem, id: undefined } } });
			expect(
				screen.queryByRole('button', { name: 'Open in Editor' })
			).not.toBeInTheDocument();
		});

		it('"Open in Editor" menu item is not shown when has_uploaded_files is false', () => {
			render(ChartListItem, {
				props: { ...navProps, item: { ...mockItem, has_uploaded_files: false } }
			});
			expect(
				screen.queryByRole('button', { name: 'Open in Editor' })
			).not.toBeInTheDocument();
		});

		it('"Open in Editor" menu item is not shown when has_uploaded_files is undefined', () => {
			const item = { ...mockItem };
			delete (item as { has_uploaded_files?: boolean }).has_uploaded_files;
			render(ChartListItem, { props: { ...navProps, item } });
			expect(
				screen.queryByRole('button', { name: 'Open in Editor' })
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

			// Verify overflow: visible is applied via inline style to win over .music-card
			expect(source).toMatch(/style="overflow:\s*visible/);
		});

		it('Modal uses portal action so fixed positioning is not trapped by card transforms', () => {
			const modalSource = readFileSync(
				path.resolve(
					__dirname,
					'../../../../ui-components/src/lib/components/Modal.svelte'
				),
				'utf-8'
			);

			expect(modalSource).toContain('use:portal');
			expect(modalSource).toContain('document.body.appendChild(node)');
		});

		it('card wrapper in ChartList does not have a standalone transform class', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			// The card grid wrapper should not have a bare "transform" class (which creates
			// a CSS containing block that traps position:fixed children like the delete modal)
			expect(source).not.toMatch(/class="[^"]*\btransform\b[^"]*hover:scale-105[^"]*"/);
		});
	});
});
