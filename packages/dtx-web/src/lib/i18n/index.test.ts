import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser environment first
Object.defineProperty(global, 'window', {
	value: { navigator: { language: 'en-US' } },
	writable: true
});

// Mock svelte-i18n
const mockInit = vi.fn();
const mockRegister = vi.fn();

vi.mock('svelte-i18n', () => ({
	init: mockInit,
	register: mockRegister
}));

// Mock $app/environment
vi.mock('$app/environment', () => ({
	browser: true
}));

describe('i18n', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Re-import the module to trigger initialization
		vi.resetModules();
	});

	it('should register locale files', async () => {
		await import('./index');

		expect(mockRegister).toHaveBeenCalledTimes(2);
		expect(mockRegister).toHaveBeenCalledWith('en', expect.any(Function));
		expect(mockRegister).toHaveBeenCalledWith('jp', expect.any(Function));
	});

	it('should initialize with browser language when in browser', async () => {
		await import('./index');

		expect(mockInit).toHaveBeenCalledWith({
			fallbackLocale: 'en',
			initialLocale: 'en-US'
		});
	});

	it('should initialize with default locale when not in browser', async () => {
		vi.doMock('$app/environment', () => ({
			browser: false
		}));

		await import('./index');

		expect(mockInit).toHaveBeenCalledWith({
			fallbackLocale: 'en',
			initialLocale: 'en'
		});
	});
});
