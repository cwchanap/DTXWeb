import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import DownloadDropdown from './DownloadDropdown.svelte';

vi.mock('svelte-i18n');
vi.mock('$lib/api', () => ({
	downloadSimfile: vi.fn().mockResolvedValue(undefined)
}));

describe('DownloadDropdown', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders a button with aria-label when hasUploadedFiles is true', () => {
		const { getByRole } = render(DownloadDropdown, {
			props: { simfileId: 7, externalUrl: null, hasUploadedFiles: true }
		});
		const btn = getByRole('button', { name: 'chart_actions.download' });
		expect(btn).toBeTruthy();
	});

	it('does not render download button when hasUploadedFiles is false', () => {
		const { queryByRole } = render(DownloadDropdown, {
			props: { simfileId: 7, externalUrl: null, hasUploadedFiles: false }
		});
		expect(queryByRole('button')).toBeNull();
	});

	it('calls downloadSimfile on click', async () => {
		const { downloadSimfile } = await import('$lib/api');
		const { getByRole } = render(DownloadDropdown, {
			props: { simfileId: 7, externalUrl: null, hasUploadedFiles: true }
		});
		await fireEvent.click(getByRole('button', { name: 'chart_actions.download' }));
		expect(downloadSimfile).toHaveBeenCalledWith('7');
	});

	it('button is disabled while downloading', async () => {
		let resolveDownload: () => void;
		const downloadPromise = new Promise<void>((resolve) => {
			resolveDownload = resolve;
		});
		const { downloadSimfile } = await import('$lib/api');
		vi.mocked(downloadSimfile).mockReturnValue(downloadPromise);

		const { getByRole } = render(DownloadDropdown, {
			props: { simfileId: 7, externalUrl: null, hasUploadedFiles: true }
		});
		const btn = getByRole('button', { name: 'chart_actions.download' });
		fireEvent.click(btn);
		expect(btn).toBeDisabled();

		resolveDownload!();
		await downloadPromise;
	});
});
