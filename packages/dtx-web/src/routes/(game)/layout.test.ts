import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockInit = vi.fn().mockResolvedValue(undefined);

vi.mock('xa_decoder', () => ({
	default: mockInit
}));

describe('(game)/+layout load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete (globalThis as Record<string, unknown>).__xaDecoderReady;
		delete (globalThis as Record<string, unknown>).__xaDecoderError;
	});

	afterEach(() => {
		vi.resetModules();
	});

	it('sets __xaDecoderReady to false initially then true on success', async () => {
		mockInit.mockResolvedValueOnce(undefined);

		const { load } = await import('./+layout');
		await load();

		// Initially set to false synchronously
		expect((globalThis as Record<string, unknown>).__xaDecoderReady).toBe(false);
		expect((globalThis as Record<string, unknown>).__xaDecoderError).toBeUndefined();

		// Flush microtasks so the void import chain resolves
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect((globalThis as Record<string, unknown>).__xaDecoderReady).toBe(true);
		expect((globalThis as Record<string, unknown>).__xaDecoderError).toBeUndefined();
	});

	it('sets __xaDecoderError when xa_decoder init fails with Error', async () => {
		mockInit.mockRejectedValueOnce(new Error('Init failed'));

		const { load } = await import('./+layout');
		await load();

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect((globalThis as Record<string, unknown>).__xaDecoderReady).toBe(false);
		expect((globalThis as Record<string, unknown>).__xaDecoderError).toBe('Init failed');
	});

	it('sets __xaDecoderError with String() when non-Error is thrown', async () => {
		mockInit.mockRejectedValueOnce('string error');

		const { load } = await import('./+layout');
		await load();

		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect((globalThis as Record<string, unknown>).__xaDecoderReady).toBe(false);
		expect((globalThis as Record<string, unknown>).__xaDecoderError).toBe('string error');
	});
});
