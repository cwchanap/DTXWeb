import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Mock localStorage before importing the store
const localStorageMock = {
	getItem: vi.fn().mockReturnValue(null),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

Object.defineProperty(window, 'localStorage', {
	value: localStorageMock,
	writable: true,
	configurable: true
});

// Import store after localStorage mock is set up
const { editorMappingStore } = await import('./editorMappingStore');

describe('editorMappingStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorageMock.getItem.mockReturnValue(null);
		editorMappingStore.clearMappings();
	});

	it('should initialize with empty state when localStorage is empty', () => {
		const state = get(editorMappingStore);
		expect(state.simFileIdToFolderPath).toEqual({});
		expect(state.simFileIdToMetadata).toEqual({});
	});

	describe('setMapping', () => {
		it('should add a new mapping', () => {
			editorMappingStore.setMapping('sim-1', '/path/to/folder');

			const state = get(editorMappingStore);
			expect(state.simFileIdToFolderPath['sim-1']).toBe('/path/to/folder');
		});

		it('should persist to localStorage', () => {
			editorMappingStore.setMapping('sim-1', '/path/to/folder');

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'editor_mapping_cache',
				expect.stringContaining('sim-1')
			);
		});

		it('should update an existing mapping', () => {
			editorMappingStore.setMapping('sim-1', '/old/path');
			editorMappingStore.setMapping('sim-1', '/new/path');

			const state = get(editorMappingStore);
			expect(state.simFileIdToFolderPath['sim-1']).toBe('/new/path');
		});

		it('should handle multiple mappings', () => {
			editorMappingStore.setMapping('sim-1', '/path/1');
			editorMappingStore.setMapping('sim-2', '/path/2');

			const state = get(editorMappingStore);
			expect(state.simFileIdToFolderPath['sim-1']).toBe('/path/1');
			expect(state.simFileIdToFolderPath['sim-2']).toBe('/path/2');
		});
	});

	describe('setMappingWithMetadata', () => {
		it('should add mapping with metadata', () => {
			editorMappingStore.setMappingWithMetadata('sim-1', '/path/to/folder', 'My Song');

			const state = get(editorMappingStore);
			expect(state.simFileIdToFolderPath['sim-1']).toBe('/path/to/folder');
			expect(state.simFileIdToMetadata['sim-1']).toEqual({
				folderPath: '/path/to/folder',
				songName: 'My Song'
			});
		});

		it('should persist metadata to localStorage', () => {
			editorMappingStore.setMappingWithMetadata('sim-1', '/path/to/folder', 'My Song');

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'editor_mapping_cache',
				expect.stringContaining('My Song')
			);
		});

		it('should update existing metadata', () => {
			editorMappingStore.setMappingWithMetadata('sim-1', '/old/path', 'Old Song');
			editorMappingStore.setMappingWithMetadata('sim-1', '/new/path', 'New Song');

			const state = get(editorMappingStore);
			expect(state.simFileIdToMetadata['sim-1']).toEqual({
				folderPath: '/new/path',
				songName: 'New Song'
			});
		});
	});

	describe('getFolderPath', () => {
		it('should return folder path from metadata when available', () => {
			editorMappingStore.setMappingWithMetadata('sim-1', '/metadata/path', 'Song');

			const path = editorMappingStore.getFolderPath('sim-1');
			expect(path).toBe('/metadata/path');
		});

		it('should fall back to simFileIdToFolderPath when no metadata', () => {
			editorMappingStore.setMapping('sim-2', '/fallback/path');

			const path = editorMappingStore.getFolderPath('sim-2');
			expect(path).toBe('/fallback/path');
		});

		it('should return undefined for unknown simFileId', () => {
			const path = editorMappingStore.getFolderPath('unknown-id');
			expect(path).toBeUndefined();
		});

		it('should prefer metadata folderPath over simFileIdToFolderPath when both exist', () => {
			editorMappingStore.setMapping('sim-1', '/old/path');
			editorMappingStore.setMappingWithMetadata('sim-1', '/metadata/path', 'Song');

			const path = editorMappingStore.getFolderPath('sim-1');
			expect(path).toBe('/metadata/path');
		});
	});

	describe('getSongMetadata', () => {
		it('should return song metadata for known simFileId', () => {
			editorMappingStore.setMappingWithMetadata('sim-1', '/path', 'Test Song');

			const metadata = editorMappingStore.getSongMetadata('sim-1');
			expect(metadata).toEqual({ folderPath: '/path', songName: 'Test Song' });
		});

		it('should return undefined for unknown simFileId', () => {
			const metadata = editorMappingStore.getSongMetadata('unknown');
			expect(metadata).toBeUndefined();
		});

		it('should return undefined when only setMapping was used (no metadata)', () => {
			editorMappingStore.setMapping('sim-1', '/path');

			const metadata = editorMappingStore.getSongMetadata('sim-1');
			expect(metadata).toBeUndefined();
		});
	});

	describe('removeMapping', () => {
		it('should remove a mapping from both stores', () => {
			editorMappingStore.setMappingWithMetadata('sim-1', '/path', 'Song');
			editorMappingStore.removeMapping('sim-1');

			const state = get(editorMappingStore);
			expect(state.simFileIdToFolderPath['sim-1']).toBeUndefined();
			expect(state.simFileIdToMetadata['sim-1']).toBeUndefined();
		});

		it('should persist removal to localStorage', () => {
			editorMappingStore.setMapping('sim-1', '/path');
			vi.clearAllMocks();
			editorMappingStore.removeMapping('sim-1');

			expect(localStorageMock.setItem).toHaveBeenCalled();
		});

		it('should not affect other mappings when removing one', () => {
			editorMappingStore.setMapping('sim-1', '/path/1');
			editorMappingStore.setMapping('sim-2', '/path/2');
			editorMappingStore.removeMapping('sim-1');

			const state = get(editorMappingStore);
			expect(state.simFileIdToFolderPath['sim-1']).toBeUndefined();
			expect(state.simFileIdToFolderPath['sim-2']).toBe('/path/2');
		});

		it('should handle removing a non-existent mapping gracefully', () => {
			expect(() => editorMappingStore.removeMapping('non-existent')).not.toThrow();
		});
	});

	describe('clearMappings', () => {
		it('should clear all mappings', () => {
			editorMappingStore.setMappingWithMetadata('sim-1', '/path/1', 'Song 1');
			editorMappingStore.setMappingWithMetadata('sim-2', '/path/2', 'Song 2');
			editorMappingStore.clearMappings();

			const state = get(editorMappingStore);
			expect(state.simFileIdToFolderPath).toEqual({});
			expect(state.simFileIdToMetadata).toEqual({});
		});

		it('should persist cleared state to localStorage', () => {
			editorMappingStore.clearMappings();

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'editor_mapping_cache',
				JSON.stringify({ simFileIdToFolderPath: {}, simFileIdToMetadata: {} })
			);
		});
	});

	describe('localStorage persistence', () => {
		it('should save state to localStorage after each operation', () => {
			vi.clearAllMocks();
			editorMappingStore.setMapping('sim-1', '/path/1');
			editorMappingStore.setMapping('sim-2', '/path/2');

			// Verify each operation persisted
			expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
			const lastCall = localStorageMock.setItem.mock.calls.at(-1);
			expect(lastCall?.[0]).toBe('editor_mapping_cache');
			const saved = JSON.parse(lastCall?.[1]);
			expect(saved.simFileIdToFolderPath['sim-2']).toBe('/path/2');
		});

		it('should not throw when localStorage.setItem fails', () => {
			localStorageMock.setItem.mockImplementation(() => {
				throw new Error('localStorage full');
			});

			expect(() => editorMappingStore.setMapping('sim-1', '/path')).not.toThrow();
		});
	});
});
