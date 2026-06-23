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
});
