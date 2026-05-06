import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';

describe('bookmarkStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetModules();
	});

	describe('hydration', () => {
		it('hydrates from valid JSON in localStorage', async () => {
			const stored = [
				{ path: '/a', name: 'A' },
				{ path: '/b', name: 'B' }
			];
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				JSON.stringify(stored)
			);

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual(stored);
		});

		it('initializes empty when localStorage has no entry', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual([]);
		});

		it('initializes empty when localStorage has malformed JSON', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('not-json');

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual([]);
		});

		it('initializes empty when localStorage has non-array JSON', async () => {
			(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
				'{"foo":"bar"}'
			);

			const { bookmarkStore: store } = await import('./bookmarkStore');
			expect(get(store)).toEqual([]);
		});
	});
});
