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

	const add = (kind: ToastKind, message: string, timeoutMs = DEFAULT_TIMEOUT_MS) => {
		const id = nextId++;
		update((toasts) => [...toasts, { id, kind, message }]);
		if (timeoutMs > 0) {
			setTimeout(() => dismiss(id), timeoutMs);
		}
	};

	const dismiss = (id: number) => update((toasts) => toasts.filter((t) => t.id !== id));

	return {
		subscribe,
		error: (message, timeoutMs) => add('error', message, timeoutMs),
		success: (message, timeoutMs) => add('success', message, timeoutMs),
		dismiss,
		reset: () => set([])
	};
};

export const toastStore = createToastStore();
