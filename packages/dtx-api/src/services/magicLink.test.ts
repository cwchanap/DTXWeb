import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workerLogger } from '@dtx/common/server';
import { generateMagicLink, anonymizeIp } from './magicLink';
import type { Env } from '../env';
import type { KVNamespace } from '@cloudflare/workers-types';

vi.mock('@supabase/supabase-js', () => {
	const generateLink = vi.fn();
	return {
		createClient: vi.fn(() => ({ auth: { admin: { generateLink } } })),
		__generateLink: generateLink
	};
});

const { __generateLink } = (await import('@supabase/supabase-js')) as unknown as {
	__generateLink: ReturnType<typeof vi.fn>;
};

const makeEnv = (): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
});

const makeKv = (initial: Record<string, string> = {}): KVNamespace => {
	const store = new Map(Object.entries(initial));
	return {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(),
		list: vi.fn(),
		getWithMetadata: vi.fn()
	} as unknown as KVNamespace;
};

// Freeze time so the hour bucket computed in the test matches the one computed
// inside generateMagicLink. Without this, tests can flake at hour boundaries.
const FROZEN_TIME = new Date('2025-01-15T12:30:00.000Z');

beforeEach(() => {
	__generateLink.mockReset();
	vi.useFakeTimers();
	vi.setSystemTime(FROZEN_TIME);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('anonymizeIp', () => {
	it('zeroes the last v4 octet', () => {
		expect(anonymizeIp('1.2.3.4')).toBe('1.2.3.x');
	});

	it('truncates v6 to group-4', () => {
		expect(anonymizeIp('2001:db8:abcd:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd:0012:*');
	});

	it('returns "redacted" for invalid input', () => {
		expect(anonymizeIp('not-an-ip')).toBe('redacted');
	});

	it('returns "redacted" for compressed/empty-group IPv6', () => {
		expect(anonymizeIp('2001:db8::1')).toBe('redacted');
		expect(anonymizeIp('::::')).toBe('redacted');
	});
});

describe('generateMagicLink', () => {
	it('returns the action link on success and writes an audit log', async () => {
		__generateLink.mockResolvedValue({
			data: { properties: { action_link: 'https://example.com/magic' } },
			error: null
		});
		const env = makeEnv();
		const kv = makeKv();
		const logSpy = vi.spyOn(workerLogger, 'info').mockImplementation(() => {});

		const result = await generateMagicLink(
			env,
			kv,
			workerLogger,
			{ id: 'u1', email: 'a@b.com' },
			'1.2.3.4'
		);

		expect(result).toEqual({ magicLinkUrl: 'https://example.com/magic' });
		expect(__generateLink).toHaveBeenCalledWith({
			type: 'magiclink',
			email: 'a@b.com',
			options: { redirectTo: 'dtx://auth-callback' }
		});
		expect(logSpy).toHaveBeenCalledWith(
			'magiclink_generated',
			expect.objectContaining({ userId: 'u1', ip: '1.2.3.x' })
		);
		logSpy.mockRestore();
	});

	it('increments KV counter on success', async () => {
		__generateLink.mockResolvedValue({
			data: { properties: { action_link: 'https://example.com/magic' } },
			error: null
		});
		const env = makeEnv();
		const kv = makeKv();
		await generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null);
		const hour = Math.floor(Date.now() / 3_600_000);
		expect(kv.put).toHaveBeenCalledWith(`magiclink:u1:${hour}`, '1', { expirationTtl: 3600 });
	});

	it('throws RATE_LIMITED when counter is at 5', async () => {
		const env = makeEnv();
		const hour = Math.floor(Date.now() / 3_600_000);
		const kv = makeKv({ [`magiclink:u1:${hour}`]: '5' });
		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).rejects.toMatchObject({ extensions: { code: 'RATE_LIMITED' } });
		expect(__generateLink).not.toHaveBeenCalled();
	});

	it('uses configured hourly limit when provided', async () => {
		__generateLink.mockResolvedValue({
			data: { properties: { action_link: 'https://example.com/magic' } },
			error: null
		});
		const env = { ...makeEnv(), MAGIC_LINK_HOURLY_LIMIT: '1000' };
		const hour = Math.floor(Date.now() / 3_600_000);
		const kv = makeKv({ [`magiclink:u1:${hour}`]: '5' });

		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).resolves.toEqual({ magicLinkUrl: 'https://example.com/magic' });

		expect(__generateLink).toHaveBeenCalledOnce();
		expect(kv.put).toHaveBeenCalledWith(`magiclink:u1:${hour}`, '6', {
			expirationTtl: 3600
		});
	});

	it('falls back to the default hourly limit when configuration is invalid', async () => {
		const env = { ...makeEnv(), MAGIC_LINK_HOURLY_LIMIT: 'not-a-number' };
		const hour = Math.floor(Date.now() / 3_600_000);
		const kv = makeKv({ [`magiclink:u1:${hour}`]: '5' });

		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).rejects.toMatchObject({ extensions: { code: 'RATE_LIMITED' } });
		expect(__generateLink).not.toHaveBeenCalled();
	});

	it('throws INTERNAL when Supabase admin returns an error', async () => {
		__generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } });
		const env = makeEnv();
		const kv = makeKv();
		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).rejects.toMatchObject({ extensions: { code: 'INTERNAL' } });
	});

	it('throws INTERNAL when Supabase returns success without action_link', async () => {
		__generateLink.mockResolvedValue({ data: { properties: {} }, error: null });
		const env = makeEnv();
		const kv = makeKv();
		await expect(
			generateMagicLink(env, kv, workerLogger, { id: 'u1', email: 'a@b.com' }, null)
		).rejects.toMatchObject({ extensions: { code: 'INTERNAL' } });
	});
});
