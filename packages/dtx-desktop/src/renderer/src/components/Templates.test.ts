import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { Template } from '../stores/templateStore';

vi.mock('@lucide/svelte');

type TemplateState = { templates: Template[]; isLoading: boolean; error: string | null };

// Mock templateStore with full control
const mockSubscribers: Array<(state: TemplateState) => void> = [];
let mockTemplateState: TemplateState = {
	templates: [],
	isLoading: false,
	error: null
};

vi.mock('../stores/templateStore', () => ({
	templateStore: {
		subscribe: vi.fn((callback) => {
			mockSubscribers.push(callback);
			callback(mockTemplateState);
			return () => {
				const idx = mockSubscribers.indexOf(callback);
				if (idx > -1) mockSubscribers.splice(idx, 1);
			};
		}),
		addTemplate: vi.fn(),
		removeTemplate: vi.fn(),
		updateTemplate: vi.fn(),
		setError: vi.fn((error: string | null) => {
			mockTemplateState = { ...mockTemplateState, error };
			mockSubscribers.forEach((cb) => cb(mockTemplateState));
		}),
		clearError: vi.fn(() => {
			mockTemplateState = { ...mockTemplateState, error: null };
			mockSubscribers.forEach((cb) => cb(mockTemplateState));
		})
	}
}));

import Templates from './Templates.svelte';
import { templateStore } from '../stores/templateStore';

const makeTemplate = (overrides: Partial<Template> = {}): Template => ({
	id: 'template-1',
	name: 'My Template',
	folderPath: '/templates/my-template',
	createdAt: new Date('2024-01-01').toISOString(),
	...overrides
});

const setTemplates = (templates: Template[]): void => {
	mockTemplateState = { ...mockTemplateState, templates };
	mockSubscribers.forEach((cb) => cb(mockTemplateState));
};

