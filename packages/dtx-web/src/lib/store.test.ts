import { describe, it, expect, vi } from 'vitest';

vi.mock('@dtx/common', () => ({
	store: {
		activeScene: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		currentDtxFile: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		currentSimfile: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		currentSoundChip: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		playingAudio: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		isPreviewing: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		playSpeed: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		measureCount: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		editorNotes: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		activeNote: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		currentSimfileID: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		currentDifficulty: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		keyBindings: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		disableBgmPreview: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		}
	}
}));

describe('Store', () => {
	it('should re-export store from common package', async () => {
		const { default: store } = await import('./store');

		expect(store).toBeDefined();
		expect(store.activeScene).toBeDefined();
		expect(typeof store.activeScene.subscribe).toBe('function');
		expect(typeof store.activeScene.set).toBe('function');
		expect(typeof store.activeScene.update).toBe('function');
	});

	it('should maintain store interface methods', async () => {
		const { default: store } = await import('./store');

		// Test that individual stores have the expected Svelte store interface
		const storeKeys = ['activeScene', 'currentDtxFile', 'currentSimfile'];
		const methods = ['subscribe', 'set', 'update'];

		storeKeys.forEach((key) => {
			expect(store).toHaveProperty(key);
			methods.forEach((method) => {
				expect(store[key as keyof typeof store]).toHaveProperty(method);
			});
		});
	});
});
