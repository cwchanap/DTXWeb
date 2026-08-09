export const _ = {
	subscribe: (cb: (fn: (key: string) => string) => void) => {
		cb((key: string) => key);
		return () => {};
	}
};

export const locale = {
	subscribe: (cb: (value: string) => void) => {
		cb('en');
		return () => {};
	}
};

// Callable no-op stubs so modules that import { init, register } from
// svelte-i18n (e.g. $lib/i18n/index.ts) do not crash on undefined exports
// when this manual mock replaces the real module in tests.
export const init = (_options?: Record<string, unknown>): void => {};
export const register = (_locale: string, _loader: () => unknown): void => {};
