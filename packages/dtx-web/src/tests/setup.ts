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

// Use the global mock for Phaser
// The moduleDirectories config in vitest.config.ts should make this work
vi.mock('phaser');

// Use global mock for svelte/store
vi.mock('svelte/store');

vi.mock('@dtx/common');
// Global mocks are now handled by the __mocks__ folder
// - @dtx/common is mocked in __mocks__/@dtx/common.ts
