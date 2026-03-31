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

import { fireEvent } from '@testing-library/svelte';
import ChartDetailPage from './+page.svelte';

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
