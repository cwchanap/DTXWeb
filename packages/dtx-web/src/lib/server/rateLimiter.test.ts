import { describe, it, expect, vi } from 'vitest';
import type { KVNamespace } from '@cloudflare/workers-types';
import { getClientIp, tryConsumeRateLimit } from './rateLimiter';

vi.mock('$lib/server/logger', () => ({
	default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}));

describe('getClientIp', () => {
	it('returns the first forwarded IP when present', () => {
		const request = {
			headers: new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
		} as Request;

		expect(getClientIp(request)).toBe('1.2.3.4');
	});

	it('returns the cf-connecting-ip when present and valid', () => {
		const request = {
			headers: new Headers({ 'cf-connecting-ip': '203.0.113.42' })
		} as Request;

		expect(getClientIp(request)).toBe('203.0.113.42');
	});

	it('prefers cf-connecting-ip over x-forwarded-for', () => {
		const request = {
			headers: new Headers({
				'cf-connecting-ip': '10.0.0.1',
				'x-forwarded-for': '192.168.1.1, 172.16.0.1'
			})
		} as Request;

		expect(getClientIp(request)).toBe('10.0.0.1');
	});

	it('returns null for missing or unknown client IPs', () => {
		expect(getClientIp({ headers: new Headers() } as Request)).toBeNull();
		expect(
			getClientIp({ headers: new Headers({ 'cf-connecting-ip': 'unknown' }) } as Request)
		).toBeNull();
	});

	it('returns null when IP value is empty string', () => {
		const request = {
			headers: new Headers({ 'x-forwarded-for': '' })
		} as Request;

		expect(getClientIp(request)).toBeNull();
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

	it('throws and does not swallow errors from KV get', async () => {
		const kvError = new Error('KV connection failed');
		const kv = {
			get: vi.fn().mockRejectedValue(kvError),
			put: vi.fn()
		} as unknown as KVNamespace;

		await expect(tryConsumeRateLimit(kv, '1.2.3.4', 128, 123 * 60000)).rejects.toThrow(
			'KV connection failed'
		);
		expect(kv.put).not.toHaveBeenCalled();
	});

	it('does not put when consume is false even if allowed', async () => {
		const kv = {
			get: vi.fn().mockResolvedValue(null),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 512, 123 * 60000, false);

		expect(result.allowed).toBe(true);
		expect(kv.put).not.toHaveBeenCalled();
	});

	it('remainingBytes is 0 when limit is exactly met', async () => {
		const kv = {
			get: vi.fn().mockResolvedValueOnce('1073741824').mockResolvedValueOnce(null),
			put: vi.fn()
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 0, 123 * 60000);
		expect(result.remainingBytes).toBe(0);
	});

	it('handles negative stored values gracefully by treating them as zero', async () => {
		const kv = {
			get: vi.fn().mockResolvedValueOnce('-500').mockResolvedValueOnce(null),
			put: vi.fn().mockResolvedValue(undefined)
		} as unknown as KVNamespace;

		const result = await tryConsumeRateLimit(kv, '1.2.3.4', 100, 123 * 60000);
		expect(result.allowed).toBe(true);
		expect(kv.put).toHaveBeenCalledWith('dl:1.2.3.4:123', '100', { expirationTtl: 120 });
	});
});
