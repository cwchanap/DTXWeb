import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { toastStore } from './toastStore';

describe('toastStore', () => {
	beforeEach(() => {
		toastStore.reset();
		vi.useRealTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts with no toasts', () => {
		expect(get(toastStore)).toEqual([]);
	});

	it('error() adds an error toast with a stable unique id', () => {
		toastStore.error('something broke');
		const toasts = get(toastStore);
		expect(toasts).toHaveLength(1);
		expect(toasts[0].kind).toBe('error');
		expect(toasts[0].message).toBe('something broke');
		expect(typeof toasts[0].id).toBe('number');
	});

	it('success() adds a success toast', () => {
		toastStore.success('all good');
		expect(get(toastStore)[0]).toMatchObject({ kind: 'success', message: 'all good' });
	});

	it('accumulates multiple toasts with distinct ids', () => {
		toastStore.error('a');
		toastStore.success('b');
		toastStore.error('c');
		const toasts = get(toastStore);
		expect(toasts).toHaveLength(3);
		const ids = toasts.map((t) => t.id);
		expect(new Set(ids).size).toBe(3);
	});

	it('dismiss(id) removes only the matching toast', () => {
		toastStore.error('keep');
		toastStore.error('remove');
		const [first, second] = get(toastStore);
		toastStore.dismiss(first.id);
		const remaining = get(toastStore);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe(second.id);
	});

	it('reset() clears all toasts', () => {
		toastStore.error('a');
		toastStore.success('b');
		toastStore.reset();
		expect(get(toastStore)).toEqual([]);
	});

	it('auto-dismisses an error toast after the timeout', () => {
		vi.useFakeTimers();
		toastStore.error('ephemeral', 5000);
		expect(get(toastStore)).toHaveLength(1);
		vi.advanceTimersByTime(4999);
		expect(get(toastStore)).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(get(toastStore)).toEqual([]);
	});

	it('dismiss is safe for an unknown id (no-op)', () => {
		toastStore.error('a');
		toastStore.dismiss(999999);
		expect(get(toastStore)).toHaveLength(1);
	});
});
