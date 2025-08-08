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
		expect(typeof store.subscribe).toBe('function');
		expect(typeof store.set).toBe('function');
		expect(typeof store.update).toBe('function');
	});

	it('should maintain store interface methods', async () => {
		const { default: store } = await import('./store');

		// Test that the store has the expected Svelte store interface
		const methods = ['subscribe', 'set', 'update'];
		methods.forEach((method) => {
			expect(store).toHaveProperty(method);
		});
	});
});
