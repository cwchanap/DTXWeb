import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { workspaceStore } from '../stores/workspaceStore';
import type { SimfileWithDtx } from '@dtx/common';

vi.mock('@lucide/svelte', () => {
	// Explicit factory: vitest's auto-mock doesn't reliably stub every icon in
	// this large barrel. vi.fn() works as a renderless Svelte component stub.
	const stub = vi.fn();
	return {
		Music: stub,
		X: stub,
		Calendar: stub,
		Link: stub,
		Cloud: stub
	};
});

vi.mock('../services/linkageCacheService', () => ({
	linkageCacheService: {
		getLinkage: vi.fn().mockReturnValue(null),
		saveLinkage: vi.fn(),
		removeLinkage: vi.fn(),
		clearCache: vi.fn()
	}
}));

import CloudSongDetail from './CloudSongDetail.svelte';

const makeSimFile = (overrides: Partial<SimfileWithDtx> = {}): SimfileWithDtx =>
	({
		id: 1,
		title: 'Spice & Wolf',
		artist: 'Yoshino',
		bpm: 145,
		is_published: false,
		publish_date: '2024-05-01',
		dtx_files: [{ level: 5, label: 'BASIC' }],
		...overrides
	}) as SimfileWithDtx;

describe('CloudSongDetail', () => {
	beforeEach(() => {
		workspaceStore.reset();
	});
	afterEach(() => cleanup());

	it('renders the simfile title and artist', () => {
		render(CloudSongDetail, { simFile: makeSimFile() });
		expect(screen.getByText('Spice & Wolf')).toBeInTheDocument();
		expect(screen.getByText('Yoshino')).toBeInTheDocument();
	});

	it('renders BPM and sorted levels', () => {
		render(CloudSongDetail, {
			simFile: makeSimFile({ bpm: 160, dtx_files: [{ level: 9 }, { level: 3 }] })
		});
		expect(screen.getByText('160')).toBeInTheDocument();
		expect(screen.getByText('3, 9')).toBeInTheDocument();
	});

	it('shows a Draft badge when unpublished', () => {
		render(CloudSongDetail, { simFile: makeSimFile({ is_published: false }) });
		expect(screen.getByText('Draft')).toBeInTheDocument();
	});

	it('shows a Published badge when published', () => {
		render(CloudSongDetail, { simFile: makeSimFile({ is_published: true }) });
		expect(screen.getByText('Published')).toBeInTheDocument();
	});

	it('shows Linked badge when a workspace node references the simfile id', () => {
		workspaceStore.setTreeStructure([
			{
				name: 'Folder',
				path: '/songs/folder',
				isExpanded: false,
				isLoading: false,
				children: [],
				hasChildren: false,
				containsDtxFiles: true,
				linkedSimFileId: '1'
			}
		]);
		render(CloudSongDetail, { simFile: makeSimFile({ id: 1 }) });
		expect(screen.getByText('Linked to workspace')).toBeInTheDocument();
	});

	it('close button clears the cloud selection', async () => {
		const sim = makeSimFile();
		workspaceStore.selectCloudSimFile(sim);
		render(CloudSongDetail, { simFile: sim });
		await fireEvent.click(screen.getByRole('button', { name: /Close cloud song details/i }));
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).selectedCloudSimFile).toBeNull();
		expect(get(workspaceStore).showCloudSongDetails).toBe(false);
	});
});
