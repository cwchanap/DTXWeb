import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { GraphQLError } from 'graphql';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { WorkerLogger } from '@dtx/common/server';
import type { Env } from '../env';

const DEFAULT_MAGIC_LINK_HOURLY_LIMIT = 5;
const adminCache = new WeakMap<Env, SupabaseClient>();

const magicLinkHourlyLimit = (env: Env): number => {
	const configured = Number(env.MAGIC_LINK_HOURLY_LIMIT);
	if (Number.isSafeInteger(configured) && configured > 0) {
		return configured;
	}
	return DEFAULT_MAGIC_LINK_HOURLY_LIMIT;
};

const getAdmin = (env: Env): SupabaseClient => {
	let cached = adminCache.get(env);
	if (!cached) {
		cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		adminCache.set(env, cached);
	}
	return cached;
};

// KV has no CAS primitive, so this read-modify-write tolerates ±1 over the
// limit if concurrent calls land between get and put — acceptable for a
// low-volume per-user magic-link flow.
const checkAndIncrement = async (
	kv: KVNamespace,
	userId: string,
	hourlyLimit: number
): Promise<boolean> => {
	const hour = Math.floor(Date.now() / 3_600_000);
	const key = `magiclink:${userId}:${hour}`;
	const currentRaw = await kv.get(key);
	const current = currentRaw ? Number(currentRaw) : 0;
	if (Number.isFinite(current) && current >= hourlyLimit) {
		return false;
	}
	await kv.put(key, String((Number.isFinite(current) ? current : 0) + 1), {
		expirationTtl: 3600
	});
	return true;
};

export const anonymizeIp = (ip: string | null): string => {
	if (!ip) return 'redacted';
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
	if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
	if (ip.includes(':')) {
		const parts = ip.split(':').slice(0, 4);
		if (parts.length === 4 && parts.every((p) => /^[0-9a-fA-F]+$/.test(p))) {
			return `${parts.join(':')}:*`;
		}
	}
	return 'redacted';
};

export const generateMagicLink = async (
	env: Env,
	kv: KVNamespace,
	logger: WorkerLogger,
	user: { id: string; email: string },
	ip: string | null
): Promise<{ magicLinkUrl: string }> => {
	const allowed = await checkAndIncrement(kv, user.id, magicLinkHourlyLimit(env));
	if (!allowed) {
		throw new GraphQLError('Too Many Requests', { extensions: { code: 'RATE_LIMITED' } });
	}

	const admin = getAdmin(env);
	const { data, error } = await admin.auth.admin.generateLink({
		type: 'magiclink',
		email: user.email,
		options: { redirectTo: 'dtx://auth-callback' }
	});

	if (error || !data?.properties?.action_link) {
		logger.error('magic link generation failed', {
			userId: user.id,
			error: error?.message
		});
		throw new GraphQLError('Failed to generate magic link', {
			extensions: { code: 'INTERNAL' }
		});
	}

	logger.info('magiclink_generated', { userId: user.id, ip: anonymizeIp(ip) });
	return { magicLinkUrl: data.properties.action_link };
};
