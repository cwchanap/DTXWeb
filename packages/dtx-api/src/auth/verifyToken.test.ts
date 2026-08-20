import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../env';

vi.mock('@supabase/supabase-js', () => {
	const getUser = vi.fn();
	return {
		createClient: vi.fn(() => ({ auth: { getUser } })),
		__getUser: getUser
	};
});

let verifyToken: typeof import('./verifyToken').verifyToken;
let getUser: ReturnType<typeof vi.fn>;

beforeEach(async () => {
	vi.resetModules();
	const mod = await import('@supabase/supabase-js');
	getUser = (mod as unknown as { __getUser: ReturnType<typeof vi.fn> }).__getUser;
	getUser.mockReset();
	({ verifyToken } = await import('./verifyToken'));
});

const env: Env = {
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	BETTER_AUTH_URL: 'https://api.test',
	BETTER_AUTH_SECRET: 'test-secret',
	DTX_WEB_URL: 'http://localhost:5173',
	AUTH_COOKIE_PREFIX: 'dtx-test',
	GOOGLE_AUTH_CLIENT_ID: 'google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'google-client-secret',
	SUPABASE_URL: 'https://example.supabase.co',
	SUPABASE_ANON_KEY: 'anon-key',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'true',
	CORS_ALLOWED_ORIGINS: '',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: ''
};

const makeJwt = (payload: Record<string, unknown>): string => {
	const b64url = (obj: unknown): string =>
		btoa(JSON.stringify(obj)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
	return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
};

const reqWith = (headers: Record<string, string>): Request =>
	new Request('https://api.test/anything', { headers });

describe('verifyToken', () => {
	it('returns null when Authorization header is absent', async () => {
		expect(await verifyToken(reqWith({}), env)).toBeNull();
	});

	it('returns null when Authorization is not a Bearer token', async () => {
		expect(await verifyToken(reqWith({ authorization: 'Basic abc' }), env)).toBeNull();
	});

	it('returns null when Bearer token is empty after the prefix', async () => {
		expect(await verifyToken(reqWith({ authorization: 'Bearer   ' }), env)).toBeNull();
	});

	it('returns null when supabase.auth.getUser rejects', async () => {
		getUser.mockRejectedValue(new Error('bad token'));
		const token = makeJwt({ exp: 9999999999 });
		await expect(
			verifyToken(reqWith({ authorization: `Bearer ${token}` }), env)
		).resolves.toBeNull();
	});

	it('returns user + synthetic session when supabase accepts a valid token', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });

		const result = await verifyToken(reqWith({ authorization: `Bearer ${token}` }), env);

		expect(result).not.toBeNull();
		expect(result!.user).toEqual(user);
		expect(result!.session.access_token).toBe(token);
		expect(result!.session.token_type).toBe('bearer');
		expect(result!.session.refresh_token).toBe('');
		expect(result!.session.expires_in).toBeGreaterThan(0);
		expect(result!.session.expires_in).toBeLessThanOrEqual(3600);
	});

	it('clamps expires_in to 0 when exp is in the past (parity with hooks.server.ts)', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const token = makeJwt({ exp: 1 });

		const result = await verifyToken(reqWith({ authorization: `Bearer ${token}` }), env);

		expect(result).not.toBeNull();
		expect(result!.session.expires_in).toBe(0);
	});

	it('returns null when JWT payload is undecodable', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const result = await verifyToken(reqWith({ authorization: 'Bearer not.a.valid.jwt' }), env);
		expect(result).toBeNull();
	});

	it('accepts case-insensitive Bearer prefix', async () => {
		const user = { id: 'user-1', email: 'a@b.com' };
		getUser.mockResolvedValue({ data: { user }, error: null });
		const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
		const result = await verifyToken(reqWith({ authorization: `bearer ${token}` }), env);
		expect(result).not.toBeNull();
	});
});
