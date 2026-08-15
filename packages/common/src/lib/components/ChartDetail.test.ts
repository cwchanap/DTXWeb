import { describe, it, expect, vi } from 'vitest';

// Override the global @testing-library/svelte mock from setup.ts with the real implementation
vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

// Mock icon subpath imports
vi.mock('@lucide/svelte/icons/x', () => ({ default: vi.fn() }));
vi.mock('@lucide/svelte/icons/check', () => ({ default: vi.fn() }));

// Mock skeleton-svelte with Switch
vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	Switch: vi.fn()
}));

import { render, screen } from '@testing-library/svelte';
import ChartDetail from './ChartDetail.svelte';

const mockSimfile = {
	id: 1,
	title: 'Test Song',
	artist: 'Test Artist',
	bpm: 140,
	isPublished: true,
	displayId: 1,
	downloadUrl: 'https://example.com/download',
	publishDate: '2024-01-01',
	createdAt: '2024-01-01T00:00:00Z',
	updatedAt: '2024-01-02T00:00:00Z',
	videoPreviewUrl: null,
	dtxFiles: [
		{ id: 1, label: 'BASIC', level: 30 },
		{ id: 2, label: 'ADVANCED', level: 60 }
	]
};

describe('ChartDetail', () => {
	it('renders the title field', () => {
		render(ChartDetail, { props: { simfile: mockSimfile } });
		// The component renders title from simfile
		expect(screen.getByText('Test Song')).toBeInTheDocument();
	});

	it('renders without simfile (default props)', () => {
		render(ChartDetail, { props: {} });
		// Title is absent when no simfile provided
		expect(screen.queryByText('Test Song')).not.toBeInTheDocument();
	});

	it('renders with showEditor=false hides Open in Editor link', () => {
		render(ChartDetail, { props: { simfile: mockSimfile, showEditor: false } });
		expect(screen.queryByText('Open in Editor')).not.toBeInTheDocument();
	});

	it('renders with showPublishingControls=false hides Display ID input', () => {
		render(ChartDetail, {
			props: { simfile: mockSimfile, showPublishingControls: false }
		});
		expect(screen.queryByLabelText('Display ID:')).not.toBeInTheDocument();
	});

	it('renders with showPublishedToggle=false hides Published label', () => {
		render(ChartDetail, {
			props: { simfile: mockSimfile, showPublishedToggle: false }
		});
		expect(screen.queryByText('Published:')).not.toBeInTheDocument();
	});

	it('renders DTX file list when dtxFiles present', () => {
		render(ChartDetail, { props: { simfile: mockSimfile } });
		expect(screen.getByText('BASIC')).toBeInTheDocument();
		expect(screen.getByText('ADVANCED')).toBeInTheDocument();
	});

	it('renders with empty dtxFiles array shows no DTX entries', () => {
		render(ChartDetail, {
			props: { simfile: { ...mockSimfile, dtxFiles: [] } }
		});
		expect(screen.queryByText('BASIC')).not.toBeInTheDocument();
		expect(screen.queryByText('ADVANCED')).not.toBeInTheDocument();
	});
});
