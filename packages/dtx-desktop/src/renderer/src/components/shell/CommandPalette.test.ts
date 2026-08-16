import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, createEvent } from '@testing-library/svelte';
import { authStore } from '../../stores/authStore';
import { workspaceStore } from '../../stores/workspaceStore';
import { simFileStore } from '../../stores/simFileStore';
import { toastStore } from '../../stores/toastStore';
import { get } from 'svelte/store';
import type { SimfileModel } from '@dtx/common';

vi.mock('@lucide/svelte');
vi.mock('../../services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('../../services/simFileService', () => ({ simFileService: { clearCache: vi.fn() } }));
vi.mock('../../services/exportService', () => ({ exportSelectedSong: vi.fn() }));
vi.mock('../../services/workspaceService', () => ({
	workspaceService: {
		selectWorkspace: vi.fn(),
		loadSubWorkspaces: vi.fn(),
		loadTreeStructure: vi.fn(),
		clearWorkspace: vi.fn()
	}
}));

import CommandPalette from './CommandPalette.svelte';
import { exportSelectedSong } from '../../services/exportService';

const makeCloudSimFile = (overrides: Partial<SimfileModel> = {}): SimfileModel =>
	({
		id: 1,
		title: 'Cloud Anthem',
		artist: 'Cloud Artist',
		bpm: 120,
		displayId: null,
		userId: 'test-user',
		googleDriveFileId: null,
		isPublished: false,
		publishDate: null,
		dtxFiles: [],
		...overrides
	}) as SimfileModel;

describe('CommandPalette', () => {
	beforeEach(() => {
		authStore.reset();
		workspaceStore.reset();
		simFileStore.reset();
		toastStore.reset();
		vi.clearAllMocks();
		vi.mocked(exportSelectedSong).mockReset();
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
		await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'settings' } });
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
		await fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
		expect(onClose).toHaveBeenCalled();
	});
	it('Enter runs the selected command and closes', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'settings' } });
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
		await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'my song' } });
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
		await fireEvent.input(screen.getByRole('combobox'), {
			target: { value: 'open settings' }
		});
		// Enter must run the single remaining result (index 0 = Open Settings → settings)
		await fireEvent.keyDown(window, { key: 'Enter' });
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('settings');
		expect(onClose).toHaveBeenCalled();
	});

	it('renders a combobox controlling a listbox of options (spec §7 ARIA)', () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		const combobox = screen.getByRole('combobox');
		expect(combobox).toHaveAttribute('aria-expanded', 'true');
		expect(combobox.getAttribute('aria-controls')).toBe('cmd-palette-list');
		// listbox + options exist
		expect(screen.getByRole('listbox')).toBeInTheDocument();
		expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
	});

	it('updates aria-activedescendant + aria-selected during arrow navigation', async () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		const combobox = screen.getByRole('combobox');
		// Initially the first option is active/selected
		expect(combobox.getAttribute('aria-activedescendant')).toBe('cmd-opt-0');
		expect(screen.getByRole('option', { name: /Go to Library/i })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		// Arrow down moves the active descendant to the 2nd option
		await fireEvent.keyDown(window, { key: 'ArrowDown' });
		expect(combobox.getAttribute('aria-activedescendant')).toBe('cmd-opt-1');
		expect(screen.getByRole('option', { name: /Go to Templates/i })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		expect(screen.getByRole('option', { name: /Go to Library/i })).toHaveAttribute(
			'aria-selected',
			'false'
		);
	});

	it('traps Tab inside the dialog (prevents focus leaving the palette)', async () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		const combobox = screen.getByRole('combobox');
		combobox.focus();
		expect(document.activeElement).toBe(combobox);
		// Tab must be intercepted (preventDefault) so focus cannot escape the modal
		const tabEvent = createEvent.keyDown(window, { key: 'Tab' });
		const preventDefault = vi.spyOn(tabEvent, 'preventDefault');
		fireEvent(window, tabEvent);
		expect(preventDefault).toHaveBeenCalled();
		// Shift+Tab is trapped too
		const shiftTabEvent = createEvent.keyDown(window, { key: 'Tab', shiftKey: true });
		const preventDefaultShift = vi.spyOn(shiftTabEvent, 'preventDefault');
		fireEvent(window, shiftTabEvent);
		expect(preventDefaultShift).toHaveBeenCalled();
	});

	it('clicking an option runs it (mouse path on role=option)', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'settings' } });
		await fireEvent.click(screen.getByRole('option', { name: /Open Settings/i }));
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('settings');
		expect(onClose).toHaveBeenCalled();
	});

	it('includes cloud simfiles in search and Enter opens their detail', async () => {
		const onClose = vi.fn();
		simFileStore.setUserSimFiles([makeCloudSimFile({ id: 42, title: 'Cloud Anthem' })]);
		render(CommandPalette, { open: true, onClose });
		await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'cloud anthem' } });
		// The cloud result is tagged CLOUD and is the only match for this query.
		expect(screen.getByText('CLOUD')).toBeInTheDocument();
		await fireEvent.keyDown(window, { key: 'Enter' });
		const { get } = await import('svelte/store');
		expect(get(workspaceStore).activeSection).toBe('cloud');
		expect(get(workspaceStore).selectedCloudSimFile?.id).toBe(42);
		expect(get(workspaceStore).showCloudSongDetails).toBe(true);
		expect(onClose).toHaveBeenCalled();
	});

	it('shows "Export Selected Song" only when a song is selected and runs it', async () => {
		const onClose = vi.fn();
		render(CommandPalette, { open: true, onClose });
		// No selection yet → command absent.
		expect(screen.queryByText('Export Selected Song')).not.toBeInTheDocument();

		// Select a local song; the command appears.
		workspaceStore.selectSong({
			name: 'Pick',
			path: '/songs/pick',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false
		} as any);
		await new Promise((r) => setTimeout(r, 0)); // flush reactive update
		// The handler now awaits exportSelectedSong's result to surface it, so the
		// mock must resolve a structured ExportResult rather than undefined.
		vi.mocked(exportSelectedSong).mockResolvedValue({
			success: true,
			zipPath: '/out/pick.zip',
			filesCount: 1
		});
		const exportOption = screen.getByRole('option', { name: 'Export Selected Song' });
		await fireEvent.click(exportOption);
		expect(exportSelectedSong).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalled();
	});

	it('surfaces a success toast when export succeeds (instead of only console)', async () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		workspaceStore.selectSong({
			name: 'Pick',
			path: '/songs/pick',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false
		} as any);
		await new Promise((r) => setTimeout(r, 0)); // flush reactive update
		vi.mocked(exportSelectedSong).mockResolvedValue({
			success: true,
			zipPath: '/out/pick.zip',
			filesCount: 2
		});
		await fireEvent.click(screen.getByRole('option', { name: 'Export Selected Song' }));
		await vi.waitFor(() => {
			expect(get(toastStore).some((t) => t.kind === 'success')).toBe(true);
		});
	});

	it('surfaces an error toast when export fails', async () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		workspaceStore.selectSong({
			name: 'Pick',
			path: '/songs/pick',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false
		} as any);
		await new Promise((r) => setTimeout(r, 0));
		vi.mocked(exportSelectedSong).mockResolvedValue({ success: false, error: 'disk full' });
		await fireEvent.click(screen.getByRole('option', { name: 'Export Selected Song' }));
		await vi.waitFor(() => {
			expect(get(toastStore).some((t) => t.kind === 'error')).toBe(true);
		});
	});

	it('surfaces an error toast when export returns a no-op failure', async () => {
		render(CommandPalette, { open: true, onClose: vi.fn() });
		workspaceStore.selectSong({
			name: 'Pick',
			path: '/songs/pick',
			isExpanded: false,
			isLoading: false,
			children: [],
			hasChildren: false
		} as any);
		await new Promise((r) => setTimeout(r, 0));
		// The service returns a structured {success:false} no-op when nothing is
		// selected; the palette must not silently close with no feedback.
		vi.mocked(exportSelectedSong).mockResolvedValue({
			success: false,
			error: 'No song selected'
		});
		await fireEvent.click(screen.getByRole('option', { name: 'Export Selected Song' }));
		await vi.waitFor(() => {
			expect(get(toastStore).some((t) => t.kind === 'error')).toBe(true);
		});
	});
});