describe('Templates', () => {
	beforeEach(() => {
		mockTemplateState = { templates: [], isLoading: false, error: null };
		vi.clearAllMocks();
		// Re-mock setError and clearError since clearAllMocks resets implementations
		vi.mocked(templateStore.setError).mockImplementation((error: string | null) => {
			mockTemplateState = { ...mockTemplateState, error };
			mockSubscribers.forEach((cb) => cb(mockTemplateState));
		});
		vi.mocked(templateStore.clearError).mockImplementation(() => {
			mockTemplateState = { ...mockTemplateState, error: null };
			mockSubscribers.forEach((cb) => cb(mockTemplateState));
		});
	});

	afterEach(() => {
		cleanup();
		mockSubscribers.length = 0;
	});

	describe('rendering', () => {
		it('renders Song Templates heading', () => {
			render(Templates);
			expect(screen.getByText('Song Templates')).toBeInTheDocument();
		});

		it('renders New Template button', () => {
			render(Templates);
			expect(
				screen.getByRole('button', { name: /Create new template/i })
			).toBeInTheDocument();
		});

		it('shows empty state when no templates exist', () => {
			render(Templates);
			expect(screen.getByText(/No templates found/i)).toBeInTheDocument();
		});

		it('shows Create First Template button in empty state', () => {
			render(Templates);
			expect(
				screen.getByRole('button', { name: /Create your first template/i })
			).toBeInTheDocument();
		});

		it('shows loading state when isLoading is true', async () => {
			mockTemplateState = { templates: [], isLoading: true, error: null };
			render(Templates);
			await waitFor(() => {
				expect(screen.getByText('Loading templates...')).toBeInTheDocument();
			});
		});

		it('shows error message when error is set', async () => {
			mockTemplateState = { templates: [], isLoading: false, error: 'Something went wrong' };
			render(Templates);
			await waitFor(() => {
				expect(screen.getByText('Something went wrong')).toBeInTheDocument();
			});
		});
	});

	describe('with templates', () => {
		it('renders template names', () => {
			setTemplates([
				makeTemplate({ id: '1', name: 'Template Alpha' }),
				makeTemplate({ id: '2', name: 'Template Beta' })
			]);
			render(Templates);
			expect(screen.getByText('Template Alpha')).toBeInTheDocument();
			expect(screen.getByText('Template Beta')).toBeInTheDocument();
		});

		it('renders template folder path', () => {
			setTemplates([makeTemplate({ folderPath: '/my/template/path' })]);
			render(Templates);
			expect(screen.getByText('/my/template/path')).toBeInTheDocument();
		});

		it('does not show empty state when templates exist', () => {
			setTemplates([makeTemplate()]);
			render(Templates);
			expect(screen.queryByText(/No templates found/i)).not.toBeInTheDocument();
		});
	});

	describe('create template form', () => {
		it('shows create form when New Template button is clicked', async () => {
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			expect(screen.getByText('Create New Template')).toBeInTheDocument();
		});

		it('shows Template Name input in create form', async () => {
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			expect(screen.getByLabelText(/Template Name/i)).toBeInTheDocument();
		});

		it('shows Browse button in create form', async () => {
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			expect(screen.getByRole('button', { name: /Browse/i })).toBeInTheDocument();
		});

		it('shows Save Template button in create form', async () => {
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			expect(screen.getByRole('button', { name: /Save Template/i })).toBeInTheDocument();
		});

		it('hides form when Cancel is clicked in create form', async () => {
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			expect(screen.getByText('Create New Template')).toBeInTheDocument();
			const cancelBtns = screen.getAllByRole('button', { name: /Cancel/i });
			await fireEvent.click(cancelBtns[0]);
			expect(screen.queryByText('Create New Template')).not.toBeInTheDocument();
		});

		it('shows error when saving template with empty name', async () => {
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			await fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));
			expect(templateStore.setError).toHaveBeenCalledWith('Please enter a template name');
		});

		it('shows error when saving template with no folder selected', async () => {
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			const nameInput = screen.getByLabelText(/Template Name/i);
			await fireEvent.input(nameInput, { target: { value: 'My New Template' } });
			await fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));
			expect(templateStore.setError).toHaveBeenCalledWith('Please select a template folder');
		});

		it('calls ipcRenderer to select folder when Browse is clicked', async () => {
			vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({ canceled: true });
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			await fireEvent.click(screen.getByRole('button', { name: /Browse/i }));
			expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('select-folder');
		});

		it('updates folder path when folder is selected via Browse', async () => {
			vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
				canceled: false,
				filePaths: ['/selected/template/folder']
			});
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			await fireEvent.click(screen.getByRole('button', { name: /Browse/i }));
			await waitFor(() => {
				expect(screen.getByDisplayValue('/selected/template/folder')).toBeInTheDocument();
			});
		});

		it('calls templateStore.addTemplate on successful save', async () => {
			vi.mocked(window.electron.ipcRenderer.invoke).mockImplementation((channel) => {
				if (channel === 'select-folder') {
					return Promise.resolve({ canceled: false, filePaths: ['/template/path'] });
				}
				if (channel === 'path-exists') return Promise.resolve(true);
				return Promise.resolve(undefined);
			});
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			const nameInput = screen.getByLabelText(/Template Name/i);
			await fireEvent.input(nameInput, { target: { value: 'New Template' } });
			await fireEvent.click(screen.getByRole('button', { name: /Browse/i }));
			await waitFor(() => screen.getByDisplayValue('/template/path'));
			await fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));
			await waitFor(() => {
				expect(templateStore.addTemplate).toHaveBeenCalledWith(
					'New Template',
					'/template/path'
				);
			});
		});

		it('shows duplicate name error when template name already exists', async () => {
			setTemplates([makeTemplate({ id: '1', name: 'Existing Template' })]);
			vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue({
				canceled: false,
				filePaths: ['/template/path']
			});
			render(Templates);
			await fireEvent.click(screen.getByRole('button', { name: /Create new template/i }));
			const nameInput = screen.getByLabelText(/Template Name/i);
			await fireEvent.input(nameInput, { target: { value: 'Existing Template' } });
			await fireEvent.click(screen.getByRole('button', { name: /Browse/i }));
			await waitFor(() => screen.getByDisplayValue('/template/path'));
			await fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));
			await waitFor(() => {
				expect(templateStore.setError).toHaveBeenCalledWith(
					'A template with this name already exists'
				);
			});
		});
	});

	describe('template actions', () => {
		it('calls open-folder-in-explorer when open folder button is clicked', async () => {
			setTemplates([makeTemplate({ folderPath: '/my/folder' })]);
			vi.mocked(window.electron.ipcRenderer.invoke).mockResolvedValue(undefined);
			render(Templates);
			const buttons = screen.getAllByRole('button');
			const openBtn = buttons.find((b) => b.title === 'Open folder');
			await fireEvent.click(openBtn!);
			expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith(
				'open-folder-in-explorer',
				'/my/folder'
			);
		});

		it('enters edit mode when edit button is clicked', async () => {
			setTemplates([makeTemplate({ name: 'My Template' })]);
			render(Templates);
			const buttons = screen.getAllByRole('button');
			const editButton = buttons.find((b) => b.title === 'Edit template');
			await fireEvent.click(editButton!);
			expect(screen.getByDisplayValue('My Template')).toBeInTheDocument();
		});

		it('calls removeTemplate when delete is confirmed', async () => {
			setTemplates([makeTemplate({ id: 'del-1', name: 'To Delete' })]);
			vi.spyOn(window, 'confirm').mockReturnValue(true);
			render(Templates);
			const buttons = screen.getAllByRole('button');
			const deleteBtn = buttons.find((b) => b.title === 'Delete template');
			await fireEvent.click(deleteBtn!);
			expect(templateStore.removeTemplate).toHaveBeenCalledWith('del-1');
		});

		it('does not call removeTemplate when delete is cancelled', async () => {
			setTemplates([makeTemplate({ id: 'del-1', name: 'To Delete' })]);
			vi.spyOn(window, 'confirm').mockReturnValue(false);
			render(Templates);
			const buttons = screen.getAllByRole('button');
			const deleteBtn = buttons.find((b) => b.title === 'Delete template');
			await fireEvent.click(deleteBtn!);
			expect(templateStore.removeTemplate).not.toHaveBeenCalled();
		});
	});
});
