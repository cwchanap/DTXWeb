import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');
vi.mock('../SongDetails.svelte', () => ({ default: vi.fn() }));

import DetailPane from './DetailPane.svelte';

describe('DetailPane', () => {
	beforeEach(() => workspaceStore.reset());
	afterEach(() => cleanup());

	it('shows empty state when no song selected', () => {
		render(DetailPane);
		expect(screen.getByText(/select a song/i)).toBeInTheDocument();
	});

	it('does not show the empty state when a song is selected', () => {
		workspaceStore.selectSong({ name: 'Tank', path: '/tank' } as never);
		render(DetailPane);
		expect(screen.queryByText(/select a song/i)).not.toBeInTheDocument();
	});
});
