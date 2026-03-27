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
	is_published: true,
	display_id: 1,
	download_url: 'https://example.com/download',
	publish_date: '2024-01-01',
	video_preview_url: null,
	dtx_files: [
		{ id: 1, label: 'BASIC', level: 30, simfile_id: 1 },
		{ id: 2, label: 'ADVANCED', level: 60, simfile_id: 1 }
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
		// Component renders with no simfile
		expect(document.querySelector('form, div')).toBeTruthy();
	});

	it('renders with showEditor=false', () => {
		render(ChartDetail, { props: { simfile: mockSimfile, showEditor: false } });
		expect(document.body).toBeTruthy();
	});

	it('renders with showPublishingControls=false', () => {
		render(ChartDetail, {
			props: { simfile: mockSimfile, showPublishingControls: false }
		});
		expect(document.body).toBeTruthy();
	});

	it('renders with showPublishedToggle=false', () => {
		render(ChartDetail, {
			props: { simfile: mockSimfile, showPublishedToggle: false }
		});
		expect(document.body).toBeTruthy();
	});

	it('renders DTX file list when dtx_files present', () => {
		render(ChartDetail, { props: { simfile: mockSimfile } });
		expect(screen.getByText('BASIC')).toBeInTheDocument();
		expect(screen.getByText('ADVANCED')).toBeInTheDocument();
	});

	it('renders with empty dtx_files array', () => {
		render(ChartDetail, {
			props: { simfile: { ...mockSimfile, dtx_files: [] } }
		});
		expect(document.body).toBeTruthy();
	});
});
