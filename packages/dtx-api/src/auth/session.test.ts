import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';

const authMocks = vi.hoisted(() => ({
	createAuth: vi.fn(),
	getSession: vi.fn()
}));

vi.mock('./auth', () => ({ createAuth: authMocks.createAuth }));

import { resolveAuthSession } from './session';

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: {} as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	BETTER_AUTH_URL: 'https://api.example.com',
	BETTER_AUTH_SECRET: 'test-secret',
	DTX_WEB_URL: 'https://web.example.com/app',
	AUTH_COOKIE_PREFIX: 'dtx-test',
	GOOGLE_AUTH_CLIENT_ID: 'google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'google-client-secret',
	SUPABASE_URL: '',
	SUPABASE_ANON_KEY: '',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: 'https://web.example.com',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	SUPABASE_SERVICE_ROLE_KEY: '',
	...overrides
});

const sessionResult = {
	user: {
		id: 'user-1',
		email: 'user@example.com',
		name: 'Test User'
	},
	session: {
		id: 'session-1',
		userId: 'user-1',
		expiresAt: new Date('2030-01-01T00:00:00.000Z')
	}
};

const makeRequest = (method: string, headers: Record<string, string> = {}) =>
	new Request('https://api.example.com/graphql', { method, headers });

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.createAuth.mockReturnValue({ api: { getSession: authMocks.getSession } });
	authMocks.getSession.mockResolvedValue(sessionResult);
});

describe('resolveAuthSession', () => {
	it('accepts a valid cookie session for a GET without Origin', async () => {
		const request = makeRequest('GET', { cookie: 'dtx-local-session=session' });

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toEqual({ user: { id: 'user-1' }, session: sessionResult.session });
		expect(authMocks.getSession).toHaveBeenCalledWith({ headers: request.headers });
	});

	it('accepts a valid cookie session for a POST from the canonical web Origin', async () => {
		const request = makeRequest('POST', {
			cookie: 'dtx-local-session=session',
			Origin: 'https://web.example.com'
		});

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toEqual({ user: { id: 'user-1' }, session: sessionResult.session });
	});

	it('rejects a cookie POST without Origin before consulting Better Auth', async () => {
		const request = makeRequest('POST', { cookie: 'dtx-local-session=session' });

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toBeNull();
		expect(authMocks.getSession).not.toHaveBeenCalled();
	});

	it('rejects a cookie POST from a different Origin before consulting Better Auth', async () => {
		const request = makeRequest('POST', {
			cookie: 'dtx-local-session=session',
			Origin: 'https://evil.example.com'
		});

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toBeNull();
		expect(authMocks.getSession).not.toHaveBeenCalled();
	});

	it('accepts a valid Bearer session for a POST without Origin', async () => {
		const request = makeRequest('POST', { Authorization: 'Bearer opaque-session-token' });

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toEqual({ user: { id: 'user-1' }, session: sessionResult.session });
		expect(authMocks.getSession).toHaveBeenCalledWith({ headers: request.headers });
	});

	it('returns null for a malformed Bearer session', async () => {
		authMocks.getSession.mockResolvedValue(null);
		const request = makeRequest('POST', { Authorization: 'Bearer malformed-token' });

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toBeNull();
	});

	it('returns null when credentials are missing', async () => {
		authMocks.getSession.mockResolvedValue(null);
		const result = await resolveAuthSession(makeRequest('GET'), makeEnv());

		expect(result).toBeNull();
	});

	it('returns null for a revoked or expired session', async () => {
		authMocks.getSession.mockResolvedValue(null);
		const request = makeRequest('GET', { cookie: 'dtx-local-session=revoked' });

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toBeNull();
	});

	it('returns null when Better Auth session validation throws', async () => {
		authMocks.getSession.mockRejectedValue(new Error('D1 unavailable'));
		const request = makeRequest('GET', { cookie: 'dtx-local-session=session' });

		const result = await resolveAuthSession(request, makeEnv());

		expect(result).toBeNull();
	});
});
