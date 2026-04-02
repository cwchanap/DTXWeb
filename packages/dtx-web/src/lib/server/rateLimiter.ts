import type { KVNamespace } from '@cloudflare/workers-types';
import logger from '$lib/server/logger';

const RATE_LIMIT_BYTES = 1073741824; // 1 GiB per minute
const KV_TTL_SECONDS = 120; // cover current and previous minute window

export interface RateLimitResult {
	allowed: boolean;
	remainingBytes: number;
}

const getRateLimitKey = (ip: string, nowMinute: number): string => `dl:${ip}:${nowMinute}`;

export const getClientIp = (request: Request): string | null => {
	const forwardedIp =
		request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
	const ip = forwardedIp?.split(',')[0]?.trim();

	if (!ip || ip.toLowerCase() === 'unknown') {
		return null;
	}

	return ip;
};

/**
 * Best-effort bandwidth limiter for the given IP using Cloudflare KV.
 * Cloudflare KV does not provide atomic read-modify-write semantics, so this reads once,
 * writes only when the limit appears to allow it, and may still permit brief concurrent overages.
 * Returns { allowed: false } without writing when the quota would be exceeded by the observed value.
 * @param now injectable for testing — defaults to the current timestamp in milliseconds
 */
export const tryConsumeRateLimit = async (
	kv: KVNamespace,
	ip: string,
	bytes: number,
	now = Date.now(),
	consume = true
): Promise<RateLimitResult> => {
	const nowMinute = Math.floor(now / 60000);
	const key = getRateLimitKey(ip, nowMinute);
	const previousKey = getRateLimitKey(ip, nowMinute - 1);
	try {
		const [storedValue, previousStoredValue] = await Promise.all([
			kv.get(key),
			kv.get(previousKey)
		]);
		const parsedValue = storedValue === null ? 0 : Number.parseInt(storedValue, 10);
		const parsedPreviousValue =
			previousStoredValue === null ? 0 : Number.parseInt(previousStoredValue, 10);
		const current = Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
		const previous =
			Number.isFinite(parsedPreviousValue) && parsedPreviousValue >= 0
				? parsedPreviousValue
				: 0;
		const currentMinuteElapsedMs = now - nowMinute * 60000;
		const previousWindowWeight = Math.max(0, (60000 - currentMinuteElapsedMs) / 60000);
		const windowTotal = current + previous * previousWindowWeight;
		const allowed = windowTotal + bytes <= RATE_LIMIT_BYTES;
		if (allowed && consume) {
			await kv.put(key, String(current + bytes), { expirationTtl: KV_TTL_SECONDS });
		}
		return {
			allowed,
			remainingBytes: Math.max(0, Math.floor(RATE_LIMIT_BYTES - windowTotal))
		};
	} catch (error) {
		logger.error('Rate limit KV error', { key, error });
		throw error;
	}
};
