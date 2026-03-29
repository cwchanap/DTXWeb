import { describe, it, expect, vi, beforeEach } from 'vitest';
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

	it('renders loading state initially', () => {
		render(ChartDetailPage);
		expect(screen.getByText('Loading...')).toBeInTheDocument();
	});

	it('renders the back button', () => {
		render(ChartDetailPage);
		expect(screen.getByText('← Back to List')).toBeInTheDocument();
	});
});
