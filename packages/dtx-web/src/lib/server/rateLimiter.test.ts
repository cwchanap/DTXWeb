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
			get: vi.fn().mockResolvedValue('not-a-number'),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 128, 123);

		expect(result).toEqual({ allowed: true, remainingBytes: 1073741824 });
		expect(kv.put).toHaveBeenCalledWith('dl:1.2.3.4:123', '128', { expirationTtl: 120 });
	});

	it('blocks requests that exceed the per-minute byte budget', async () => {
		const kv = {
			get: vi.fn().mockResolvedValue('1073741824'),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 1, 123);

		expect(result).toEqual({ allowed: false, remainingBytes: 0 });
		expect(kv.put).not.toHaveBeenCalled();
	});

	it('supports non-consuming validation checks', async () => {
		const kv = {
			get: vi.fn().mockResolvedValue('256'),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 128, 123, false);

		expect(result).toEqual({ allowed: true, remainingBytes: 1073741568 });
		expect(kv.put).not.toHaveBeenCalled();
	});
});
