import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}))
});

// Mock localStorage with an in-memory backing store so values written
// through setItem remain observable from getItem within the same test.
const localStorageStore = new Map<string, string>();
const localStorageMock = {
	getItem: vi.fn((key: string) => localStorageStore.get(key) ?? null),
	setItem: vi.fn((key: string, value: string) => {
		localStorageStore.set(key, String(value));
	}),
	removeItem: vi.fn((key: string) => {
		localStorageStore.delete(key);
	}),
	clear: vi.fn(() => {
		localStorageStore.clear();
	}),
	length: 0,
	key: vi.fn()
};
Object.defineProperty(window, 'localStorage', {
	configurable: true,
	writable: true,
	value: localStorageMock
});

// Mock console methods to avoid noise in tests
global.console = {
	...console,
	error: vi.fn(),
	warn: vi.fn(),
	log: vi.fn()
};

// Mock atob for base64 decoding
global.atob = vi.fn();

// Mock ResizeObserver (not implemented in jsdom)
global.ResizeObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn()
}));

// Reset the stateful localStorage backing store between tests so seeded
// values from one test do not leak into another.
afterEach(() => {
	window.localStorage.clear();
});
