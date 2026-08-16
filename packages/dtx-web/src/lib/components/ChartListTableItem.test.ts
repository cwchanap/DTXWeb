import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ModalStub from '../../tests/stubs/ModalStub.svelte';

vi.mock('svelte-i18n');

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: PopoverStub } = await import('../../tests/stubs/PopoverStub.svelte');
	const { default: TooltipStub } = await import('../../tests/stubs/TooltipStub.svelte');
	return { Popover: PopoverStub, Tooltip: TooltipStub };
});

vi.mock('@dtx/ui-components/components', () => ({
	Modal: ModalStub
}));

vi.mock('@dtx/ui-components', async () => {
	const { default: ButtonStub } = await import('../../tests/stubs/ButtonStub.svelte');
	return { Button: ButtonStub };
});

vi.mock('$lib/toaster', () => ({ default: toastMock }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api', () => ({
	downloadSimfile: vi.fn().mockResolvedValue(undefined),
	bulkDownloadBaseUrl: vi.fn(() => '/downloads/bulk'),
	bulkDownloadHeaders: vi.fn().mockResolvedValue({ 'Content-Type': 'application/json' })
}));

import ChartListTableItem from './ChartListTableItem.svelte';
import { goto } from '$app/navigation';

const mockItem = {
	id: 10,
	isPublished: false,
	downloadUrl: null as string | null,
	hasUploadedFiles: true
};

describe('ChartListTableItem', () => {
	const defaultProps = {
		item: mockItem,
		isBlog: false,
		enableDownload: false,
		togglePublishChart: vi.fn().mockResolvedValue(undefined),
		onFileDelete: vi.fn()
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not render a dialog in blog mode with no downloadUrl', () => {
		render(ChartListTableItem, { props: { ...defaultProps, isBlog: true } });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('renders R2 download link and external link in blog mode', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				enableDownload: true,
				item: { ...mockItem, downloadUrl: 'https://dl.example.com' }
			}
		});
		const r2Button = screen.getByRole('button', { name: 'chart_actions.download' });
		expect(r2Button).toBeInTheDocument();
		const externalLink = screen.getByRole('link', { name: /external download link/i });
		expect(externalLink).toHaveAttribute('href', 'https://dl.example.com');
	});

	it('hides the R2 download link in blog mode when upload availability is omitted', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				enableDownload: true,
				item: (() => {
					const item = { ...mockItem, downloadUrl: 'https://dl.example.com' };
					delete (item as { hasUploadedFiles?: boolean }).hasUploadedFiles;
					return item;
				})()
			}
		});
		expect(
			screen.queryByRole('button', { name: 'chart_actions.download' })
		).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: /external download link/i })).toBeInTheDocument();
	});

	it('shows R2 download link in blog mode when downloadUrl is null', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				enableDownload: true,
				item: { ...mockItem, downloadUrl: null }
			}
		});
		expect(screen.getByRole('button', { name: 'chart_actions.download' })).toBeInTheDocument();
	});

	it('hides the R2 download link in blog mode when downloadUrl is null and uploads are unavailable', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				enableDownload: true,
				item: { ...mockItem, downloadUrl: null, hasUploadedFiles: false }
			}
		});
		expect(
			screen.queryByRole('button', { name: 'chart_actions.download' })
		).not.toBeInTheDocument();
		expect(screen.getByTitle('No external link available')).toBeInTheDocument();
	});

	it('hides the R2 download link in blog mode when uploaded files are unavailable', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				enableDownload: true,
				item: {
					...mockItem,
					hasUploadedFiles: false,
					downloadUrl: 'https://dl.example.com'
				}
			}
		});
		expect(
			screen.queryByRole('button', { name: 'chart_actions.download' })
		).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: /external download link/i })).toBeInTheDocument();
	});

	it('does not render the in-app download link in blog table mode when downloads are disabled', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				enableDownload: false,
				item: { ...mockItem, downloadUrl: 'https://dl.example.com' }
			}
		});

		expect(
			screen.queryByRole('button', { name: 'chart_actions.download' })
		).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: /external download link/i })).toHaveAttribute(
			'href',
			'https://dl.example.com'
		);
	});

	it('renders action buttons in non-blog mode', () => {
		render(ChartListTableItem, { props: defaultProps });
		expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
		expect(screen.getByRole('menuitem', { name: 'Edit details' })).toBeInTheDocument();
	});

	it('shows a compact Preview link in blog mode for a previewable chart', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				item: { ...mockItem, isPublished: true }
			}
		});

		expect(screen.getByRole('link', { name: 'preview.open' })).toHaveAttribute(
			'href',
			'/preview/10'
		);
	});

	it('shows Preview and Edit details in owner mode for a published uploaded chart', () => {
		render(ChartListTableItem, {
			props: { ...defaultProps, item: { ...mockItem, isPublished: true } }
		});

		// PopoverStub always renders its content.
		expect(screen.getByRole('menuitem', { name: 'preview.open' })).toHaveAttribute(
			'href',
			'/preview/10'
		);
		expect(screen.getByRole('menuitem', { name: 'Edit details' })).toHaveAttribute(
			'href',
			'/app/chart/10'
		);
	});

	describe('Navigation', () => {
		beforeEach(() => {
			vi.mocked(goto).mockClear();
		});

		it('renders "Open in Editor" button in non-blog mode', () => {
			render(ChartListTableItem, { props: defaultProps });
			expect(screen.getByRole('button', { name: 'Open in Editor' })).toBeInTheDocument();
		});

		it('clicking "Open in Editor" navigates to the chart editor', async () => {
			render(ChartListTableItem, { props: defaultProps });
			await fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }));
			expect(goto).toHaveBeenCalledWith(`/editor/${mockItem.id}`);
		});

		it('"Open in Editor" is not rendered in blog mode', () => {
			render(ChartListTableItem, { props: { ...defaultProps, isBlog: true } });
			expect(
				screen.queryByRole('button', { name: 'Open in Editor' })
			).not.toBeInTheDocument();
		});

		it('"Open in Editor" is not rendered when hasUploadedFiles is false', () => {
			render(ChartListTableItem, {
				props: { ...defaultProps, item: { ...mockItem, hasUploadedFiles: false } }
			});
			expect(
				screen.queryByRole('button', { name: 'Open in Editor' })
			).not.toBeInTheDocument();
		});

		it('"Open in Editor" is not rendered when hasUploadedFiles is undefined', () => {
			const item = { ...mockItem };
			delete (item as { hasUploadedFiles?: boolean }).hasUploadedFiles;
			render(ChartListTableItem, { props: { ...defaultProps, item } });
			expect(
				screen.queryByRole('button', { name: 'Open in Editor' })
			).not.toBeInTheDocument();
		});
	});

	it('clicking Delete opens the confirmation modal', async () => {
		render(ChartListTableItem, { props: defaultProps });

		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

		expect(screen.getByRole('dialog')).toBeInTheDocument();
	});

	it('confirming delete calls onFileDelete', async () => {
		const onFileDelete = vi.fn();
		render(ChartListTableItem, { props: { ...defaultProps, onFileDelete } });

		// Open modal
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

		// Confirm inside dialog
		const dialog = screen.getByRole('dialog');
		const allDeleteButtons = screen.getAllByRole('button', { name: 'Delete' });
		const dialogDeleteButton = allDeleteButtons.find((btn) => dialog.contains(btn));
		await fireEvent.click(dialogDeleteButton!);

		expect(onFileDelete).toHaveBeenCalledWith(mockItem.id);
	});
});
