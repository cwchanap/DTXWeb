import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { workspaceStore } from '../stores/workspaceStore';

vi.mock('@lucide/svelte');

const mockDesktopHost = vi.hoisted(() => ({
	pathExists: vi.fn(),
	createSong: vi.fn(),
	loadTreeStructure: vi.fn(),
	selectFolder: vi.fn()
}));

vi.mock('../services/desktopHost', () => ({
	desktopHost: mockDesktopHost
}));

import NewSong from './NewSong.svelte';

describe('NewSong', () => {
	beforeEach(() => {
		workspaceStore.reset();
		vi.clearAllMocks();
		mockDesktopHost.pathExists.mockResolvedValue({ exists: false, error: 'not-found' });
		mockDesktopHost.createSong.mockResolvedValue({ success: true });
		mockDesktopHost.loadTreeStructure.mockResolvedValue([]);
		mockDesktopHost.selectFolder.mockResolvedValue({ canceled: true, filePaths: [] });
	});

	afterEach(() => {
		cleanup();
	});

	describe('rendering', () => {
		it('renders the Create New Song heading', () => {
			render(NewSong);
			expect(screen.getByText('Create New Song')).toBeInTheDocument();
		});

		it('renders the song name input', () => {
			render(NewSong);
			expect(screen.getByLabelText(/Song Name/i)).toBeInTheDocument();
		});

		it('renders the Use same name checkbox', () => {
			render(NewSong);
			expect(screen.getByLabelText(/Use same name for folder/i)).toBeInTheDocument();
		});

		it('renders Create Song button', () => {
			render(NewSong);
			expect(screen.getByRole('button', { name: /Create Song/i })).toBeInTheDocument();
		});

		it('renders Cancel button', () => {
			render(NewSong);
			expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
		});

		it('renders Back button', () => {
			render(NewSong);
			expect(screen.getByRole('button', { name: /Back/i })).toBeInTheDocument();
		});

		it('renders Import Template button initially', () => {
			render(NewSong);
			expect(screen.getByText('Import Template')).toBeInTheDocument();
		});

		it('does not show folder name input when useSameNameForFolder is checked', () => {
			render(NewSong);
			expect(screen.queryByLabelText(/Folder Name/i)).not.toBeInTheDocument();
		});

		it('shows folder name input when Use same name checkbox is unchecked', async () => {
			render(NewSong);
			const checkbox = screen.getByLabelText(/Use same name for folder/i);
			await fireEvent.click(checkbox);
			expect(screen.getByLabelText(/Folder Name/i)).toBeInTheDocument();
		});

		it('shows full path when workspace path is set', async () => {
			workspaceStore.setPath('/test/workspace');
			render(NewSong);
			await waitFor(() => {
				expect(screen.getByText('Full path:')).toBeInTheDocument();
			});
		});
	});

	describe('navigation', () => {
		it('calls workspaceStore.closeNewSongForm when Back button is clicked', async () => {
			const closeSpy = vi.spyOn(workspaceStore, 'closeNewSongForm');
			render(NewSong);
			await fireEvent.click(screen.getByRole('button', { name: /Back/i }));
			expect(closeSpy).toHaveBeenCalled();
		});

		it('calls workspaceStore.closeNewSongForm when Cancel button is clicked', async () => {
			const closeSpy = vi.spyOn(workspaceStore, 'closeNewSongForm');
			render(NewSong);
			await fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe('form validation', () => {
		it('Create Song button is disabled when song name is empty (prevents empty submission)', async () => {
			workspaceStore.setPath('/test/workspace');
			render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			const createBtn = screen.getByRole('button', { name: /Create Song/i });
			expect(createBtn).toBeDisabled();
		});

		it('Create Song button is disabled when song name is empty', () => {
			render(NewSong);
			const createBtn = screen.getByRole('button', { name: /Create Song/i });
			expect(createBtn).toBeDisabled();
		});

		it('Create Song button is enabled when song name is filled and path is set', async () => {
			workspaceStore.setPath('/test/workspace');
			render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			const input = screen.getByLabelText(/Song Name/i);
			await fireEvent.input(input, { target: { value: 'My Song' } });
			const createBtn = screen.getByRole('button', { name: /Create Song/i });
			expect(createBtn).not.toBeDisabled();
		});
	});

	describe('song creation', () => {
		it('invokes path-exists check before creating', async () => {
			workspaceStore.setPath('/test/workspace');
			mockDesktopHost.pathExists.mockResolvedValue({
				exists: false,
				error: 'not-found'
			});
			render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			const input = screen.getByLabelText(/Song Name/i);
			await fireEvent.input(input, { target: { value: 'Test Song' } });
			const form = screen.getByRole('button', { name: /Create Song/i }).closest('form');
			await fireEvent.submit(form!);
			await waitFor(() => {
				expect(mockDesktopHost.pathExists).toHaveBeenCalledWith(
					'/test/workspace',
					'Test Song'
				);
			});
		});

		it('shows error when folder already exists', async () => {
			workspaceStore.setPath('/test/workspace');
			// First call for the debounced check, second for the create-song check
			mockDesktopHost.pathExists.mockResolvedValue({
				exists: true,
				error: null
			});
			render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			const input = screen.getByLabelText(/Song Name/i);
			await fireEvent.input(input, { target: { value: 'Existing Song' } });
			const form = screen.getByRole('button', { name: /Create Song/i }).closest('form');
			await fireEvent.submit(form!);
			await waitFor(() => {
				expect(
					screen.getByText(/A folder named.*already exists in the selected location/i)
				).toBeInTheDocument();
			});
		});

		it('creates song and closes form on success', async () => {
			const closeSpy = vi.spyOn(workspaceStore, 'closeNewSongForm');
			workspaceStore.setPath('/test/workspace');
			mockDesktopHost.pathExists.mockResolvedValue({ exists: false, error: 'not-found' });
			mockDesktopHost.createSong.mockResolvedValue({ success: true });
			mockDesktopHost.loadTreeStructure.mockResolvedValue([]);
			render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			const input = screen.getByLabelText(/Song Name/i);
			await fireEvent.input(input, { target: { value: 'New Song' } });
			const form = screen.getByRole('button', { name: /Create Song/i }).closest('form');
			await fireEvent.submit(form!);
			await waitFor(() => {
				expect(closeSpy).toHaveBeenCalled();
			});
		});

		it('shows error message when create-song throws', async () => {
			workspaceStore.setPath('/test/workspace');
			mockDesktopHost.pathExists.mockResolvedValue({ exists: false, error: 'not-found' });
			mockDesktopHost.createSong.mockRejectedValue(new Error('Disk full'));
			render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			const input = screen.getByLabelText(/Song Name/i);
			await fireEvent.input(input, { target: { value: 'New Song' } });
			const form = screen.getByRole('button', { name: /Create Song/i }).closest('form');
			await fireEvent.submit(form!);
			await waitFor(() => {
				expect(screen.getByText('Disk full')).toBeInTheDocument();
			});
		});
	});

	describe('folder selection', () => {
		it('calls desktopHost to select folder when Choose different folder button is clicked', async () => {
			mockDesktopHost.selectFolder.mockResolvedValue({ canceled: true, filePaths: [] });
			render(NewSong);
			const chooseFolderBtn = screen.getByRole('button', {
				name: /Choose different folder/i
			});
			await fireEvent.click(chooseFolderBtn);
			expect(mockDesktopHost.selectFolder).toHaveBeenCalled();
		});

		it('updates selected path when folder is selected', async () => {
			mockDesktopHost.selectFolder.mockResolvedValue({
				canceled: false,
				filePaths: ['/new/path']
			});
			render(NewSong);
			const chooseFolderBtn = screen.getByRole('button', {
				name: /Choose different folder/i
			});
			await fireEvent.click(chooseFolderBtn);
			await waitFor(() => {
				expect(screen.getByText(/\/new\/path/)).toBeInTheDocument();
			});
		});

		it('shows error message when selectFolder rejects', async () => {
			mockDesktopHost.selectFolder.mockRejectedValue(new Error('IPC error'));
			render(NewSong);
			const chooseFolderBtn = screen.getByRole('button', {
				name: /Choose different folder/i
			});
			await fireEvent.click(chooseFolderBtn);
			await waitFor(() => {
				expect(screen.getByText('Failed to select folder')).toBeInTheDocument();
			});
		});
	});

	describe('template selection', () => {
		it('shows template selection modal when Import Template button area is clicked', async () => {
			render(NewSong);
			// The button id="template" has label "Template (Optional)", find by text
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			expect(screen.getByText('Select Template')).toBeInTheDocument();
		});

		it('shows empty templates message when no templates exist', async () => {
			render(NewSong);
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			expect(screen.getByText(/No templates available/i)).toBeInTheDocument();
		});

		it('closes template modal when Cancel is clicked in template selection', async () => {
			render(NewSong);
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			expect(screen.getByText('Select Template')).toBeInTheDocument();
			const cancelBtns = screen.getAllByRole('button', { name: /Cancel/i });
			await fireEvent.click(cancelBtns[cancelBtns.length - 1]);
			expect(screen.queryByText('Select Template')).not.toBeInTheDocument();
		});

		it('selects a template and auto-populates empty song name', async () => {
			const { templateStore } = await import('../stores/templateStore');
			templateStore.reloadTemplates();
			templateStore.addTemplate('My Template', '/templates/my-template');
			render(NewSong);
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);

			await fireEvent.click(screen.getByText('My Template'));

			expect(
				screen.getByText('Template files will be copied to the new song folder')
			).toBeInTheDocument();
			const input = screen.getByLabelText(/Song Name/i) as HTMLInputElement;
			expect(input.value).toBe('My Template');
		});

		it('selects a template without overwriting an existing song name', async () => {
			const { templateStore } = await import('../stores/templateStore');
			templateStore.reloadTemplates();
			templateStore.addTemplate('My Template', '/templates/my-template');
			render(NewSong);
			const input = screen.getByLabelText(/Song Name/i);
			await fireEvent.input(input, { target: { value: 'Pre-existing Name' } });

			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			await fireEvent.click(screen.getByText('My Template'));

			expect((screen.getByLabelText(/Song Name/i) as HTMLInputElement).value).toBe(
				'Pre-existing Name'
			);
		});

		it('clears the selected template when the remove button is clicked', async () => {
			const { templateStore } = await import('../stores/templateStore');
			templateStore.reloadTemplates();
			templateStore.addTemplate('My Template', '/templates/my-template');
			render(NewSong);
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			await fireEvent.click(screen.getByText('My Template'));

			await fireEvent.click(screen.getByTitle('Remove template'));

			expect(screen.getByText('Import Template')).toBeInTheDocument();
		});
	});
});
