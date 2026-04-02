import { describe, it, expect, vi } from 'vitest';
import type { KVNamespace } from '@cloudflare/workers-types';
import { getClientIp, tryConsumeRateLimit } from './rateLimiter';

describe('getClientIp', () => {
	it('returns the first forwarded IP when present', () => {
		const request = {
			headers: new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
		} as Request;

		expect(getClientIp(request)).toBe('1.2.3.4');
	});

	it('returns null for missing or unknown client IPs', () => {
		expect(getClientIp({ headers: new Headers() } as Request)).toBeNull();
		expect(
			getClientIp({ headers: new Headers({ 'cf-connecting-ip': 'unknown' }) } as Request)
		).toBeNull();
	});
});

describe('tryConsumeRateLimit', () => {
	it('falls back to zero when KV contains an invalid value', async () => {
		const kv = {
			get: vi.fn().mockResolvedValueOnce('not-a-number').mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 128, 123 * 60000);

		expect(result).toEqual({ allowed: true, remainingBytes: 1073741824 });
		expect(kv.get).toHaveBeenNthCalledWith(1, 'dl:1.2.3.4:123');
		expect(kv.get).toHaveBeenNthCalledWith(2, 'dl:1.2.3.4:122');
		expect(kv.put).toHaveBeenCalledWith('dl:1.2.3.4:123', '128', { expirationTtl: 120 });
	});

	it('blocks requests that exceed the per-minute byte budget', async () => {
		const kv = {
			get: vi.fn().mockResolvedValueOnce('1073741824').mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 1, 123 * 60000);

		expect(result).toEqual({ allowed: false, remainingBytes: 0 });
		expect(kv.put).not.toHaveBeenCalled();
	});

	it('supports non-consuming validation checks', async () => {
		const kv = {
			get: vi.fn().mockResolvedValueOnce('256').mockResolvedValueOnce('512'),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 128, 123 * 60000, false);

		expect(result).toEqual({ allowed: true, remainingBytes: 1073741056 });
		expect(kv.put).not.toHaveBeenCalled();
	});

	it('weights prior-minute usage by the overlapping portion of the trailing window', async () => {
		const kv = {
			get: vi.fn().mockResolvedValueOnce('512').mockResolvedValueOnce('1073741312'),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const expectedRemainingBytes = 1055845623;
		const now = 123 * 60000 + 59000;
		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 1, now);

		expect(result).toEqual({ allowed: true, remainingBytes: expectedRemainingBytes });
		expect(kv.put).toHaveBeenCalledWith('dl:1.2.3.4:123', '513', { expirationTtl: 120 });
	});
});
