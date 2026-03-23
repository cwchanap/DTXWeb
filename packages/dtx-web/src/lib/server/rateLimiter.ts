import type { KVNamespace } from '@cloudflare/workers-types';

const RATE_LIMIT_BYTES = 1073741824; // 1 GiB per minute
const KV_TTL_SECONDS = 120; // cover current and previous minute window

export interface RateLimitResult {
	allowed: boolean;
	remainingBytes: number;
}

const getRateLimitKey = (ip: string, nowMinute: number): string => `dl:${ip}:${nowMinute}`;

/**
 * Best-effort bandwidth limiter for the given IP using Cloudflare KV.
 * Cloudflare KV does not provide atomic read-modify-write semantics, so this reads once,
 * writes only when the limit appears to allow it, and may still permit brief concurrent overages.
 * Returns { allowed: false } without writing when the quota would be exceeded by the observed value.
 * @param nowMinute injectable for testing — defaults to current UTC minute
 */
export const tryConsumeRateLimit = async (
	kv: KVNamespace,
	ip: string,
	bytes: number,
	nowMinute = Math.floor(Date.now() / 60000)
): Promise<RateLimitResult> => {
	const key = getRateLimitKey(ip, nowMinute);
	const current = Number((await kv.get(key)) ?? '0');
	const allowed = current + bytes <= RATE_LIMIT_BYTES;
	if (allowed) {
		await kv.put(key, String(current + bytes), { expirationTtl: KV_TTL_SECONDS });
	}
	return { allowed, remainingBytes: Math.max(0, RATE_LIMIT_BYTES - current) };
};
