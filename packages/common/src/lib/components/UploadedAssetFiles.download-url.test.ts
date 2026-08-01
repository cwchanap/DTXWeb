import { describe, expect, it, vi } from 'vitest';

vi.mock('@testing-library/svelte', async () => await vi.importActual('@testing-library/svelte'));

vi.mock('@skeletonlabs/skeleton-svelte', async () => {
	const { default: AccordionStub } = await import('../../tests/stubs/AccordionStub.svelte');
	const { default: AccordionItemStub } =
		await import('../../tests/stubs/AccordionItemStub.svelte');
	(AccordionStub as unknown as Record<string, unknown>).Item = AccordionItemStub;
	return { Accordion: AccordionStub };
});

vi.mock('@lucide/svelte', () => ({
	DownloadCloud: vi.fn()
}));

import { render, screen, waitFor } from '@testing-library/svelte';
import UploadedAssetFiles from './UploadedAssetFiles.svelte';

const cloudFile = {
	fileName: 'snare#1.wav',
	size: 100,
	lastModified: '2024-01-01T00:00:00Z',
	key: 'songs/1/snare#1.wav'
};

describe('UploadedAssetFiles download URL validation', () => {
	it('uses an encoded root-relative URL when the desktop bucket origin is empty', async () => {
		render(UploadedAssetFiles, {
			props: {
				simfileId: 'sim-1',
				simfileBucketUrl: '',
				loadAssetFiles: vi.fn().mockResolvedValue([cloudFile])
			}
		});

		await waitFor(() => {
			expect(screen.getByTitle('Download file')).toHaveAttribute(
				'href',
				'/songs/1/snare%231.wav'
			);
		});
	});

	it('does not render a download link for an executable bucket URL scheme', async () => {
		render(UploadedAssetFiles, {
			props: {
				simfileId: 'sim-1',
				simfileBucketUrl: 'javascript:alert(1)',
				loadAssetFiles: vi.fn().mockResolvedValue([cloudFile])
			}
		});

		await waitFor(() => {
			expect(screen.getByText('snare#1.wav')).toBeInTheDocument();
			expect(screen.queryByTitle('Download file')).not.toBeInTheDocument();
		});
	});
});
