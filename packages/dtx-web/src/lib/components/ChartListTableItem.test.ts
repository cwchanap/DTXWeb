import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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

vi.mock('@dtx/ui-components', () => ({
	Button: vi.fn()
}));

vi.mock('$lib/toaster', () => ({ default: toastMock }));

import ChartListTableItem from './ChartListTableItem.svelte';

const mockItem = {
	id: 10,
	is_published: false,
	download_url: null as string | null
};

describe('ChartListTableItem', () => {
	const defaultProps = {
		item: mockItem,
		isBlog: false,
		togglePublishChart: vi.fn().mockResolvedValue(undefined),
		onFileDelete: vi.fn()
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not render a dialog in blog mode with no download_url', () => {
		render(ChartListTableItem, { props: { ...defaultProps, isBlog: true } });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('renders a download link in blog mode when download_url is set', () => {
		render(ChartListTableItem, {
			props: {
				...defaultProps,
				isBlog: true,
				item: { ...mockItem, download_url: 'https://dl.example.com' }
			}
		});
		expect(screen.getByRole('link')).toBeInTheDocument();
	});

	it('renders action buttons in non-blog mode', () => {
		render(ChartListTableItem, { props: defaultProps });
		expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
	});
});
