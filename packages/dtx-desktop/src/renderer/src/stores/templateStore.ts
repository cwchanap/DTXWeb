import { writable } from 'svelte/store';

export interface Template {
	id: string;
	name: string;
	folderPath: string;
	createdAt: string;
}

interface TemplateState {
	templates: Template[];
	isLoading: boolean;
	error: string | null;
}

const TEMPLATES_STORAGE_KEY = 'song_templates';

const initialState: TemplateState = {
	templates: [],
	isLoading: false,
	error: null
};

function createTemplateStore() {
	// Load templates from localStorage
	const loadTemplatesFromStorage = (): Template[] => {
		try {
			const stored = localStorage.getItem(TEMPLATES_STORAGE_KEY);
			return stored ? JSON.parse(stored) : [];
		} catch (error) {
			console.error('Error loading templates from localStorage:', error);
			return [];
		}
	};

	// Save templates to localStorage
	const saveTemplatesToStorage = (templates: Template[]): void => {
		try {
			localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
		} catch (error) {
			console.error('Error saving templates to localStorage:', error);
		}
	};

	const initializedState: TemplateState = {
		...initialState,
		templates: loadTemplatesFromStorage()
	};

	const { subscribe, update } = writable<TemplateState>(initializedState);

	return {
		subscribe,
		addTemplate: (name: string, folderPath: string) => {
			update((state) => {
				const newTemplate: Template = {
					id: crypto.randomUUID(),
					name: name.trim(),
					folderPath,
					createdAt: new Date().toISOString()
				};

				const updatedTemplates = [...state.templates, newTemplate];
				saveTemplatesToStorage(updatedTemplates);

				return {
					...state,
					templates: updatedTemplates,
					error: null
				};
			});
		},
		removeTemplate: (id: string) => {
			update((state) => {
				const updatedTemplates = state.templates.filter((t) => t.id !== id);
				saveTemplatesToStorage(updatedTemplates);

				return {
					...state,
					templates: updatedTemplates
				};
			});
		},
		updateTemplate: (id: string, updates: Partial<Omit<Template, 'id'>>) => {
			update((state) => {
				const updatedTemplates = state.templates.map((template) =>
					template.id === id ? { ...template, ...updates } : template
				);
				saveTemplatesToStorage(updatedTemplates);

				return {
					...state,
					templates: updatedTemplates
				};
			});
		},
		setLoading: (isLoading: boolean) => {
			update((state) => ({ ...state, isLoading }));
		},
		setError: (error: string | null) => {
			update((state) => ({ ...state, error }));
		},
		clearError: () => {
			update((state) => ({ ...state, error: null }));
		},
		reloadTemplates: () => {
			update((state) => ({
				...state,
				templates: loadTemplatesFromStorage()
			}));
		}
	};
}

export const templateStore = createTemplateStore();
