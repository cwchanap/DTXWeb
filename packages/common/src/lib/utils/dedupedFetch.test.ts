import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { dedupedFetch } from './dedupedFetch';

describe('dedupedFetch', () => {
	let fetchSpy: MockInstance<typeof globalThis.fetch>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch');
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	const makeResponse = (body: string, init?: ResponseInit) => new Response(body, init);

	it('dedupes concurrent GET requests to the same URL', async () => {
		fetchSpy.mockImplementation(async () => makeResponse('hello'));

		const [a, b] = await Promise.all([
			dedupedFetch('https://example.com/x'),
			dedupedFetch('https://example.com/x')
		]);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(await a.text()).toBe('hello');
		expect(await b.text()).toBe('hello');
	});

	it('does not dedupe sequential calls (post-settle)', async () => {
		fetchSpy.mockImplementation(async () => makeResponse('hello'));

		await dedupedFetch('https://example.com/x');
		await dedupedFetch('https://example.com/x');

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('treats different URLs independently', async () => {
		fetchSpy.mockImplementation(async (input) => makeResponse(String(input)));

		await Promise.all([
			dedupedFetch('https://example.com/a'),
			dedupedFetch('https://example.com/b')
		]);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('propagates rejection to all concurrent callers and recovers afterwards', async () => {
		fetchSpy.mockRejectedValueOnce(new Error('boom'));

		const calls = await Promise.allSettled([
			dedupedFetch('https://example.com/fail'),
			dedupedFetch('https://example.com/fail')
		]);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(calls[0].status).toBe('rejected');
		expect(calls[1].status).toBe('rejected');

		// Subsequent call after settle should retry, not stay stuck.
		fetchSpy.mockResolvedValueOnce(makeResponse('ok'));
		const recovered = await dedupedFetch('https://example.com/fail');
		expect(await recovered.text()).toBe('ok');
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('passes non-GET/HEAD methods through without deduping', async () => {
		fetchSpy.mockImplementation(async () => makeResponse('ok'));

		await Promise.all([
			dedupedFetch('https://example.com/x', { method: 'POST' }),
			dedupedFetch('https://example.com/x', { method: 'POST' })
		]);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});
});
