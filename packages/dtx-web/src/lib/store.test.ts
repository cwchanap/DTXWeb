import { describe, it, expect, vi } from 'vitest';

vi.mock('@dtx/common', () => ({
	store: {
		subscribe: vi.fn(),
		set: vi.fn(),
		update: vi.fn()
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
