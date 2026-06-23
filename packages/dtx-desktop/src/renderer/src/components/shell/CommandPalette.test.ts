import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('../../services/simFileService', () => ({ simFileService: { clearCache: vi.fn() } }));
vi.mock('../../services/workspaceService', () => ({
	workspaceService: {
		selectWorkspace: vi.fn(),
		loadSubWorkspaces: vi.fn(),
		loadTreeStructure: vi.fn(),
		clearWorkspace: vi.fn()
	}
}));

import CommandPalette from './CommandPalette.svelte';

describe('CommandPalette', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		vi.clearAllMocks();
	});
	afterEach(() => cleanup());

	it('does not render when closed', () => {
		render(CommandPalette, { open: false, onClose: vi.fn() });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
	it('lists commands when open', () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		expect(screen.getByText('New Song')).toBeInTheDocument();
		expect(screen.getByText('Open Settings')).toBeInTheDocument();
	});
	it('filters by query', async () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'settings' } });
		expect(screen.getByText('Open Settings')).toBeInTheDocument();
		expect(screen.queryByText('New Song')).not.toBeInTheDocument();
	});
	it('Esc closes', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
	});
	it('Esc closes when focus is inside the palette (keydown bubbles to window)', async () => {
		// In real usage focus auto-lands in the input on open, so the keydown
		// originates inside the dialog. It must still reach the window handler —
		// nothing in the palette may stop its propagation.
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
	});
	it('Enter runs the selected command and closes', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'settings' } });
		await fireEvent.keyDown(window, { key: 'Enter' });
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('settings');
		expect(onClose).toHaveBeenCalled();
	});
	it('ArrowDown navigates to the 2nd result and Enter runs it', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		// query='' → flatResults[0]=Go to Library (nav.library), flatResults[1]=Go to Templates (nav.templates)
		await fireEvent.keyDown(window, { key: 'ArrowDown' });
		await fireEvent.keyDown(window, { key: 'Enter' });
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('templates');
		expect(onClose).toHaveBeenCalled();
	});
	it('Enter on a song result selects it and navigates to library', async () => {
		const onClose = vi.fn();
		workspaceStore.setTreeStructure([
			{
				name: 'My Song',
				path: '/songs/my-song',
				children: [],
				isExpanded: false,
				isLoading: false,
				hasChildren: false,
				containsDtxFiles: true,
				songTitle: 'My Song'
			}
		]);
		render(CommandPalette, { open: true, onClose });
		// type a query that matches the song but no command
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'my song' } });
		await fireEvent.keyDown(window, { key: 'Enter' });
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('library');
		expect(get(workspaceStore).selectedSong?.path).toBe('/songs/my-song');
		expect(onClose).toHaveBeenCalled();
	});
	it('selected resets to 0 when query narrows (regression)', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		// Move selection to index 1 (Go to Templates)
		await fireEvent.keyDown(window, { key: 'ArrowDown' });
		// Now narrow the query so only 1 result remains: "Open Settings"
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'open settings' } });
		// Enter must run the single remaining result (index 0 = Open Settings → settings)
		await fireEvent.keyDown(window, { key: 'Enter' });
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('settings');
		expect(onClose).toHaveBeenCalled();
	});
});
