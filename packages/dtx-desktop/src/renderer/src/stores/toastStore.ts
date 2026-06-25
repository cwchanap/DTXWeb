import { writable } from 'svelte/store';

export type ToastKind = 'error' | 'success';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
}

export interface ToastStore {
	subscribe: ReturnType<typeof writable<Toast[]>>['subscribe'];
	error: (message: string, timeoutMs?: number) => void;
	success: (message: string, timeoutMs?: number) => void;
	dismiss: (id: number) => void;
	reset: () => void;
}

const DEFAULT_TIMEOUT_MS = 6000;

const createToastStore = (): ToastStore => {
	const { subscribe, update, set } = writable<Toast[]>([]);
	let nextId = 1;
	// Track pending auto-dismiss timers so reset() and dismiss() can cancel
	// them. Without this, a stale timer firing after reset() is a no-op today
	// (id mismatch), but leaks across test files that mix real/fake timers and
	// creates flaky-test risk.
	const timers = new Map<number, ReturnType<typeof setTimeout>>();

	const add = (kind: ToastKind, message: string, timeoutMs = DEFAULT_TIMEOUT_MS) => {
		const id = nextId++;
		update((toasts) => [...toasts, { id, kind, message }]);
		if (timeoutMs > 0) {
			timers.set(
				id,
				setTimeout(() => dismiss(id), timeoutMs)
			);
		}
	};

	const dismiss = (id: number) => {
		const t = timers.get(id);
		if (t) {
			clearTimeout(t);
			timers.delete(id);
		}
		update((toasts) => toasts.filter((t) => t.id !== id));
	};

	return {
		subscribe,
		error: (message, timeoutMs) => add('error', message, timeoutMs),
		success: (message, timeoutMs) => add('success', message, timeoutMs),
		dismiss,
		reset: () => {
			for (const t of timers.values()) clearTimeout(t);
			timers.clear();
			set([]);
		}
	};
};

export const toastStore = createToastStore();
