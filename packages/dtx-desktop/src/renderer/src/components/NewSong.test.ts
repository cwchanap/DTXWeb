import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { workspaceStore } from '../stores/workspaceStore';
import { workspaceService } from '../services/workspaceService';

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

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve };
};

const treeNode = (name: string, path: string) => ({
	name,
	path,
	isExpanded: false,
	isLoading: false,
	children: [],
	hasChildren: false
});

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

		it('does not let an old-root post-create refresh overwrite a switched workspace', async () => {
			const oldTree = [treeNode('Old song', '/workspace/a/old')];
			const newTree = [treeNode('New root song', '/workspace/b/new')];
			const refresh = createDeferred<typeof oldTree>();
			const refreshSpy = vi.spyOn(workspaceService, 'loadTreeStructure');
			workspaceStore.setPath('/workspace/a');
			mockDesktopHost.loadTreeStructure.mockReturnValue(refresh.promise);
			render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			await fireEvent.input(screen.getByLabelText(/Song Name/i), {
				target: { value: 'Created Song' }
			});
			const form = screen.getByRole('button', { name: /Create Song/i }).closest('form');

			await fireEvent.submit(form!);
			await waitFor(() => {
				expect(refreshSpy).toHaveBeenCalledOnce();
				expect(mockDesktopHost.loadTreeStructure).toHaveBeenCalledWith('/workspace/a');
			});

			workspaceStore.setPath('/workspace/b');
			workspaceStore.setTreeStructure(newTree);
			refresh.resolve(oldTree);
			await refreshSpy.mock.results[0].value;

			expect(get(workspaceStore).path).toBe('/workspace/b');
			expect(get(workspaceStore).treeStructure).toEqual(newTree);
		});

		it('does not let an unmounted post-create refresh overwrite replacement tree state', async () => {
			const staleTree = [treeNode('Stale song', '/workspace/a/stale')];
			const replacementTree = [treeNode('Replacement song', '/workspace/a/replacement')];
			const refresh = createDeferred<typeof staleTree>();
			const refreshSpy = vi.spyOn(workspaceService, 'loadTreeStructure');
			workspaceStore.setPath('/workspace/a');
			mockDesktopHost.loadTreeStructure.mockReturnValue(refresh.promise);
			const view = render(NewSong);
			await waitFor(() => screen.getByText('Full path:'));
			await fireEvent.input(screen.getByLabelText(/Song Name/i), {
				target: { value: 'Created Song' }
			});
			const form = screen.getByRole('button', { name: /Create Song/i }).closest('form');

			await fireEvent.submit(form!);
			await waitFor(() => {
				expect(refreshSpy).toHaveBeenCalledOnce();
				expect(mockDesktopHost.loadTreeStructure).toHaveBeenCalledWith('/workspace/a');
			});

			view.unmount();
			workspaceStore.setTreeStructure(replacementTree);
			refresh.resolve(staleTree);
			await refreshSpy.mock.results[0].value;

			expect(get(workspaceStore).treeStructure).toEqual(replacementTree);
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

		it('exposes a labelled dialog when the template modal opens', async () => {
			render(NewSong);
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			const dialog = screen.getByRole('dialog');
			expect(dialog).toHaveAttribute('aria-modal', 'true');
			expect(dialog).toHaveAttribute('aria-labelledby', 'template-modal-title');
		});

		it('closes the template modal on Escape', async () => {
			render(NewSong);
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			expect(screen.getByText('Select Template')).toBeInTheDocument();
			await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
			expect(screen.queryByText('Select Template')).not.toBeInTheDocument();
		});

		it('closes the template modal when the backdrop is clicked', async () => {
			render(NewSong);
			const importBtn = screen.getByText('Import Template').closest('button');
			await fireEvent.click(importBtn!);
			expect(screen.getByText('Select Template')).toBeInTheDocument();
			// role="dialog" lives on the backdrop; clicking it directly (target === currentTarget)
			// dismisses, while clicks inside the panel do not.
			await fireEvent.click(screen.getByRole('dialog'));
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
