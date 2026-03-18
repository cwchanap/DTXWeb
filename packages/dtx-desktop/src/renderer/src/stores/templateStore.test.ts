import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { templateStore } from './templateStore';
import type { Template } from './templateStore';

describe('templateStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset to empty state by reloading from empty localStorage
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
		// Clear templates by manipulating the store through reloadTemplates
		templateStore.reloadTemplates();
	});

	it('should initialize with empty templates when localStorage is empty', () => {
		const state = get(templateStore);
		expect(state.templates).toEqual([]);
		expect(state.isLoading).toBe(false);
		expect(state.error).toBeNull();
	});

	describe('addTemplate', () => {
		it('should add a new template with auto-generated id', () => {
			templateStore.addTemplate('My Template', '/path/to/folder');

			const state = get(templateStore);
			expect(state.templates).toHaveLength(1);
			expect(state.templates[0].name).toBe('My Template');
			expect(state.templates[0].folderPath).toBe('/path/to/folder');
			expect(state.templates[0].id).toBeDefined();
			expect(state.templates[0].createdAt).toBeDefined();
		});

		it('should trim whitespace from template name', () => {
			templateStore.addTemplate('  Trimmed Name  ', '/path');

			const state = get(templateStore);
			expect(state.templates[0].name).toBe('Trimmed Name');
		});

		it('should persist to localStorage', () => {
			templateStore.addTemplate('Template 1', '/path/1');

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'song_templates',
				expect.stringContaining('Template 1')
			);
		});

		it('should clear error when adding template', () => {
			templateStore.setError('some error');
			templateStore.addTemplate('New Template', '/path');

			const state = get(templateStore);
			expect(state.error).toBeNull();
		});

		it('should add multiple templates', () => {
			templateStore.addTemplate('Template 1', '/path/1');
			templateStore.addTemplate('Template 2', '/path/2');

			const state = get(templateStore);
			expect(state.templates).toHaveLength(2);
		});

		it('should generate unique ids for each template', () => {
			templateStore.addTemplate('Template 1', '/path/1');
			templateStore.addTemplate('Template 2', '/path/2');

			const state = get(templateStore);
			const ids = state.templates.map((t) => t.id);
			expect(new Set(ids).size).toBe(2);
		});

		it('should set createdAt as ISO string', () => {
			templateStore.addTemplate('Template', '/path');

			const state = get(templateStore);
			const createdAt = state.templates[0].createdAt;
			expect(() => new Date(createdAt)).not.toThrow();
			expect(new Date(createdAt).toISOString()).toBe(createdAt);
		});
	});

	describe('removeTemplate', () => {
		it('should remove a template by id', () => {
			templateStore.addTemplate('Template 1', '/path/1');
			const { templates } = get(templateStore);
			const id = templates[0].id;

			templateStore.removeTemplate(id);

			const state = get(templateStore);
			expect(state.templates).toHaveLength(0);
		});

		it('should only remove the specified template', () => {
			templateStore.addTemplate('Template 1', '/path/1');
			templateStore.addTemplate('Template 2', '/path/2');

			const { templates } = get(templateStore);
			const id1 = templates[0].id;

			templateStore.removeTemplate(id1);

			const state = get(templateStore);
			expect(state.templates).toHaveLength(1);
			expect(state.templates[0].name).toBe('Template 2');
		});

		it('should persist removal to localStorage', () => {
			templateStore.addTemplate('Template 1', '/path/1');
			vi.clearAllMocks();

			const { templates } = get(templateStore);
			templateStore.removeTemplate(templates[0].id);

			expect(window.localStorage.setItem).toHaveBeenCalledWith('song_templates', '[]');
		});

		it('should not throw when removing non-existent id', () => {
			expect(() => templateStore.removeTemplate('non-existent-id')).not.toThrow();
		});
	});

	describe('updateTemplate', () => {
		it('should update template name', () => {
			templateStore.addTemplate('Old Name', '/path');
			const { templates } = get(templateStore);
			const id = templates[0].id;

			templateStore.updateTemplate(id, { name: 'New Name' });

			const state = get(templateStore);
			expect(state.templates[0].name).toBe('New Name');
		});

		it('should update template folderPath', () => {
			templateStore.addTemplate('Template', '/old/path');
			const { templates } = get(templateStore);
			const id = templates[0].id;

			templateStore.updateTemplate(id, { folderPath: '/new/path' });

			const state = get(templateStore);
			expect(state.templates[0].folderPath).toBe('/new/path');
		});

		it('should update multiple fields at once', () => {
			templateStore.addTemplate('Old', '/old');
			const { templates } = get(templateStore);
			const id = templates[0].id;

			templateStore.updateTemplate(id, { name: 'New', folderPath: '/new' });

			const state = get(templateStore);
			expect(state.templates[0].name).toBe('New');
			expect(state.templates[0].folderPath).toBe('/new');
		});

		it('should persist update to localStorage', () => {
			templateStore.addTemplate('Template', '/path');
			vi.clearAllMocks();

			const { templates } = get(templateStore);
			templateStore.updateTemplate(templates[0].id, { name: 'Updated' });

			expect(window.localStorage.setItem).toHaveBeenCalledWith(
				'song_templates',
				expect.stringContaining('Updated')
			);
		});

		it('should preserve id and createdAt when updating', () => {
			templateStore.addTemplate('Template', '/path');
			const { templates } = get(templateStore);
			const original = templates[0];

			templateStore.updateTemplate(original.id, { name: 'Updated' });

			const state = get(templateStore);
			expect(state.templates[0].id).toBe(original.id);
			expect(state.templates[0].createdAt).toBe(original.createdAt);
		});

		it('should not affect other templates', () => {
			templateStore.addTemplate('Template 1', '/path/1');
			templateStore.addTemplate('Template 2', '/path/2');
			const { templates } = get(templateStore);

			templateStore.updateTemplate(templates[0].id, { name: 'Updated 1' });

			const state = get(templateStore);
			expect(state.templates[1].name).toBe('Template 2');
		});
	});

	describe('setLoading', () => {
		it('should set loading to true', () => {
			templateStore.setLoading(true);
			expect(get(templateStore).isLoading).toBe(true);
		});

		it('should set loading to false', () => {
			templateStore.setLoading(true);
			templateStore.setLoading(false);
			expect(get(templateStore).isLoading).toBe(false);
		});
	});

	describe('setError', () => {
		it('should set error message', () => {
			templateStore.setError('Template error');
			expect(get(templateStore).error).toBe('Template error');
		});

		it('should clear error with null', () => {
			templateStore.setError('some error');
			templateStore.setError(null);
			expect(get(templateStore).error).toBeNull();
		});
	});

	describe('clearError', () => {
		it('should clear the error', () => {
			templateStore.setError('some error');
			templateStore.clearError();
			expect(get(templateStore).error).toBeNull();
		});
	});

	describe('reloadTemplates', () => {
		it('should load templates from localStorage', () => {
			const storedTemplates: Template[] = [
				{
					id: 'stored-id-1',
					name: 'Stored Template',
					folderPath: '/stored/path',
					createdAt: '2024-01-01T00:00:00.000Z'
				}
			];
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify(storedTemplates)
			);

			templateStore.reloadTemplates();

			const state = get(templateStore);
			expect(state.templates).toHaveLength(1);
			expect(state.templates[0].name).toBe('Stored Template');
		});

		it('should handle empty localStorage gracefully', () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			templateStore.reloadTemplates();

			const state = get(templateStore);
			expect(state.templates).toEqual([]);
		});

		it('should handle invalid JSON in localStorage gracefully', () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				'invalid-json{'
			);

			expect(() => templateStore.reloadTemplates()).not.toThrow();
			const state = get(templateStore);
			expect(state.templates).toEqual([]);
		});
	});
});
