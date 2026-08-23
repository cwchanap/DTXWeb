import { beforeEach, describe, expect, it, test, vi } from 'vitest';
import type { Env } from '../env';
import * as authSchema from './schema';

const authMocks = vi.hoisted(() => ({
	betterAuth: vi.fn(() => ({ handler: vi.fn(), api: {} })),
	drizzle: vi.fn(() => 'request-scoped-drizzle'),
	drizzleAdapter: vi.fn(() => 'better-auth-adapter')
}));

vi.mock('better-auth', () => ({ betterAuth: authMocks.betterAuth }));
vi.mock('drizzle-orm/d1', () => ({ drizzle: authMocks.drizzle }));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: authMocks.drizzleAdapter }));

import authCli from './auth.cli';
import { createAuth } from './auth';

const makeEnv = (overrides: Partial<Env> = {}): Env => ({
	DB: { name: 'd1' } as unknown as Env['DB'],
	DTXFILE_BUCKET: {} as Env['DTXFILE_BUCKET'],
	RATE_LIMIT_API: {} as Env['RATE_LIMIT_API'],
	BETTER_AUTH_URL: 'https://api.example.com',
	BETTER_AUTH_SECRET: 'test-secret',
	DTX_WEB_URL: 'https://web.example.com',
	AUTH_COOKIE_DOMAIN: 'example.com',
	AUTH_COOKIE_PREFIX: 'dtx',
	GOOGLE_AUTH_CLIENT_ID: 'google-client-id',
	GOOGLE_AUTH_CLIENT_SECRET: 'google-client-secret',
	RATE_LIMIT_ENV: 'pre-prod',
	GRAPHIQL: 'false',
	CORS_ALLOWED_ORIGINS: 'https://web.example.com',
	PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false',
	PUBLIC_SIMFILE_BUCKET_URL: '',
	...overrides
});

describe('createAuth', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('creates a usable Better Auth CLI instance', () => {
		expect(authCli).toBeTruthy();
		expect(typeof authCli.api).toBe('object');
	});

	it('creates Better Auth with request-scoped D1 Drizzle storage and the Task 1 options', () => {
		const env = makeEnv();

		const auth = createAuth(env);

		expect(authMocks.drizzle).toHaveBeenCalledWith(env.DB, { schema: authSchema });
		expect(authMocks.drizzleAdapter).toHaveBeenCalledWith('request-scoped-drizzle', {
			provider: 'sqlite'
		});
		expect(authMocks.betterAuth).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: env.BETTER_AUTH_URL,
				secret: env.BETTER_AUTH_SECRET,
				trustedOrigins: [env.DTX_WEB_URL],
				database: 'better-auth-adapter',
				advanced: expect.objectContaining({
					cookiePrefix: env.AUTH_COOKIE_PREFIX,
					crossSubDomainCookies: { enabled: true, domain: env.AUTH_COOKIE_DOMAIN }
				}),
				socialProviders: {
					google: expect.objectContaining({
						clientId: env.GOOGLE_AUTH_CLIENT_ID,
						clientSecret: env.GOOGLE_AUTH_CLIENT_SECRET
					})
				}
			})
		);
		expect(auth.handler).toBeDefined();
	});

	it('disables cross-subdomain cookies when the local domain is omitted', () => {
		const env = makeEnv();
		delete env.AUTH_COOKIE_DOMAIN;

		createAuth(env);

		expect(authMocks.betterAuth).toHaveBeenCalledWith(
			expect.objectContaining({
				advanced: expect.objectContaining({
					crossSubDomainCookies: { enabled: false }
				})
			})
		);
	});

	it('retains the pre-production cross-subdomain cookie domain', () => {
		const env = makeEnv({ AUTH_COOKIE_DOMAIN: 'pre-prod.dtx.hapadona.com' });

		createAuth(env);

		expect(authMocks.betterAuth).toHaveBeenCalledWith(
			expect.objectContaining({
				advanced: expect.objectContaining({
					crossSubDomainCookies: {
						enabled: true,
						domain: 'pre-prod.dtx.hapadona.com'
					}
				})
			})
		);
	});
});
