import { describe, it, expect, vi } from 'vitest';

vi.mock('@skeletonlabs/skeleton-svelte', () => ({
	createToaster: vi.fn(() => ({
		trigger: vi.fn(),
		close: vi.fn(),
		closeAll: vi.fn()
	}))
}));

import toastStore from './toaster';

describe('toaster', () => {
	it('exports a toast store', () => {
		expect(toastStore).toBeDefined();
	});

	it('toast store has expected shape from createToaster', () => {
		expect(typeof toastStore).toBe('object');
	});
});
