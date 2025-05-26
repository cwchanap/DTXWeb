import '@testing-library/jest-dom';
import { vi } from 'vitest';

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

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
	length: 0,
	key: vi.fn()
};
Object.defineProperty(window, 'localStorage', {
	value: localStorageMock
});

// Mock window.electron for Electron IPC
Object.defineProperty(window, 'electron', {
	value: {
		ipcRenderer: {
			send: vi.fn(),
			on: vi.fn(),
			invoke: vi.fn()
		}
	}
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

// Use global mocks
vi.mock('svelte/store');
